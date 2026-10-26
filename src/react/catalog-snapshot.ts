/**
 * Catalog components on this page, and copies of them for the panel.
 *
 * React's fibers (dev builds) say which component rendered each element: the
 * first element a component fiber owns, in document order, is its root on the
 * page. A copy is that root cloned with the computed styles written inline, so
 * it looks the same in the panel — and on any other page — without the app's
 * CSS, theme or providers.
 */

import { componentTypeName, firstAppFrame } from './annotator.js';

/** What the panel needs to know about a catalog entry */
export interface CatalogItem {
  id: string;
  name: string;
  source: string;
  folder: string;
  library: boolean;
  uses: number;
  props: Array<{ name: string; required: boolean; values: string[]; kind: 'enum' | 'boolean' | 'text' | 'other'; default?: string }>;
  renders?: string;
  example?: { file: string; line: number; code: string };
  importAs?: 'named' | 'default';
  /** The module a library import uses (`@mui/material`) */
  module?: string;
  layer?: 'base' | 'product';
  kind?: string;
  feature?: string;
  featureLabel?: string;
  ds?: string;
  dsGroup?: string;
}

export interface CatalogSnapshot {
  variant: string; html: string; w: number; h: number;
  /** The instance's literal props and text — a dropped copy is written with them, so code matches the screen */
  props?: Record<string, string | number | boolean>;
  text?: string;
}

type F = { type?: unknown; return?: F | null; child?: F | null; alternate?: F | null; stateNode?: unknown; memoizedProps?: Record<string, unknown>; _debugStack?: { stack?: string }; _debugOwner?: F | null };

function fiberOf(el: Element): F | null {
  const k = Object.keys(el).find(key => key.startsWith('__reactFiber$'));
  return k ? (el as unknown as Record<string, F>)[k] : null;
}

/**
 * A component's name as the source has it. Bundlers rename functions that clash
 * in one prebundled file (Vite's deps: `Button2`, `Box3`), so a trailing number
 * is also tried without it.
 */
export function sourceNames(name: string): string[] {
  const bare = name.replace(/\d+$/, '');
  return bare !== name && bare.length > 1 ? [name, bare] : [name];
}

export interface Instance { name: string; root: HTMLElement; props: Record<string, unknown>; fiber?: unknown }

/** Instances of the named components on the page, each with its root element and props */
export function findInstances(names: Set<string>, limitPerName = 12): Instance[] {
  const out: Instance[] = [];
  const seen = new Set<F>();
  const count = new Map<string, number>();
  const all = document.body.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (!(el instanceof HTMLElement) || el.closest('[data-ilse-toolbar]')) continue;
    const f = fiberOf(el);
    // Up from this element to the next element above it: the components in between own it
    for (let x = f?.return ?? null, d = 0; x && typeof x.type !== 'string' && d < 40; x = x.return ?? null, d++) {
      if (seen.has(x) || (x.alternate && seen.has(x.alternate))) break;
      seen.add(x);
      const typeName = componentTypeName(x.type);
      const name = typeName ? sourceNames(typeName).find(n => names.has(n)) : undefined;
      if (!name) continue;
      const n = count.get(name) ?? 0;
      if (n >= limitPerName) continue;
      count.set(name, n + 1);
      out.push({ name, root: el, props: x.memoizedProps ?? {}, fiber: x });
    }
  }
  return out;
}

/** A selected element that is a catalog component's root: which one, its props, where its JSX is */
export interface ComponentHit {
  item: CatalogItem;
  /** Its props as set where it's written (primitive values only) */
  props: Record<string, string | number | boolean>;
  /** Its text, to tell lookalikes apart in the file */
  text?: string;
  /** Dev stack URL of the file that wrote `<Item …>` */
  frameUrl?: string;
}

/**
 * The catalog component this element is the root of — the outermost one, the
 * `<Button>` the app wrote rather than the `ButtonBase` inside the library.
 */
