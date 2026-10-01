/**
 * Did the agent leave code that no longer parses?
 *
 * The agent runs without a shell, so it can't build the project to see its own
 * mistakes — a JSX comment dropped where only one element fits, say, and the
 * designer finds out from the dev server's error overlay. Every file a batch
 * touched is parsed here (milliseconds, no AI). A file only counts as broken
 * when the version before the batch parsed fine: syntax this parser doesn't
 * know is never blamed on the agent.
 */

import { parse, type ParserPlugin } from '@babel/parser';
import type { FileChange } from './changeset.js';

export interface SyntaxBreak { file: string; line: number; column: number; message: string; excerpt: string }

const CODE = /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/;

function plugins(file: string): ParserPlugin[] {
  if (/\.tsx$/.test(file)) return ['typescript', 'jsx', 'decorators-legacy'];
  if (/\.(ts|mts|cts)$/.test(file)) return ['typescript', 'decorators-legacy'];
  return ['jsx', 'decorators-legacy'];
}

/** The first syntax error in `code`, or null */
export function syntaxError(code: string, file: string): { line: number; column: number; message: string } | null {
  try {
    parse(code, { sourceType: 'unambiguous', plugins: plugins(file), errorRecovery: false });
    return null;
  } catch (err) {
    const e = err as Error & { loc?: { line: number; column: number } };
    return { line: e.loc?.line ?? 0, column: (e.loc?.column ?? 0) + 1, message: e.message.replace(/\s*\(\d+:\d+\)$/, '') };
  }
}

export function syntaxBreaks(files: FileChange[]): SyntaxBreak[] {
  const out: SyntaxBreak[] = [];
  for (const f of files) {
    if (f.after == null || !CODE.test(f.path)) continue;
    const err = syntaxError(f.after, f.path);
    if (!err) continue;
    if (f.before != null && syntaxError(f.before, f.path)) continue; // was already like that
    const lines = f.after.split('\n');
    const from = Math.max(0, err.line - 4), to = Math.min(lines.length, err.line + 2);
    const excerpt = lines.slice(from, to).map((l, i) => `${String(from + i + 1).padStart(4)}${from + i + 1 === err.line ? ' >' : '  '} ${l}`).join('\n');
    out.push({ file: f.path, ...err, excerpt });
  }
  return out;
}

/** One line per break, for the CLI and the toolbar */
export function describeBreaks(breaks: SyntaxBreak[]): string {
  return breaks.map(b => `${b.file}:${b.line}:${b.column} — ${b.message}`).join('; ');
}

/** The follow-up turn: fix exactly this, nothing else */
export function repairPrompt(breaks: SyntaxBreak[]): string {
  return [
    'Your last edit left code that does not compile. Ilse parsed the files you changed and found:',
    '',
    ...breaks.flatMap(b => [`${b.file}:${b.line}:${b.column} — ${b.message}`, '```', b.excerpt, '```', '']),
    'Fix only these syntax errors, in place, keeping what you meant to do. Change nothing else.',
    'Reminder: inside `cond ? ( … )` or `return ( … )` only one JSX element fits — a {/* comment */} goes inside that element, not before it.',
  ].join('\n');
}
