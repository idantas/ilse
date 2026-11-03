/**
 * The Consistency tab (Pro): each piece on this screen against the project's standard — the
 * DS components as they draw themselves, and the tokens. No AI here, only what is certain:
 *
 * - override: a DS component whose caller's className changes its look
 * - copy: a hand-written piece that looks exactly like a DS variant
 * - off-token: a colour the CSS doesn't declare
 *
 * What needs judgement (a pill where the Badge is rounded-lg, a Select that should be the
 * Button) is the user's agent's, fed by `reviewPieces` — see the toolbar's consistency_review.
 */

import { readLook, type Look } from './look-alike.js';
import { writtenIn, sourceNames, type CatalogItem } from './catalog-snapshot.js';
import { deltaE, readColor, type RGBA } from './color.js';

type F = { type?: unknown; return?: F | null; memoizedProps?: Record<string, unknown>; _debugInfo?: Array<{ name?: string; props?: Record<string, unknown> }> | null };
const fiberOf = (el: Element): F | null => {
  const k = Object.keys(el).find(x => x.startsWith('__reactFiber$'));
  return k ? (el as unknown as Record<string, F>)[k] : null;
};
const typeName = (t: unknown): string | undefined => {
  const x = t as { displayName?: string; name?: string; render?: { displayName?: string; name?: string }; type?: { displayName?: string; name?: string } } | null;
  return x?.displayName || x?.name || x?.render?.displayName || x?.render?.name || x?.type?.displayName || x?.type?.name;
};

/** Standard components this element is the root of, with their props; the outermost of a name wins (a Button wrapping Base UI's Button) */
function chain(el: Element, byName: Map<string, CatalogItem>) {
  const out: Array<{ name: string; props: Record<string, unknown> }> = [];
  const f = fiberOf(el);
  for (const i of f?._debugInfo ?? []) if (i?.name && byName.has(i.name)) out.push({ name: i.name, props: i.props ?? {} });
  for (let x = f?.return ?? null, d = 0; x && typeof x.type !== 'string' && d < 40; x = x.return ?? null, d++) {
    const n = typeName(x.type);
    const name = n ? sourceNames(n).find(s => byName.has(s)) : undefined;
    if (!name) continue;
    const at = out.findIndex(o => o.name === name);
    const entry = { name, props: x.memoizedProps ?? {} };
    if (at >= 0) out[at] = entry; else out.push(entry);
  }
  return out;
}

const painted = (c: RGBA | null) => !!c && c.a > 0.02;
const boxed = (l: Look) => painted(l.fill) || l.border.width > 0 || l.shadow;

/** The look, with the fill read from a surface layer when the element paints none itself (a Button's inset span) */
export function lookOf(el: HTMLElement): Look {
  const look = readLook(el);
  if (boxed(look)) return look;
  const r = el.getBoundingClientRect();
  for (const c of Array.from(el.children) as HTMLElement[]) {
    const s = getComputedStyle(c);
    if (s.position !== 'absolute') continue;
    const cr = c.getBoundingClientRect();
    if (cr.width * cr.height < r.width * r.height * 0.85) continue;
    const fill = readColor(s.backgroundColor);
    const shadow = s.boxShadow !== 'none';
    if (painted(fill) || shadow) return { ...look, fill, shadow, radius: look.radius || parseFloat(s.borderTopLeftRadius) || 0 };
  }
  return look;
}

const callerClasses = (props: Record<string, unknown>) => Object.entries(props)
  .filter(([k, v]) => /classname$/i.test(k) && typeof v === 'string')
  .flatMap(([, v]) => (v as string).split(/\s+/).filter(Boolean));