export function componentAt(el: Element, items: CatalogItem[]): ComponentHit | null {
  const byName = new Map(items.map(i => [i.name, i]));
  let hit: ComponentHit | null = null;
  for (let x = fiberOf(el)?.return ?? null, d = 0; x && typeof x.type !== 'string' && d < 40; x = x.return ?? null, d++) {
    const typeName = componentTypeName(x.type);
    const name = typeName ? sourceNames(typeName).find(n => byName.has(n)) : undefined;
    if (!name) continue;
    const props: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(x.memoizedProps ?? {})) {
      if (k !== 'children' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) props[k] = v;
    }
    const children = x.memoizedProps?.children;
    hit = {
      item: byName.get(name)!,
      props,
      ...(typeof children === 'string' ? { text: children } : {}),
      ...(firstAppFrame(x._debugStack?.stack) ? { frameUrl: firstAppFrame(x._debugStack?.stack)!.url } : {}),
    };
  }
  return hit;
}

/** The component instance this element is the root of, for "next to it" in the code — or null */
export interface InstanceRef {
  component: string;
  source?: string;
  frameUrl?: string;
  props: Record<string, string | number | boolean>;
  text?: string;
}

const SCREEN = /^(App|Root|Page|.*Layout|.*Provider|.*Page)$/;

export function instanceAt(el: Element, items: CatalogItem[]): InstanceRef | null {
  let out: InstanceRef | null = null;
  for (let x = fiberOf(el)?.return ?? null, d = 0; x && typeof x.type !== 'string' && d < 40; x = x.return ?? null, d++) {
    const typeName = componentTypeName(x.type);
    if (!typeName) continue;
    const name = sourceNames(typeName).find(n => items.some(i => i.name === n)) ?? typeName;
    const frame = firstAppFrame(x._debugStack?.stack);
    if (!frame) continue; // written inside a library, not by the app
    if (SCREEN.test(name)) break; // the screen itself: next to its root is the element's own place
    const props: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(x.memoizedProps ?? {})) {
      if (k !== 'children' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) props[k] = v;
    }
    const children = x.memoizedProps?.children;
    const item = items.find(i => i.name === name);
    out = {
      component: name, frameUrl: frame.url, props,
      ...(item ? { source: item.source } : {}),
      ...(typeof children === 'string' ? { text: children } : {}),
    };
  }
  return out;
}

/**
 * The first element a component instance renders, depth first. Not just down
 * the first children: a styled component's first child can render nothing
 * (Emotion's <Insertion/>), and the element is its sibling.
 */
function hostOf(f: F): HTMLElement | null {
  type G = F & { sibling?: G | null; child?: G | null };
  const stack: G[] = [];
  if ((f as G).child) stack.push((f as G).child!);
  for (let steps = 0; stack.length && steps < 400; steps++) {
    const x = stack.pop()!;
    if (typeof x.type === 'string' && x.stateNode instanceof HTMLElement) return x.stateNode;
    if (x.sibling) stack.push(x.sibling);
    if (x.child) stack.push(x.child);
  }
  return null;
}

/** Every element a component renders at its top level, portals included (a dialog's backdrop and its panel) */
function hostsOf(f: F, limit = 12): HTMLElement[] {
  type G = F & { sibling?: G | null; child?: G | null };
  const out: HTMLElement[] = [];
  const stack: G[] = [];
  if ((f as G).child) stack.push((f as G).child!);
  for (let steps = 0; stack.length && steps < 800 && out.length < limit; steps++) {
    const x = stack.pop()!;
    if (x.sibling) stack.push(x.sibling);
    if (typeof x.type === 'string' && x.stateNode instanceof HTMLElement) out.push(x.stateNode);
    else if (x.child) stack.push(x.child);
  }
  return out;
}

/** A layer over the whole window: a dialog's backdrop, or the fixed frame it's centered in */
function coversWindow(el: HTMLElement): boolean {
  const pos = getComputedStyle(el).position;
  if (pos !== 'fixed' && pos !== 'absolute') return false;
  const r = el.getBoundingClientRect();
  return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
}

