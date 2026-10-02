/**
 * Live layout — move the real element and let the real layout react.
 *
 * Dragging a selected element lifts the node itself (not a stand-in box). When
 * its parent is a flex or grid container, the siblings re-flow around it through
 * CSS `order`, animated FLIP-style, so the page shows exactly what the reordered
 * code will render. Nodes are never moved in the DOM: React owns them, and a node
 * moved behind its back breaks the next render. The change is described in
 * React's terms (key, owning component) for the agent to make real in the source.
 *
 * Every preview is undone when the real code lands (React reorders or recreates
 * the children), on cancel, or when it expires.
 */

// ── Pure: where does a dragged item land? ─────────────────────────────────

export type Axis = 'row' | 'column' | 'grid';

export interface Slot { left: number; top: number; width: number; height: number }

/**
 * Where the dragged item goes, given the pointer, the other items' laid-out
 * boxes (in visual order) and the slot it holds now.
 *
 * It takes the place of the item it is over — and only when it is over one.
 * Crossing a gap, or hovering its own (now empty) slot, changes nothing. That
 * is what keeps a grid calm: the nearest-centre rule it replaces reshuffled the
 * whole grid as soon as the pointer drifted between cells.
 */
export function targetIndex(pointer: { x: number; y: number }, others: Slot[], current: number): number {
  const over = others.findIndex(s =>
    pointer.x >= s.left && pointer.x <= s.left + s.width && pointer.y >= s.top && pointer.y <= s.top + s.height);
  if (over < 0) return current;
  // Items after the current slot shift back when it leaves: land after them
  return over >= current ? over + 1 : over;
}

/** `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Is the pointer deep enough inside a box to mean "into it" rather than "next
 * to it"? The outer quarter on each side stays a reorder — like Figma, where
 * the middle of a frame drops inside and its edges drop beside.
 */
export function inInnerZone(p: { x: number; y: number }, r: Slot, edge = 0.25): boolean {
  const ix = Math.min(r.width * edge, 48);
  const iy = Math.min(r.height * edge, 48);
  return p.x > r.left + ix && p.x < r.left + r.width - ix && p.y > r.top + iy && p.y < r.top + r.height - iy;
}

/**
 * Where among a container's children the pointer inserts: before the first
 * child it comes before, along the container's axis (reading order for grids).
 */
export function insertionIndex(p: { x: number; y: number }, children: Slot[], axis: Axis): number {
  const i = children.findIndex(c => {
    const cx = c.left + c.width / 2;
    const cy = c.top + c.height / 2;
    if (axis === 'row') return p.x < cx;
    if (axis === 'column') return p.y < cy;
    return p.y < c.top || (p.y <= c.top + c.height && p.x < cx);
  });
  return i < 0 ? children.length : i;
}

// ── React's view of an element (dev builds) ────────────────────────────────

interface Fiber {
  key: string | null;
  type: unknown;
  return: Fiber | null;
  _debugOwner?: Fiber | null;
}

function fiberOf(el: Element): Fiber | null {
  const k = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  return k ? (el as unknown as Record<string, Fiber>)[k] : null;
}

function nameOf(f: Fiber | null | undefined): string | undefined {
  const t = f?.type as { displayName?: string; name?: string } | string | undefined;
  if (!t || typeof t === 'string') return undefined;
  return t.displayName || t.name || undefined;
}

export interface ReactView {
  /** The `key` React knows the element by, when it has one (lists from .map()) */
  key?: string;
  /** Component that rendered it (the one to edit) */
  owner?: string;
}

export function reactView(el: Element): ReactView {
  const f = fiberOf(el);
  if (!f) return {};
  // The host fiber may be keyless while a wrapping component carries the key
  let keyed: Fiber | undefined;
  for (let x: Fiber | null = f; x && !keyed; x = x.return) {
    if (x.key != null) keyed = x;
    if (x !== f && typeof x.type === 'string') break; // stop at the next DOM element up
  }
  // The component that wrote `<Item key=…>` is the one whose code holds the
  // order — the app's list, not the design-system primitive (SidebarMenuItem).
  let owner = nameOf((keyed ?? f)._debugOwner);
  for (let x = f.return; x && !owner; x = x.return) owner = nameOf(x);
  return { key: keyed?.key ?? undefined, owner };
}

/**
 * The component that rendered this element, and how many of it are on the page.
 * A button inside <Card> changes every Card when its class is edited where
 * Card is written — the designer should get to choose. Counts instances (owner
 * fibers), not DOM nodes. Dev builds only (React keeps _debugOwner there).
 */
