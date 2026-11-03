/**
 * The preview stage: a catalog component drawn for its copy when the page
 * doesn't show it — never visited, inside a closed menu, or a variant nobody
 * has rendered yet.
 *
 * It renders inside the app's own React tree, so the theme, router and every
 * provider above apply: an empty element of the app gets, for a moment, a
 * portal child (`overrideProps`, the hook `live-props.ts` uses) holding the
 * component in an off-screen box. The copy is taken from that box and the
 * element goes back to empty. An error boundary keeps a component that can't
 * stand alone (a menu's content outside its menu) from taking the page down —
 * it just gets no copy.
 *
 * The component itself comes from a fiber seen this session or, on Vite, from
 * its module (the URL the app itself loaded, so React stays the app's one).
 */

import { seenTypes, snapshotOf, variantKey, type CatalogItem, type CatalogSnapshot } from './catalog-snapshot.js';
import { currentOf } from './live-props.js';
import { hushPageErrors } from './page-errors.js';

type F = { tag?: number; type?: unknown; memoizedProps?: Record<string, unknown>; alternate?: F | null; return?: F | null; stateNode?: unknown };
interface Renderer {
  version?: string;
  overrideProps?: (fiber: F, path: string[], value: unknown) => void;
  overridePropsDeletePath?: (fiber: F, path: string[]) => void;
}
export type Props = Record<string, string | number | boolean>;

const VOID = /^(AREA|BASE|BR|COL|EMBED|HR|IMG|INPUT|LINK|META|SOURCE|TRACK|WBR|TEXTAREA|SELECT|OPTION|SCRIPT|STYLE|TEMPLATE|SVG|CANVAS|VIDEO|AUDIO|IFRAME)$/;
/** Long enough for a fade-in and late fonts; short enough to stay unnoticed */
const SETTLE_MS = 320;

function renderer(): Renderer | undefined {
  const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: { renderers?: Map<number, Renderer> } }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  for (const r of hook?.renderers?.values() ?? []) if (typeof r.overrideProps === 'function') return r;
  return undefined;
}

function fiberOf(el: Element): F | null {
  const k = Object.keys(el).find(key => key.startsWith('__reactFiber$'));
  return k ? (el as unknown as Record<string, F>)[k] : null;
}

/**
 * `<Button variant="outlined" size="small">Save</Button>` → its literal props
 * and text. Expressions are left out: the stage draws what the code spells out.
 */
