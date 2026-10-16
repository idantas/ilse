/**
 * Takes the <Ilse /> an older Ilse wrote into the layout back out: the import
 * and the tag (also inside a `{cond && <Ilse />}` line). Pure — the caller
 * writes the file. Refuses rather than guesses: if Ilse is still referenced
 * after removal, or the file no longer parses, nothing changes.
 */
import { syntaxError } from '../agent/verify.js';

export type RemoveResult =
  | { ok: true; content: string; removed: string[] }
  | { ok: false; reason: 'not-found' | 'still-used' | 'syntax' };

const IMPORT = /^[ \t]*import\s+[^;]*?from\s*['"]ilse-design\/react['"][ \t]*;?[ \t]*\r?\n?/m;
// A whole line that only renders Ilse, optionally behind a condition
const GUARDED_LINE = /^[ \t]*\{[^{}\n]*&&\s*<Ilse\b[^>]*\/>\s*\}[ \t]*\r?\n?/m;
const TAG_LINE = /^[ \t]*<Ilse\b[^>]*\/>[ \t]*\r?\n?/m;
const TAG_INLINE = /<Ilse\b[^>]*\/>/;

export function removeIlseComponent(content: string, file: string): RemoveResult {
  let out = content;
  const removed: string[] = [];
  for (const re of [IMPORT, GUARDED_LINE, TAG_LINE, TAG_INLINE]) {
    for (let m = out.match(re); m; m = out.match(re)) {
      removed.push(m[0].trim().replace(/\s+/g, ' '));
      out = out.slice(0, m.index) + out.slice(m.index! + m[0].length);
    }
  }
  if (removed.length === 0) return { ok: false, reason: 'not-found' };
  if (/<Ilse\b|['"]ilse-design\/react['"]/.test(out)) return { ok: false, reason: 'still-used' };
  if (syntaxError(out, file)) return { ok: false, reason: 'syntax' };
  return { ok: true, content: out, removed };
}
