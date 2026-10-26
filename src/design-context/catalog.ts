/**
 * The catalog: every component the product already has, read from the code, no AI.
 *
 * Two sources. The project's own components (exported from its files and used
 * somewhere, or sitting in a kit folder like `components/ui`), and the library
 * components the code actually imports (`Button` from `@mui/material`) — never a
 * whole library, which would be noise.
 *
 * For each one: where it comes from, how often it's used, its props and the
 * values each prop takes — from the TypeScript type (`variant?: 'a' | 'b'`, a
 * `cva()` variants map) and from the values the code passes. Nothing invented:
 * what the panel offers later is what this found.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import type { Node } from '@babel/types';
import { parseCode } from './ast.js';
import { isCatalog, walk } from './consistency.js';
import { classify, type CatalogKind, type CatalogLayer } from './catalog-kinds.js';
import { readCatalogFile } from './catalog-file.js';
import { inKit, readDesignSystem } from './design-system.js';
import { libraryChoices, type LibraryChoice } from './library-types.js';

export interface CatalogProp {
  name: string;
  /** Required by the component's type (library props: unknown, so false) */
  required: boolean;
  /** Values it takes: the type's literals first, then the ones the code passes, most used first */
  values: string[];
  kind: 'enum' | 'boolean' | 'text' | 'other';
  /** What it is when left out, when the code says so (`= 'md'`, cva's `defaultVariants`, a library's `@default`); a boolean is false */
  default?: string;
}

export interface CatalogEntry {
  /** `source#name` — stable across scans */
  id: string;
  name: string;
  /** Project file (`src/components/ui/button.tsx`) or package (`@mui/material`) */
  source: string;
  /** Folder it's listed under: `ui`, `dashboard`, `@mui/material` */
  folder: string;
  library: boolean;
  /** How it's imported: `import { X }` or `import X` */
  importAs: 'named' | 'default';
  /** The module path a library import uses (`@mui/material`, `@mui/material/Button`) */
  module?: string;
  uses: number;
  props: CatalogProp[];
  /** The element it renders at its root (project components): `button`, `div` */
  renders?: string;
  /** The most common way the code writes it, to copy on insert */
  example?: { file: string; line: number; code: string };
  /** Base (library, kit, shared pattern) or one feature's own (`catalog-kinds.ts`) */
  layer?: CatalogLayer;
  /** What it's for: actions, inputs, overlays… */
  kind?: CatalogKind;
  /** The part of the business a product component belongs to: `keys` */
  feature?: string;
  /** How the team names that part (`.ilse/catalog.md`): Chaves */
  featureLabel?: string;
  /** The design system it comes from: a package (`@acme/ui`), `Storybook` or `shadcn/ui` */
  ds?: string;
  /** Its group there: a story title's (`Forms`) */
  dsGroup?: string;
}

// Icons would flood the list; providers and routers aren't something to place on a page
const SKIP_PACKAGES = /^(react|react-dom|lucide-react|react-icons|@mui\/icons-material|@heroicons\/.*|@tabler\/icons-react|@radix-ui\/react-icons|@phosphor-icons\/.*|phosphor-react|react-feather)$/;
const SKIP_NAMES = /Provider$|^Route[sr]?$|Router$|^Suspense$|^Fragment$|^StrictMode$|^Helmet|^Head$|^Script$|^Outlet$|^ErrorBoundary$|^CssBaseline$|^GlobalStyles?$|^Analytics$|^SpeedInsights$|^AnimatePresence$|^LayoutGroup$|^MotionConfig$|^Controller$|^FormProvider$/;
// Screens, not pieces: the app root and framework route files
const SCREEN_FILE = /(^|\/)(page|layout|loading|error|template|not-found|default|_app|_document|main|index)\.(tsx|jsx)$/;
const SCREEN_NAME = /^(App|Root|RootLayout|Layout|Page|Home|NotFound)$/;
const SKIP_PROPS = new Set(['key', 'ref', 'className', 'style', 'sx', 'id', 'class', 'css', 'tw']);
const MAX_VALUES = 12;
/** Props that carry words for people, not a choice among variants */
const TEXT_PROPS = /^(label|title|placeholder|alt|text|description|helperText|name|href|src|value|defaultValue|tooltip|caption|heading|subtitle|content|message)$/i;

