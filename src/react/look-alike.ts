/**
 * Look-alikes: elements that read as the same piece to the eye but aren't one
 * component in the code — four `<Link>`s with the same classes pasted, that the
 * catalog can't see because it lists components, not looks.
 *
 * The look is the computed style that makes a piece what it is. Its shape
 * (corners, padding, height, type) says *which* piece — the family, "the
 * button"; its paint (fill, text, border colour) says which variant of it. A
 * member whose shape is off by one property is the inconsistency worth naming:
 * "1 differs in padding". Reads the page only (Pro shows it).
 */

import { deltaE, readColor, type RGBA } from './color.js';
import { componentAt, ownRoot, snapshotOf, styledByCaller, writtenIn, type CatalogItem, type CatalogSnapshot } from './catalog-snapshot.js';

export interface Look {
  radius: number;
  padX: number;
  padY: number;
  height: number;
  fontSize: number;
  fontWeight: number;
  textTransform: string;
  fill: RGBA | null;
  text: RGBA | null;
  border: { width: number; color: RGBA | null };
  shadow: boolean;
}

export interface LookMember<T = unknown> {
  look: Look;
  ref: T;
  /** Where it's written (the component whose JSX has it): two places make a pattern */
  file?: string;
  /** The catalog component it is the root of, when it is one */
  component?: string;
}

export interface LookVariant<T = unknown> { members: LookMember<T>[] }

export interface LookFamily<T = unknown> {
  /** The shape the family's members share, `radius=8 padX=16 …` */
  shape: string;
  variants: LookVariant<T>[];
  /** Same piece, one shape property off: what it differs in */
  nearMisses: Array<{ member: LookMember<T>; differsIn: ShapeProp }>;
  size: number;
}

export type ShapeProp = 'radius' | 'padX' | 'padY' | 'height' | 'fontSize' | 'fontWeight' | 'textTransform';
const SHAPE: ShapeProp[] = ['radius', 'padX', 'padY', 'height', 'fontSize', 'fontWeight', 'textTransform'];

/** Rounding noise (15.5px vs 16px, a 39 vs 40 height) isn't a different piece */
function shapeOf(l: Look): Record<ShapeProp, string> {
  const px = (n: number, step: number) => String(Math.round(n / step) * step);
  return {
    // A pill is a pill whatever its radius past half the height
    radius: l.radius >= l.height / 2 ? 'pill' : px(l.radius, 2),
    padX: px(l.padX, 2),
    padY: px(l.padY, 2),
    height: px(l.height, 4),
    fontSize: px(l.fontSize, 1),
    fontWeight: String(l.fontWeight >= 600 ? 'bold' : l.fontWeight >= 500 ? 'medium' : 'regular'),
    textTransform: l.textTransform === 'none' ? '' : l.textTransform,
  };
}

const shapeKey = (s: Record<ShapeProp, string>) => SHAPE.map(p => `${p}=${s[p]}`).join(' ');

/** Colours closer than this read as the same to the eye (ΔE ×100 in OKLab) */
const SAME_COLOR = 4;

function sameColor(a: RGBA | null, b: RGBA | null): boolean {
  const none = (c: RGBA | null) => !c || c.a < 0.02;
  if (none(a) || none(b)) return none(a) && none(b);
  return deltaE(a!, b!) < SAME_COLOR;
}

function samePaint(a: Look, b: Look): boolean {
  const borderA = a.border.width > 0 ? a.border.color : null;
  const borderB = b.border.width > 0 ? b.border.color : null;
  return sameColor(a.fill, b.fill) && sameColor(a.text, b.text) && sameColor(borderA, borderB) && a.shadow === b.shadow;
}

/**
 * Groups members into families by shape, variants by paint, and pulls a
 * one-property-off member into the bigger family it almost is. A family shows
 * when it's a pattern: `min` members, or written in two places.
 */
