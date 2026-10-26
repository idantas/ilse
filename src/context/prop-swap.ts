/**
 * Prop swap — a component's variant changed in the panel, written without AI.
 *
 * The panel's Component section offers the props the code already uses
 * (`variant`, `size`, `color`…). Picking another value is a decision already
 * made: `<Button variant="contained">` → `variant="outlined"`. Any library,
 * not only Tailwind.
 *
 * Where: React's dev stack says which file wrote the `<Button>`; inside it, the
 * one `<Button>` whose literal props (and text) match the instance on the page.
 * Not exactly one, or a prop computed by an expression → a reason, and the
 * request goes to the agent as before.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JSXElement, JSXOpeningElement, Node } from '@babel/types';
import { parseCode } from '../design-context/ast.js';
import { resolveImport } from '../design-context/catalog.js';
import { frameFile } from './locate.js';
import type { SwapResult } from './token-swap.js';

export type PropValue = string | number | boolean;

export interface PropEdit {
  /** The component as the catalog names it (`Button`) */
  component: string;
  /** Catalog source: a package (`@mui/material`) or the project file that defines it */
  source: string;
  /** Where React created this instance's element (dev stack URL) — the file that wrote it */
  frameUrl?: string;
  /** The instance's literal props now, to tell it apart from its siblings in the file */
  props: Record<string, PropValue>;
  /** Its text, when it has some */
  text?: string;
  changes: Array<{ prop: string; from?: string; to: string }>;
}

function visit(node: unknown, fn: (n: Node, parent: Node | null) => void, parent: Node | null = null): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) visit(n, fn, parent); return; }
  const n = node as Node;
  if (typeof n.type !== 'string') return;
  fn(n, parent);
  for (const k of Object.keys(n)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments' || k === 'extra') continue;
    visit((n as unknown as Record<string, unknown>)[k], fn, n);
  }
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** An attribute's value when it's a literal: `"a"`, `{2}`, `{true}`, bare `disabled` → 'true' */
function literal(attr: Node): { value: string } | { dynamic: true } {
  if (attr.type !== 'JSXAttribute') return { dynamic: true };
  const v = attr.value;
  if (v == null) return { value: 'true' };
  if (v.type === 'StringLiteral') return { value: v.value };
  if (v.type === 'JSXExpressionContainer') {
    const e = v.expression;
    if (e.type === 'StringLiteral' || e.type === 'NumericLiteral' || e.type === 'BooleanLiteral') return { value: String(e.value) };
    if (e.type === 'TemplateLiteral' && e.expressions.length === 0) return { value: e.quasis.map(q => q.value.cooked ?? '').join('') };
  }
  return { dynamic: true };
}