export function componentScope(el: Element): { component: string; count: number } | null {
  const owner = fiberOf(el)?._debugOwner;
  const component = nameOf(owner);
  if (!owner || !component) return null;
  // Each rendered instance has a fiber pair (current/alternate): count one per pair
  const instances = new Set<Fiber>();
  for (const node of Array.from(document.getElementsByTagName(el.tagName))) {
    const o = fiberOf(node)?._debugOwner;
    if (!o || o.type !== owner.type) continue;
    const alt = (o as Fiber & { alternate?: Fiber | null }).alternate;
    if (instances.has(o) || (alt && instances.has(alt))) continue;
    instances.add(o);
  }
  return { component, count: instances.size };
}

/**
 * The same JSX node in the component's other instances on the page — what
 * "all of them" changes. Same tag, same owning component and the same place
 * in its code (where React created the element: line:column in the dev stack),
 * or, without a dev stack, the same classes.
 */
export function scopeTwins(el: Element): HTMLElement[] {
  const owner = fiberOf(el)?._debugOwner;
  if (!owner) return [];
  const site = jsxSite(el);
  const cls = el.getAttribute('class') ?? '';
  return Array.from(document.getElementsByTagName(el.tagName)).filter((node): node is HTMLElement => {
    if (node === el || !(node instanceof HTMLElement) || node.closest('[data-ilse-toolbar]')) return false;
    if (fiberOf(node)?._debugOwner?.type !== owner.type) return false;
    const other = jsxSite(node);
    return site && other ? other === site : (node.getAttribute('class') ?? '') === cls;
  });
}

/** Where React created the element: the first app frame of its dev stack, with line:column */
function jsxSite(el: Element): string | undefined {
  const stack = (fiberOf(el) as (Fiber & { _debugStack?: { stack?: string } }) | null)?._debugStack?.stack;
  return (stack ?? '').split('\n').find(l => /^\s*at\s/.test(l) && /:\d+:\d+\)?\s*$/.test(l)
    && !/node_modules|react-stack|jsx-dev-runtime|react-dom|jsxDEV/.test(l))?.trim();
}

// ── Live preview (browser) ─────────────────────────────────────────────────

export function itemLabel(el: Element): string {
  const line = ((el as HTMLElement).innerText ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? '';
  const aria = el.getAttribute('aria-label') ?? '';
  const text = aria || line;
  return text ? (text.length > 40 ? text.slice(0, 39) + '…' : text) : el.tagName.toLowerCase();
}

function describeContainer(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const attrs = Array.from(el.attributes)
    .filter(a => a.name.startsWith('data-') && !a.name.startsWith('data-ilse') || a.name === 'role' || a.name === 'id')
    .slice(0, 2)
    .map(a => `${a.name}="${a.value}"`);
  return `<${[tag, ...attrs].join(' ')}>`;
}

interface Saved { order: string; transform: string; transition: string; zIndex: string; position: string; boxShadow: string; pointerEvents: string; willChange: string }

const save = (el: HTMLElement): Saved => ({
  order: el.style.order, transform: el.style.transform, transition: el.style.transition,
  zIndex: el.style.zIndex, position: el.style.position, boxShadow: el.style.boxShadow,
  pointerEvents: el.style.pointerEvents, willChange: el.style.willChange,
});

const restore = (el: HTMLElement, s: Saved) => { Object.assign(el.style, s); };

/** One container's live preview: the original look of each child, to put back. */
interface LiveList {
  parent: HTMLElement;
  saved: Map<HTMLElement, Saved>;
  /** Children in their original DOM order, for "from" and "current order" */
  original: HTMLElement[];
  observer: MutationObserver;
  expiry?: ReturnType<typeof setTimeout>;
}

const lists = new Map<HTMLElement, LiveList>();

function layoutChildren(parent: HTMLElement): HTMLElement[] {
  return Array.from(parent.children).filter((c): c is HTMLElement => {
    if (!(c instanceof HTMLElement) || c.closest('[data-ilse-toolbar]')) return false;
    const cs = getComputedStyle(c);
    return cs.display !== 'none' && cs.position !== 'absolute' && cs.position !== 'fixed';
  });
}

function axisOf(parent: HTMLElement): Axis | null {
  const cs = getComputedStyle(parent);
  if (cs.display.includes('grid')) return 'grid';
  if (!cs.display.includes('flex')) return null;
  if (cs.flexWrap !== 'nowrap') return 'grid';
  return cs.flexDirection.startsWith('column') ? 'column' : 'row';
}

function adopt(parent: HTMLElement): LiveList {
  const existing = lists.get(parent);
  if (existing) return existing;
  const original = layoutChildren(parent);
  const saved = new Map(original.map(c => [c, save(c)]));
  const entry: LiveList = { parent, saved, original, observer: new MutationObserver(() => {
    // Only our items moving or going away means the real code landed. Other
    // children come and go on their own (an animated active-item highlight).
    const now = Array.from(parent.children).filter(c => original.includes(c as HTMLElement));
    const changed = now.length !== original.length || now.some((c, i) => c !== original[i]);
    if (changed) settle(parent);
  }) };
  entry.observer.observe(parent, { childList: true });
  lists.set(parent, entry);
  return entry;
}

/**
 * What actually moves when an element is dragged: the element itself, or the
 * nearest ancestor that is an item of a flex/grid list. Clicking a menu entry
 * selects its <button>, but the thing to reorder is the <li> around it.
 */
export function reorderUnit(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent || parent === document.body) break;
    if (!axisOf(parent)) continue;
    const items = layoutChildren(parent);
    // A list has look-alike items (same tag and same slot/classes, as a .map()
    // renders them); an icon + label pair inside a button doesn't.
    const alike = items.filter(c => c !== node && lookAlike(c, node!));
    if (items.includes(node) && alike.length >= 1) return node;
  }
  return el;
}

