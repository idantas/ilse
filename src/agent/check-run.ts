/**
 * Runs the project's own checks on a change: its typecheck, and the tests that
 * cover the files the change touched (`vitest related`, `jest --findRelatedTests`).
 * The pure part — reading the output, deciding what is new — is `project-check.ts`.
 *
 * What fails is run again on the project as it was before the change (a copy
 * outside the project, see `baselineDir`): only what passed there is the
 * change's doing.
 */

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { FileChange } from './changeset.js';
import { projectStateFile } from '../config/project-rc.js';
import {
  emptyReport, newTestFailures, newTypeErrors, parseTestJson, parseTsc, protectedEdits, readProtected,
  relevantTypeErrors, weakenedTests, type CheckReport, type ProtectedPath, type TestFailure, type TypeError,
} from './project-check.js';

type Runner = 'vitest' | 'jest' | 'custom';

export interface CheckSetup {
  /** tsc binary, or a command from `.ilserc.json` (its output read as tsc's) */
  typecheck: { bin: string } | { command: string } | null;
  tests: { runner: Runner; bin: string } | { runner: 'custom'; command: string } | null;
  timeoutMs: number;
  protected: ProtectedPath[];
}

const DEFAULT_TIMEOUT = 180_000;

/** The nearest `node_modules/.bin/<name>`, walking up (monorepos keep it at the root) */
function findBin(cwd: string, name: string): string | null {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const bin = join(dir, 'node_modules', '.bin', name);
    if (existsSync(bin)) return bin;
    if (dirname(dir) === dir) return null;
  }
}