/** How a value is written in JSX: `prop="a"`, `prop={2}`, `prop`, `prop={false}` */
export function writeProp(prop: string, to: string, wasNumber = false): string {
  if (to === 'true') return prop;
  if (to === 'false') return `${prop}={false}`;
  if (wasNumber && /^-?\d+(\.\d+)?$/.test(to)) return `${prop}={${to}}`;
  return /["\\\n]/.test(to) ? `${prop}={${JSON.stringify(to)}}` : `${prop}="${to}"`;
}

/** Names the file uses for the component: imports of it (aliased too), or its own definition */
function localNames(ast: Node, file: string, edit: { component: string; source: string }, cwd: string): Set<string> {
  const names = new Set<string>();
  if (edit.source === file) names.add(edit.component);
  visit(ast, (n) => {
    if (n.type !== 'ImportDeclaration') return;
    const src = n.source.value;
    const project = resolveImport(cwd, file, src);
    const fromIt = project ? project === edit.source : (src === edit.source || src.startsWith(`${edit.source}/`));
    if (!fromIt) return;
    for (const sp of n.specifiers) {
      if (sp.type === 'ImportSpecifier') {
        const imported = sp.imported.type === 'Identifier' ? sp.imported.name : sp.imported.value;
        if (imported === edit.component) names.add(sp.local.name);
      } else if (sp.type === 'ImportDefaultSpecifier' && (sp.local.name === edit.component || /\//.test(src.slice(edit.source.length)))) {
        // `import Button from '@mui/material/Button'` — the default of the component's own module
        names.add(sp.local.name);
      }
    }
  });
  return names;
}

/** An instance on the page, as React's dev stack and its props describe it */
export interface InstanceSpec {
  component: string;
  /** Catalog source, to recognise aliased imports; absent: the JSX name is the component's */
  source?: string;
  frameUrl?: string;
  props: Record<string, PropValue>;
  text?: string;
}

export type FoundInstance =
  | { ok: true; file: string; code: string; ast: Node; open: JSXOpeningElement; el: JSXElement | null }
  | { ok: false; reason: string };

/**
 * The one `<Component …>` in the file that wrote this instance: same literal
 * props, same plain text. None or several → a reason.
 */
export function findInstance(spec: InstanceSpec, cwd: string): FoundInstance {
  const file = spec.frameUrl ? frameFile(spec.frameUrl, cwd) : null;
  if (!file) return { ok: false, reason: 'arquivo do componente não localizado' };
  const abs = join(cwd, file);
  if (!existsSync(abs)) return { ok: false, reason: 'arquivo não encontrado' };
  const code = readFileSync(abs, 'utf8');
  const parsed = parseCode(code, abs);
  if (!parsed.ok) return { ok: false, reason: 'arquivo não parseou' };
  const ast = parsed.value as unknown as Node;
  const names = spec.source ? localNames(ast, file, { ...spec, source: spec.source }, cwd) : new Set([spec.component]);
  if (names.size === 0) return { ok: false, reason: `${spec.component} não é importado em ${file}` };

  // Every <Component> in the file that could be this instance
  const candidates: Array<{ open: JSXOpeningElement; el: JSXElement | null }> = [];
  visit(ast, (n, parent) => {
    if (n.type !== 'JSXOpeningElement' || n.name.type !== 'JSXIdentifier' || !names.has(n.name.name)) return;
    candidates.push({ open: n, el: parent?.type === 'JSXElement' ? parent : null });
  });
  const matching = candidates.filter(({ open, el }) => {
    for (const a of open.attributes) {
      if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier') continue;
      const lit = literal(a);
      const has = spec.props[a.name.name];
      // A literal in the code that disagrees with the instance (or that it doesn't have): another <Button>
      if ('value' in lit && a.name.name !== 'key' && (has === undefined || String(has) !== lit.value)) return false;
    }
    // A literal prop the instance has but this JSX doesn't set (and isn't spread): another one
    for (const [k, v] of Object.entries(spec.props)) {
      if (k === 'children') continue;
      const spread = open.attributes.some(a => a.type === 'JSXSpreadAttribute');
      const set = open.attributes.some(a => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === k);
      if (!set && !spread && v !== false && v !== undefined) return false;
    }
    if (spec.text && el && el.children.length > 0 && el.children.every(c => c.type === 'JSXText')) {
      if (squash(el.children.map(c => (c as { value: string }).value).join('')) !== squash(spec.text)) return false;
    }
    return true;
  });
  if (matching.length === 0) return { ok: false, reason: `nenhum <${spec.component}> igual ao da tela em ${file}` };
  if (matching.length > 1) return { ok: false, reason: `${matching.length} <${spec.component}> iguais em ${file}` };
  return { ok: true, file, code, ast, ...matching[0] };
}

export function planPropSwap(edit: PropEdit, cwd: string): SwapResult {
  if (edit.changes.length === 0) return { ok: false, reason: 'nada a mudar' };
  const found = findInstance(edit, cwd);
  if (!found.ok) return found;
  const { file, code } = found;
  const { open } = found;
  type Splice = { start: number; end: number; text: string };
  const splices: Splice[] = [];
  for (const change of edit.changes) {
    if (!/^[A-Za-z][\w-]*$/.test(change.prop)) return { ok: false, reason: `prop inválida: ${change.prop}` };
    const attr = open.attributes.find(a => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === change.prop);
    // "—" / "(default)" in the panel: the prop leaves the JSX, with the space or line it took
    if (change.to === '') {
      if (!attr) continue;
      if (!('value' in literal(attr))) return { ok: false, reason: `${change.prop} vem de uma expressão` };
      let start = attr.start!;
      while (start > 0 && /[ \t]/.test(code[start - 1])) start--;
      const lineStart = start > 0 && code[start - 1] === '\n';
      const end = lineStart && code[attr.end!] === '\n' ? attr.end! + 1 : attr.end!;
      splices.push({ start, end, text: '' });
      continue;
    }
    if (attr) {
      const lit = literal(attr);
      if (!('value' in lit)) return { ok: false, reason: `${change.prop} vem de uma expressão` };
      const wasNumber = attr.type === 'JSXAttribute' && attr.value?.type === 'JSXExpressionContainer' && attr.value.expression.type === 'NumericLiteral';
      splices.push({ start: attr.start!, end: attr.end!, text: writeProp(change.prop, change.to, wasNumber) });
    } else {
      const at = open.name.end!;
      splices.push({ start: at, end: at, text: ` ${writeProp(change.prop, change.to, typeof edit.props[change.prop] === 'number')}` });
    }
  }
  let after = code;
  for (const s of splices.sort((a, b) => b.start - a.start)) after = after.slice(0, s.start) + s.text + after.slice(s.end);
  if (after === code) return { ok: false, reason: 'nada a mudar' };
  return {
    ok: true,
    plan: {
      file, line: open.loc?.start.line ?? 1, before: code, after,
      edits: edit.changes.map(c => ({ property: c.prop, removed: c.from ? [c.from] : [], added: c.to })),
    },
  };
}

/** Only the shapes the toolbar sends */
export function parsePropEdit(v: unknown): PropEdit | undefined {
  const e = v as Partial<Record<keyof PropEdit, unknown>> | null;
  if (!e || typeof e.component !== 'string' || typeof e.source !== 'string' || !Array.isArray(e.changes)) return undefined;
  const props: Record<string, PropValue> = {};
  if (e.props && typeof e.props === 'object') {
    for (const [k, val] of Object.entries(e.props as Record<string, unknown>).slice(0, 40)) {
      if (typeof val === 'string' ? val.length <= 200 : typeof val === 'number' || typeof val === 'boolean') props[k.slice(0, 60)] = val as PropValue;
    }
  }
  const changes = (e.changes as unknown[]).flatMap(c => {
    const x = c as { prop?: unknown; from?: unknown; to?: unknown };
    return typeof x.prop === 'string' && typeof x.to === 'string' ? [{ prop: x.prop.slice(0, 60), to: x.to.slice(0, 200), ...(typeof x.from === 'string' ? { from: x.from.slice(0, 200) } : {}) }] : [];
  }).slice(0, 12);
  if (changes.length === 0) return undefined;
  return {
    component: e.component.slice(0, 80), source: e.source.slice(0, 300), props, changes,
    ...(typeof e.frameUrl === 'string' ? { frameUrl: e.frameUrl.slice(0, 400) } : {}),
    ...(typeof e.text === 'string' ? { text: e.text.slice(0, 200) } : {}),
  };
}