function looksLikePanel(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  if (r.width < 40 || r.height < 24 || cs.visibility === 'hidden') return false;
  return !isClear(cs.backgroundColor) || cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0;
}

/**
 * What to copy of an instance. Usually its root; but a dialog's first element
 * is the dimmed layer over the whole window (or the frame that centers it),
 * or an empty wrapper, and the dialog itself is the panel inside or beside it.
 */
export function surfaceOf(root: HTMLElement, fiber?: unknown): HTMLElement {
  // Nothing to see at the root either: a zero-height wrapper before the dialog's portal (sac's KeyDialog)
  const r = root.getBoundingClientRect();
  if (!coversWindow(root) && r.width >= 2 && r.height >= 2) return root;
  const queue: HTMLElement[] = fiber ? hostsOf(fiber as F) : [root];
  if (!queue.includes(root)) queue.unshift(root);
  for (let i = 0; i < queue.length && i < 600; i++) {
    const el = queue[i];
    if (!coversWindow(el) && looksLikePanel(el)) return el;
    for (const c of Array.from(el.children)) if (c instanceof HTMLElement) queue.push(c);
  }
  return root;
}

/**
 * A drop next to something inside one of the project's own components (a
 * label inside StatCard) would change that component's definition — every
 * StatCard. "Here" means next to this StatCard, where the page wrote it: the
 * anchor climbs to the instance, as many levels as it takes — but only out of
 * components that are reused (a library's, Base, or written in 2+ places).
 * A section written once (AuditActivity, used by one page) is where this part
 * of the page lives: a drop inside it changes that file, and climbing past it
 * sent every drop to the top of the whole screen.
 */
export function liftAnchor(el: HTMLElement, items: CatalogItem[]): { anchor: HTMLElement; lifted: boolean } {
  const byName = new Map(items.map(i => [i.name, i]));
  let anchor = el;
  let lifted = false;
  // Up the owners: the component whose code wrote this element, then whose code wrote that one…
  for (let o = fiberOf(el)?._debugOwner ?? null, d = 0; o && d < 30; o = o._debugOwner ?? null, d++) {
    const name = componentTypeName(o.type);
    if (!name) continue;
    if (SCREEN.test(name)) break;
    const item = sourceNames(name).map(n => byName.get(n)).find(Boolean);
    if (!item) continue; // not in the catalog (a local helper, a provider): look further up
    if (!isReused(item)) break; // written once: the drop belongs in its file
    const root = hostOf(o);
    if (!root || !root.contains(anchor)) break;
    anchor = root;
    lifted = true;
  }
  return { anchor, lifted };
}

/** A component whose definition is shared: changing its inside changes it everywhere */
export function isReused(item: Pick<CatalogItem, 'library' | 'layer' | 'uses'>): boolean {
  return item.library || item.layer === 'base' || item.uses > 1;
}

/** The names of all components rendered on the page */
export function namesOnPage(): Set<string> {
  const names = new Set<string>();
  const seen = new Set<F>();
  const all = document.body.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.closest('[data-ilse-toolbar]')) continue;
    for (let x = fiberOf(el)?.return ?? null, d = 0; x && typeof x.type !== 'string' && d < 40; x = x.return ?? null, d++) {
      if (seen.has(x)) break;
      seen.add(x);
      const name = componentTypeName(x.type);
      if (name) for (const n of sourceNames(name)) names.add(n);
    }
  }
  return names;
}

