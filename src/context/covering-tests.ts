/**
 * The tests that cover a file: a test beside it with its name, or one that
 * imports it. Told to the agent with the source, so a change to how something
 * looks updates the test that pins the old look in the same pass — instead of
 * Ilse finding the failure afterwards and spending a repair turn on it.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { TEST_FILE } from '../agent/project-check.js';

const TTL = 30_000;
let cache: { cwd: string; at: number; tests: { path: string; source: string }[] } | null = null;

function testFiles(cwd: string): { path: string; source: string }[] {
  if (cache && cache.cwd === cwd && Date.now() - cache.at < TTL) return cache.tests;
  let paths: string[] = [];
  try {
    paths = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter(p => TEST_FILE.test(p) && !p.startsWith('node_modules/') && !/(^|\/)e2e\//.test(p));
  } catch { /* not a repo: no tests found */ }
  const tests = paths.slice(0, 3000).flatMap(path => {
    try { return [{ path, source: readFileSync(join(cwd, path), 'utf8') }]; } catch { return []; }
  });
  cache = { cwd, at: Date.now(), tests };
  return tests;
}

/** Test files for `file` (relative to cwd): named after it, or importing it */
export function coveringTests(file: string, tests: { path: string; source: string }[], limit = 5): string[] {
  const stem = basename(file, extname(file));
  if (!stem || stem === 'index') return [];
  const imports = new RegExp(`from\\s+['"][^'"]*/${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[cm]?[jt]sx?)?['"]`);
  const named = (p: string) => basename(p).startsWith(`${stem}.`);
  return tests.filter(t => named(t.path) || imports.test(t.source))
    .sort((a, b) => Number(named(b.path)) - Number(named(a.path)))
    .slice(0, limit).map(t => t.path);
}

export function testsCovering(file: string, cwd = process.cwd()): string[] {
  if (process.env.ILSE_CHECK === 'off') return [];
  return coveringTests(file, testFiles(cwd));
}
