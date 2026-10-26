/**
 * A library component's choices, from its own type declarations (no AI).
 *
 * The code alone only shows the values it already uses: after the last
 * `variant="outlined"` became `"contained"`, "outlined" would vanish from the
 * panel. The library declares them all — MUI's Button says
 * `variant?: OverridableStringUnion<'text' | 'outlined' | 'contained', …>` —
 * so the catalog reads its `.d.ts`: string-literal unions only, following type
 * aliases into the files they're imported from. Best effort: an unknown layout
 * gives nothing, and the code's own values still stand.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Node } from '@babel/types';
import { parseCode } from './ast.js';

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** The declaration file for `name` imported from `module`, in the project's node_modules */
export function declarationFile(cwd: string, module: string, name: string): string | null {
  const parts = module.split('/');
  const rootName = module.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const root = join(cwd, 'node_modules', rootName);
  if (!existsSync(root)) return null;
  const sub = module.slice(rootName.length); // '' or '/Button'
  const dirs = [...new Set([name, kebab(name), name.toLowerCase()])];
  const candidates = [
    ...(sub ? [`${root}${sub}.d.ts`, `${root}${sub}/index.d.ts`, `${root}${sub}/${name}.d.ts`] : []),
    ...dirs.flatMap(d => [
      join(root, d, `${name}.d.ts`), join(root, d, `${d}.d.ts`), join(root, d, 'index.d.ts'),
      join(root, 'es', d, 'index.d.ts'), join(root, 'lib', d, 'index.d.ts'), join(root, 'dist', d, 'index.d.ts'),
      join(root, 'dist', 'components', d, 'index.d.ts'),
    ]),
  ];
  return candidates.find(f => existsSync(f)) ?? null;
}

interface Parsed { decls: Map<string, Node>; imports: Map<string, string>; reexports: string[] }

const cache = new Map<string, Parsed | null>();

function parseFile(file: string): Parsed | null {
  if (cache.has(file)) return cache.get(file)!;
  let out: Parsed | null = null;
  try {
    const code = readFileSync(file, 'utf8');
    if (code.length < 400_000) {
      const res = parseCode(code, file.replace(/\.d\.ts$/, '.ts'));
      if (res.ok) {
        out = { decls: new Map(), imports: new Map(), reexports: [] };
        for (const s of (res.value as unknown as { program: { body: Node[] } }).program.body) {
          const d = (s.type === 'ExportNamedDeclaration' && s.declaration) ? s.declaration : s;
          if ((d.type === 'TSInterfaceDeclaration' || d.type === 'TSTypeAliasDeclaration') && d.id.type === 'Identifier') out.decls.set(d.id.name, d);
          if (s.type === 'ImportDeclaration' && s.source.value.startsWith('.')) {
            for (const sp of s.specifiers) if (sp.type === 'ImportSpecifier') out.imports.set(sp.local.name, s.source.value);
          }
          if ((s.type === 'ExportNamedDeclaration' || s.type === 'ExportAllDeclaration') && s.source?.value.startsWith('.')) out.reexports.push(s.source.value);
        }
      }
    }
  } catch { /* unreadable: nothing */ }
  cache.set(file, out);
  return out;
}

/** `../styles/createTypography.js` from a .d.ts → the .d.ts it means */
function relativeDeclaration(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec.replace(/\.(js|mjs|cjs)$/, ''));
  for (const f of [`${base}.d.ts`, join(base, 'index.d.ts')]) if (existsSync(f)) return f;
  return null;
}

/** String literals a type stands for: unions, aliases (here or imported), OverridableStringUnion<…> / LiteralUnion<…> */
function literals(t: Node | null | undefined, file: string, depth = 0): string[] {
  if (!t || depth > 6) return [];
  if (t.type === 'TSLiteralType' && (t.literal.type === 'StringLiteral' || t.literal.type === 'NumericLiteral')) return [String(t.literal.value)];
  if (t.type === 'TSUnionType') return t.types.flatMap(x => literals(x, file, depth + 1));
  if (t.type === 'TSParenthesizedType') return literals(t.typeAnnotation, file, depth + 1);
  if (t.type === 'TSTypeReference' && t.typeName.type === 'Identifier') {
    const name = t.typeName.name;
    if (/^(OverridableStringUnion|LiteralUnion)$/.test(name)) return literals(t.typeParameters?.params[0], file, depth + 1);
    const here = parseFile(file);
    const decl = here?.decls.get(name);
    if (decl?.type === 'TSTypeAliasDeclaration') return literals(decl.typeAnnotation, file, depth + 1);
    const from = here?.imports.get(name);
    const other = from ? relativeDeclaration(file, from) : null;
    const there = other ? parseFile(other)?.decls.get(name) : undefined;
    if (other && there?.type === 'TSTypeAliasDeclaration') return literals(there.typeAnnotation, other, depth + 1);
  }
  return [];
}

export interface LibraryChoice { values: string[]; /** Its JSDoc `@default`, when it names one of the values */ def?: string }

/** `@default 'text'` in the JSDoc above a member → text */
function jsDocDefault(m: Node): string | undefined {
  for (const c of m.leadingComments ?? []) {
    const v = /@default\s+(['"`]?)([\w.-]+)\1\s*$/m.exec(c.value)?.[2];
    if (v) return v;
  }
  return undefined;
}

/** Members of the component's props interface(s) that are string-literal choices */
function choicesIn(file: string, name: string, depth = 0): Map<string, LibraryChoice> {
  const out = new Map<string, LibraryChoice>();
  const parsed = parseFile(file);
  if (!parsed || depth > 2) return out;
  for (const iface of [`${name}OwnProps`, `${name}Props`, `${name}BaseProps`]) {
    const decl = parsed.decls.get(iface);
    const body = decl?.type === 'TSInterfaceDeclaration' ? decl.body.body
      : decl?.type === 'TSTypeAliasDeclaration' && decl.typeAnnotation.type === 'TSTypeLiteral' ? decl.typeAnnotation.members : [];
    for (const m of body) {
      if (m.type !== 'TSPropertySignature' || m.key.type !== 'Identifier' || out.has(m.key.name)) continue;
      const values = [...new Set(literals(m.typeAnnotation?.typeAnnotation, file))];
      if (values.length < 2 || values.length > 30) continue;
      const def = jsDocDefault(m);
      out.set(m.key.name, { values, ...(def && values.includes(def) ? { def } : {}) });
    }
  }
  // An index that only re-exports: look one level in
  if (out.size === 0) {
    for (const spec of parsed.reexports) {
      const next = relativeDeclaration(file, spec);
      if (next) for (const [k, v] of choicesIn(next, name, depth + 1)) if (!out.has(k)) out.set(k, v);
    }
  }
  return out;
}

/** A library component's props that take one of a declared set of values */
export function libraryChoices(cwd: string, module: string, name: string): Map<string, LibraryChoice> {
  const file = declarationFile(cwd, module, name);
  return file ? choicesIn(file, name) : new Map();
}
