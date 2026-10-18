/**
 * Does the project still pass its own checks after a change?
 *
 * A design change can break what CI runs: a prop used but never declared, a
 * test that pins the old look, a "show only 10" that changed the backend's page
 * limit. The agent runs without a shell, so Ilse runs the project's typecheck
 * and the tests that cover the files a change touched, and hands what broke
 * back to the agent to fix — before the change is called done.
 *
 * Only what passed before the change counts: failures the change didn't cause
 * (another agent's work on the same branch, a test already red) are never
 * blamed on it. See `baseline.ts`.
 *
 * This module is the pure part — reading tool output, deciding what is new,
 * the repair turn. Running the tools is `check-run.ts`.
 */

import { basename, extname } from 'node:path';
import type { FileChange } from './changeset.js';

export interface TypeError { file: string; line: number; column: number; code: string; message: string }
export interface TestFailure { file: string; name: string; message: string }
export interface ProtectedPath { path: string; note?: string }

export interface CheckReport {
  typeErrors: TypeError[];
  testFailures: TestFailure[];
  /** Changed files the project says are not edited directly */
  protectedEdits: { file: string; note?: string }[];
  /** Test files that lost assertions or gained a skip: a test made to pass, not fixed */
  weakenedTests: string[];
}

export const emptyReport = (): CheckReport => ({ typeErrors: [], testFailures: [], protectedEdits: [], weakenedTests: [] });

export function hasProblems(r: CheckReport): boolean {
  return r.typeErrors.length + r.testFailures.length + r.protectedEdits.length + r.weakenedTests.length > 0;
}

// ── TypeScript ──────────────────────────────────────────────────────────────

const TSC_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/** `tsc --pretty false` output → errors; indented lines continue the one above */
export function parseTsc(output: string): TypeError[] {
  const errors: TypeError[] = [];
  for (const line of output.split('\n')) {
    const m = TSC_LINE.exec(line.trimEnd());
    if (m) { errors.push({ file: m[1].replace(/\\/g, '/'), line: +m[2], column: +m[3], code: m[4], message: m[5] }); continue; }
    const last = errors[errors.length - 1];
    if (last && /^\s+\S/.test(line)) last.message += '\n' + line.trimEnd();
  }
  return errors;
}

/** Same error, wherever its line moved to */
const typeKey = (e: TypeError) => `${e.file}|${e.code}|${e.message.split('\n')[0]}`;

/**
 * Errors the change can be responsible for: in a file it touched, or in a file
 * that imports one (a prop removed from Button breaks the screen that passes it).
 * The rest of the project's errors are someone else's.
 */
export function relevantTypeErrors(errors: TypeError[], changed: string[], sourceOf: (file: string) => string | null): TypeError[] {
  const touched = new Set(changed);
  const stems = changed.map(f => basename(f, extname(f))).filter(s => s !== 'index');
  const importsChanged = new Map<string, boolean>();
  return errors.filter(e => {
    if (touched.has(e.file)) return true;
    if (!importsChanged.has(e.file)) {
      const src = sourceOf(e.file) ?? '';
      importsChanged.set(e.file, stems.some(stem => new RegExp(`from\\s+['"][^'"]*/${escapeRe(stem)}(\\.[jt]sx?)?['"]`).test(src)));
    }
    return importsChanged.get(e.file)!;
  });
}

export function newTypeErrors(after: TypeError[], before: TypeError[]): TypeError[] {
  const old = new Set(before.map(typeKey));
  return after.filter(e => !old.has(typeKey(e)));
}

// ── Tests ───────────────────────────────────────────────────────────────────

interface JestJson {
  testResults?: {
    name: string;
    status?: string;
    message?: string;
    assertionResults?: { status: string; title: string; ancestorTitles?: string[]; failureMessages?: string[] }[];
  }[];
}