const SLOT_ATTRS = ['data-slot', 'data-sidebar', 'role'];

export function lookAlike(a: Element, b: Element): boolean {
  if (a.tagName !== b.tagName) return false;
  const slotted = SLOT_ATTRS.filter(n => a.hasAttribute(n) || b.hasAttribute(n));
  if (slotted.length) return slotted.every(n => a.getAttribute(n) === b.getAttribute(n));
  // State classes (active, selected…) differ between items; the structural ones don't
  const sig = (e: Element) => Array.from(e.classList).filter(c => !/(active|selected|current|open|checked|disabled)/i.test(c)).sort().join(' ');
  return sig(a) === sig(b);
}

/** Undo every preview on this container. */
export function settle(parent: HTMLElement): void {
  const entry = lists.get(parent);
  if (!entry) return;
  entry.observer.disconnect();
  if (entry.expiry) clearTimeout(entry.expiry);
  for (const [el, s] of entry.saved) if (el.isConnected) restore(el, s);
  lists.delete(parent);
}

export type PreviewKind = 'order' | 'move' | 'size';

/**
 * Undo the preview that involves `el` (its own offset, or its list's order).
 * `only` limits it to some kinds — taking back a resize leaves a reorder alone.
 */
export function settleElement(el: Element | null | undefined, only?: PreviewKind[]): void {
  if (!el) return;
  const does = (k: PreviewKind) => !only || only.includes(k);
  // Moved into another container: take the stand-in away, then settle the original where it lives
  const moved = moves.get(el as HTMLElement);
  if (moved && (does('order') || does('move'))) { settleMove(moved); settleElement(moved.el, only); return; }
  for (let node: Element | null = el, d = 0; node && d < 6; node = node.parentElement, d++) {
    const parent = node.parentElement;
    if (does('order') && parent && lists.has(parent)) settle(parent);
    const free = does('move') ? freeMoves.get(node as HTMLElement) : undefined;
    if (free) { restore(node as HTMLElement, free); freeMoves.delete(node as HTMLElement); }
    const size = does('size') ? resized.get(node as HTMLElement) : undefined;
    if (size) { Object.assign((node as HTMLElement).style, size); resized.delete(node as HTMLElement); }
  }
}

/** The agent has had its go: if the code didn't change the list by now, stop pretending it did. */
export function expireElement(el: Element | null | undefined, ms = 4000): void {
  const moved = el ? moves.get(el as HTMLElement) : undefined;
  if (moved) {
    if (moved.expiry) clearTimeout(moved.expiry);
    moved.expiry = setTimeout(() => settleElement(moved.ph), ms);
    return;
  }
  for (let node: Element | null = el ?? null, d = 0; node && d < 6; node = node.parentElement, d++) {
    const entry = node.parentElement ? lists.get(node.parentElement) : undefined;
    if (entry) {
      if (entry.expiry) clearTimeout(entry.expiry);
      entry.expiry = setTimeout(() => settle(entry.parent), ms);
    }
    const target = node as HTMLElement;
    if (resized.has(target)) {
      setTimeout(() => {
        const s = resized.get(target);
        if (s) { Object.assign(target.style, s); resized.delete(target); }
      }, ms);
    }
    if (freeMoves.has(target)) {
      setTimeout(() => {
        const s = freeMoves.get(target);
        if (s) { restore(target, s); freeMoves.delete(target); }
      }, ms);
    }
  }
}

/** Elements nudged outside a flex/grid list keep their offset until settled. */
const freeMoves = new Map<HTMLElement, Saved>();

// ── Resize the element itself ─────────────────────────────────────────────

// ── Into / out of a container ──────────────────────────────────────────────

/** Elements that hold content rather than being content */
const LEAF = /^(BUTTON|A|P|SPAN|H[1-6]|LABEL|INPUT|TEXTAREA|SELECT|OPTION|IMG|SVG|PATH|VIDEO|CANVAS|IFRAME|CODE|PRE|STRONG|EM|B|I|SMALL|TD|TH)$/;

