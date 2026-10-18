/**
 * Change sets — undo for any agent.
 *
 * Before a batch runs, the CLI snapshots the project's source files. After it
 * runs, it diffs: what changed, what appeared, what vanished. The designer
 * already sees the result through HMR; undo (toolbar button or ⌘Z) writes the
 * originals back, newest batch first.
 *
 * Works with any agent because it never asks the agent anything — it looks at
 * the disk. Discard is careful: a file edited again after the batch (by the
 * designer or a later batch) is left alone and reported as a conflict.
 */

import { readFileSync, statSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { globSync } from 'glob';

const TEXT_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,css,scss,sass,less,html,json,md,mdx,svg,vue,svelte,astro,yml,yaml}';
const IGNORE = [
  '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/out/**',
  '**/coverage/**', '**/.turbo/**', '**/.vercel/**', '**/.cache/**', '**/storybook-static/**',
  '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock',
];
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 80_000_000;

export interface Snapshot { cwd: string; files: Map<string, string> }

export interface FileChange { path: string; before: string | null; after: string | null }

export interface ChangeSet {
  id: string;
  annotationIds: string[];
  label?: string;          // what the batch did, shown on the undo button
  files: FileChange[];
  createdAt: number;
}

function listFiles(cwd: string): string[] {
  return globSync(TEXT_GLOB, { cwd, ignore: IGNORE, nodir: true, dot: false });
}

export function takeSnapshot(cwd: string): Snapshot {
  const files = new Map<string, string>();
  let total = 0;
  for (const rel of listFiles(cwd)) {
    const abs = join(cwd, rel);
    try {
      const size = statSync(abs).size;
      if (size > MAX_FILE_BYTES) continue;
      if (total + size > MAX_TOTAL_BYTES) break;
      files.set(rel, readFileSync(abs, 'utf8'));
      total += size;
    } catch { /* vanished mid-scan */ }
  }
  return { cwd, files };
}

export function diffSnapshot(snap: Snapshot, annotationIds: string[]): ChangeSet | null {
  const changes: FileChange[] = [];
  const now = new Set(listFiles(snap.cwd));

  for (const [rel, before] of snap.files) {
    if (!now.has(rel)) { changes.push({ path: rel, before, after: null }); continue; }
    let after: string;
    try { after = readFileSync(join(snap.cwd, rel), 'utf8'); } catch { continue; }
    if (after !== before) changes.push({ path: rel, before, after });
  }
  for (const rel of now) {
    if (snap.files.has(rel)) continue;
    try {
      if (statSync(join(snap.cwd, rel)).size > MAX_FILE_BYTES) continue;
      changes.push({ path: rel, before: null, after: readFileSync(join(snap.cwd, rel), 'utf8') });
    } catch { /* ignore */ }
  }

  if (changes.length === 0) return null;
  return { id: randomUUID().slice(0, 8), annotationIds, files: changes, createdAt: Date.now() };
}

export interface DiscardResult { restored: string[]; conflicts: string[] }

/** Restores the batch's files — only where the disk still holds what the batch wrote. */
export function discardChangeSet(cs: ChangeSet, cwd: string): DiscardResult {
  const restored: string[] = [];
  const conflicts: string[] = [];
  for (const f of cs.files) {
    const abs = join(cwd, f.path);
    const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (current !== f.after) { conflicts.push(f.path); continue; }
    if (f.before === null) {
      unlinkSync(abs);
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.before, 'utf8');
    }
    restored.push(f.path);
  }
  return { restored, conflicts };
}

/** Summary line per file for the toolbar: `+3 −1 src/Card.tsx` */
export function summarizeChangeSet(cs: ChangeSet): Array<{ path: string; added: number; removed: number; status: 'modified' | 'created' | 'deleted' }> {
  return cs.files.map(f => {
    const a = f.after?.split('\n') ?? [];
    const b = f.before?.split('\n') ?? [];
    const setB = new Set(b);
    const setA = new Set(a);
    return {
      path: f.path,
      added: a.filter(l => !setB.has(l)).length,
      removed: b.filter(l => !setA.has(l)).length,
      status: f.before === null ? 'created' : f.after === null ? 'deleted' : 'modified',
    };
  });
}

// ── Undo stack (in memory, per CLI process) ─────────────────────────────────

const MAX_UNDO = 30;
const undoStack: ChangeSet[] = [];

// Redo: batches taken back, newest last. Any new batch clears it — redoing past
// a newer change would stack edits in an order nobody chose (as in any editor).
const redoStack: ChangeSet[] = [];

export function pushUndo(cs: ChangeSet, fromRedo = false): void {
  undoStack.push(cs);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  if (!fromRedo) redoStack.length = 0;
}
export function popUndo(): ChangeSet | undefined { return undoStack.pop(); }
/** The change an undo would take back now */
export function peekUndo(): ChangeSet | undefined { return undoStack[undoStack.length - 1]; }
export function pushRedo(cs: ChangeSet): void { redoStack.push(cs); }
export function popRedo(): ChangeSet | undefined { return redoStack.pop(); }
export function undoState(): { count: number; label?: string; redoCount: number; redoLabel?: string } {
  return {
    count: undoStack.length, label: undoStack[undoStack.length - 1]?.label,
    redoCount: redoStack.length, redoLabel: redoStack[redoStack.length - 1]?.label,
  };
}

/**
 * Put an undone batch back: each file goes to its "after" — only if it is still
 * exactly as the undo left it. Anything edited since is a conflict, left alone.
 */
export function reapplyChangeSet(cs: ChangeSet, cwd: string): DiscardResult {
  const restored: string[] = [];
  const conflicts: string[] = [];
  for (const f of cs.files) {
    const abs = join(cwd, f.path);
    const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (current !== f.before) { conflicts.push(f.path); continue; }
    if (f.after === null) {
      unlinkSync(abs);
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.after, 'utf8');
    }
    restored.push(f.path);
  }
  return { restored, conflicts };
}