export function parseExample(code: string, name: string): { props: Props; text?: string } {
  // Imported under another name (`Button as MuiButton`): the first component tag
  const tag = new RegExp(`<${name.replace(/[.$]/g, '\\$&')}\\b`).test(code) ? name : /<([A-Z][\w.]*)/.exec(code)?.[1];
  if (!tag) return { props: {} };
  name = tag;
  const start = new RegExp(`<${name.replace(/[.$]/g, '\\$&')}\\b`).exec(code);
  if (!start) return { props: {} };
  // The opening tag ends at the first `>` outside braces (`onClick={() => go()}` has one inside)
  let depth = 0, end = -1;
  for (let i = start.index + start[0].length; i < code.length; i++) {
    const ch = code[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) { end = i; break; }
  }
  if (end < 0) return { props: {} };
  const selfClosing = code[end - 1] === '/';
  // Expressions out, literals kept: `tone={kind}` → `tone={}`, so `kind` isn't read as a prop
  let raw = code.slice(start.index + start[0].length, selfClosing ? end - 1 : end);
  for (let prev = ''; prev !== raw;) { prev = raw; raw = raw.replace(/\{([^{}]*)\}/g, (m, inner: string) => /^\s*(-?\d+(\.\d+)?|true|false|"[^"]*"|'[^']*')\s*$/.test(inner) ? m.replace(/[{}]/g, c => c === '{' ? '\u0001' : '\u0002') : '{}'); }
  raw = raw.replace(/\u0001/g, '{').replace(/\u0002/g, '}');
  const open = { index: start.index, 0: code.slice(start.index, end + 1), 1: raw, 2: selfClosing ? '/' : '' };
  const props: Props = {};
  const attrs = /([A-Za-z][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(-?\d+(?:\.\d+)?|true|false|"[^"]*"|'[^']*')\s*\}))?/g;
  for (let m = attrs.exec(open[1]); m; m = attrs.exec(open[1])) {
    const [, key, dq, sq, expr] = m;
    if (/^(key|ref|className|style|sx)$/.test(key) || /^on[A-Z]/.test(key)) continue;
    const after = open[1].slice(m.index + m[0].length).trimStart();
    // `prop={someVar}`: not a literal, skip (its `{…}` would read as a bare prop)
    if (dq === undefined && sq === undefined && expr === undefined && after.startsWith('=')) continue;
    if (dq !== undefined) props[key] = dq;
    else if (sq !== undefined) props[key] = sq;
    else if (expr === undefined) props[key] = true;
    else if (expr === 'true' || expr === 'false') props[key] = expr === 'true';
    else if (/^["']/.test(expr)) props[key] = expr.slice(1, -1);
    else props[key] = Number(expr);
  }
  let text: string | undefined;
  if (!open[2]) {
    const rest = code.slice(open.index + open[0].length);
    const close = rest.indexOf(`</${name}>`);
    const inner = close >= 0 ? rest.slice(0, close).replace(/\s+/g, ' ').trim() : '';
    if (inner && !/[<{]/.test(inner)) text = inner;
  }
  return { props, ...(text ? { text } : {}) };
}

/** On Vite, the URL a dependency was loaded from (`/node_modules/.vite/deps/@mui_material.js?v=…`) */
export function viteDepUrl(module: string, loaded: string[]): string | undefined {
  // Vite's flattenId
  const flat = module.replace(/[/:]/g, '_').replace(/\./g, '__');
  return loaded.find(u => u.includes(`/node_modules/.vite/deps/${flat}.js`));
}

function isVite(): boolean {
  return !!document.querySelector('script[src="/@vite/client"]');
}

/** The component to draw: one seen on a page this session, else (Vite) its module */
async function typeOf(item: CatalogItem): Promise<unknown> {
  const seen = seenTypes.get(item.name);
  if (seen) return seen;
  if (!isVite()) return undefined;
  const loaded = performance.getEntriesByType('resource').map(e => e.name);
  const url = item.library ? viteDepUrl(item.module ?? item.source, loaded) : `/${item.source.replace(/^\/+/, '')}`;
  if (!url) return undefined;
  try {
    const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ url) as Record<string, unknown>;
    const type = item.importAs === 'default' ? mod.default : mod[item.name];
    if (type) seenTypes.set(item.name, type);
    return type;
  } catch { return undefined; }
}

/** An element of the app with no children: the stage's portal hangs there for a moment */
function anchor(): F | null {
  const els = document.body.getElementsByTagName('*');
  for (let i = 0; i < els.length && i < 4000; i++) {
    const el = els[i];
    if (el.childNodes.length || VOID.test(el.tagName) || el.closest('[data-ilse-toolbar],[data-ilse-stage],[data-ilse-draft],[data-ilse-variant-for]')) continue;
    const f = fiberOf(el);
    const live = f && currentOf(f);
    if (live?.tag === 5 && live.memoizedProps && live.memoizedProps.children == null) return live;
  }
  return null;
}

/** Catches what a component throws standing alone; React needs only this much of a class */
function makeBoundary(): unknown {
  function Boundary(this: { props: unknown; state: { failed: boolean } }, props: unknown) { this.props = props; this.state = { failed: false }; }
  Boundary.prototype.isReactComponent = {};
  Boundary.prototype.render = function (this: { props: { children: unknown }; state: { failed: boolean } }) { return this.state.failed ? null : this.props.children; };
  (Boundary as unknown as { getDerivedStateFromError: () => unknown }).getDerivedStateFromError = () => ({ failed: true });
  return Boundary;
}
let boundary: unknown = null;

function element(r: Renderer, type: unknown, props: Record<string, unknown>, key: string | null = null): Record<string, unknown> {
  const v19 = /^(19|[2-9]\d)\./.test(r.version ?? '');
  return v19
    ? { $$typeof: Symbol.for('react.transitional.element'), type, key, props, _owner: null, _store: { validated: 1 } }
    : { $$typeof: Symbol.for('react.element'), type, key, ref: null, props, _owner: null, _store: { validated: true } };
}

const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

export interface StageRequest { item: CatalogItem; props: Props; text?: string }

/** Can this page draw components on the stage (dev React with a hook that came first)? */
export function canStage(): boolean {
  return !!renderer();
}

/**
 * Draws each request in turn and copies it. A request whose component can't
 * be found or drawn is left out. One at a time, so the app's tree changes for
 * a moment at most once.
 */
export async function stage(requests: StageRequest[]): Promise<Array<{ id: string } & CatalogSnapshot>> {
  const r = renderer();
  if (!r?.overrideProps) return [];
  boundary ??= makeBoundary();
  const out: Array<{ id: string } & CatalogSnapshot> = [];
  for (const req of requests) {
    const type = await typeOf(req.item);
    const at = anchor();
    if (!type || !at) continue;
    const box = document.createElement('div');
    box.setAttribute('data-ilse-stage', '');
    // A definite size for what fills its parent (a chart's responsive container); the column
    // keeps everything else at its own width, as a button would sit on a page
    box.style.cssText = 'position:fixed;left:-10000px;top:0;width:400px;height:260px;display:flex;flex-direction:column;align-items:flex-start;pointer-events:none;contain:layout;';
    document.body.appendChild(box);
    const props: Record<string, unknown> = { ...req.props, ...(req.text ? { children: req.text } : {}) };
    const portal = {
      $$typeof: Symbol.for('react.portal'), key: 'ilse-stage', containerInfo: box, implementation: null,
      children: element(r, boundary, { children: element(r, type, props) }),
    };
    // A component that can't stand alone logs as it fails: not the app breaking
    const unhush = hushPageErrors();
    try {
      r.overrideProps(at, ['children'], portal);
      await wait(SETTLE_MS);
      const root = box.firstElementChild as HTMLElement | null;
      const snap = root ? snapshotOf(root) : null;
      if (snap) {
        out.push({ id: req.item.id, ...snap, variant: variantKey(req.item, req.props), props: req.props, ...(req.text ? { text: req.text } : {}) });
      }
    } catch { /* not drawn: no copy */ } finally {
      try {
        const now = currentOf(at);
        if (now) {
          if (r.overridePropsDeletePath) r.overridePropsDeletePath(now, ['children']);
          else r.overrideProps(now, ['children'], undefined);
        }
      } catch { /* the element went away meanwhile */ }
      await wait(0);
      box.remove();
      unhush();
    }
  }
  return out;
}

/** What to draw for an item with no copy: the props its usage example spells out */
export function exampleRequest(item: CatalogItem): StageRequest {
  const ex = item.example ? parseExample(item.example.code, item.name) : { props: {} as Props };
  return { item, props: ex.props, ...(ex.text ? { text: ex.text } : {}) };
}
