/**
 * Insert a catalog component next to (or inside) an element, without AI.
 *
 * The designer dragged `Button` from the catalog and dropped it after a field.
 * When the decision is complete — every prop has a value (picked in the panel,
 * or copied from how the code already writes it) — the JSX is written next to
 * the anchor's JSX, plus the import when the file doesn't have it.
 *
 * Anything that needs judgment returns a reason and goes to the agent with the
 * same card: a required prop with no value, a handler or data to wire, an
 * anchor that is rendered by a list (`.map()`) or that can't be found exactly.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JSXElement, Node } from '@babel/types';
import type { Annotation } from '../types.js';
import { parseCode } from '../design-context/ast.js';
import { relativeImport, resolveImport } from '../design-context/catalog.js';
import { jsxAt, type SwapResult } from './token-swap.js';
import { findInstance, writeProp, type InstanceSpec, type PropValue } from './prop-swap.js';

export interface InsertRequest {
  component: string;
  /** Catalog source: a package or the project file that defines it */
  source: string;
  /** Library import path (`@mui/material`), when it's a library */
  module?: string;
  importAs: 'named' | 'default';
  library: boolean;
  placement: 'before' | 'after' | 'inside';
  /** Props picked in the panel (override the example's) */
  props: Record<string, PropValue>;
  /** Props the type requires */
  required: string[];
  /** How the code already writes it — its literal props and text are copied */
  example?: string;
  /** The copy's text, when the example has none */
  text?: string;
  /**
   * The anchor is the root of a component instance (`<StatCard …/>`): next to
   * it means next to where that instance is written, not inside its definition
   */
  at?: InstanceSpec;
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

/**
 * The JSX to write: the example's literal props and plain text, the panel's
 * picks on top. Null with a reason when something can't be copied as is.
 */
export function buildJsx(req: InsertRequest, localName: string): { code: string } | { reason: string } {
  const props = new Map<string, string>();
  let children: string | undefined;
  if (req.example) {
    const parsed = parseCode(`<>${req.example}</>`, 'example.tsx');
    if (!parsed.ok) return { reason: 'exemplo não parseou' };
    let el: JSXElement | null = null;
    visit(parsed.value, (n) => { if (!el && n.type === 'JSXElement' && n.openingElement.name.type === 'JSXIdentifier' && /^[A-Z]/.test(n.openingElement.name.name)) el = n; });
    const found = el as JSXElement | null;
    if (found) {
      for (const a of found.openingElement.attributes) {
        if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier') continue;
        const v = a.value;
        const name = a.name.name;
        if (name === 'key') continue;
        if (v == null) props.set(name, 'true');
        else if (v.type === 'StringLiteral') props.set(name, v.value);
        else if (v.type === 'JSXExpressionContainer' && (v.expression.type === 'StringLiteral' || v.expression.type === 'NumericLiteral' || v.expression.type === 'BooleanLiteral')) props.set(name, String(v.expression.value));
        // A handler or data (onClick={save}, items={rows}): only the agent knows what to wire here
        else if (req.required.includes(name)) return { reason: `${name} precisa ser ligado` };
      }
      const kids = found.children.filter(c => !(c.type === 'JSXText' && !c.value.trim()));
      // The copy on screen has its own text: that one wins over the example's
      if (kids.length > 0 && !req.text?.trim()) {
        if (!kids.every(c => c.type === 'JSXText')) return { reason: 'o conteúdo do exemplo vem de código' };
        children = kids.map(c => (c as { value: string }).value).join('').replace(/\s+/g, ' ').trim();
      }
    }
  }
  for (const [k, v] of Object.entries(req.props)) props.set(k, String(v));
  const missing = req.required.filter(r => r !== 'children' && !props.has(r));
  if (missing.length) return { reason: `sem valor para ${missing.join(', ')}` };
  if (req.text?.trim()) children = req.text.trim().replace(/\s+/g, ' ');
  if (req.required.includes('children') && !children) return { reason: 'sem conteúdo para children' };
  const attrs = [...props.entries()].map(([k, v]) => ` ${writeProp(k, v)}`).join('');
  const safe = children && /[{}<>]/.test(children) ? `{${JSON.stringify(children)}}` : children;
  return { code: safe ? `<${localName}${attrs}>${safe}</${localName}>` : `<${localName}${attrs} />` };
}