/** The component's own look: a hidden copy without the classes its caller passed in (className, surfaceClassName…) */
function pristine(el: HTMLElement, props: Record<string, unknown>): { look: Look; own: number } {
  const caller = new Set(callerClasses(props));
  const own = Array.from(el.classList).filter(c => !caller.has(c)).length;
  if (!caller.size || !el.parentElement) return { look: lookOf(el), own };
  const clone = el.cloneNode(true) as HTMLElement;
  for (const x of [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('[class]'))]) {
    x.setAttribute('class', Array.from(x.classList).filter(c => !caller.has(c)).join(' '));
  }
  clone.style.cssText += ';position:absolute;visibility:hidden;pointer-events:none;left:0;top:0';
  el.parentElement.appendChild(clone);
  const look = lookOf(clone);
  clone.remove();
  return { look, own };
}

const SHAPE = ['radius', 'padX', 'padY', 'height', 'fontSize', 'fontWeight'] as const;
export type LookProp = typeof SHAPE[number] | 'fill' | 'text' | 'border';
const pill = (l: Look) => l.radius >= l.height / 2;
function close(p: typeof SHAPE[number], a: Look, b: Look): boolean {
  if (p === 'radius') return (pill(a) && pill(b)) || Math.abs(a.radius - b.radius) <= 1;
  if (p === 'fontWeight') return Math.abs(a.fontWeight - b.fontWeight) < 100;
  if (p === 'height') return Math.abs(a.height - b.height) <= 2;
  return Math.abs(a[p] - b[p]) <= 1;
}
const sameColor = (a: RGBA | null, b: RGBA | null) => !painted(a) || !painted(b) ? !painted(a) && !painted(b) : deltaE(a!, b!) < 4;

/** Which properties two looks differ in; the height only when padding doesn't set it (the words do) */
export function lookDiff(a: Look, b: Look): LookProp[] {
  const d: LookProp[] = SHAPE.filter(p => !(p === 'height' && a.padY > 0 && b.padY > 0) && !close(p, a, b));
  if (!sameColor(a.fill, b.fill)) d.push('fill');
  if (!sameColor(a.text, b.text)) d.push('text');
  if (!sameColor(a.border.width > 0 ? a.border.color : null, b.border.width > 0 ? b.border.color : null)) d.push('border');
  return d;
}

const kindOf = (el: Element) => /^(A|BUTTON)$/.test(el.tagName) || el.getAttribute('role') === 'button' ? 'button'
  : /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? 'field' : 'chip';

function isPiece(el: Element, l: Look): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0 || r.height > 120 || r.width > 480 || r.right <= 0) return false;
  if (!boxed(l)) return false;
  if (l.padX === 0 && l.padY === 0 && !(el.textContent?.trim() && r.height <= 32 && r.width <= 64)) return false;
  // A box around other controls is a layout, not a piece
  if (/^(SPAN|DIV|LABEL)$/.test(el.tagName) && (!el.textContent?.trim() || el.querySelector('a, button, [role="button"], input, select, textarea'))) return false;
  return true;
}

/** Ilse's own UI is never a piece of the page: its marked parts, and everything under its root
 *  (a hover label or a tooltip the toolbar draws without a mark) */
const ILSE_UI = '[data-ilse-toolbar], [data-ilse-stage], [data-ilse-draft], [data-ilse-variant-for], #ilse-standalone-root';

/** Charts paint boxes with data colours: not pieces of the UI */
const DATAVIZ = /chart|treemap|heatmap|graf|barras|meter|gauge|sparkline/i;

