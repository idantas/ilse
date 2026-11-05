/**
 * Did the agent leave code that no longer parses?
 *
 * The agent runs without a shell, so it can't build the project to see its own
 * mistakes — a JSX comment dropped where only one element fits, say, and the
 * designer finds out from the dev server's error overlay. Every file a batch
 * touched is parsed here (milliseconds, no AI). A file only counts as broken
 * when the version before the batch parsed fine: syntax this parser doesn't
 * know is never blamed on the agent.
 *
 * A file that parses can still crash the page: `<Button>` written without its
 * import (seen live, a "Fix all" turning a hand-written button into the DS's).
 * Plain JS projects have no typecheck to catch it, so a capitalized JSX tag
 * nothing in the file declares counts as a break too.
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

type Loc = { line: number; column: number };
type AstNode = { type?: string; loc?: { start: Loc }; [k: string]: unknown };

function walk(node: unknown, visit: (n: AstNode) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  const n = node as AstNode;
  if (typeof n.type === 'string') visit(n);
  for (const k in n) if (k !== 'loc' && k !== 'start' && k !== 'end' && k !== 'extra') walk(n[k], visit);
}

/** Every name a pattern binds: `x`, `{ a, b: c }`, `[d, ...e]`, `f = 1` */
function patternNames(p: unknown, out: Set<string>): void {
  const n = p as AstNode | null;
  if (!n) return;
  if (n.type === 'Identifier') out.add(n.name as string);
  else if (n.type === 'ObjectPattern') for (const prop of n.properties as AstNode[]) patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
  else if (n.type === 'ArrayPattern') for (const el of n.elements as AstNode[]) patternNames(el, out);
  else if (n.type === 'RestElement') patternNames(n.argument, out);
  else if (n.type === 'AssignmentPattern') patternNames(n.left, out);
  else if (n.type === 'TSParameterProperty') patternNames(n.parameter, out);
}

/**
 * Capitalized JSX tags that nothing in the file declares, first use of each.
 * Not scope-exact on purpose: a name declared anywhere in the file counts, so
 * it can miss a break but never blames a tag that resolves.
 */
export function unboundComponents(code: string, file: string): Array<{ name: string; line: number; column: number }> {
  let ast: unknown;
  try { ast = parse(code, { sourceType: 'unambiguous', plugins: plugins(file), errorRecovery: false }); } catch { return []; }
  const declared = new Set<string>();
  const used = new Map<string, Loc>();
  walk(ast, n => {
    switch (n.type) {
      case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier':
        declared.add((n.local as AstNode).name as string); break;
      case 'FunctionDeclaration': case 'ClassDeclaration': case 'FunctionExpression': case 'ClassExpression':
        if (n.id) declared.add((n.id as AstNode).name as string);
        if (n.params) for (const p of n.params as unknown[]) patternNames(p, declared);
        break;
      case 'ArrowFunctionExpression': case 'ObjectMethod': case 'ClassMethod':
        for (const p of n.params as unknown[]) patternNames(p, declared); break;
      case 'VariableDeclarator': patternNames(n.id, declared); break;
      case 'CatchClause': patternNames(n.param, declared); break;
      case 'TSEnumDeclaration': case 'TSModuleDeclaration': if (n.id) declared.add((n.id as AstNode).name as string); break;
      case 'JSXOpeningElement': {
        let name = n.name as AstNode;
        while (name.type === 'JSXMemberExpression') name = name.object as AstNode; // <Select.Item> needs `Select`
        const id = name.type === 'JSXIdentifier' ? name.name as string : '';
        if (/^[A-Z]/.test(id) && !used.has(id) && name.loc) used.set(id, name.loc.start);
        break;
      }
    }
  });
  return [...used].filter(([name]) => !declared.has(name)).map(([name, loc]) => ({ name, line: loc.line, column: loc.column + 1 }));
}

export function syntaxBreaks(files: FileChange[]): SyntaxBreak[] {
  const out: SyntaxBreak[] = [];
  for (const f of files) {
    if (f.after == null || !CODE.test(f.path)) continue;
    const err = syntaxError(f.after, f.path);
    if (!err) {
      // Parses: is every component it renders imported or defined?
      const was = new Set(f.before != null ? unboundComponents(f.before, f.path).map(u => u.name) : []);
      const lines = f.after.split('\n');
      for (const u of unboundComponents(f.after, f.path)) {
        if (was.has(u.name)) continue; // was already like that (a global, a build-time inject)
        out.push({ file: f.path, line: u.line, column: u.column, message: `<${u.name}> is used but never imported or defined`, excerpt: `${String(u.line).padStart(4)} > ${lines[u.line - 1] ?? ''}` });
      }
      continue;
    }
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
    'Your last edit left code that does not compile or crashes the page. Ilse parsed the files you changed and found:',
    '',
    ...breaks.flatMap(b => [`${b.file}:${b.line}:${b.column} — ${b.message}`, '```', b.excerpt, '```', '']),
    'Fix only these errors, in place, keeping what you meant to do. Change nothing else.',
    'A component used but never imported: add its import (find where it is exported), do not remove the component.',
    'Reminder: inside `cond ? ( … )` or `return ( … )` only one JSX element fits — a {/* comment */} goes inside that element, not before it.',
  ].join('\n');
}
