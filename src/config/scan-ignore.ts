/**
 * `.ilse/.ignore` — keeps the dev server's file scanners out of Ilse's folder.
 *
 * Tailwind v4 reads every file in the project for class names and reloads the page when one of
 * them changes; seen live, writing the DS (`.ilse/ds/*`) reloaded the page the person was on,
 * and the DS now follows every change. `.ignore` is the ripgrep / `ignore`-crate convention that
 * Tailwind's scanner honours and git doesn't: the folder stays versioned, nothing in the
 * project's own config is touched.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BODY = '# Written by Ilse: file scanners (Tailwind) skip this folder, so writing it never reloads the page. Git still tracks it.\n*\n';

export function ensureScanIgnore(cwd: string): void {
  const dir = join(cwd, '.ilse');
  const file = join(dir, '.ignore');
  if (existsSync(file)) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, BODY, 'utf8');
  } catch { /* read-only project: the page may reload, nothing else breaks */ }
}