/** Every colour the CSS declares as a custom property, resolved by the browser */
function colorTokens(): Array<{ name: string; c: RGBA }> {
  const names = new Set<string>();
  const walk = (rules: CSSRuleList) => {
    for (const r of Array.from(rules)) {
      if ((r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules);
      const st = (r as CSSStyleRule).style;
      if (st) for (let i = 0; i < st.length; i++) if (st[i].startsWith('--')) names.add(st[i]);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) { try { walk(sheet.cssRules); } catch { /* another origin */ } }
  // A variable that isn't a colour (a font, a size) is invalid as one and inherits: from the sentinel, so it's dropped
  const host = document.createElement('i');
  host.setAttribute('data-ilse-toolbar', '');
  host.style.color = 'rgb(1, 2, 3)';
  const probe = document.createElement('i');
  host.appendChild(probe);
  document.body.appendChild(host);
  const out: Array<{ name: string; c: RGBA }> = [];
  for (const n of names) {
    probe.style.color = 'rgb(1, 2, 3)';
    probe.style.color = `var(${n})`;
    const c = readColor(getComputedStyle(probe).color);
    if (c && painted(c) && !(c.r === 1 && c.g === 2 && c.b === 3)) out.push({ name: n, c: { ...c, a: 1 } });
  }
  host.remove();
  return out;
}

/** One DS variant as the component draws it — the standard pieces are compared with */
export interface StandardRef { key: string; name: string; kind: string; look: Look }

/** Variants seen on other screens this session count too: the Badge on /users is the standard on /audit */
const knownRefs = new Map<string, StandardRef>();

export type FindingType = 'override' | 'copy' | 'off-token' | 'off-font' | 'off-size';

export interface ConsistencyFinding {
  /** Stable across reads of the same screen */
  id: string;
  type: FindingType;
  /** Where it is on the page: the first one is selected */
  els: HTMLElement[];
  text: string;
  /** The component whose code writes it */
  owner?: string;
  /** The DS variant involved: "Button variant=primary" */
  standard?: string;
  /** override: the properties the className changed; off-token: the colours */
  props: string[];
  /** override: each piece's classes from its caller, the ones that change the look — without them
   *  it is the standard again (the page previews that before the agent writes it) */
  drop?: Array<[HTMLElement, string[]]>;
  /** Every place it is, as the note names them: "\"R$ 429\" in <Landing>" */
  pieces: string[];
  /** off-token: each colour and the token Fix puts in its place */
  swaps?: Swap[];
}

/** One off-token colour and the token to use: the nearest one that keeps the text readable (WCAG AA) */
export interface Swap {
  role: 'fill' | 'text' | 'border' | 'font' | 'size';
  from: string;
  token: string;
  value: string;
  /** Text against what is behind it (text), or the text on it (fill), with the token in place */
  contrast?: number;
  /** contrast passes AA (4.5:1, 3:1 for large text); undefined when there's nothing to read against */
  ok?: boolean;
  /** No near token reads: this one is farther, the look changes more */
  far?: boolean;
}

const luminance = (c: RGBA) => {
  const ch = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
};
export const contrastRatio = (a: RGBA, b: RGBA) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/**
 * The token for an off-token colour: among the near ones (by ΔE), the nearest that still reads
 * against `against` (AA); none does → the nearest, flagged. Pure, for the tests.
 */
export function pickSwap(role: Swap['role'], from: RGBA, tokens: Array<{ name: string; c: RGBA }>, against?: RGBA, large = false): Swap | null {
  const ranked = tokens.map(x => ({ ...x, d: deltaE(x.c, { ...from, a: 1 }) })).sort((a, b) => a.d - b.d);
  if (!ranked.length) return null;
  const need = large ? 3 : 4.5;
  const check = role !== 'border' && against ? (c: RGBA) => contrastRatio(c, against) : null;
  const near = ranked.filter(x => x.d < 25);
  // Readable first: the nearest that passes, then a farther one that does (it changes the look more), else the nearest
  const passing = check ? near.find(x => check(x.c) >= need) ?? ranked.find(x => check(x.c) >= need) : undefined;
  const pick = passing ?? ranked[0];
  const contrast = check ? Math.round(check(pick.c) * 10) / 10 : undefined;
  return { role, from: hex(from), token: pick.name, value: hex(pick.c), ...(contrast !== undefined ? { contrast, ok: contrast >= need } : {}), ...(pick.d >= 25 ? { far: true } : {}) };
}

/** The colour behind an element: its own or its nearest ancestor's opaque-enough background (the page's white if none) */
function behind(el: Element | null): RGBA {
  for (let x = el; x; x = x.parentElement) {
    const c = readColor(getComputedStyle(x).backgroundColor);
    if (c && c.a > 0.5) return c;
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

export interface ReviewPiece {
  id: number;
  kind: string;
  text: string;
  owner?: string;
  /** The DS component it is, with its variant */
  component?: string;
  look: string;
}

export interface ConsistencyRead {
  findings: ConsistencyFinding[];
  /** For the user's agent: every piece, numbered (`els[id]` is the element) */
  pieces: ReviewPiece[];
  els: HTMLElement[];
  /** What was checked, for the empty state */
  checked: { pieces: number; standards: number; colors: number };
}

const hex = (c: RGBA) => '#' + [c.r, c.g, c.b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
const label = (el: HTMLElement) => (el.textContent || (el as HTMLInputElement).placeholder || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
const lookText = (l: Look) => [
  pill(l) ? 'radius pill' : `radius ${Math.round(l.radius)}`,
  `pad ${Math.round(l.padY)}/${Math.round(l.padX)}`, `h ${Math.round(l.height)}`,
  `font ${Math.round(l.fontSize)}/${Math.round(l.fontWeight)}`,
  painted(l.fill) ? `fill ${hex(l.fill!)}` : '', painted(l.text) ? `text ${hex(l.text!)}` : '',
  l.border.width > 0 && painted(l.border.color) ? `border ${l.border.width}px ${hex(l.border.color!)}` : '',
  l.shadow ? 'shadow' : '',
].filter(Boolean).join(', ');

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|emoji|math|fangsong|-apple-system|blinkmacsystemfont)$/;

/** The families of a font stack, as names: `"Geist", "Geist Fallback", sans-serif` → ['geist'] (fallbacks and generics aren't choices) */
export function families(stack: string): string[] {
  return stack.split(',').map(x => x.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(x => x && !GENERIC.test(x) && !/ fallback$/.test(x));
}

/** The type scale step nearest a size: the named token when there is one */
export function nearestStep(px: number, steps: Array<{ name?: string; px: number }>): { name?: string; px: number } | null {
  return steps.reduce<{ name?: string; px: number } | null>((best, x) => !best || Math.abs(x.px - px) < Math.abs(best.px - px) || (Math.abs(x.px - px) === Math.abs(best.px - px) && x.name && !best.name) ? x : best, null);
}

/** The DS's fonts (--font-*) and type scale (--text-*), as the browser resolves them */
function typeTokens(): { fonts: Array<{ name: string; families: string[] }>; sizes: Array<{ name: string; px: number }> } {
  const names = new Set<string>();
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const toPx = (v: string) => v.endsWith('rem') ? parseFloat(v) * rem : v.endsWith('px') ? parseFloat(v) : NaN;
  const fonts: Array<{ name: string; families: string[] }> = [];
  const sizes: Array<{ name: string; px: number }> = [];
  // Tailwind's `@theme inline` writes no variable: the value is in the utility (.font-serif, .text-sm)
  const walk = (rules: CSSRuleList) => {
    for (const r of Array.from(rules)) {
      if ((r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules);
      const st = (r as CSSStyleRule).style;
      if (!st) continue;
      for (let i = 0; i < st.length; i++) if (/^--(font|text)-/.test(st[i])) names.add(st[i]);
      const sel = (r as CSSStyleRule).selectorText ?? '';
      const font = /^\.(font-[a-z0-9-]+)$/.exec(sel);
      if (font && st.fontFamily && !st.fontFamily.includes('var(')) { const fam = families(st.fontFamily); if (fam.length) fonts.push({ name: font[1], families: fam }); }
      const text = /^\.(text-(?:xs|sm|base|lg|[0-9]?xl))$/.exec(sel);
      if (text && st.fontSize && !st.fontSize.includes('var(')) { const px = toPx(st.fontSize); if (!isNaN(px)) sizes.push({ name: text[1], px: Math.round(px * 10) / 10 }); }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) { try { walk(sheet.cssRules); } catch { /* another origin */ } }
  // next/font puts its variables on a class of <body> or <html>
  const read = (n: string) => getComputedStyle(document.body).getPropertyValue(n).trim() || getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  for (const n of names) {
    const v = read(n);
    if (!v) continue;
    if (n.startsWith('--font-')) {
      // --font-weight-*, --font-size-* aren't families
      if (/^--font-(weight|size|feature|variation)/.test(n)) continue;
      const fam = families(v.replace(/var\([^)]*\)/g, ''));
      if (fam.length) fonts.push({ name: n, families: fam });
    } else if (/^--text-[a-z0-9]+$/.test(n)) {
      const px = toPx(v);
      if (!isNaN(px)) sizes.push({ name: n, px: Math.round(px * 10) / 10 });
    }
  }
  return { fonts, sizes };
}

/**
 * The standard: the base layer (components/ui) when the project has one — a product component with
 * its own classes is then written by hand — otherwise every component in the catalog.
 */
export function standardOf(items: CatalogItem[]): CatalogItem[] {
  const base = items.filter(i => i.layer === 'base' && i.folder === 'ui');
  return base.length >= 5 ? base : items.filter(i => !i.library || i.layer === 'base');
}

export function readConsistency(items: CatalogItem[], max = 80): ConsistencyRead {
  const byName = new Map(standardOf(items).map(i => [i.name, i]));
  const enumKeys = (name: string) => (byName.get(name)?.props ?? []).filter(p => p.kind === 'enum' || p.kind === 'boolean').map(p => p.name);
  type Piece = { el: HTMLElement; look: Look; kind: string; owner?: string; ref?: string; name?: string; base?: Look; caller: boolean; drop?: string[] };
  const pieces: Piece[] = [];
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('a, button, [role="button"], input:not([type="hidden"]), select, textarea, label, span, div'))) {
    if (el.closest(ILSE_UI)) continue;
    // A badge inside a button is the button's
    const host = el.parentElement?.closest<HTMLElement>('a, button, [role="button"]');
    if (host && isPiece(host, lookOf(host))) continue;
    const owner = writtenIn(el);
    if (DATAVIZ.test(owner ?? '')) continue;
    const look = lookOf(el);
    if (!isPiece(el, look)) continue;
    // Only the component that wrote the element counts, and only when it brings its own classes: an unstyled <Link> is hand-written
    const inner = chain(el, byName).find(x => x.name === owner);
    const pr = inner ? pristine(el, inner.props) : null;
    if (inner && pr && pr.own > 0) {
      const ref = `${inner.name}${enumKeys(inner.name).filter(k => inner.props[k] !== undefined).map(k => ` ${k}=${String(inner.props[k])}`).join('')}`;
      pieces.push({ el, look, kind: kindOf(el), owner, ref, name: inner.name, base: pr.look, caller: callerClasses(inner.props).length > 0, drop: callerClasses(inner.props) });
    } else {
      pieces.push({ el, look, kind: kindOf(el), owner, caller: false });
    }
  }

  for (const p of pieces) if (p.ref && p.base && !knownRefs.has(p.ref)) knownRefs.set(p.ref, { key: p.ref, name: p.name!, kind: p.kind, look: p.base });
  const refs = [...knownRefs.values()].filter(r => byName.has(r.name));
  const named = colorTokens();
  const colors = named.map(x => x.c);
  for (const r of refs) for (const c of [r.look.fill, r.look.text, r.look.border.color]) if (c && painted(c)) colors.push({ ...c, a: 1 });
  // The token to use instead, by name and checked for contrast — "the closest token" alone sent an agent for a whole theme class
  const swapsOf = (el: HTMLElement, off: Array<[Swap['role'], RGBA]>) => off.flatMap(([role, c]) => {
    const st = getComputedStyle(el);
    const size = parseFloat(st.fontSize);
    const large = size >= 24 || (size >= 18.66 && parseInt(st.fontWeight, 10) >= 700);
    // Text reads against what is behind it; a fill against the text on it
    const against = role === 'text' ? behind(el) : role === 'fill' ? readColor(st.color) ?? undefined : undefined;
    const sw = pickSwap(role, c, named, against, large);
    return sw ? [sw] : [];
  });
  // Black and white are everyone's
  const offColor = (c: RGBA | null) => !!c && painted(c) && colors.length > 0
    && !colors.some(t => deltaE(t, { ...c, a: 1 }) < 2) && !(c.r === c.g && c.g === c.b && (c.r === 0 || c.r === 255));

  const findings: ConsistencyFinding[] = [];
  // One row per problem: a colour is one row wherever it's used, so its fix covers every place
  const add = (f: Omit<ConsistencyFinding, 'id' | 'pieces'>) => {
    const id = f.type.startsWith('off-') ? `${f.type}:${f.props.join(',')}` : `${f.type}:${f.owner ?? ''}:${f.standard ?? ''}:${f.props.join(',')}`;
    const piece = `"${f.text}"${f.owner ? ` in <${f.owner}>` : ''}`;
    const same = findings.find(x => x.id === id);
    if (!same) { findings.push({ ...f, id, pieces: [piece] }); return; }
    same.els.push(...f.els);
    if (f.drop) same.drop = [...(same.drop ?? []), ...f.drop];
    if (!same.pieces.includes(piece)) same.pieces.push(piece);
  };
  for (const p of pieces) {
    const text = label(p.el);
    if (p.ref) {
      const d = p.base ? lookDiff(p.look, p.base) : [];
      if (p.caller && d.length) add({ type: 'override', els: [p.el], text, owner: p.owner, standard: p.ref, props: d, drop: [[p.el, p.drop ?? []]] });
      continue;
    }
    // A DS component styled like another DS variant on purpose (a SelectTrigger like the Button) isn't a copy
    if (!byName.has(p.owner ?? '')) {
      const same = refs.find(r => (r.kind === p.kind || (p.kind !== 'field' && r.kind !== 'field')) && lookDiff(p.look, r.look).length === 0);
      if (same) add({ type: 'copy', els: [p.el], text, owner: p.owner, standard: same.key, props: [] });
    }
    const off = ([['fill', p.look.fill], ['text', p.look.text], ['border', p.look.border.width ? p.look.border.color : null]] as const)
      .filter(([, c]) => offColor(c)).map(([role, c]) => [role, c!] as [Swap['role'], RGBA]);
    if (off.length) add({ type: 'off-token', els: [p.el], text, owner: p.owner, props: [...new Set(off.map(([, c]) => hex(c)))], swaps: swapsOf(p.el, off) });
  }
  // Words: a colour, a font or a size the DS doesn't have
  const type = typeTokens();
  const dsFamilies = new Set([...type.fonts.flatMap(f => f.families), ...families(getComputedStyle(document.body).fontFamily).slice(0, 1)]);
  // The scale: the --text-* steps, plus the sizes the DS's own components draw (a Badge's 11px is the DS's)
  const steps: Array<{ name?: string; px: number }> = [...type.sizes, ...refs.map(r => ({ px: Math.round(r.look.fontSize * 10) / 10 }))];
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    if (el.closest(`${ILSE_UI}, svg`)) continue;
    if (!Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent!.trim())) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const owner = writtenIn(el);
    if (DATAVIZ.test(owner ?? '')) continue;
    const st = getComputedStyle(el);
    const c = readColor(st.color);
    if (offColor(c)) add({ type: 'off-token', els: [el], text: label(el), owner, props: [hex(c!)], swaps: swapsOf(el, [['text', c!]]) });
    const fam = families(st.fontFamily)[0];
    if (fam && type.fonts.length && !dsFamilies.has(fam)) {
      // The DS font for the same role: code for a monospace stack, else the body's
      const mono = /mono|code|courier|consolas|menlo/i.test(st.fontFamily);
      const to = type.fonts.find(f => mono === /mono|code/.test(f.name)) ?? type.fonts[0];
      add({ type: 'off-font', els: [el], text: label(el), owner, props: [fam], swaps: [{ role: 'font', from: fam, token: to.name, value: to.families[0] }] });
    }
    // Display sizes are often fluid (clamp, vw): a heading over 40px is left to the agent
    const px = Math.round(parseFloat(st.fontSize) * 10) / 10;
    if (type.sizes.length >= 3 && px < 40 && !steps.some(x => Math.abs(x.px - px) <= 0.5)) {
      const to = nearestStep(px, steps)!;
      add({ type: 'off-size', els: [el], text: label(el), owner, props: [`${px}px`], swaps: [{ role: 'size', from: `${px}px`, token: to.name ?? `${to.px}px`, value: `${to.px}px` }] });
    }
  }

  const listed = pieces.slice(0, max);
  return {
    findings,
    els: listed.map(p => p.el),
    pieces: listed.map((p, id) => ({
      id, kind: p.kind, text: label(p.el), look: lookText(p.look),
      ...(p.owner ? { owner: p.owner } : {}), ...(p.ref ? { component: p.ref } : {}),
    })),
    checked: { pieces: pieces.length, standards: refs.length, colors: colors.length },
  };
}

/** The screen as the agent's cache sees it: same route and same pieces → same review. Not their looks:
 *  a selection outline or a hover would ask the agent again; ↻ asks after a restyle */
export function screenKey(route: string, pieces: ReviewPiece[]): string {
  let h = 5381;
  for (const ch of pieces.map(p => `${p.kind}|${p.text}|${p.owner ?? ''}|${p.component ?? ''}`).join('\n')) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return `${route}#${(h >>> 0).toString(36)}`;
}

type NoteInput = { type: string; text: string; owner?: string; standard?: string; props: string[]; swaps?: Swap[]; detail?: string; fix?: string; file?: string; line?: number; pieces?: string[] };

/** A finding on several pieces: the note is about all of them, not only the selected one */
const every = (pieces?: string[]) => pieces && pieces.length > 1
  ? ` This is on ${pieces.length} pieces of this screen: ${pieces.slice(0, 12).join(', ')}${pieces.length > 12 ? '…' : ''} — fix every one of them the same way, not only the selected one; one that turns out different stays as it is.`
  : '';

const swapText = (w: Swap) => `${w.from} → ${w.token} (${w.value})${w.contrast !== undefined ? `, contrast ${w.contrast}:1` : ''}`;

/**
 * What the agent reads for Fix — exactly what the row said it would do, nothing more.
 * `mode` 'add' (off-token only): the colour becomes a DS token instead.
 */
export function fixNote(f: NoteInput, mode: 'fix' | 'add' | 'variant' = 'fix'): string {
  const where = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : f.owner ? ` (written in <${f.owner}>)` : '';
  const piece = `"${f.text}"${where}`;
  switch (f.type) {
    case 'override': return mode === 'variant'
      ? `${piece} is the DS's ${f.standard} with its look changed by the className (${f.props.join(', ')}). Keep this look as a variant of ${f.standard!.split(' ')[0]}: use the variant that already has it, else add one to ${f.standard!.split(' ')[0]} named by its role, then use it here and drop those classes. Nothing may look different after.${every(f.pieces)}`
      : `${piece} is the DS's ${f.standard} with its look changed by the className (${f.props.join(', ')}). Remove the classes that change it, so it looks like ${f.standard} again; keep the ones for layout (margin, width, position).${every(f.pieces)}`;
    case 'copy': return `${piece} is written by hand but looks exactly like the DS's ${f.standard}. Replace it with that component and drop the hand-written classes; it must look the same after.${every(f.pieces)}`;
    case 'off-token': return mode === 'add'
      ? `${f.props.join(', ')} isn't a token of the DS. Add it once as a new colour token, named by its role, where the other colour tokens are declared, and use that token in every place it is written by hand. Nothing may look different after.${every(f.pieces) || ` It is used by ${piece}.`}`
      : `${f.props.join(', ')} isn't a token of the DS. Swap exactly this: ${(f.swaps ?? []).map(swapText).join('; ')}.${every(f.pieces) || ` It is used by ${piece}.`} `
        + 'Change only that colour, written the way this file writes tokens (a utility class or var()); don\'t add theme or section classes. If it can\'t be done without changing anything else, change nothing and say so.';
    case 'off-font':
    case 'off-size': {
      const what = f.type === 'off-font' ? `font family "${f.props[0]}", which isn't one of the DS's fonts` : `text size ${f.props[0]}, which is off the DS's type scale`;
      const w = f.swaps?.[0];
      return mode === 'add'
        ? `${f.props[0]} (${f.type === 'off-font' ? 'font family' : 'text size'}) isn't in the DS. Add it once as a new ${f.type === 'off-font' ? 'font' : 'type scale'} token, named by its role, where the others are declared, and use it in every place it is written by hand. Nothing may look different after.${every(f.pieces) || ` It is used by ${piece}.`}`
        : `${piece} uses ${what}. Swap exactly this: ${f.props[0]} → ${w?.token}${w && w.token !== w.value ? ` (${w.value})` : ''}, through the token or its utility class. Change only the ${f.type === 'off-font' ? 'font family' : 'size'}.${every(f.pieces)} If it can't be done without changing anything else, change nothing and say so.`;
    }
    default: {
      return `${piece}: ${f.detail ?? ''}${f.fix ? ` Should be: ${f.fix}.` : ''}${every(f.pieces)}`;
    }
  }
}

/** How long the agent's review usually takes here: the mean of the last ones, 25s before there are any */
export function reviewEstimate(past: number[]): number {
  const last = past.filter(n => Number.isFinite(n) && n > 0).slice(-5);
  return last.length ? Math.round(last.reduce((a, b) => a + b, 0) / last.length) : 25_000;
}

/** Ticks of the review meter lit after `elapsed`: never all of them before the agent answers */
export function ticksLit(elapsed: number, expect: number, total: number): { lit: number; slow: boolean } {
  const slow = elapsed > expect;
  return { lit: Math.max(1, Math.min(total - 1, Math.round((elapsed / expect) * total))), slow };
}

/** The panel properties a swap writes on one piece. A colour row covers every piece in that colour,
 *  as text on one and border on another: each piece gets the property it uses the colour in.
 *  Fonts aren't here — the panel has no font family, so those go to the agent */
export function swapStyles(st: Pick<CSSStyleDeclaration, 'color' | 'backgroundColor' | 'borderColor' | 'borderTopWidth' | 'fontSize'>, swaps: Swap[]): Record<string, string> {
  const out: Record<string, string> = {};
  // Computed styles are always rgb()/rgba(): read them as is
  const same = (css: string, want: string) => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(css);
    return !!m && (m[4] === undefined || +m[4] > 0.02) && hex({ r: +m[1], g: +m[2], b: +m[3], a: 1 }) === want.toLowerCase();
  };
  for (const w of swaps) {
    if (w.role === 'size') { if (Math.abs(parseFloat(st.fontSize) - parseFloat(w.from)) <= 0.5) out.fontSize = w.value; continue; }
    if (w.role === 'font') continue;
    if (same(st.color, w.from)) out.color = w.value;
    if (same(st.backgroundColor, w.from)) out.backgroundColor = w.value;
    if (parseFloat(st.borderTopWidth) > 0 && same(st.borderColor, w.from)) out.borderColor = w.value;
  }
  return out;
}

/** A row whose fix the page can show before it's sent and Ilse can write without AI */
export const previewable = (swaps?: Swap[]) => !!swaps?.length && swaps.every(w => w.role !== 'font');