function readPkg(cwd: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
  try { return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')); } catch { return {}; }
}

/**
 * What to run, from the project and `.ilserc.json` → `check` / `protected`.
 * `ILSE_CHECK=off` turns it all off, `ILSE_CHECK=types` keeps only the typecheck.
 * Null when there is nothing to check.
 */
export function checkSetup(cwd: string, rc: Record<string, unknown>, env = process.env.ILSE_CHECK): CheckSetup | null {
  if (env === 'off' || env === '0' || env === 'false') return null;
  const conf = (rc.check && typeof rc.check === 'object' ? rc.check : {}) as { typecheck?: unknown; test?: unknown; timeoutMs?: unknown };
  const deps = { ...readPkg(cwd).dependencies, ...readPkg(cwd).devDependencies };

  let typecheck: CheckSetup['typecheck'] = null;
  if (typeof conf.typecheck === 'string') typecheck = { command: conf.typecheck };
  else if (conf.typecheck !== false && existsSync(join(cwd, 'tsconfig.json'))) {
    const bin = findBin(cwd, 'tsc');
    if (bin) typecheck = { bin };
  }

  let tests: CheckSetup['tests'] = null;
  if (env !== 'types') {
    if (typeof conf.test === 'string') tests = { runner: 'custom', command: conf.test };
    else if (conf.test !== false) {
      const runner: Runner | null = deps.vitest ? 'vitest' : deps.jest ? 'jest' : null;
      const bin = runner && findBin(cwd, runner);
      if (runner && bin) tests = { runner, bin };
    }
  }

  const prot = readProtected(rc.protected);
  if (!typecheck && !tests && prot.length === 0) return null;
  const timeoutMs = typeof conf.timeoutMs === 'number' && conf.timeoutMs > 0 ? conf.timeoutMs : DEFAULT_TIMEOUT;
  return { typecheck, tests, timeoutMs, protected: prot };
}

interface Ran { code: number | null; out: string; timedOut: boolean }

function run(cmd: string, args: string[], cwd: string, timeoutMs: number, shell = false): Promise<Ran> {
  return new Promise(resolve => {
    // CI=1: snapshot tests don't write new snapshots, watchers don't start
    const child = spawn(cmd, args, { cwd, shell, env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = (b: Buffer) => { out += b.toString(); if (out.length > 4_000_000) out = out.slice(-2_000_000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve({ code: null, out, timedOut }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, timedOut }); });
  });
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

async function typecheckIn(dir: string, setup: CheckSetup, buildInfo?: string): Promise<TypeError[] | null> {
  const tc = setup.typecheck;
  if (!tc) return null;
  const r = 'bin' in tc
    ? await run(tc.bin, ['--noEmit', '--pretty', 'false', '-p', '.', ...(buildInfo ? ['--incremental', '--tsBuildInfoFile', buildInfo] : [])], dir, setup.timeoutMs)
    : await run(tc.command, [], dir, setup.timeoutMs, true);
  return r.timedOut ? null : parseTsc(r.out);
}

/** `related`: the tests that import these files. Otherwise, these test files themselves */
async function testsIn(dir: string, setup: CheckSetup, files: string[], mode: 'related' | 'files'): Promise<TestFailure[] | null> {
  const t = setup.tests;
  if (!t || files.length === 0) return null;
  if (t.runner === 'custom' && 'command' in t) {
    const r = await run(`${t.command} ${files.map(quote).join(' ')}`, [], dir, setup.timeoutMs, true);
    if (r.timedOut) return null;
    return r.code === 0 ? [] : [{ file: '(tests)', name: t.command, message: r.out.split('\n').slice(-15).join('\n') }];
  }
  const bin = (t as { bin: string }).bin;
  const report = join(tmpdir(), `ilse-tests-${process.pid}-${Date.now()}.json`);
  const args = t.runner === 'vitest'
    ? [...(mode === 'related' ? ['related', '--run'] : ['run']), '--passWithNoTests', '--reporter=json', `--outputFile=${report}`, ...files]
    : [...(mode === 'related' ? ['--findRelatedTests'] : ['--runTestsByPath']), ...files, '--ci', '--passWithNoTests', '--json', `--outputFile=${report}`];
  const r = await run(bin, args, dir, setup.timeoutMs);
  let json = '';
  try { json = readFileSync(report, 'utf8'); rmSync(report, { force: true }); } catch { /* no report */ }
  if (r.timedOut || !json) return null;
  // Runners report real paths: the temp dir is /var/… but /private/var/… on macOS
  let root = dir;
  try { root = realpathSync(dir); } catch { /* keep it */ }
  return parseTestJson(json, root);
}

/**
 * The project as it was before the change, outside the project: HEAD from
 * `git archive`, the uncommitted work on top, the change's files put back as
 * they were, `node_modules` linked. Rebuilt on each use; nothing is written
 * in the project or registered in its git. Null outside git.
 */
export function baselineDir(cwd: string, files: FileChange[]): string | null {
  let root: string;
  try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
  const base = join(tmpdir(), 'ilse-baseline', createHash('sha1').update(root).digest('hex').slice(0, 12));
  try {
    rmSync(base, { recursive: true, force: true }); // links are removed, never followed
    mkdirSync(base, { recursive: true });
    execFileSync('sh', ['-c', 'git archive --format=tar HEAD | tar -x -C "$1"', 'sh', base], { cwd: root, stdio: 'ignore' });

    // Uncommitted work is part of "before" too
    const status = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).split('\0');
    for (let i = 0; i < status.length; i++) {
      const entry = status[i];
      if (entry.length < 4) continue;
      const xy = entry.slice(0, 2), path = entry.slice(3);
      if (xy[0] === 'R' || xy[0] === 'C') { const from = status[++i]; if (xy[0] === 'R' && from) rmSync(join(base, from), { force: true }); }
      const src = join(root, path), dst = join(base, path);
      if (!existsSync(src)) { rmSync(dst, { force: true, recursive: true }); continue; }
      if (lstatSync(src).isDirectory()) continue;
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    }

    const project = join(base, relative(root, cwd));
    for (const f of files) {
      const dst = join(project, f.path);
      if (f.before == null) { rmSync(dst, { force: true }); continue; }
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, f.before);
    }

    for (const from of new Set([root, cwd])) {
      const modules = join(from, 'node_modules');
      const link = join(base, relative(root, from), 'node_modules');
      if (existsSync(modules) && !existsSync(link)) symlinkSync(modules, link, 'dir');
    }
    return project;
  } catch {
    return null;
  }
}

export interface CheckRun extends CheckReport {
  /** What could run: false when absent, timed out or switched off */
  ran: { types: boolean; tests: boolean };
  ms: number;
}

/** The project's checks on a change; only what passed before it is reported */
export async function checkChange(cwd: string, files: FileChange[], setup: CheckSetup): Promise<CheckRun> {
  const started = Date.now();
  const report: CheckReport = { ...emptyReport(), protectedEdits: protectedEdits(files, setup.protected), weakenedTests: weakenedTests(files) };
  const present = files.filter(f => f.after != null).map(f => f.path);
  const buildInfo = join(dirname(projectStateFile(cwd)), 'tsbuildinfo');
  try { mkdirSync(dirname(buildInfo), { recursive: true }); } catch { /* tsc then runs without it */ }

  const [types, tests] = await Promise.all([
    typecheckIn(cwd, setup, buildInfo),
    testsIn(cwd, setup, present, 'related'),
  ]);
  const read = (f: string) => { try { return readFileSync(join(cwd, f), 'utf8'); } catch { return null; } };
  let typeErrors = types ? relevantTypeErrors(types, files.map(f => f.path), read) : [];
  let testFailures = tests ?? [];

  if (typeErrors.length || testFailures.length) {
    const before = baselineDir(cwd, files);
    if (before) {
      const failingFiles = [...new Set(testFailures.map(f => f.file))].filter(f => f !== '(tests)');
      const [oldTypes, oldTests] = await Promise.all([
        typeErrors.length ? typecheckIn(before, setup) : Promise.resolve([]),
        testFailures.length
          ? (setup.tests?.runner === 'custom' ? testsIn(before, setup, present, 'related') : testsIn(before, setup, failingFiles, 'files'))
          : Promise.resolve([]),
      ]);
      // A check that couldn't run on the copy proves nothing either way: keep what we found
      if (oldTypes) typeErrors = newTypeErrors(typeErrors, oldTypes);
      if (oldTests) testFailures = newTestFailures(testFailures, oldTests);
    }
  }
  return { ...report, typeErrors, testFailures, ran: { types: !!types, tests: !!tests }, ms: Date.now() - started };
}