/** Plain recursive walk over a Babel AST (sync; the catalog doesn't need scopes) */
function visit(node: unknown, fn: (n: Node, parent: Node | null) => void, parent: Node | null = null): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) visit(n, fn, parent); return; }
  const n = node as Node;
  if (typeof n.type !== 'string') return;
  fn(n, parent);
  for (const k of Object.keys(n)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments' || k === 'extra') continue;
    visit((n as unknown as Record<string, unknown>)[k], fn, n);
  }
}

/** `@mui/material/Button` → `@mui/material`; `antd` → `antd` */
export function packageRoot(source: string): string {
  const parts = source.split('/');
  return source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const EXTS = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

/** A relative or aliased import → the project file it points at (posix, relative to cwd), or null */
export function resolveImport(cwd: string, fromRel: string, source: string): string | null {
  let bases: string[];
  if (source.startsWith('.')) bases = [posix.join(posix.dirname(fromRel), source)];
  else if (/^[@~]\//.test(source)) bases = [posix.join('src', source.slice(2)), source.slice(2)];
  else return null;
  for (const base of bases) {
    for (const ext of ['', ...EXTS]) {
      const rel = base + ext;
      if (/\.(tsx|ts|jsx|js)$/.test(rel) && existsSync(join(cwd, rel))) return posix.normalize(rel);
    }
  }
  return null;
}

/** `src/components/ui/button.tsx` → `ui`; `src/components/stat-card.tsx` → `components`; `src/app/x.tsx` → `app` */
export function folderOf(rel: string): string {
  const parts = rel.split('/');
  const at = parts.lastIndexOf('components');
  if (at >= 0) return parts.slice(at + 1, -1).join('/') || 'components';
  const pkg = parts.indexOf('packages');
  if (pkg >= 0 && parts[pkg + 1]) return parts[pkg + 1];
  return parts.at(-2) ?? '.';
}

interface TypeInfo { required: boolean; values: string[]; kind: CatalogProp['kind']; default?: string }
type CvaMap = Map<string, Map<string, { values: string[]; def?: string }>>;

function literalsOf(t: Node | null | undefined): TypeInfo['values'] | null {
  if (!t) return null;
  if (t.type === 'TSLiteralType' && (t.literal.type === 'StringLiteral' || t.literal.type === 'NumericLiteral')) return [String(t.literal.value)];
  if (t.type === 'TSUnionType') {
    const all = t.types.map(literalsOf);
    return all.every(Boolean) ? (all as string[][]).flat() : all.some(Boolean) ? (all.filter(Boolean) as string[][]).flat() : null;
  }
  return null;
}

function kindOf(t: Node | null | undefined): TypeInfo['kind'] {
  if (!t) return 'other';
  if (literalsOf(t)?.length) return 'enum';
  if (t.type === 'TSBooleanKeyword') return 'boolean';
  if (t.type === 'TSStringKeyword' || t.type === 'TSNumberKeyword') return 'text';
  if (t.type === 'TSTypeReference' && t.typeName.type === 'TSQualifiedName' && t.typeName.right.name === 'ReactNode') return 'text';
  if (t.type === 'TSTypeReference' && t.typeName.type === 'Identifier' && t.typeName.name === 'ReactNode') return 'text';
  return 'other';
}

/** Props a type declares, following local interfaces/aliases and `A & B` */
function propsOfType(t: Node | null | undefined, local: Map<string, Node>, cva: CvaMap, depth = 0): Map<string, TypeInfo> {
  const out = new Map<string, TypeInfo>();
  if (!t || depth > 4) return out;
  const merge = (m: Map<string, TypeInfo>) => { for (const [k, v] of m) if (!out.has(k)) out.set(k, v); };
  if (t.type === 'TSTypeLiteral' || t.type === 'TSInterfaceBody') {
    const members = t.type === 'TSTypeLiteral' ? t.members : t.body;
    for (const m of members) {
      if (m.type !== 'TSPropertySignature' || m.key.type !== 'Identifier') continue;
      const ann = m.typeAnnotation?.typeAnnotation;
      out.set(m.key.name, { required: !m.optional, values: literalsOf(ann) ?? (ann?.type === 'TSBooleanKeyword' ? ['true', 'false'] : []), kind: kindOf(ann) });
    }
  } else if (t.type === 'TSIntersectionType') {
    for (const part of t.types) merge(propsOfType(part, local, cva, depth + 1));
  } else if (t.type === 'TSTypeReference') {
    const name = t.typeName.type === 'Identifier' ? t.typeName.name : t.typeName.type === 'TSQualifiedName' ? t.typeName.right.name : '';
    // VariantProps<typeof buttonVariants> — the cva() variants are the props
    if (name === 'VariantProps') {
      const arg = t.typeParameters?.params[0];
      const ref = arg?.type === 'TSTypeQuery' && arg.exprName.type === 'Identifier' ? arg.exprName.name : undefined;
      for (const [k, { values, def }] of cva.get(ref ?? '') ?? []) out.set(k, { required: false, values, kind: 'enum', ...(def ? { default: def } : {}) });
    } else if (local.has(name)) {
      const decl = local.get(name)!;
      merge(propsOfType(decl.type === 'TSInterfaceDeclaration' ? decl.body : decl.type === 'TSTypeAliasDeclaration' ? decl.typeAnnotation : null, local, cva, depth + 1));
      if (decl.type === 'TSInterfaceDeclaration') for (const h of decl.extends ?? []) {
        if (h.expression.type === 'Identifier') merge(propsOfType({ type: 'TSTypeReference', typeName: h.expression, typeParameters: h.typeParameters } as unknown as Node, local, cva, depth + 1));
      }
    }
  }
  return out;
}

/** `cva(base, { variants: { size: { sm: …, lg: … } }, defaultVariants: { size: 'sm' } })` assigned to a const → its variant names, values and defaults */
function cvaMaps(ast: Node): CvaMap {
  const out: CvaMap = new Map();
  visit(ast, (n) => {
    if (n.type !== 'VariableDeclarator' || n.id.type !== 'Identifier' || n.init?.type !== 'CallExpression') return;
    const callee = n.init.callee;
    if (callee.type !== 'Identifier' || !/^(cva|tv)$/.test(callee.name)) return;
    const config = n.init.arguments.find(a => a.type === 'ObjectExpression');
    if (config?.type !== 'ObjectExpression') return;
    const prop = (name: string) => config.properties.find(p => p.type === 'ObjectProperty' && ((p.key.type === 'Identifier' && p.key.name === name) || (p.key.type === 'StringLiteral' && p.key.value === name)));
    const variants = prop('variants');
    if (variants?.type !== 'ObjectProperty' || variants.value.type !== 'ObjectExpression') return;
    const defaults = new Map<string, string>();
    const dv = prop('defaultVariants');
    if (dv?.type === 'ObjectProperty' && dv.value.type === 'ObjectExpression') for (const d of dv.value.properties) {
      if (d.type !== 'ObjectProperty') continue;
      const key = d.key.type === 'Identifier' ? d.key.name : d.key.type === 'StringLiteral' ? d.key.value : null;
      const v = literalValue(d.value);
      if (key && v !== undefined) defaults.set(key, v);
    }
    const map = new Map<string, { values: string[]; def?: string }>();
    for (const v of variants.value.properties) {
      if (v.type !== 'ObjectProperty' || v.value.type !== 'ObjectExpression') continue;
      const key = v.key.type === 'Identifier' ? v.key.name : v.key.type === 'StringLiteral' ? v.key.value : null;
      if (!key) continue;
      const values = v.value.properties.flatMap(o => o.type === 'ObjectProperty' ? [o.key.type === 'Identifier' ? o.key.name : o.key.type === 'StringLiteral' ? o.key.value : o.key.type === 'NumericLiteral' ? String(o.key.value) : ''] : []).filter(Boolean);
      map.set(key, { values, ...(defaults.has(key) ? { def: defaults.get(key) } : {}) });
    }
    out.set(n.id.name, map);
  });
  return out;
}

/** `'md'`, `3`, `false` → its text; anything computed → undefined */
function literalValue(n: Node): string | undefined {
  if (n.type === 'StringLiteral' || n.type === 'NumericLiteral' || n.type === 'BooleanLiteral') return String(n.value);
  return undefined;
}

interface Exported { name: string; props: Map<string, TypeInfo>; renders?: string; isDefault: boolean; line: number }

/** The first element a component returns: `button`, `div`, or a component name */
function rootTag(fn: Node): string | undefined {
  let tag: string | undefined;
  visit(fn, (n) => {
    if (tag || n.type !== 'JSXOpeningElement') return;
    tag = n.name.type === 'JSXIdentifier' ? n.name.name : n.name.type === 'JSXMemberExpression' && n.name.property.type === 'JSXIdentifier' ? n.name.property.name : undefined;
  });
  return tag;
}

/** Function components a file exports, with the props their type declares */
function exportedComponents(ast: Node): Exported[] {
  const program = ast.type === 'File' ? ast.program : null;
  if (!program) return [];
  const local = new Map<string, Node>();
  for (const s of program.body) {
    const d = s.type === 'ExportNamedDeclaration' && s.declaration ? s.declaration : s;
    if ((d.type === 'TSInterfaceDeclaration' || d.type === 'TSTypeAliasDeclaration') && d.id.type === 'Identifier') local.set(d.id.name, d);
  }
  const cva = cvaMaps(ast);
  const fns = new Map<string, Node>();
  for (const s of program.body) {
    if (s.type === 'FunctionDeclaration' && s.id) fns.set(s.id.name, s);
    if (s.type === 'VariableDeclaration') for (const d of s.declarations) if (d.id.type === 'Identifier' && d.init) fns.set(d.id.name, d);
    const d = (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration') ? s.declaration : null;
    if (d?.type === 'FunctionDeclaration' && d.id) fns.set(d.id.name, d);
    if (d?.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier' && v.init) fns.set(v.id.name, v);
  }

  const names: Array<{ name: string; isDefault: boolean }> = [];
  for (const s of program.body) {
    if (s.type === 'ExportNamedDeclaration') {
      const d = s.declaration;
      if (d?.type === 'FunctionDeclaration' && d.id) names.push({ name: d.id.name, isDefault: false });
      if (d?.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier') names.push({ name: v.id.name, isDefault: false });
      for (const sp of s.specifiers) if (sp.type === 'ExportSpecifier' && sp.local.type === 'Identifier' && !s.source) {
        names.push({ name: sp.local.name, isDefault: sp.exported.type === 'Identifier' && sp.exported.name === 'default' });
      }
    }
    if (s.type === 'ExportDefaultDeclaration') {
      const d = s.declaration;
      if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) names.push({ name: d.id.name, isDefault: true });
      if (d.type === 'Identifier') names.push({ name: d.name, isDefault: true });
    }
  }

  const out: Exported[] = [];
  for (const { name, isDefault } of names) {
    if (!/^[A-Z]/.test(name)) continue;
    const decl = fns.get(name);
    if (!decl) continue;
    // The function itself: a declaration, an arrow, or the one inside forwardRef()/memo()
    let fn: Node | null = decl.type === 'VariableDeclarator' ? decl.init ?? null : decl;
    let typeFromCall: Node | undefined;
    if (fn?.type === 'CallExpression') {
      const params = fn.typeParameters?.params ?? [];
      typeFromCall = params[1] ?? params[0];
      fn = fn.arguments.find(a => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression') ?? null;
    }
    if (!fn || (fn.type !== 'FunctionDeclaration' && fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')) continue;
    const renders = rootTag(fn);
    if (!renders) continue; // not a component: returns no JSX
    const param = fn.params[0];
    const ann = param && 'typeAnnotation' in param && param.typeAnnotation?.type === 'TSTypeAnnotation' ? param.typeAnnotation.typeAnnotation : undefined;
    // `React.FC<Props>` on the variable
    const varAnn = decl.type === 'VariableDeclarator' && decl.id.type === 'Identifier' && decl.id.typeAnnotation?.type === 'TSTypeAnnotation' ? decl.id.typeAnnotation.typeAnnotation : undefined;
    const fcArg = varAnn?.type === 'TSTypeReference' ? varAnn.typeParameters?.params[0] : undefined;
    const props = propsOfType(ann ?? typeFromCall ?? fcArg, local, cva);
    // A default in the destructuring makes a "required" type prop optional in practice
    if (param?.type === 'ObjectPattern') for (const p of param.properties) {
      if (p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.value.type === 'AssignmentPattern') {
        const info = props.get(p.key.name);
        if (info) {
          info.required = false;
          const def = literalValue(p.value.right);
          if (def !== undefined) info.default = def;
        }
      }
    }
    out.push({ name, props, renders, isDefault, line: decl.loc?.start.line ?? 1 });
  }
  return out;
}

/** A library's declared choices as typed props: none required, its `@default` kept */
function libraryTyped(choices: Map<string, LibraryChoice>): Map<string, TypeInfo> {
  return new Map([...choices].map(([k, { values, def }]) => [k, { required: false, values, kind: 'enum' as const, ...(def ? { default: def } : {}) }]));
}

interface Usage { file: string; line: number; code: string; attrs: Map<string, string | null> }

/** Build the catalog for the project at `cwd` */
export function buildCatalog(cwd: string): CatalogEntry[] {
  const paths: string[] = [];
  walk(cwd, paths);

  const entries = new Map<string, CatalogEntry & { typed: Map<string, TypeInfo>; usages: Usage[] }>();
  const parsed: Array<{ rel: string; code: string; ast: Node }> = [];

  for (const full of paths) {
    let code: string;
    try { code = readFileSync(full, 'utf8'); } catch { continue; }
    if (code.length > 300_000) continue;
    const rel = relative(cwd, full).split(sep).join('/');
    const res = parseCode(code, full);
    if (!res.ok) continue;
    parsed.push({ rel, code, ast: res.value as unknown as Node });
    for (const c of exportedComponents(res.value as unknown as Node)) {
      const id = `${rel}#${c.name}`;
      entries.set(id, {
        id, name: c.name, source: rel, folder: folderOf(rel), library: false,
        importAs: c.isDefault ? 'default' : 'named', uses: 0, props: [], renders: c.renders,
        typed: c.props, usages: [],
      });
    }
  }

  for (const { rel, code, ast } of parsed) {
    // Local name → where it comes from
    const imports = new Map<string, { id: string; library?: { module: string; name: string; isDefault: boolean } }>();
    visit(ast, (n) => {
      if (n.type !== 'ImportDeclaration' || n.importKind === 'type') return;
      const source = n.source.value;
      const file = resolveImport(cwd, rel, source);
      for (const sp of n.specifiers) {
        if (sp.type === 'ImportNamespaceSpecifier') continue;
        const imported = sp.type === 'ImportSpecifier' ? (sp.imported.type === 'Identifier' ? sp.imported.name : sp.imported.value) : 'default';
        const localName = sp.local.name;
        if (!/^[A-Z]/.test(localName)) continue;
        if (file) {
          // `export default function Card` imported as Card, or a named export
          const named = imported === 'default'
            ? [...entries.values()].find(e => e.source === file && e.importAs === 'default')
            : entries.get(`${file}#${imported}`);
          if (named) imports.set(localName, { id: named.id });
        } else if (!SKIP_PACKAGES.test(packageRoot(source)) && !/icon/i.test(packageRoot(source)) && !source.startsWith('.')) {
          const name = imported === 'default' ? localName : imported;
          if (SKIP_NAMES.test(name)) continue;
          imports.set(localName, { id: `${packageRoot(source)}#${name}`, library: { module: source, name, isDefault: imported === 'default' } });
        }
      }
    });
    // Components used in the file they're declared in
    for (const e of entries.values()) if (e.source === rel && !imports.has(e.name)) imports.set(e.name, { id: e.id });

    visit(ast, (n, parent) => {
      if (n.type !== 'JSXOpeningElement' || n.name.type !== 'JSXIdentifier') return;
      const hit = imports.get(n.name.name);
      if (!hit) return;
      let entry = entries.get(hit.id);
      if (!entry && hit.library) {
        const root = packageRoot(hit.library.module);
        entry = {
          id: hit.id, name: hit.library.name, source: root, folder: root, library: true,
          importAs: hit.library.isDefault ? 'default' : 'named', module: hit.library.module,
          uses: 0, props: [],
          // Its declared choices (MUI's variant: text | outlined | contained), not only the ones the code uses
          typed: libraryTyped(libraryChoices(cwd, hit.library.module, hit.library.name)),
          usages: [],
        };
        entries.set(hit.id, entry);
      }
      if (!entry) return;
      // A library piece the kit wraps (Radix inside components/ui) is the kit's business, not a catalog item
      if (entry.library && isCatalog(rel)) return;
      entry.uses++;
      const attrs = new Map<string, string | null>();
      for (const a of n.attributes) {
        if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier') continue;
        const v = a.value;
        attrs.set(a.name.name,
          v == null ? 'true'
          : v.type === 'StringLiteral' ? v.value
          : v.type === 'JSXExpressionContainer' && (v.expression.type === 'StringLiteral' || v.expression.type === 'NumericLiteral' || v.expression.type === 'BooleanLiteral') ? String(v.expression.value)
          : null);
      }
      const el = parent?.type === 'JSXElement' ? parent : n;
      const snippet = el.start != null && el.end != null ? code.slice(el.start, el.end) : '';
      entry.usages.push({ file: rel, line: n.loc?.start.line ?? 1, code: snippet, attrs });
    });
  }

  const out: CatalogEntry[] = [];
  const usedIn = new Map<string, string[]>();
  for (const e of entries.values()) {
    if (e.uses === 0 && !isCatalog(e.source)) continue;
    if (!e.library && (SCREEN_NAME.test(e.name) || (SCREEN_FILE.test(e.source) && !isCatalog(e.source)))) continue;
    // Values: the type's own first (its order is the author's), then what the code passes
    const seen = new Map<string, Map<string, number>>();
    for (const u of e.usages) for (const [k, v] of u.attrs) {
      if (!seen.has(k)) seen.set(k, new Map());
      if (v != null) seen.get(k)!.set(v, (seen.get(k)!.get(v) ?? 0) + 1);
    }
    const names = [...new Set([...e.typed.keys(), ...seen.keys()])].filter(k => !SKIP_PROPS.has(k) && !/^(data|aria)-/.test(k));
    e.props = names.map(name => {
      const typed = e.typed.get(name);
      const used = [...(seen.get(name) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
      const values = [...new Set([...(typed?.values ?? []), ...used])].slice(0, MAX_VALUES);
      // Untyped (a library's props): words like contained/small are choices, even seen once; prose is text
      const kind: CatalogProp['kind'] = typed?.kind && typed.kind !== 'other' ? typed.kind
        : /^on[A-Z]/.test(name) ? 'other'
        : values.length > 0 && values.every(v => v === 'true' || v === 'false') ? 'boolean'
        : TEXT_PROPS.test(name) ? (values.length ? 'text' : 'other')
        : values.length > 0 && values.every(v => /^[\w.-]{1,24}$/.test(v)) ? 'enum'
        : values.length > 0 ? 'text' : 'other';
      const def = typed?.default ?? (kind === 'boolean' ? 'false' : undefined);
      return { name, required: typed?.required ?? false, values, kind, ...(def !== undefined ? { default: def } : {}) };
    });
    // Enums first (what the Component section offers as selects), then required, then the rest
    const rank = (p: CatalogProp) => (p.kind === 'enum' ? 0 : p.kind === 'boolean' ? 1 : p.required ? 2 : 3);
    e.props.sort((a, b) => rank(a) - rank(b));
    // The most common way it's written, short enough to copy
    const byCode = new Map<string, { n: number; u: Usage }>();
    for (const u of e.usages) {
      if (!u.code || u.code.length > 400) continue;
      const k = u.code.replace(/\s+/g, ' ');
      const cur = byCode.get(k);
      byCode.set(k, { n: (cur?.n ?? 0) + 1, u: cur?.u ?? u });
    }
    const best = [...byCode.values()].sort((a, b) => b.n - a.n || a.u.code.length - b.u.code.length)[0];
    usedIn.set(e.id, e.usages.map(u => u.file));
    const { typed: _t, usages: _u, ...entry } = e;
    out.push({ ...entry, ...(best ? { example: { file: best.u.file, line: best.u.line, code: best.u.code } } : {}) });
  }
  const where = classify(out, usedIn);
  for (const e of out) Object.assign(e, where.get(e.id));
  // A design system the project declares names and groups its own pieces
  const ds = readDesignSystem(cwd);
  for (const e of out) {
    const pkg = e.library ? ds.packages.find(p => e.source === p || e.source.startsWith(`${p}/`)) : undefined;
    const group = (!e.library || pkg) ? ds.storyGroups.get(e.name) : undefined;
    const kit = !e.library && inKit(ds, e.source);
    if (!pkg && group === undefined && !kit) continue;
    e.layer = 'base';
    delete e.feature;
    e.ds = pkg ?? (group !== undefined ? 'Storybook' : 'shadcn/ui');
    if (group) e.dsGroup = group;
  }
  // The team's own corrections and names (.ilse/catalog.md) win over the rules
  const file = readCatalogFile(cwd);
  if (!file) return out.sort((a, b) => a.name.localeCompare(b.name));
  const plain = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const byLabel = new Map([...file.areas].map(([folder, label]) => [plain(label), folder]));
  const kept = out.filter(e => !file.hidden.has(e.name));
  for (const e of kept) {
    const o = file.components.get(e.name);
    if (o?.layer) e.layer = o.layer;
    if (o?.kind) e.kind = o.kind;
    if (o?.feature) e.feature = file.areas.has(o.feature) ? o.feature : byLabel.get(plain(o.feature)) ?? o.feature;
    if (e.layer === 'base') { delete e.feature; continue; }
    if (e.feature) e.featureLabel = file.areas.get(e.feature) ?? (o?.feature === e.feature ? o.feature : undefined);
    if (!e.featureLabel) delete e.featureLabel;
  }
  return kept.sort((a, b) => a.name.localeCompare(b.name));
}

export { namesFor, searchCatalog } from './catalog-search.js';

/** For the import line the insert adds: `@/components/ui/button` style paths stay the project's choice; this is the plain relative one */
export function relativeImport(fromFile: string, toFile: string): string {
  let r = posix.relative(posix.dirname(fromFile), toFile).replace(/\.(tsx|ts|jsx|js)$/, '').replace(/\/index$/, '');
  if (!r.startsWith('.')) r = `./${r}`;
  return r;
}

