/**
 * Journal — what Ilse did, how long each step took, what it cost.
 *
 * The raw material for making Ilse smoother: where the designer waits, where
 * the agent wanders, what gets undone. Exported from the toolbar
 * (Settings → Logs → JSON / Markdown → Copy).
 *
 * Privacy by construction: no note text, no prompt, no code, no file paths.
 * Only intents, counts, lengths, timings, tokens and outcomes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import type { Annotation } from '../types.js';

export type RunPath = 'swap' | 'quick' | 'agent' | 'mcp' | 'clipboard';

export interface RunRecord {
  id: string;
  batchId?: string;
  receivedAt: string;
  intent?: string;
  severity?: string;
  path?: RunPath;
  input: {
    captureMode?: string;
    noteChars: number;
    images: number;
    styleProps: string[];     // property names only (gap, fontWeight…)
    moved: boolean;
    resized: boolean;
    /** Earlier Ilse changes to the same file put in the prompt (0 = none / ILSE_HISTORY=0) */
    history?: number;
    composeMs?: number;       // designer effort: capture → added
  };
  locate: { found: boolean; kind?: string; score?: number; candidates: number; ms?: number };
  swap?: { applied: boolean; reason?: string };
  /** Why the quick path didn't take it (blocked before, or the model said it needs more) */
  quick?: { applied: boolean; reason?: string };
  /** ms since the annotation reached the CLI */
  timeline: {
    queued?: number;          // batch started (after debounce)
    agentStart?: number;      // agent process spawned / claimed via MCP
    firstEvent?: number;      // agent said anything (cold start ends)
    firstTool?: number;
    firstEdit?: number;
    resolved?: number;
    end?: number;             // batch finished
  };
  outcome: { resolved: boolean; error?: string; stopped?: boolean; undone: boolean; undoneAfterMs?: number };
}

export interface BatchRecord {
  id: string;
  path: RunPath;
  agent?: string;
  size: number;
  startedAt: string;
  durationMs?: number;
  ok?: boolean;
  error?: string;
  resumed?: boolean;
  /** Model the agent ran on (alias or id); absent = the user's default */
  model?: string;
  /** Re-run one tier up after a cheaper model changed no file */
  escalated?: boolean;
  turns?: number;
  apiMs?: number;
  tools: Record<string, number>;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number };
  changes?: { files: number; added: number; removed: number };
}

export interface SessionInfo {
  startedAt: string;
  ilseVersion: string;
  node: string;
  platform: string;
  framework?: string;
  mode?: string;
  agent?: string;
  toolbar?: 'proxy' | 'component' | 'plugin';
}

export class Journal {
  readonly session: SessionInfo;
  private runs = new Map<string, RunRecord>();
  private runT0 = new Map<string, number>();
  private batches = new Map<string, BatchRecord>();
  private batchT0 = new Map<string, number>();
  private file?: string;

  constructor(session: Omit<SessionInfo, 'startedAt' | 'node' | 'platform'>, opts: { persist?: boolean } = {}) {
    this.session = { startedAt: new Date().toISOString(), node: process.version, platform: platform(), ...session };
    if (opts.persist !== false) {
      const dir = join(homedir(), '.ilse', 'logs');
      try { mkdirSync(dir, { recursive: true }); } catch { /* read-only home — memory only */ }
      this.file = join(dir, `session-${this.session.startedAt.replace(/[:.]/g, '-')}.json`);
    }
  }

  // ── Runs (one per annotation) ─────────────────────────────────────────────

  received(a: Annotation): void {
    if (this.runs.has(a.id)) return;
    const hit = a.source?.[0];
    this.runT0.set(a.id, Date.now());
    this.runs.set(a.id, {
      id: a.id,
      receivedAt: new Date().toISOString(),
      intent: a.intent,
      severity: a.severity,
      input: {
        captureMode: a.meta?.captureMode,
        noteChars: a.note?.trim().length ?? 0,
        images: (a.imageRefs?.length ?? 0) + (a.imageRef ? 1 : 0),
        styleProps: a.styleData?.changes.map(c => c.property) ?? [],
        moved: a.intent === 'move',
        resized: a.intent === 'resize',
        composeMs: a.meta?.composeMs,
      },
      locate: { found: !!hit, kind: hit?.kind, score: hit?.score, candidates: a.source?.length ?? 0, ms: a.meta?.locateMs },
      timeline: {},
      outcome: { resolved: false, undone: false },
    });
    this.save();
  }