/** `variant=outlined size=small` — the entry's choosable props as this instance sets them */
export function variantKey(item: Pick<CatalogItem, 'props'>, props: Record<string, unknown>): string {
  return item.props
    .filter(p => p.kind === 'enum' || p.kind === 'boolean')
    .flatMap(p => {
      const v = props[p.name];
      // Set to what it is anyway (`providerFixed={false}`): the same look as not set
      if ((typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && String(v) === p.default) return [];
      return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? [`${p.name}=${String(v)}`] : [];
    })
    .join(' ');
}

/** Two variant keys that draw the same thing: a prop at its default counts as not set (copies kept before keys dropped defaults) */
export function sameVariant(item: Pick<CatalogItem, 'props'>, a: string, b: string): boolean {
  const norm = (key: string) => {
    const kept = key.split(' ').filter(Boolean).filter(pair => {
      const i = pair.indexOf('=');
      const p = item.props.find(x => x.name === pair.slice(0, i));
      return !p || pair.slice(i + 1) !== p.default;
    });
    return kept.sort().join(' ');
  };
  return norm(a) === norm(b);
}

const STYLE_PROPS = [
  'display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'top', 'right', 'bottom', 'left', 'z-index', 'transform',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'align-content',
  'gap', 'row-gap', 'column-gap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'text-overflow', 'vertical-align',
  'color', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'box-shadow', 'opacity', 'overflow-x', 'overflow-y', 'object-fit', 'list-style-type',
  'fill', 'stroke', 'stroke-width', 'visibility',
];

const MAX_NODES = 1500;

const isClear = (bg: string) => bg === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(bg);
const MAX_HTML = 250_000;

/** Passed down from parent to child: a child that says the same as its parent needn't say it */
const INHERITED = new Set([
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'white-space', 'color', 'visibility', 'list-style-type', 'fill', 'stroke', 'stroke-width',
]);
/** Always written: the copy keeps every piece's measured size */
const KEEP = new Set(['width', 'height']);

/**
 * The browser's own look for a tag, with no page CSS on it: a piece that looks
 * exactly like that needn't write it. Measured in a shadow root the page's
 * stylesheets can't reach.
 */
const defaults = new Map<string, Map<string, string>>();
let sandbox: ShadowRoot | null = null;
function defaultsFor(el: Element): Map<string, string> {
  const svg = el instanceof SVGElement;
  const key = (svg ? 'svg:' : '') + el.tagName;
  const known = defaults.get(key);
  if (known) return known;
  const out = new Map<string, string>();
  try {
    if (!sandbox) {
      const host = document.createElement('div');
      host.setAttribute('data-ilse-toolbar', '');
      host.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none';
      document.documentElement.appendChild(host);
      sandbox = host.attachShadow({ mode: 'open' });
    }
    const probe = svg ? document.createElementNS('http://www.w3.org/2000/svg', el.tagName) : document.createElement(el.tagName);
    const holder = svg && el.tagName.toLowerCase() !== 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : null;
    if (holder) holder.appendChild(probe);
    sandbox.appendChild(holder ?? probe);
    const cs = getComputedStyle(probe);
    for (const p of STYLE_PROPS) if (!INHERITED.has(p) && !KEEP.has(p)) out.set(p, cs.getPropertyValue(p));
    (holder ?? probe).remove();
  } catch { /* no sandbox: everything gets written */ }
  defaults.set(key, out);
  return out;
}

/**
 * The element cloned with its computed styles inline, ids, classes and handlers
 * gone. Null when it's too big to be a piece (a whole page section) or invisible.
 * Only what differs is written: the root says everything, each piece below it
 * what it doesn't inherit and the browser wouldn't give it anyway.
 */
export function snapshotOf(root: HTMLElement): CatalogSnapshot | null {
  const box = root.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return null;
  // The whole window is a screen, not a piece to place
  if (box.width >= window.innerWidth * 0.9 && box.height >= window.innerHeight * 0.8) return null;
  const originals = [root, ...Array.from(root.querySelectorAll('*'))];
  if (originals.length > MAX_NODES) return null;
  const clone = root.cloneNode(true) as HTMLElement;
  const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];
  if (copies.length !== originals.length) return null;
  const computed = new Map<Element, CSSStyleDeclaration>();
  for (let i = 0; i < copies.length; i++) {
    const src = originals[i], dst = copies[i];
    if (/^(SCRIPT|IFRAME|STYLE|LINK|VIDEO|AUDIO|CANVAS|OBJECT|EMBED)$/.test(dst.tagName)) { dst.remove(); continue; }
    const cs = getComputedStyle(src);
    computed.set(src, cs);
    const parent = i === 0 ? null : (src.parentElement && computed.get(src.parentElement)) ?? null;
    const plain = i === 0 ? null : defaultsFor(src);
    const style = STYLE_PROPS.flatMap(p => {
      const v = cs.getPropertyValue(p);
      if (parent && INHERITED.has(p) && parent.getPropertyValue(p) === v) return [];
      if (plain && plain.get(p) === v) return [];
      return [`${p}:${v}`];
    }).join(';');
    for (const a of Array.from(dst.attributes)) {
      if (/^(id|class|style|on.*|data-.*|aria-.*|tabindex|href|action|formaction|srcset|autofocus)$/i.test(a.name)) dst.removeAttribute(a.name);
    }
    if (src instanceof HTMLInputElement && dst instanceof HTMLInputElement) dst.setAttribute('value', src.value);
    if (src instanceof HTMLImageElement && dst instanceof HTMLImageElement) dst.setAttribute('src', src.currentSrc || src.src);
    dst.setAttribute('style', style);
  }
  // The copy sits at the origin of its own box, whatever placed it on the page
  clone.style.position = 'relative';
  clone.style.top = clone.style.left = clone.style.right = clone.style.bottom = 'auto';
  clone.style.margin = '0';
  clone.style.transform = 'none';
  // White text on a see-through button only reads on what's behind it: take the nearest backdrop
  if (isClear(getComputedStyle(root).backgroundColor) && !getComputedStyle(root).backgroundImage.startsWith('url')) {
    for (let up = root.parentElement; up; up = up.parentElement) {
      const bg = getComputedStyle(up).backgroundColor;
      // Only the thumbnail uses it: a dropped copy sits on its new backdrop
      if (!isClear(bg)) { clone.setAttribute('data-ilse-backdrop', bg); break; }
    }
  }
  clone.style.width = `${box.width}px`;
  clone.style.height = `${box.height}px`;
  const html = clone.outerHTML;
  if (html.length > MAX_HTML) return null;
  return { variant: '', html, w: box.width, h: box.height };
}

