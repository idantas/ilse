/**
 * Change ledger — what Ilse changed, kept for whoever commits next.
 *
 * Ilse's edits land through another process (the spawned agent, a class swap,
 * an MCP client). The session that later makes the commit didn't make them, so
 * it sees modified files with no reason attached — and agents only commit what
 * they know they changed. This ledger is the reason attached.
 *
 * One JSON line per batch that touched files, from the change set (the disk
 * diff, so it works whatever tool the agent used). Undo appends a tombstone.
 * It lives in `.git/ilse/changes.jsonl`: per clone, never committed, next to
 * git's own state. Unlike the journal it does keep notes and paths — that is
 * the point — and it never leaves the machine.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Annotation } from '../types.js';
import { summarizeChangeSet, type ChangeSet } from '../agent/changeset.js';

export type LedgerPath = 'agent' | 'swap' | 'quick' | 'mcp';

export interface LedgerAnnotation {
  id: string;
  intent?: string;
  /** The note's first line — the designer's words (Ilse's own context follows them in the note) */
  note?: string;
  /** Component and element, e.g. "Card · button.px-4" */
  element?: string;
  /** Property-panel edits, "gap: 12px → 16px" */
  style?: string[];
  /** What the agent said it did */
  summary?: string;
}

export interface LedgerEntry {
  v: 1;
  id: string;
  at: string;
  path: LedgerPath;
  batch?: string;
  agent?: string;
  model?: string;
  label?: string;
  annotations: LedgerAnnotation[];
  files: Array<{ path: string; status: 'modified' | 'created' | 'deleted'; added: number; removed: number }>;
}

interface Tombstone { v: 1; id: string; at: string; undone: true }

function git(cwd: string, args: string[], raw = false): string | null {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return raw ? out : out.trim();
  } catch { return null; }
}

/** `.git/ilse/changes.jsonl` of the repo containing cwd (worktree-aware), or null outside git */
export function ledgerFile(cwd: string): string | null {
  const dir = git(cwd, ['rev-parse', '--absolute-git-dir']);
  return dir ? join(dir, 'ilse', 'changes.jsonl') : null;
}

function append(cwd: string, line: LedgerEntry | Tombstone): void {
  const file = ledgerFile(cwd);
  if (!file) return;
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    appendFileSync(file, JSON.stringify(line) + '\n', 'utf8');
  } catch { /* the ledger is a convenience — never break a run over it */ }
}

export function describeAnnotation(a: Annotation | undefined, id: string): LedgerAnnotation {
  if (!a) return { id };
  const owner = a.source?.[0]?.owner ?? a.component;
  return {
    id,
    intent: a.intent,
    note: a.note?.trim().split('\n')[0].slice(0, 200) || undefined,
    element: [owner, a.element].filter(Boolean).join(' · ') || undefined,
    style: a.styleData?.changes.map(c => `${c.property}: ${c.from || '—'} → ${c.to}${c.token ? ` (${c.token})` : ''}`),
    summary: a.resolvedSummary,
  };
}

export function recordChange(cwd: string, cs: ChangeSet, meta: {
  path: LedgerPath; batch?: string; agent?: string; model?: string; annotations: LedgerAnnotation[];
}): void {
  append(cwd, {
    v: 1, id: cs.id, at: new Date(cs.createdAt).toISOString(), label: cs.label,
    ...meta,
    files: summarizeChangeSet(cs),
  });
}

export function recordUndone(cwd: string, id: string): void {
  append(cwd, { v: 1, id, at: new Date().toISOString(), undone: true });
}

export function readLedger(cwd: string): LedgerEntry[] {
  const file = ledgerFile(cwd);
  if (!file || !existsSync(file)) return [];
  const entries = new Map<string, LedgerEntry>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as LedgerEntry | Tombstone;
      if ('undone' in rec) entries.delete(rec.id);
      else entries.set(rec.id, rec);
    } catch { /* a torn line: skip */ }
  }
  return [...entries.values()];
}

/**
 * Entries still waiting for a commit: not undone, and at least one of their
 * files still differs from HEAD. Committed or reverted work drops out by itself.
 */
