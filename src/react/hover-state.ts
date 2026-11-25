/**
 * Keeping an element hovered, so what its hover shows can be selected.
 *
 * A sidebar item that opens a card on hover: with Ilse the card opened as the
 * pointer went over it, and closed the moment the item was selected (the pointer
 * left for the panel). "Hover" in the panel holds the element in its hover state:
 * - its `:hover` CSS, copied with `:hover` turned into an attribute Ilse sets on
 *   the element and its ancestors (the ones a real pointer would hover too);
 * - its hover handlers (a tooltip, a hover card): the pointer's arrival is sent
 *   to it, and its leaving is kept from the page until hover is turned off.
 * The pointer can then go to the card and select it. Lives on `window`, so it
 * outlives the panel (selecting the card closes the item's panel) and HMR.
 */

const ATTR = 'data-ilse-hover';
const HOVER = /:hover(?![\w-])/g;
const hasHover = (s: string) => /:hover(?![\w-])/.test(s);

/** What a nested rule's selector means at the top level (`&:hover` under `.a` → `:is(.a):hover`) */
export function resolveNested(parent: string | undefined, selector: string): string {
  if (!parent) return selector;
  if (selector.includes('&')) return selector.replace(/&/g, `:is(${parent})`);
  return splitList(selector).map(s => `:is(${parent}) ${s}`).join(', ');
}

/** A selector list's parts, commas inside `:is(…)`/`[…]` left alone */
export function splitList(selector: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(selector.slice(from, i).trim()); from = i + 1; }
  }
  out.push(selector.slice(from).trim());
  return out.filter(Boolean);
}

/** The selector with the hover held by Ilse's attribute instead of the pointer */
export const forced = (selector: string) => selector.replace(HOVER, `[${ATTR}]`);

export interface HoverRule { selector: string; css: string; layer?: string }