export function planInsert(annotation: Annotation, cwd: string): SwapResult {
  const req = annotation.insert;
  if (!req) return { ok: false, reason: 'nada a inserir' };
  let file: string, code: string, ast: Node, anchor: JSXElement | null;
  if (req.at) {
    // Next to a component instance: where the page wrote it
    const found = findInstance(req.at, cwd);
    if (!found.ok) return found;
    ({ file, code, ast } = found);
    anchor = found.el;
  } else {
    const hit = annotation.source?.[0];
    if (!hit || hit.kind !== 'element') return { ok: false, reason: 'lugar não localizado' };
    if (hit.ambiguous) return { ok: false, reason: 'localização ambígua' };
    const second = annotation.source?.[1];
    if (second && second.kind === 'element' && second.score >= hit.score) return { ok: false, reason: 'localização ambígua' };
    const abs = join(cwd, hit.file);
    if (!existsSync(abs)) return { ok: false, reason: 'arquivo não encontrado' };
    file = hit.file;
    code = readFileSync(abs, 'utf8');
    const parsed = parseCode(code, abs);
    if (!parsed.ok) return { ok: false, reason: 'arquivo não parseou' };
    ast = parsed.value as unknown as Node;
    const tag = /^([a-z][\w-]*)/.exec(annotation.element ?? '')?.[1];
    anchor = jsxAt(ast, hit.line, tag);
  }
  if (!anchor || anchor.start == null || anchor.end == null) return { ok: false, reason: 'nó JSX não encontrado' };
  const line = anchor.loc?.start.line ?? 1;
  // Never a component inside its own definition
  if (!req.library && req.source === file) return { ok: false, reason: `${req.component} é definido neste arquivo` };

  // Rendered by a list: one copy per item would appear — the agent decides
  let inList = false;
  visit(ast, (n) => {
    if (inList || n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression' || n.callee.property.type !== 'Identifier' || n.callee.property.name !== 'map') return;
    if (n.start! <= anchor!.start! && anchor!.end! <= n.end!) inList = true;
  });
  if (inList && req.placement !== 'inside') return { ok: false, reason: 'dentro de uma lista' };
  if (req.placement === 'inside' && anchor.openingElement.selfClosing) return { ok: false, reason: 'elemento sem filhos' };

  // The name to write, and the import it needs
  let localName = req.component;
  let importLine: string | null = null;
  let addSpecifierAt: number | null = null;
  const imports: Array<{ start: number; end: number; source: string; specifiers: Array<{ local: string; imported: string }>; namedEnd?: number }> = [];
  visit(ast, (n) => {
    if (n.type !== 'ImportDeclaration' || n.start == null || n.end == null) return;
    const named = n.specifiers.filter(s => s.type === 'ImportSpecifier');
    imports.push({
      start: n.start, end: n.end, source: n.source.value,
      specifiers: n.specifiers.map(s => ({ local: s.local.name, imported: s.type === 'ImportSpecifier' ? (s.imported.type === 'Identifier' ? s.imported.name : s.imported.value) : 'default' })),
      namedEnd: named.length ? named[named.length - 1].end ?? undefined : undefined,
    });
  });
  const fromIt = (src: string) => {
    if (req.library) return src === (req.module ?? req.source) || src === req.source;
    return resolveImport(cwd, file, src) === req.source;
  };
  const existing = imports.find(i => fromIt(i.source) && i.specifiers.some(s => s.imported === (req.importAs === 'default' ? 'default' : req.component)));
  if (existing) {
    localName = existing.specifiers.find(s => s.imported === (req.importAs === 'default' ? 'default' : req.component))!.local;
  } else if (!req.library && req.source === file) {
    localName = req.component; // defined in this very file
  } else {
    // Another thing already answers to that name here: the agent sorts out the alias
    if (imports.some(i => i.specifiers.some(s => s.local === req.component))) return { ok: false, reason: `${req.component} já é outro import neste arquivo` };
    const from = req.library ? (req.module ?? req.source) : relativeImport(file, req.source);
    const sameModule = req.importAs === 'named' ? imports.find(i => i.source === from && i.namedEnd != null) : undefined;
    if (sameModule) addSpecifierAt = sameModule.namedEnd!;
    else importLine = req.importAs === 'default' ? `import ${req.component} from '${from}';` : `import { ${req.component} } from '${from}';`;
  }

  const jsx = buildJsx(req, localName);
  if ('reason' in jsx) return { ok: false, reason: jsx.reason };

  // Indent like the anchor's line
  const lineStart = code.lastIndexOf('\n', anchor.start - 1) + 1;
  // Its own line: that line's indent. Sharing a line (`<Grid><Card /></Grid>`): its column
  const lead = code.slice(lineStart, anchor.start);
  const indent = /^[ \t]*$/.test(lead) ? lead : ' '.repeat(anchor.loc?.start.column ?? 0);
  type Splice = { at: number; text: string };
  const splices: Splice[] = [];
  if (req.placement === 'before') splices.push({ at: anchor.start, text: `${jsx.code}\n${indent}` });
  else if (req.placement === 'after') splices.push({ at: anchor.end, text: `\n${indent}${jsx.code}` });
  else {
    const close = anchor.closingElement;
    if (!close || close.start == null) return { ok: false, reason: 'elemento sem filhos' };
    const closeLineStart = code.lastIndexOf('\n', close.start - 1) + 1;
    const ownLine = !code.slice(closeLineStart, close.start).trim();
    splices.push({ at: ownLine ? closeLineStart : close.start, text: ownLine ? `${indent}  ${jsx.code}\n` : jsx.code });
  }
  if (addSpecifierAt != null) splices.push({ at: addSpecifierAt, text: `, ${req.component}` });
  if (importLine) {
    const last = imports.at(-1);
    splices.push(last ? { at: last.end, text: `\n${importLine}` } : { at: 0, text: `${importLine}\n` });
  }
  let after = code;
  for (const s of splices.sort((a, b) => b.at - a.at)) after = after.slice(0, s.at) + s.text + after.slice(s.at);
  return {
    ok: true,
    plan: {
      file, line, before: code, after,
      edits: [{ property: 'insert', removed: [], added: jsx.code }],
    },
  };
}

/** Only the shapes the toolbar sends */
export function parseInsert(v: unknown): InsertRequest | undefined {
  const r = v as Partial<Record<keyof InsertRequest, unknown>> | null;
  if (!r || typeof r.component !== 'string' || !/^[A-Z][\w$]{0,79}$/.test(r.component) || typeof r.source !== 'string') return undefined;
  if (r.placement !== 'before' && r.placement !== 'after' && r.placement !== 'inside') return undefined;
  const props: Record<string, PropValue> = {};
  if (r.props && typeof r.props === 'object') {
    for (const [k, val] of Object.entries(r.props as Record<string, unknown>).slice(0, 30)) {
      if (/^[A-Za-z][\w-]*$/.test(k) && (typeof val === 'string' ? val.length <= 200 : typeof val === 'number' || typeof val === 'boolean')) props[k] = val as PropValue;
    }
  }
  return {
    component: r.component, source: r.source.slice(0, 300), placement: r.placement, props,
    importAs: r.importAs === 'default' ? 'default' : 'named',
    library: r.library === true,
    required: Array.isArray(r.required) ? (r.required as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 30) : [],
    ...(typeof r.module === 'string' ? { module: r.module.slice(0, 200) } : {}),
    ...(typeof r.example === 'string' && r.example.length <= 400 ? { example: r.example } : {}),
    ...(typeof r.text === 'string' ? { text: r.text.slice(0, 200) } : {}),
    ...(parseAt(r.at) ? { at: parseAt(r.at)! } : {}),
  };
}

function parseAt(v: unknown): InstanceSpec | undefined {
  const a = v as Partial<Record<keyof InstanceSpec, unknown>> | null;
  if (!a || typeof a.component !== 'string' || !/^[A-Z][\w$]{0,79}$/.test(a.component) || typeof a.frameUrl !== 'string') return undefined;
  const props: Record<string, PropValue> = {};
  if (a.props && typeof a.props === 'object') {
    for (const [k, val] of Object.entries(a.props as Record<string, unknown>).slice(0, 40)) {
      if (typeof val === 'string' ? val.length <= 200 : typeof val === 'number' || typeof val === 'boolean') props[k.slice(0, 60)] = val as PropValue;
    }
  }
  return {
    component: a.component, frameUrl: a.frameUrl.slice(0, 400), props,
    ...(typeof a.source === 'string' ? { source: a.source.slice(0, 300) } : {}),
    ...(typeof a.text === 'string' ? { text: a.text.slice(0, 200) } : {}),
  };
}