export function pendingChanges(cwd: string): LedgerEntry[] {
  // Raw: the leading space of " M file" is part of the format
  const status = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], true);
  if (status === null) return [];
  const prefix = git(cwd, ['rev-parse', '--show-prefix']) ?? '';
  const dirty = new Set(status.split('\0').filter(Boolean).map(l => l.slice(3)));
  return readLedger(cwd).filter(e => e.files.some(f => dirty.has(prefix + f.path)));
}

export interface LedgerSummary {
  /** Changes Ilse made here and kept (undone ones are gone) */
  total: number;
  /** Of those, still waiting for a commit */
  pending: number;
  recent: { id: string; at: string; path: LedgerPath; text: string; files: string[]; pending: boolean }[];
}

/** The design side of the project memory: what Ilse changed, newest first */
export function ledgerSummary(cwd: string, limit = 8): LedgerSummary {
  const all = readLedger(cwd);
  const pending = new Set(pendingChanges(cwd).map(e => e.id));
  const recent = all.slice(-limit).reverse().map(e => ({
    id: e.id,
    at: e.at,
    path: e.path,
    text: e.annotations.map(a => a.note?.trim() || a.summary || '').filter(Boolean).join(' · ') || e.label || '',
    files: e.files.map(f => f.path),
    pending: pending.has(e.id),
  }));
  return { total: all.length, pending: pending.size, recent };
}

/** Markdown for the agent (or person) about to commit */
export function formatPending(entries: LedgerEntry[]): string {
  if (entries.length === 0) return 'Nenhuma mudança da Ilse pendente de commit.';
  const out = [
    '# Mudanças feitas pela Ilse, ainda sem commit',
    '',
    'Feitas por um designer no app rodando (Ilse → agente/painel). São intencionais: inclua esses arquivos no commit e use as notas abaixo para escrever a mensagem.',
  ];
  for (const e of entries) {
    out.push('', `## ${e.label || e.annotations.map(a => a.note).filter(Boolean).join(' · ') || e.id}`);
    out.push(`_${e.at.slice(0, 16).replace('T', ' ')} · ${e.path}${e.model ? ` · ${e.model}` : ''}_`);
    for (const a of e.annotations) {
      const head = [a.intent && `(${a.intent})`, a.element].filter(Boolean).join(' ');
      out.push(`- ${head || a.id}${a.note ? `: "${a.note}"` : ''}${a.summary ? ` → ${a.summary}` : ''}`);
      for (const s of a.style ?? []) out.push(`  - painel: ${s}`);
    }
    out.push(`- Arquivos: ${e.files.map(f => `${f.path} (${f.status === 'created' ? 'novo' : f.status === 'deleted' ? 'removido' : `+${f.added} −${f.removed}`})`).join(', ')}`);
  }
  return out.join('\n');
}

// ── History for the next edit ───────────────────────────────────────────────

/**
 * What Ilse already did to this file, newest first — so the next edit keeps
 * those decisions instead of undoing them. Undone batches are gone already.
 */
export function historyFor(cwd: string, file: string, limit = 3): LedgerEntry[] {
  return readLedger(cwd)
    .filter(e => e.files.some(f => f.path === file))
    .slice(-limit)
    .reverse();
}

/** A few hundred tokens at most: one line per earlier change */
export function formatHistory(file: string, entries: LedgerEntry[]): string | undefined {
  if (entries.length === 0) return undefined;
  const lines = entries.map(e => {
    const what = e.annotations.map(a => [
      a.intent,
      a.note && `"${a.note.slice(0, 80)}"`,
      a.summary && `→ ${a.summary.slice(0, 80)}`,
      a.style?.length ? `painel: ${a.style.slice(0, 3).join('; ')}` : undefined,
    ].filter(Boolean).join(' ')).join(' | ');
    return `- ${e.at.slice(0, 10)} · ${what || e.label || 'mudança'}`;
  });
  return [
    `**Earlier Ilse changes to \`${file}\`** (decided by the designer — keep them consistent, do not revert unless asked):`,
    ...lines,
  ].join('\n');
}