export function groupLookAlikes<T>(members: LookMember<T>[], min = 3): LookFamily<T>[] {
  const byShape = new Map<string, { shape: Record<ShapeProp, string>; members: LookMember<T>[] }>();
  for (const m of members) {
    const shape = shapeOf(m.look);
    const key = shapeKey(shape);
    if (!byShape.has(key)) byShape.set(key, { shape, members: [] });
    byShape.get(key)!.members.push(m);
  }

  // Biggest first: a near miss joins the family it almost is, never the other way round
  const groups = [...byShape.entries()].sort((a, b) => b[1].members.length - a[1].members.length);
  const families: Array<LookFamily<T> & { shapeOf: Record<ShapeProp, string> }> = [];
  for (const [key, g] of groups) {
    const host = families.find(f => f.size > g.members.length && SHAPE.filter(p => f.shapeOf[p] !== g.shape[p]).length === 1);
    if (host) {
      const differsIn = SHAPE.find(p => host.shapeOf[p] !== g.shape[p])!;
      for (const member of g.members) host.nearMisses.push({ member, differsIn });
      continue;
    }
    const variants: LookVariant<T>[] = [];
    for (const m of g.members) {
      const v = variants.find(x => samePaint(x.members[0].look, m.look));
      if (v) v.members.push(m);
      else variants.push({ members: [m] });
    }
    variants.sort((a, b) => b.members.length - a.members.length);
    families.push({ shape: key, shapeOf: g.shape, variants, nearMisses: [], size: g.members.length });
  }

  return families
    .map(({ shapeOf: _, ...f }) => f)
    .filter(f => {
      const all = [...f.variants.flatMap(v => v.members), ...f.nearMisses.map(n => n.member)];
      const files = new Set(all.map(m => m.file).filter(Boolean));
      return all.length >= min || (files.size >= 2 && all.length >= 2);
    })
    .sort((a, b) => (b.size + b.nearMisses.length) - (a.size + a.nearMisses.length));
}

// ── Reading the page ────────────────────────────────────────────────────────

/** What can be a piece: clickable things, and boxes drawn as chips, badges, fields */
const CANDIDATES = 'a, button, [role="button"], input:not([type="hidden"]), select, textarea, label, span, div';
const MAX_CANDIDATES = 2000;

const num = (v: string) => parseFloat(v) || 0;

export function readLook(el: Element): Look {
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    radius: num(s.borderTopLeftRadius),
    padX: (num(s.paddingLeft) + num(s.paddingRight)) / 2,
    padY: (num(s.paddingTop) + num(s.paddingBottom)) / 2,
    height: r.height,
    fontSize: num(s.fontSize),
    fontWeight: num(s.fontWeight),
    textTransform: s.textTransform,
    fill: readColor(s.backgroundColor),
    text: readColor(s.color),
    border: { width: num(s.borderTopWidth), color: readColor(s.borderTopColor) },
    shadow: s.boxShadow !== 'none',
  };
}

/**
 * A box someone drew on purpose: it has a fill or a border, and padding, and is
 * small — a span or div only when it looks like a chip, never a layout block.
 */
function isPiece(el: Element, look: Look): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0 || r.height > 120 || r.width > 480) return false;
  // Off to the left is Ilse's preview stage, not the page
  if (r.right <= 0) return false;
  const boxed = (look.fill && look.fill.a > 0.02) || look.border.width > 0;
  if (!boxed || (look.padX === 0 && look.padY === 0)) return false;
  if (/^(SPAN|DIV)$/.test(el.tagName)) {
    // A chip has its own words and nothing boxed inside it
    if (!el.textContent?.trim() || el.querySelector(CANDIDATES.replace(', span, div', ''))) return false;
  }
  return true;
}

/** The page's pieces with their looks, outside Ilse's own UI */
export function lookCandidates(root: ParentNode = document.body): LookMember<HTMLElement>[] {
  const out: LookMember<HTMLElement>[] = [];
  const all = root.querySelectorAll(CANDIDATES);
  for (let i = 0; i < all.length && out.length < MAX_CANDIDATES; i++) {
    const el = all[i];
    if (!(el instanceof HTMLElement) || el.closest('[data-ilse-toolbar], #ilse-standalone-root')) continue;
    // The outermost box is the piece: a button's inner span isn't another one
    if (el.parentElement?.closest('a, button, [role="button"]')) continue;
    const look = readLook(el);
    if (isPiece(el, look)) out.push({ look, ref: el });
  }
  return out;
}

// ── For the Library ─────────────────────────────────────────────────────────

/** Members that are all one component's roots already are that component, not a look-alike.
 *  Only the matching members count: a near miss written by hand (a search bar that happens to
 *  look almost like the Chip) differs anyway and mustn't bring the component back to the list. */
export function looseFamilies<T>(families: LookFamily<T>[]): LookFamily<T>[] {
  return families.filter(f => {
    const made = new Set(f.variants.flatMap(v => v.members).map(m => m.component ?? ''));
    return !(made.size === 1 && !made.has(''));
  });
}

export type PieceKind = 'button' | 'field' | 'chip';