/**
 * Copies of the catalog components on this page: one per variant seen, keyed
 * by catalog id. `skip` holds the `id|variant` already copied this session;
 * `avoid` turns down a root that shows an edit not in the code yet.
 */
export function snapshotPage(items: CatalogItem[], skip?: Set<string>, avoid?: (root: HTMLElement) => boolean): Array<{ id: string } & CatalogSnapshot> {
  const byName = new Map<string, CatalogItem>();
  for (const it of items) if (!byName.has(it.name)) byName.set(it.name, it);
  const out: Array<{ id: string } & CatalogSnapshot> = [];
  const taken = new Set<string>();
  for (const inst of findInstances(new Set(byName.keys()))) {
    const item = byName.get(inst.name)!;
    const variant = variantKey(item, inst.props);
    const k = `${item.id}|${variant}`;
    if (taken.has(k) || skip?.has(k)) continue;
    const root = surfaceOf(inst.root, inst.fiber);
    // Being edited in the panel, or standing in for a preview: not how the code draws it
    if (root.closest('[data-ilse-draft],[data-ilse-variant-for]') || root.querySelector('[data-ilse-variant-for]') || avoid?.(root)) continue;
    const snap = snapshotOf(root);
    if (!snap) continue;
    taken.add(k);
    const props: Record<string, string | number | boolean> = {};
    for (const [p, v] of Object.entries(inst.props)) {
      if (!/^(children|key|ref|style|sx|className|class|id)$/.test(p) && !/^on[A-Z]/.test(p) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) props[p] = v;
    }
    const text = typeof inst.props.children === 'string' ? inst.props.children : undefined;
    out.push({ id: item.id, ...snap, variant, props, ...(text ? { text } : {}) });
  }
  return out;
}