function isContainer(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || LEAF.test(el.tagName) || el.closest('svg')) return false;
  if (el === document.body || el === document.documentElement) return false;
  // A box that holds blocks (a card holding rows), not one that holds a label:
  // a row with text and an icon isn't somewhere to drop things into
  if (!Array.from(el.children).some(c => c instanceof HTMLElement && !LEAF.test(c.tagName) && !c.hasAttribute('data-ilse-placeholder'))) return false;
  const r = el.getBoundingClientRect();
  return r.width >= 24 && r.height >= 24;
}

/** The deepest container under the pointer that isn't the dragged element or inside it */
function containerAt(x: number, y: number, dragged: HTMLElement, within?: HTMLElement): HTMLElement | null {
  for (const node of document.elementsFromPoint(x, y)) {
    if (dragged.contains(node) || node.closest('[data-ilse-toolbar]') || node.closest(`[${PLACEHOLDER}]`)) continue;
    for (let c: Element | null = node; c; c = c.parentElement) {
      if (c === dragged || dragged.contains(c)) break;
      if (within && !within.contains(c)) break;
      if (isContainer(c)) return c;
    }
  }
  return null;
}

const BRAND = '#FA6900';
const PLACEHOLDER = 'data-ilse-placeholder';
const PIXEL = 'data-ilse-pixel-target';

/**
 * Animate whatever `mutate` shifts: record where the boxes are, change the
 * layout, then let each box glide from its old spot to its new one (FLIP).
 */
function flip(els: HTMLElement[], mutate: () => void) {
  const live = els.filter(e => e.isConnected && !freeMoves.has(e));
  const first = new Map(live.map(e => [e, e.getBoundingClientRect()]));
  mutate();
  for (const e of live) {
    if (!e.isConnected) continue;
    const a = first.get(e)!;
    const b = e.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    e.style.transition = 'none';
    e.style.transform = `translate(${dx}px, ${dy}px)`;
    void e.offsetWidth;
    e.style.transition = SETTLE;
    e.style.transform = '';
  }
}

/** Boxes a change inside these containers can push around: their items, and the containers' neighbours */
function affected(...containers: Array<HTMLElement | null | undefined>): HTMLElement[] {
  const out = new Set<HTMLElement>();
  for (const c of containers) {
    if (!c) continue;
    for (const k of layoutChildren(c)) out.add(k);
    if (c.parentElement && c.parentElement !== document.body) for (const k of layoutChildren(c.parentElement)) out.add(k);
  }
  return [...out].filter(e => !e.hasAttribute(PLACEHOLDER));
}

const kidsOf = (target: HTMLElement, el: HTMLElement) =>
  layoutChildren(target).filter(c => c !== el && !c.contains(el) && !c.hasAttribute(PLACEHOLDER));

/** A preview of the element sitting in another container, until the code catches up */
interface Moved { el: HTMLElement; ph: HTMLElement; display: string; observer: MutationObserver; expiry?: ReturnType<typeof setTimeout> }
/** Keyed by both the original and its stand-in */
const moves = new Map<HTMLElement, Moved>();

function settleMove(m: Moved) {
  m.observer.disconnect();
  if (m.expiry) clearTimeout(m.expiry);
  moves.delete(m.el); moves.delete(m.ph);
  const pixel = m.ph.getAttribute(PIXEL);
  m.ph.remove();
  if (m.el.isConnected) {
    m.el.style.display = m.display;
    if (pixel) m.el.setAttribute(PIXEL, pixel);
  }
}

/**
 * Moving into (or out of) a container — for real, as far as the eye goes.
 *
 * React owns the element, so it can't be moved in the DOM. Instead the
 * original is collapsed (`display: none`: its list closes the gap) and a clone
 * stands in inside the destination (which opens room for it). The clone renders
 * with the destination's styles, so what shows is what the code will render.
 * Everything around glides into place. A copy follows the pointer meanwhile.
 */