  private mark(id: string, step: keyof RunRecord['timeline'], onlyFirst = true): void {
    const run = this.runs.get(id);
    const t0 = this.runT0.get(id);
    if (!run || t0 === undefined) return;
    if (onlyFirst && run.timeline[step] !== undefined) return;
    run.timeline[step] = Date.now() - t0;
  }

  swap(id: string, applied: boolean, reason?: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.swap = { applied, reason };
    if (applied) run.path = 'swap';
    this.save();
  }

  quick(id: string, applied: boolean, reason?: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.quick = { applied, reason };
    this.save();
  }

  resolved(id: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    this.mark(id, 'resolved');
    run.outcome.resolved = true;
    this.save();
  }

  undone(ids: string[]): void {
    for (const id of ids) {
      const run = this.runs.get(id);
      const t0 = this.runT0.get(id);
      if (!run || t0 === undefined) continue;
      run.outcome.undone = true;
      run.outcome.undoneAfterMs = Date.now() - t0 - (run.timeline.resolved ?? 0);
    }
    this.save();
  }

  // ── Batches (one agent run, or one MCP claim) ─────────────────────────────

  history(id: string, lines: number): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.input.history = lines;
    this.save();
  }

  /**
   * Claude reports total_cost_usd for the whole session — with --resume, that
   * includes every earlier batch of it. Summing those counted each resumed batch
   * again and again (a 28-annotation session showed $22 for ~$4 spent). The
   * batch's own cost is the difference from the session's previous total.
   */
  private sessionCost = new Map<string, number>();
  private batchCost(event: Record<string, unknown>): number {
    const total = Number(event.total_cost_usd ?? 0);
    const session = typeof event.session_id === 'string' ? event.session_id : undefined;
    if (!session) return total;
    const before = this.sessionCost.get(session) ?? 0;
    this.sessionCost.set(session, total);
    return Math.max(0, +(total - before).toFixed(6));
  }

  batchStart(id: string, ids: string[], path: RunPath, agent?: string, resumed?: boolean, run: { model?: string; escalated?: boolean } = {}): void {
    this.batchT0.set(id, Date.now());
    this.batches.set(id, { id, path, agent, size: ids.length, startedAt: new Date().toISOString(), resumed, tools: {}, ...run });
    for (const rid of ids) {
      const run = this.runs.get(rid);
      if (!run) continue;
      run.batchId = id;
      run.path = path;
      // A new attempt (the agent after the quick path, a tier up after a run that
      // changed nothing) starts clean — the handover isn't the annotation's failure
      run.outcome.error = undefined;
      run.outcome.stopped = undefined;
      this.mark(rid, 'queued');
      this.mark(rid, 'agentStart');
    }
    this.save();
  }

  private batchRuns(batchId: string): RunRecord[] {
    return [...this.runs.values()].filter(r => r.batchId === batchId);
  }

  /** Raw stream-json event from the spawned agent. */
  agentEvent(batchId: string, event: Record<string, unknown>): void {
    const batch = this.batches.get(batchId);
    if (!batch) return;
    const runs = this.batchRuns(batchId);
    for (const r of runs) this.mark(r.id, 'firstEvent');

    if (event.type === 'assistant') {
      const content = (event.message as { content?: Array<Record<string, unknown>> } | undefined)?.content ?? [];
      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        const name = String(block.name ?? 'tool');
        batch.tools[name] = (batch.tools[name] ?? 0) + 1;
        for (const r of runs) this.mark(r.id, 'firstTool');
        if (['Edit', 'Write', 'MultiEdit', 'Update'].includes(name)) for (const r of runs) this.mark(r.id, 'firstEdit');
      }
    }
    if (event.type === 'result') {
      const u = event.usage as Record<string, number> | undefined;
      if (u) {
        batch.tokens = {
          input: u.input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          costUsd: this.batchCost(event),
        };
      }
      if (typeof event.num_turns === 'number') batch.turns = event.num_turns;
      if (typeof event.duration_api_ms === 'number') batch.apiMs = event.duration_api_ms;
      this.save();
    }
  }

  /** MCP path: the agent's own tool calls are not visible, only claim → resolve. */
  batchChanges(batchId: string, changes: { files: number; added: number; removed: number }): void {
    const batch = this.batches.get(batchId);
    if (batch) { batch.changes = changes; this.save(); }
  }

  batchEnd(id: string, result: { ok: boolean; error?: string; stopped?: boolean }): void {
    const batch = this.batches.get(id);
    const t0 = this.batchT0.get(id);
    if (!batch || t0 === undefined) return;
    batch.durationMs = Date.now() - t0;
    batch.ok = result.ok;
    if (result.error) batch.error = result.error.slice(0, 120);
    for (const r of this.batchRuns(id)) {
      this.mark(r.id, 'end');
      if (!result.ok) {
        r.outcome.error = result.error?.slice(0, 120);
        r.outcome.stopped = result.stopped;
      }
    }
    this.save();
  }

  // ── Export ────────────────────────────────────────────────────────────────

  summary() {
    const runs = [...this.runs.values()];
    const batches = [...this.batches.values()];
    const byPath: Record<string, number> = {};
    for (const r of runs) byPath[r.path ?? 'pending'] = (byPath[r.path ?? 'pending'] ?? 0) + 1;
    const resolvedTimes = (p?: RunPath) => runs.filter(r => (!p || r.path === p) && r.timeline.resolved !== undefined).map(r => r.timeline.resolved!);
    const coldStarts = runs.map(r => r.timeline.firstEvent).filter((v): v is number => v !== undefined);
    const tokens = batches.reduce((acc, b) => {
      if (!b.tokens) return acc;
      acc.input += b.tokens.input; acc.output += b.tokens.output;
      acc.cacheRead += b.tokens.cacheRead; acc.cacheWrite += b.tokens.cacheWrite; acc.costUsd += b.tokens.costUsd;
      return acc;
    }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });
    // Every annotation an AI worked on — the quick path's cost counts too
    const agentRuns = runs.filter(r => r.path === 'agent' || r.path === 'quick').length;
    return {
      annotations: runs.length,
      byPath,
      resolved: runs.filter(r => r.outcome.resolved).length,
      undone: runs.filter(r => r.outcome.undone).length,
      errors: runs.filter(r => r.outcome.error && !r.outcome.stopped).length,
      locateHitRate: rate(runs.filter(r => r.locate.found).length, runs.length),
      swapRate: rate(runs.filter(r => r.path === 'swap').length, runs.length),
      quickRate: rate(runs.filter(r => r.path === 'quick').length, runs.length),
      medianComposeMs: median(runs.map(r => r.input.composeMs).filter((v): v is number => v !== undefined)),
      medianResolveMs: {
        all: median(resolvedTimes()),
        swap: median(resolvedTimes('swap')),
        quick: median(resolvedTimes('quick')),
        agent: median(resolvedTimes('agent')),
        mcp: median(resolvedTimes('mcp')),
      },
      medianColdStartMs: median(coldStarts),
      medianTurns: median(batches.map(b => b.turns).filter((v): v is number => v !== undefined)),
      tokens,
      tokensPerAgentAnnotation: agentRuns ? Math.round((tokens.input + tokens.cacheRead + tokens.cacheWrite) / agentRuns) : undefined,
      costPerAgentAnnotationUsd: agentRuns ? +(tokens.costUsd / agentRuns).toFixed(4) : undefined,
    };
  }

  toJSON() {
    return { session: this.session, summary: this.summary(), batches: [...this.batches.values()], runs: [...this.runs.values()] };
  }

  toMarkdown(): string {
    const s = this.summary();
    const ms = (v?: number) => v === undefined ? '—' : v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(1)}s`;
    const lines = [
      `# Ilse — journal`,
      ``,
      `${this.session.startedAt} · ilse ${this.session.ilseVersion} · ${this.session.framework ?? '?'} · mode ${this.session.mode ?? '?'} · agent ${this.session.agent ?? '?'} · ${this.session.toolbar ?? '?'}`,
      ``,
      `## Summary`,
      ``,
      `| | |`,
      `|---|---|`,
      `| Annotations | ${s.annotations} (${Object.entries(s.byPath).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}) |`,
      `| Resolved / undone / errors | ${s.resolved} / ${s.undone} / ${s.errors} |`,
      `| Located (file:line) | ${pct(s.locateHitRate)} |`,
      `| Applied without AI | ${pct(s.swapRate)} |`,
      `| Quick path (fast model, no agent) | ${pct(s.quickRate)} |`,
      `| Median compose time (designer) | ${ms(s.medianComposeMs)} |`,
      `| Median time to resolved | all ${ms(s.medianResolveMs.all)} · swap ${ms(s.medianResolveMs.swap)} · quick ${ms(s.medianResolveMs.quick)} · agent ${ms(s.medianResolveMs.agent)} · mcp ${ms(s.medianResolveMs.mcp)} |`,
      `| Median agent cold start | ${ms(s.medianColdStartMs)} |`,
      `| Median agent turns | ${s.medianTurns ?? '—'} |`,
      `| Tokens (in / out / cache read / cache write) | ${s.tokens.input} / ${s.tokens.output} / ${s.tokens.cacheRead} / ${s.tokens.cacheWrite} |`,
      `| Cost | $${s.tokens.costUsd.toFixed(4)}${s.costPerAgentAnnotationUsd !== undefined ? ` ($${s.costPerAgentAnnotationUsd} per AI annotation)` : ''} |`,
      ``,
      `## Annotations`,
      ``,
      `| id | intent | path | located | history | compose | queued | agent said | 1st edit | resolved | outcome |`,
      `|---|---|---|---|---|---|---|---|---|---|---|`,
    ];
    for (const r of this.runs.values()) {
      const outcome = r.outcome.undone ? `undone after ${ms(r.outcome.undoneAfterMs)}`
        : r.outcome.error ? (r.outcome.stopped ? 'stopped' : 'error')
        : r.outcome.resolved ? 'ok' : 'pending';
      lines.push(`| ${r.id} | ${r.intent ?? '—'} | ${r.path ?? '—'}${r.swap && !r.swap.applied ? ` (swap: ${r.swap.reason})` : ''}${r.quick && !r.quick.applied && r.path !== 'quick' ? ` (quick: ${r.quick.reason})` : ''} | ${r.locate.found ? `${r.locate.kind} ${r.locate.score}` : 'no'} | ${r.input.history ?? '—'} | ${ms(r.input.composeMs)} | ${ms(r.timeline.queued)} | ${ms(r.timeline.firstEvent)} | ${ms(r.timeline.firstEdit)} | ${ms(r.timeline.resolved)} | ${outcome} |`);
    }
    if (this.batches.size) {
      lines.push('', '## Agent runs', '', '| batch | path | model | size | duration | turns | tools | tokens in/out | cost |', '|---|---|---|---|---|---|---|---|---|');
      for (const b of this.batches.values()) {
        const tools = Object.entries(b.tools).map(([k, v]) => `${k}×${v}`).join(' ') || '—';
        lines.push(`| ${b.id} | ${b.path}${b.resumed ? ' (resumed)' : ''} | ${b.model ?? (b.path === 'agent' ? 'default' : '—')}${b.escalated ? ' ↑' : ''} | ${b.size} | ${ms(b.durationMs)} | ${b.turns ?? '—'} | ${tools} | ${b.tokens ? `${b.tokens.input + b.tokens.cacheRead + b.tokens.cacheWrite}/${b.tokens.output}` : '—'} | ${b.tokens ? `$${b.tokens.costUsd.toFixed(4)}` : '—'} |`);
      }
    }
    return lines.join('\n');
  }

  private save(): void {
    if (!this.file) return;
    try { writeFileSync(this.file, JSON.stringify(this.toJSON(), null, 2)); } catch { /* best effort */ }
  }
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function rate(n: number, total: number): number | undefined {
  return total ? +(n / total).toFixed(2) : undefined;
}

function pct(v?: number): string {
  return v === undefined ? '—' : `${Math.round(v * 100)}%`;
}
