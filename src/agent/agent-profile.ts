/**
 * How Ilse runs the user's agent for a visual fix — lean, isolated, sized to the job.
 *
 * The journal showed where the cost went: 7–11 turns per single-element fix,
 * mostly Bash (grep/cat/sed) redoing the search the locator had already done,
 * each turn re-sending the whole context — including the user's global
 * CLAUDE.md and memory (personal notes, other projects) that have nothing to do
 * with a padding change.
 *
 *   - Model by task: mechanical edits on a located element go to a fast model;
 *     judgement calls to a stronger one; open-ended creation to the user's own.
 *     A cheap run that changes no file is retried once one tier up.
 *   - Isolated: no user-level CLAUDE.md, no auto-memory. The project's own
 *     CLAUDE.md / AGENTS.md still go in — its conventions matter.
 *   - No shell: Read/Grep/Glob to look, Edit to change. Fewer turns, and every
 *     edit is a visible tool call.
 *
 * Claude only: the flags and variables below are Claude Code's.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Annotation } from '../types.js';

/**
 * Two tiers, named by what they are for, mapped to a model per agent:
 *   fast   — mechanical edits on a located element (a class, a size)
 *   strong — judgement: a fix in words, a move, a review
 *   default — the agent's own model, for open-ended work (new UI, chat, a picture)
 */
export type Tier = 'fast' | 'strong' | 'default';
export interface ModelTiers { fast?: string; strong?: string }
export type AgentName = 'claude' | 'codex' | 'cursor-agent' | 'gemini' | 'none';

/** Out of the box only Claude's names are stable enough to ship; others set theirs in .ilserc.json */
const DEFAULT_TIERS: Partial<Record<AgentName, ModelTiers>> = {
  claude: { fast: 'haiku', strong: 'sonnet' },
};

const MECHANICAL = new Set(['style', 'resize']);
const EDITS = new Set(['fix', 'change', 'style', 'resize', 'move']);

/** Which tier does this batch as well as the top model would */
export function pickTier(annotations: Annotation[]): Tier {
  const located = annotations.every(a => a.source?.[0]?.kind === 'element' && !a.source[0].ambiguous);
  const withImages = annotations.some(a => !!a.imageRef || (a.imageRefs?.length ?? 0) > 0);
  // Open-ended work stays on the agent's own model: new UI, free chat, a picture to match
  if (withImages || annotations.some(a => a.intent === 'create' || a.intent === 'chat')) return 'default';
  if (annotations.length > 3 || !located) return 'strong';
  if (annotations.every(a => MECHANICAL.has(a.intent ?? ''))) return 'fast';
  return 'strong';
}

/** One tier up, when a run left the files untouched */
export function escalateTier(tier: Tier): Tier | null {
  return tier === 'fast' ? 'strong' : tier === 'strong' ? 'default' : null;
}

/**
 * The project's tiers for this agent. `.ilserc.json` takes either one pair for
 * whatever agent runs, or a pair per agent:
 *   { "models": { "fast": "haiku", "strong": "sonnet" } }
 *   { "models": { "codex": { "fast": "gpt-5-mini", "strong": "gpt-5" } } }
 */
export function modelTiers(cwd: string, agent: AgentName): ModelTiers {
  let rc: { models?: ModelTiers & Partial<Record<AgentName, ModelTiers>> } = {};
  try { rc = JSON.parse(readFileSync(join(cwd, '.ilserc.json'), 'utf8')); } catch { /* none */ }
  const own = rc.models?.[agent];
  const shared = rc.models && (typeof rc.models.fast === 'string' || typeof rc.models.strong === 'string')
    ? { fast: rc.models.fast, strong: rc.models.strong } : undefined;
  return { ...DEFAULT_TIERS[agent], ...clean(shared), ...clean(own) };
}

const clean = (t?: ModelTiers): ModelTiers => Object.fromEntries(Object.entries(t ?? {}).filter(([, v]) => typeof v === 'string' && v)) as ModelTiers;

/**
 * The model id to pass, or undefined for the agent's own default.
 * `ILSE_MODEL` overrides everything (`default` = the agent's own).
 */
export function resolveModel(tier: Tier, tiers: ModelTiers, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const forced = env.ILSE_MODEL?.trim();
  if (forced) return forced === 'default' ? undefined : forced;
  return tier === 'default' ? undefined : tiers[tier];
}

/** An edit was asked for — so "no file changed" means the run fell short */
export function expectsEdit(annotations: Annotation[]): boolean {
  return annotations.some(a => EDITS.has(a.intent ?? 'fix'));
}

/**
 * The Claude account every run uses, as chosen at startup: a CLAUDE_CONFIG_DIR,
 * null for the default one, undefined to leave the terminal's as it is.
 */
let claudeConfigDir: string | null | undefined;
export function setClaudeConfigDir(dir: string | null | undefined): void { claudeConfigDir = dir; }

function withAccount(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (claudeConfigDir === undefined) return env;
  const out = { ...env };
  if (claudeConfigDir) out.CLAUDE_CONFIG_DIR = claudeConfigDir; else delete out.CLAUDE_CONFIG_DIR;
  return out;
}

/** No user-level CLAUDE.md, no auto-memory — the user's notes stay out of the fix */
export function isolatedEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.ILSE_AGENT_USER_CONTEXT === '1') return withAccount(env);
  return withAccount({ ...env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
}

const PROJECT_DOCS = ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md'];
const MAX_PROJECT_CHARS = 20_000;

/**
 * The project's own agent instructions, handed back explicitly — isolation
 * switches off CLAUDE.md discovery altogether, the project's included.
 */
export function projectInstructions(cwd: string): string | undefined {
  const parts: string[] = [];
  for (const name of PROJECT_DOCS) {
    const p = join(cwd, name);
    if (!existsSync(p)) continue;
    try { parts.push(`# ${name}\n\n${readFileSync(p, 'utf8').trim()}`); } catch { /* unreadable: skip */ }
  }
  if (parts.length === 0) return undefined;
  const all = parts.join('\n\n---\n\n');
  return all.length > MAX_PROJECT_CHARS ? `${all.slice(0, MAX_PROJECT_CHARS)}\n\n[…truncated]` : all;
}

/** Tools a visual fix never needs: the shell (search/edit have their own tools) and the web */
export const DISALLOWED_TOOLS = ['Bash', 'WebFetch', 'WebSearch'];
