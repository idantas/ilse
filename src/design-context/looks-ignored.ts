/**
 * What the person chose to ignore — a look-alike, a Consistency finding — so it
 * stays hand-written on purpose, on every screen; Memory brings one back.
 *
 * Kept in `.git/ilse/looks-ignored.json`, next to the ledger: a file written inside
 * the project makes Next's dev server reload the page (the toolbar closed on every
 * Ignore). Outside git, `.ilse/` as before; a list left there is still read.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerFile } from '../git/ledger.js';

export interface IgnoredLook { id: string; label: string; at: string }

const legacy = (cwd: string) => join(cwd, '.ilse', 'looks-ignored.json');
const file = (cwd: string) => { const l = ledgerFile(cwd); return l ? join(l, '..', 'looks-ignored.json') : legacy(cwd); };

function readList(f: string): IgnoredLook[] {
  try {
    const list = JSON.parse(readFileSync(f, 'utf8'));
    return Array.isArray(list) ? list.filter((x): x is IgnoredLook => typeof x?.id === 'string' && typeof x?.label === 'string') : [];
  } catch { return []; }
}

export function readIgnoredLooks(cwd: string): IgnoredLook[] {
  const f = file(cwd);
  if (existsSync(f) || f === legacy(cwd)) return readList(f);
  // First read after the move: the old list, written to the new place on the next change
  return readList(legacy(cwd));
}

function write(cwd: string, list: IgnoredLook[]): void {
  const f = file(cwd);
  if (!existsSync(join(f, '..'))) mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, JSON.stringify(list, null, 2) + '\n');
}

export function ignoreLook(cwd: string, id: string, label: string, now = new Date()): IgnoredLook[] {
  const list = readIgnoredLooks(cwd).filter(x => x.id !== id);
  list.push({ id: id.slice(0, 300), label: label.slice(0, 120), at: now.toISOString() });
  write(cwd, list);
  return list;
}

export function unignoreLook(cwd: string, id: string): IgnoredLook[] {
  const list = readIgnoredLooks(cwd).filter(x => x.id !== id);
  write(cwd, list);
  return list;
}