const ANSI = /\x1b\[[0-9;]*m/g;

/** The JSON report vitest and jest both write → failures, paths relative to `root` */
export function parseTestJson(json: string, root: string): TestFailure[] {
  let data: JestJson;
  try { data = JSON.parse(json) as JestJson; } catch { return []; }
  const prefix = root.endsWith('/') ? root : root + '/';
  const failures: TestFailure[] = [];
  for (const suite of data.testResults ?? []) {
    const file = suite.name.startsWith(prefix) ? suite.name.slice(prefix.length) : suite.name;
    const failed = (suite.assertionResults ?? []).filter(a => a.status === 'failed');
    for (const a of failed) {
      failures.push({ file, name: [...(a.ancestorTitles ?? []), a.title].join(' > '), message: trimMessage((a.failureMessages ?? []).join('\n')) });
    }
    // The file didn't load (an import that no longer resolves): one failure for the whole file
    if (failed.length === 0 && suite.status === 'failed') failures.push({ file, name: '(file)', message: trimMessage(suite.message ?? '') });
  }
  return failures;
}

const testKey = (f: TestFailure) => `${f.file}|${f.name}`;

export function newTestFailures(after: TestFailure[], before: TestFailure[]): TestFailure[] {
  const old = new Set(before.map(testKey));
  return after.filter(f => !old.has(testKey(f)));
}

/** The assertion and the line that failed, not the whole stack */
function trimMessage(message: string): string {
  const lines = message.replace(ANSI, '').split('\n')
    .filter(l => !/^\s+at\s/.test(l) && !/node_modules/.test(l))
    .map(l => l.trimEnd()).filter(Boolean);
  return lines.slice(0, 12).join('\n').slice(0, 900);
}

export const TEST_FILE = /(\.|\/|^)(test|spec)\.[cm]?[jt]sx?$|\/__tests__\//;

const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;
const TESTS = /\b(?:it|test)(?:\.each\([^)]*\))?\s*\(/g;
const EXPECTS = /\bexpect\s*[.(]/g;
const SKIPS = /\b(?:it|test|describe)\.(?:skip|todo)\b|\bx(?:it|describe|test)\s*\(/g;

/**
 * Test files the change made weaker: fewer tests or assertions, or a new skip.
 * Updating what a test expects is fine; making it expect less is not.
 */
export function weakenedTests(files: FileChange[]): string[] {
  return files.filter(f => TEST_FILE.test(f.path) && f.before != null).filter(f => {
    const after = f.after ?? '';
    return count(after, TESTS) < count(f.before!, TESTS)
      || count(after, EXPECTS) < count(f.before!, EXPECTS)
      || count(after, SKIPS) > count(f.before!, SKIPS);
  }).map(f => f.path);
}

// ── Protected paths ─────────────────────────────────────────────────────────

/** `components/ui/**`, `*.css`, `lib/?.ts` — a glob as a RegExp over a relative path */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += escapeRe(c);
  }
  // A bare folder protects what is inside it
  return new RegExp(`^${re}${glob.endsWith('/') ? '.*' : '(?:/.*)?'}$`);
}

export function protectedEdits(files: FileChange[], paths: ProtectedPath[]): { file: string; note?: string }[] {
  const rules = paths.map(p => ({ re: globToRegExp(p.path), note: p.note }));
  return files.flatMap(f => {
    const rule = rules.find(r => r.re.test(f.path));
    return rule ? [{ file: f.path, note: rule.note }] : [];
  });
}

/** `.ilserc.json` → `protected`: strings or `{ path, note }` */
export function readProtected(value: unknown): ProtectedPath[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(v => typeof v === 'string' ? [{ path: v }]
    : v && typeof v === 'object' && typeof (v as ProtectedPath).path === 'string' ? [{ path: (v as ProtectedPath).path, note: typeof (v as ProtectedPath).note === 'string' ? (v as ProtectedPath).note : undefined }]
    : []);
}

// ── What the agent and the designer are told ────────────────────────────────

/** The follow-up turn: what broke, and how to tell a test to update from code to fix */
export function checkRepairPrompt(r: CheckReport, asked: string[] = []): string {
  const out = ['Ilse ran the project\'s checks on the files you changed. Your change broke these — they passed before it:', ''];
  // A repair that only reverts passes the checks and loses the change: say what must survive
  const notes = asked.map(n => n.replace(/[`*_~]/g, '').trim().slice(0, 300)).filter(Boolean);
  if (notes.length) {
    out.unshift('What the designer asked for, which the fix must keep:', ...notes.map(n => `<<<\n${n}\n>>>`), '');
  }
  if (r.typeErrors.length) {
    out.push('Type errors:');
    for (const e of r.typeErrors.slice(0, 15)) out.push(`- ${e.file}:${e.line}:${e.column} ${e.code} ${e.message}`);
    out.push('');
  }
  if (r.testFailures.length) {
    out.push('Failing tests:');
    for (const f of r.testFailures.slice(0, 15)) out.push(`- ${f.file} › ${f.name}`, ...f.message.split('\n').map(l => `    ${l}`));
    out.push('');
  }
  if (r.protectedEdits.length) {
    out.push('Files this project does not edit directly — undo your edits to them:');
    for (const p of r.protectedEdits) out.push(`- ${p.file}${p.note ? ` (${p.note})` : ''}`);
    out.push('');
  }
  if (r.weakenedTests.length) {
    out.push(`You removed or skipped tests or assertions in ${r.weakenedTests.join(', ')} — put them back.`, '');
  }
  out.push(
    'Fix them and keep the designer\'s change:',
    '- A test that pins how something looks (text, class, colour, size, markup) and fails because the look changed on purpose: update the test to the new look.',
    '- A test of behaviour (paging, limits, permissions, requests, state, data): fix the code so the behaviour stays as it was and the look the designer asked for still holds. Do not change that test.',
    '- A type error: fix the code.',
    '- Never delete, skip or loosen a test to make it pass.',
    '- Do not run builds or tests — Ilse runs them again.',
  );
  return out.join('\n');
}

/** One short line per problem, for the terminal and the toolbar */
export function describeReport(r: CheckReport): string[] {
  return [
    ...r.typeErrors.map(e => `${e.file}:${e.line} ${e.code} ${e.message.split('\n')[0]}`),
    ...r.testFailures.map(f => `${f.file} › ${f.name}`),
    ...r.protectedEdits.map(p => `${p.file} (protected)`),
    ...r.weakenedTests.map(f => `${f} (weakened)`),
  ];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