function reparentSession(el: HTMLElement, grab: { x: number; y: number }, base: Saved | undefined) {
  let target: HTMLElement | null = null;
  let index = 0;
  let ph: HTMLElement | null = null;
  let ghost: HTMLElement | null = null;
  let frame: HTMLDivElement | null = null;
  let display = '';
  const size = el.getBoundingClientRect();
  // The dragged element itself never takes part in the glide — the copy stands for it
  const around = (...c: Array<HTMLElement | null | undefined>) => affected(...c).filter(e => e !== el);

  const clean = (node: HTMLElement) => {
    node.removeAttribute(PIXEL);
    node.querySelectorAll(`[${PIXEL}]`).forEach(n => n.removeAttribute(PIXEL));
    return node;
  };

  const makePlaceholder = () => {
    const c = clean(el.cloneNode(true) as HTMLElement);
    c.setAttribute(PLACEHOLDER, '');
    // The clone carries the lifted look — put the element's own styles back
    Object.assign(c.style, base ?? {}, { display, transform: '', transition: 'opacity 200ms ease', opacity: '0.5' });
    return c;
  };

  const makeGhost = () => {
    const g = clean(el.cloneNode(true) as HTMLElement);
    const cs = getComputedStyle(el);
    g.setAttribute('data-ilse-toolbar', '');
    // Out of its context it would lose inherited type and colour
    for (const k of ['color', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'backgroundColor', 'borderRadius'] as const) {
      g.style[k] = cs[k];
    }
    Object.assign(g.style, {
      position: 'fixed', margin: '0', boxSizing: 'border-box', display: display || cs.display,
      width: `${size.width}px`, height: `${size.height}px`, left: '0px', top: '0px',
      transform: '', transition: 'none', order: '',
      zIndex: '99990', pointerEvents: 'none', boxShadow: LIFT_SHADOW, opacity: '0.96',
    });
    document.body.appendChild(g);
    return g;
  };

  const place = (into: HTMLElement, at: number) => {
    const kids = kidsOf(into, el);
    const ref = kids[at];
    if (ref) into.insertBefore(ph!, ref);
    else if (kids.length) kids[kids.length - 1].after(ph!);
    else into.appendChild(ph!);
  };

  let raf = 0;
  const track = () => {
    if (!frame || !target) { raf = 0; return; }
    const r = target.getBoundingClientRect();
    Object.assign(frame.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    raf = requestAnimationFrame(track);
  };
  const outline = (into: HTMLElement) => {
    if (!frame) {
      frame = document.createElement('div');
      frame.setAttribute('data-ilse-toolbar', '');
      frame.style.cssText = `position:fixed;pointer-events:none;z-index:99989;border:1.5px solid ${BRAND};border-radius:8px`;
      document.body.appendChild(frame);
    }
    // The destination is itself gliding (it grows, its neighbours shift) — follow it every frame
    void into;
    if (!raf) raf = requestAnimationFrame(track);
  };

  /** Stable index: it only changes while the pointer is over an item, like the list */
  const indexFor = (into: HTMLElement, p: { x: number; y: number }, fresh: boolean) => {
    const kids = kidsOf(into, el);
    const axis = axisOf(into) ?? 'column';
    if (fresh) return insertionIndex(p, kids.map(k => k.getBoundingClientRect()), axis);
    const over = kids.findIndex(k => pointIn(p, k.getBoundingClientRect()));
    if (over < 0) return index;
    const r = kids[over].getBoundingClientRect();
    const past = axis === 'row' ? p.x > r.left + r.width / 2
      : axis === 'column' ? p.y > r.top + r.height / 2
      : p.y > r.top + r.height / 2 || p.x > r.left + r.width / 2;
    return past ? over + 1 : over;
  };

  return {
    get active() { return target !== null; },
    get target() { return target; },
    get index() { return index; },
    show(into: HTMLElement, x: number, y: number) {
      const p = { x, y };
      if (!target) {
        display = el.style.display;
        index = indexFor(into, p, true);
        ph = makePlaceholder();
        ghost = makeGhost(); // before hiding: it copies the element's computed look
        flip(around(el.parentElement, into), () => { el.style.display = 'none'; place(into, index); });
      } else if (into !== target) {
        const from = target;
        index = indexFor(into, p, true);
        flip(around(from, into), () => { ph!.remove(); place(into, index); });
      } else {
        const next = indexFor(into, p, false);
        if (next !== index) {
          index = next;
          flip(around(into), () => place(into, index));
        }
      }
      target = into;
      outline(into);
      track();
    },
    follow(x: number, y: number) {
      if (ghost) Object.assign(ghost.style, { left: `${x - grab.x}px`, top: `${y - grab.y}px` });
    },
    /** Back to the original list, animated */
    exit() {
      if (!target) return;
      const from = target;
      flip(around(el.parentElement, from), () => { ph?.remove(); el.style.display = display; });
      this.cancel();
    },
    cancel() {
      ph?.remove(); ghost?.remove(); frame?.remove();
      if (target) el.style.display = display;
      ph = ghost = frame = null;
      target = null;
    },
    /** Drop: the copy glides into the stand-in, which becomes the element on screen */
    commit(): HTMLElement {
      const stand = ph!;
      const g = ghost!;
      frame?.remove();
      const r = stand.getBoundingClientRect();
      g.style.transition = `left 260ms cubic-bezier(0.22, 1, 0.36, 1), top 260ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 260ms`;
      Object.assign(g.style, { left: `${r.left}px`, top: `${r.top}px`, boxShadow: 'none' });
      setTimeout(() => { g.remove(); stand.style.opacity = '1'; }, 260);
      // The selection follows the element to where it now shows
      const pixel = el.getAttribute(PIXEL);
      if (pixel) { el.removeAttribute(PIXEL); stand.setAttribute(PIXEL, pixel); }
      // When the real code lands (React re-renders either side), the preview steps aside
      const m: Moved = { el, ph: stand, display, observer: new MutationObserver(records => {
        if (records.some(rec => [...rec.addedNodes, ...rec.removedNodes].some(n => n !== stand))) settleMove(m);
      }) };
      for (const parent of new Set([el.parentElement, stand.parentElement])) if (parent) m.observer.observe(parent, { childList: true });
      moves.set(el, m); moves.set(stand, m);
      ph = ghost = frame = null;
      target = null;
      return stand;
    },
  };
}

/** Labels of the children around the insertion point, for "between A and B" */
function neighbours(target: HTMLElement, el: HTMLElement, index: number): { before?: string; after?: string; first?: string; count: number } {
  const kids = kidsOf(target, el);
  return { before: kids[index - 1] && itemLabel(kids[index - 1]), after: kids[index] && itemLabel(kids[index]), first: kids[0] && itemLabel(kids[0]), count: kids.length };
}

interface SavedSize { width: string; height: string; maxWidth: string; maxHeight: string; flexBasis: string; transition: string }
const resized = new Map<HTMLElement, SavedSize>();

export interface LiveResize {
  /** Grow/shrink by this much from where the drag started */
  apply(dw: number, dh: number): void;
  cancel(): void;
}

/**
 * Handles resize the real element: its width/height change in place, so the
 * layout around it reacts the way it will once the code changes.
 */
export function beginResize(el: HTMLElement): LiveResize {
  if (!resized.has(el)) {
    resized.set(el, {
      width: el.style.width, height: el.style.height, maxWidth: el.style.maxWidth,
      maxHeight: el.style.maxHeight, flexBasis: el.style.flexBasis, transition: el.style.transition,
    });
  }
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  // Resize the border box as the designer sees it, whatever box-sizing says
  const extraW = cs.boxSizing === 'border-box' ? 0 : parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  const extraH = cs.boxSizing === 'border-box' ? 0 : parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const inFlex = !!el.parentElement && getComputedStyle(el.parentElement).display.includes('flex');
  return {
    apply(dw, dh) {
      el.style.transition = 'none';
      if (dw) {
        el.style.width = `${Math.max(4, r.width + dw - extraW)}px`;
        el.style.maxWidth = 'none';
        if (inFlex) el.style.flexBasis = 'auto';
      }
      if (dh) {
        el.style.height = `${Math.max(4, r.height + dh - extraH)}px`;
        el.style.maxHeight = 'none';
      }
    },
    cancel() {
      const s = resized.get(el);
      if (s) Object.assign(el.style, s);
      resized.delete(el);
    },
  };
}

export type DragResult =
  | {
      kind: 'reorder';
      from: number;
      to: number;
      before: string[];
      after: string[];
      item: string;
      container: string;
      react: ReactView;
      listOwner?: string;
    }
  | { kind: 'offset'; dx: number; dy: number }
  | {
      kind: 'reparent';
      item: string;
      react: ReactView;
      /** Where it leaves */
      from: string;
      fromOwner?: string;
      /** Where it goes */
      into: string;
      intoLabel: string;
      intoOwner?: string;
      /** The destination element, for locating it in the source */
      target: HTMLElement;
      index: number;
      before?: string;
      after?: string;
      /** The destination is outside the element's current parent (taking it out) */
      out: boolean;
      /** What now shows the element on screen (the stand-in in the destination) */
      landed: HTMLElement;
    };

export interface LiveDrag {
  move(clientX: number, clientY: number): void;
  /** Settle the element where it was dropped and report what changed (null: nothing did) */
  end(): DragResult | null;
  /** Put everything back as it was before this drag */
  cancel(): void;
}

function reparentResult(el: HTMLElement, parent: HTMLElement | null, target: HTMLElement, index: number, landed: HTMLElement): Extract<DragResult, { kind: 'reparent' }> {
  const n = neighbours(target, el, index);
  const view = reactView(el);
  return {
    kind: 'reparent',
    item: itemLabel(el), react: view,
    from: parent ? describeContainer(parent) : 'body', fromOwner: parent ? reactView(parent).owner : undefined,
    // Named by its own first item — its text now includes the stand-in
    into: describeContainer(target), intoLabel: n.first ?? itemLabel(target), intoOwner: reactView(target).owner,
    target, index, before: n.before, after: n.after,
    out: !!parent && !parent.contains(target),
    landed,
  };
}

const LIFT_SHADOW = '0 12px 28px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.12)';
// Unhurried, with a soft landing — siblings glide rather than jump
const SETTLE = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';

export function beginDrag(picked: HTMLElement, start: { x: number; y: number }): LiveDrag {
  const el = reorderUnit(picked);
  const parent = el.parentElement;
  const axis = parent ? axisOf(parent) : null;

  // ── Free move: not in a flex/grid list — the element itself follows the pointer
  if (!parent || !axis) {
    if (!freeMoves.has(el)) freeMoves.set(el, save(el));
    const base = parseTranslate(el.style.transform);
    lift(el);
    let last = { dx: 0, dy: 0 };
    const r0 = el.getBoundingClientRect();
    const rs = reparentSession(el, { x: start.x - r0.left, y: start.y - r0.top }, freeMoves.get(el));
    return {
      move(x, y) {
        last = { dx: x - start.x, dy: y - start.y };
        // Out of its parent, or deep inside another container: it goes in there
        const into = containerAt(x, y, el);
        const outside = !!parent && !pointIn({ x, y }, parent.getBoundingClientRect());
        if (into && into !== parent && (outside || inInnerZone({ x, y }, into.getBoundingClientRect()))) {
          rs.show(into, x, y);
          rs.follow(x, y);
          return;
        }
        if (rs.active) rs.exit();
        el.style.transform = `translate(${base.x + last.dx}px, ${base.y + last.dy}px)`;
      },
      end() {
        drop(el);
        if (rs.active) {
          const target = rs.target!;
          const index = rs.index;
          el.style.transform = freeMoves.get(el)?.transform ?? '';
          return reparentResult(el, parent, target, index, rs.commit());
        }
        el.style.transform = `translate(${base.x + last.dx}px, ${base.y + last.dy}px)`;
        return Math.abs(last.dx) > 2 || Math.abs(last.dy) > 2 ? { kind: 'offset', dx: base.x + last.dx, dy: base.y + last.dy } : null;
      },
      cancel() {
        rs.cancel();
        const s = freeMoves.get(el);
        if (s) restore(el, s);
        freeMoves.delete(el);
      },
    };
  }

  // ── Reorder inside a flex/grid list
  const entry = adopt(parent);
  const snapshot = new Map(entry.original.map(c => [c, save(c)]));
  // Current visual order (a previous drag on this list may already have reordered it)
  let order = layoutChildren(parent).sort((a, b) => (Number(a.style.order) || 0) - (Number(b.style.order) || 0));
  const from = order.indexOf(el);
  const before = order.map(itemLabel);
  const applyOrder = (list: HTMLElement[]) => list.forEach((c, i) => { c.style.order = String(i); });
  applyOrder(order);

  const grab = (() => {
    const r = el.getBoundingClientRect();
    return { x: start.x - r.left, y: start.y - r.top };
  })();
  lift(el);

  // Laid-out boxes (no transforms), measured once per order state
  let natural = new Map<HTMLElement, DOMRect>();
  const measure = () => {
    const saved = order.map(c => [c, c.style.transform, c.style.transition] as const);
    for (const c of order) { c.style.transition = 'none'; c.style.transform = ''; }
    natural = new Map(order.map(c => [c, c.getBoundingClientRect()]));
    for (const [c, t, tr] of saved) { c.style.transform = t; c.style.transition = tr; }
  };
  measure();
  let index = from;
  const initial = [...order];
  const rs = reparentSession(el, grab, snapshot.get(el));

  // FLIP the siblings: remember where they were, reorder, animate from there
  const reflow = (next: HTMLElement[], nextIndex: number) => {
    const others = order.filter(c => c !== el);
    const first = new Map(others.map(c => [c, c.getBoundingClientRect()]));
    order = next;
    index = nextIndex;
    applyOrder(order);
    measure();
    for (const c of others) {
      const a = first.get(c)!;
      const b = natural.get(c)!;
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (!dx && !dy) continue;
      c.style.transition = 'none';
      c.style.transform = `translate(${dx}px, ${dy}px)`;
      void c.offsetWidth; // commit the inverted position before animating
      c.style.transition = SETTLE;
      c.style.transform = '';
    }
  };

  const follow = (x: number, y: number) => {
    const n = natural.get(el)!;
    el.style.transform = `translate(${x - grab.x - n.left}px, ${y - grab.y - n.top}px)`;
  };

  return {
    move(x, y) {
      const p = { x, y };
      const others = order.filter(c => c !== el);
      // Into a sibling (the middle of it) or out of the list (past its edges)
      let into: HTMLElement | null = null;
      if (!pointIn(p, parent.getBoundingClientRect())) into = containerAt(x, y, el);
      else {
        const over = others.find(c => pointIn(p, natural.get(c)!));
        if (over && isContainer(over) && inInnerZone(p, natural.get(over)!)) into = containerAt(x, y, el, over) ?? over;
      }
      if (into) {
        if (index !== from) reflow([...initial], from); // the list goes back as it was
        rs.show(into, x, y);
        rs.follow(x, y);
        return;
      }
      if (rs.active) { rs.exit(); measure(); }
      const to = targetIndex(p, others.map(c => natural.get(c)!), index);
      if (to !== index) reflow(moveItem(order, index, to), to);
      follow(x, y);
    },
    end() {
      drop(el);
      if (rs.active) {
        const target = rs.target!;
        const at = rs.index;
        // The list keeps its order, minus the element; it waits (hidden) in its slot
        for (const [c, s] of snapshot) c.style.order = s.order;
        el.style.transform = '';
        return reparentResult(el, parent, target, at, rs.commit());
      }
      // Glide into the slot
      el.style.transition = SETTLE;
      el.style.transform = '';
      if (index === from) {
        if (lists.get(parent) === entry && [...snapshot].every(([c, s]) => c.style.order === s.order)) settle(parent);
        return null;
      }
      const view = reactView(el);
      return {
        kind: 'reorder',
        from, to: index,
        before, after: order.map(itemLabel),
        item: itemLabel(el),
        container: describeContainer(parent),
        react: view,
        // Keyed items: their owner is where the list is written. Otherwise the list's own owner.
        listOwner: view.key ? view.owner : reactView(parent).owner,
      };
    },
    cancel() {
      rs.cancel();
      for (const [c, s] of snapshot) if (c.isConnected) restore(c, s);
      if ([...snapshot].every(([c]) => entry.saved.get(c)?.order === c.style.order)) settle(parent);
    },
  };
}

const pointIn = (p: { x: number; y: number }, r: Slot & { right?: number; bottom?: number }) =>
  p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height;

function lift(el: HTMLElement) {
  el.style.transition = 'none';
  // z-index needs a positioned box; `relative` doesn't move a static one
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.style.zIndex = '99990';
  el.style.boxShadow = LIFT_SHADOW;
  el.style.pointerEvents = 'none';
  el.style.willChange = 'transform';
}

function drop(el: HTMLElement) {
  const s = lists.get(el.parentElement!)?.saved.get(el) ?? freeMoves.get(el);
  el.style.boxShadow = s?.boxShadow ?? '';
  el.style.pointerEvents = s?.pointerEvents ?? '';
  el.style.willChange = s?.willChange ?? '';
  // zIndex/position stay lifted until the glide ends, then go back
  setTimeout(() => {
    el.style.zIndex = s?.zIndex ?? '';
    el.style.position = s?.position ?? '';
  }, 180);
}

function parseTranslate(t: string): { x: number; y: number } {
  const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(t);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
}

// ── What the agent reads ───────────────────────────────────────────────────

export function formatReparent(r: Extract<DragResult, { kind: 'reparent' }>, targetHint?: string): string {
  const where = r.before && r.after ? `entre "${r.before}" e "${r.after}"`
    : r.after ? `no início, antes de "${r.after}"`
    : r.before ? `no fim, depois de "${r.before}"`
    : 'como único filho';
  const lines = [
    `${r.out ? 'Tirar elemento do container atual e colocar em outro' : 'Mover elemento para dentro de outro container'} (já pré-visualizado na tela pelo designer):`,
    `- Elemento: "${r.item}"${r.react.key ? ` (key "${r.react.key}")` : ''}${r.react.owner ? ` no componente <${r.react.owner}>` : ''}`,
    `- Sai de: ${r.from}${r.fromOwner ? ` no componente <${r.fromOwner}>` : ''}`,
    `- Entra em: ${r.into} — o bloco que começa com "${r.intoLabel}"${r.intoOwner ? ` no componente <${r.intoOwner}>` : ''}${targetHint ? ` (localizar por: ${targetHint})` : ''}`,
    `- Posição: ${where}`,
    'Mova o JSX do elemento na fonte: recorte de onde está e coloque dentro do container de destino, na posição indicada. Se origem e destino estão em componentes diferentes, leve o conteúdo pelo caminho que o código já usa (props/children) em vez de duplicar. Não use CSS (position, order, margin, transform) para simular.',
  ];
  return lines.join('\n');
}

export function formatReorder(r: Extract<DragResult, { kind: 'reorder' }>): string {
  const owner = r.listOwner ?? r.react.owner;
  const lines = [
    'Reordenar itens (já pré-visualizado na tela pelo designer):',
    `- Lista: ${r.container}${owner ? ` no componente <${owner}>` : ''}`,
    `- Item movido: "${r.item}"${r.react.key ? ` (key "${r.react.key}")` : ''} — da posição ${r.from + 1} para a ${r.to + 1}`,
    `- Ordem atual: ${r.before.map((l, i) => `${i + 1}. ${l}`).join(' · ')}`,
    `- Nova ordem: ${r.after.map((l, i) => `${i + 1}. ${l}`).join(' · ')}`,
    'Mude a ordem na fonte — a ordem dos elementos na JSX, ou do array que gera a lista. Não use CSS `order`, margens nem posicionamento para simular.',
  ];
  return lines.join('\n');
}