/** Every `:hover` rule of the page's CSS that applies now (media, supports), nesting resolved */
export function hoverRules(doc: Document = document): HoverRule[] {
  const out: HoverRule[] = [];
  const win = doc.defaultView ?? window;
  const walk = (list: CSSRuleList, ctx: string | undefined, layer: string | undefined) => {
    for (const r of Array.from(list)) {
      const rule = r as CSSRule & { selectorText?: string; style?: CSSStyleDeclaration; cssRules?: CSSRuleList; conditionText?: string; name?: string; media?: MediaList };
      if (typeof rule.selectorText === 'string') {
        const selector = resolveNested(ctx, rule.selectorText);
        if (hasHover(selector) && rule.style && rule.style.length > 0) out.push({ selector, css: rule.style.cssText, layer });
        if (rule.cssRules?.length) walk(rule.cssRules, selector, layer);
      } else if (rule.style && !rule.cssRules) {
        // Declarations nested in a rule after other rules (CSSNestedDeclarations): the parent's selector
        if (ctx && hasHover(ctx) && rule.style.length > 0) out.push({ selector: ctx, css: rule.style.cssText, layer });
      } else if (rule.cssRules) {
        const kind = rule.constructor?.name ?? '';
        if (kind === 'CSSMediaRule' && !win.matchMedia(rule.conditionText ?? rule.media?.mediaText ?? 'all').matches) continue;
        if (kind === 'CSSSupportsRule' && !(win.CSS?.supports?.(rule.conditionText ?? '') ?? true)) continue;
        const inner = kind === 'CSSLayerBlockRule' && rule.name ? (layer ? `${layer}.${rule.name}` : rule.name) : layer;
        walk(rule.cssRules, ctx, inner);
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    const owner = sheet.ownerNode as Element | null;
    if (owner?.closest?.('[data-ilse-toolbar]') || owner?.hasAttribute?.('data-ilse-hover-style')) continue;
    try { walk(sheet.cssRules, undefined, undefined); } catch { /* another origin's sheet */ }
  }
  return out;
}

const safeMatches = (el: Element, selector: string) => { try { return el.matches(selector) || !!el.querySelector(selector); } catch { return false; } };

/** A rule its hover changes: it applies to the element (or inside it) only while the element is hovered */
function cssHover(el: Element, rules: HoverRule[]): boolean {
  const had = el.hasAttribute(ATTR);
  try {
    el.removeAttribute(ATTR);
    const before = rules.map(r => safeMatches(el, forced(r.selector)));
    el.setAttribute(ATTR, '');
    return rules.some((r, i) => !before[i] && safeMatches(el, forced(r.selector)));
  } finally {
    if (!had) el.removeAttribute(ATTR);
  }
}

const ENTER = ['onMouseEnter', 'onMouseOver', 'onPointerEnter', 'onPointerOver'];
const MOVE = ['onPointerMove', 'onMouseMove'];

function reactProps(el: Element): Record<string, unknown> | undefined {
  const key = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  return key ? (el as unknown as Record<string, Record<string, unknown>>)[key] : undefined;
}

/** Hover handlers in React's props: on the element (move too: Radix's tooltip opens on it), or just above it */
export function jsHover(el: Element): boolean {
  let node: Element | null = el;
  for (let i = 0; node && i < 3; node = node.parentElement, i++) {
    const props = reactProps(node);
    if (!props) continue;
    const names = i === 0 ? [...ENTER, ...MOVE] : ENTER;
    if (names.some(n => typeof props[n] === 'function')) return true;
  }
  return false;
}

/** Whether hovering the element changes something: its CSS, or what its handlers open */
export function hasHoverEffect(el: Element | null): boolean {
  if (!el) return false;
  return jsHover(el) || cssHover(el, hoverRules(el.ownerDocument));
}

// ── The held hover ─────────────────────────────────────────────────────────

interface Held { el: HTMLElement; marked: Element[]; style: HTMLStyleElement; block: (e: Event) => void; label: string }

declare global {
  interface Window {
    __ilseHover?: Held | null;
    __ilseHoverListeners?: Set<() => void>;
  }
}

const listeners = () => (window.__ilseHoverListeners ??= new Set());
const notify = () => listeners().forEach(fn => fn());

export function onHoverChange(fn: () => void): () => void {
  listeners().add(fn);
  return () => { listeners().delete(fn); };
}

/** The element held hovered, if any (and still on the page) */
export function heldHover(): { el: HTMLElement; label: string } | null {
  const h = typeof window !== 'undefined' ? window.__ilseHover : null;
  if (!h) return null;
  if (!h.el.isConnected) { stopHover(); return null; }
  return { el: h.el, label: h.label };
}

const inIlse = (t: EventTarget | null) => t instanceof Element && !!t.closest('[data-ilse-toolbar]');

function send(el: HTMLElement, types: string[], related: EventTarget | null) {
  const r = el.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, relatedTarget: related, view: el.ownerDocument.defaultView };
  const win = el.ownerDocument.defaultView ?? window;
  for (const type of types) {
    const bubbles = !/enter|leave/.test(type);
    const ev = type.startsWith('pointer') && typeof win.PointerEvent === 'function'
      ? new win.PointerEvent(type, { ...init, bubbles, pointerType: 'mouse', pointerId: 1, isPrimary: true })
      : new win.MouseEvent(type, { ...init, bubbles });
    el.dispatchEvent(ev);
  }
}

export function startHover(el: HTMLElement, label: string): void {
  stopHover();
  const doc = el.ownerDocument;
  const style = doc.createElement('style');
  style.setAttribute('data-ilse-hover-style', '');
  // In the rule's own layer, so it wins and loses where the real hover would
  style.textContent = hoverRules(doc)
    .map(r => { const rule = `${forced(r.selector)} { ${r.css} }`; return r.layer ? `@layer ${r.layer} { ${rule} }` : rule; })
    .join('\n');
  doc.head.appendChild(style);
  const marked: Element[] = [];
  for (let n: Element | null = el; n && n !== doc.documentElement; n = n.parentElement) { n.setAttribute(ATTR, ''); marked.push(n); }
  // The pointer leaving (for the panel, for the card) doesn't reach the page; nor does it
  // arriving on another element, whose own hover would close this one. Stopped on the
  // document: Ilse's listeners there still run, the page's (React's root, the elements') don't.
  const block = (e: Event) => {
    if (inIlse(e.target)) return;
    if ((e.type === 'pointermove' || e.type === 'mousemove') && (e as MouseEvent).buttons !== 0) return;
    e.stopPropagation();
  };
  for (const type of BLOCKED) doc.addEventListener(type, block, true);
  window.__ilseHover = { el, marked, style, block, label };
  send(el, ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'], null);
  notify();
}

const BLOCKED = ['pointerover', 'pointerenter', 'pointerout', 'pointerleave', 'mouseover', 'mouseenter', 'mouseout', 'mouseleave', 'pointermove', 'mousemove'];

export function stopHover(): void {
  const h = typeof window !== 'undefined' ? window.__ilseHover : null;
  if (!h) return;
  window.__ilseHover = null;
  const doc = h.el.ownerDocument;
  for (const type of BLOCKED) doc.removeEventListener(type, h.block, true);
  h.style.remove();
  for (const n of h.marked) n.removeAttribute(ATTR);
  if (h.el.isConnected) send(h.el, ['pointerout', 'pointerleave', 'mouseout', 'mouseleave'], doc.body);
  notify();
}