/** What the family is, said by its most common element */
export function pieceKind(tags: string[]): PieceKind {
  const count = (re: RegExp) => tags.filter(x => re.test(x)).length;
  const button = count(/^(A|BUTTON)$/), field = count(/^(INPUT|SELECT|TEXTAREA)$/);
  if (field > button && field >= tags.length / 2) return 'field';
  return button >= tags.length / 2 ? 'button' : 'chip';
}

export interface LookAlikeView {
  /** The look, the same on every screen: what "Ignore" keeps */
  id: string;
  family: LookFamily<HTMLElement>;
  kind: PieceKind;
  /** The most used variant's first member, copied */
  snap?: CatalogSnapshot;
  /** Each variant's first member, copied (most used first) */
  variantSnaps: Array<CatalogSnapshot | undefined>;
  /** A member's words, to recognise it ("Comprar") */
  text?: string;
  /** How many places write it */
  places: number;
}

/**
 * A look's id: what it is and its shape, without the colours (the variants come
 * and go) and without the height (the words decide it: one line or two)
 */
export const lookId = (kind: PieceKind, shape: string) => `${kind}:${shape.split(' ').filter(x => !x.endsWith('=') && !x.startsWith('height=')).join(' ')}`;

/** The page's look-alikes that aren't one component and weren't ignored, biggest first */
export function readLookAlikes(items: CatalogItem[], ignored: Set<string> = new Set(), max = 8): LookAlikeView[] {
  const members = lookCandidates().map(m => ({
    ...m,
    file: writtenIn(m.ref),
    component: styledByCaller(m.ref) ? undefined : componentAt(m.ref, items)?.item.name ?? ownRoot(m.ref),
  }));
  const out: LookAlikeView[] = [];
  for (const family of looseFamilies(groupLookAlikes(members))) {
    if (out.length >= max) break;
    const all = [...family.variants.flatMap(v => v.members), ...family.nearMisses.map(n => n.member)];
    const kind = pieceKind(all.map(m => m.ref.tagName));
    const id = lookId(kind, family.shape);
    if (ignored.has(id)) continue;
    const first = family.variants[0].members[0].ref;
    out.push({
      id,
      family,
      kind,
      snap: snapshotOf(first) ?? undefined,
      variantSnaps: family.variants.slice(0, 6).map(v => snapshotOf(v.members[0].ref) ?? undefined),
      text: all.map(m => m.ref.textContent?.trim()).find(Boolean)?.slice(0, 40),
      places: new Set(all.map(m => m.file).filter(Boolean)).size,
    });
  }
  return out;
}

const hex = (c: RGBA | null) => !c || c.a < 0.02 ? 'none' : '#' + [c.r, c.g, c.b].map(n => Math.round(n).toString(16).padStart(2, '0')).join('');

/** What the agent reads for "Make it a component": the members, their looks and where they're written */
export function lookNote<T>(family: LookFamily<T>, kind: PieceKind, text?: string): string {
  const all = [...family.variants.flatMap(v => v.members), ...family.nearMisses.map(n => n.member)];
  const files = [...new Set(all.map(m => m.file).filter(Boolean))];
  const made = [...all.reduce((m, x) => x.component ? m.set(x.component, (m.get(x.component) ?? 0) + 1) : m, new Map<string, number>())];
  const variants = family.variants.map((v, i) => {
    const l = v.members[0].look;
    const border = l.border.width > 0 ? `, border ${l.border.width}px ${hex(l.border.color)}` : '';
    return `${i + 1}) fill ${hex(l.fill)}, text ${hex(l.text)}${border} (${v.members.length}×)`;
  });
  const misses = family.nearMisses.length
    ? `${family.nearMisses.length} of them differ in ${[...new Set(family.nearMisses.map(n => n.differsIn))].join(', ')} only: give them the family's shape.`
    : '';
  return [
    `Make one component of these ${all.length} look-alike ${kind}s${text ? ` (like "${text}")` : ''}: they look like one piece but are written by hand, not one component.`,
    `Shared shape: ${family.shape.split(' ').filter(x => !x.endsWith('=')).join(' ')}.`,
    variants.length > 1 ? `Variants by paint: ${variants.join('; ')} — one prop for them.` : `Paint: ${variants[0]?.slice(3)}.`,
    files.length ? `Written in: ${files.join(', ')}.` : '',
    made.length ? `Already a component: ${made.map(([c, n]) => `${n} are <${c}>`).join(', ')} — use it for the rest unless it can't take their look.` : '',
    misses,
    'Reuse a catalog component if one already fits; otherwise create it next to the others, in the design system\'s tokens (the design contract) rather than these raw values, then replace every instance with it.',
  ].filter(Boolean).join(' ');
}
