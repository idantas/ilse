/**
 * Dragging a catalog component onto the page: where it would land, and the
 * draft copy that stands there until the change is applied.
 *
 * The draft is the component's copy (HTML with its styles inline) put in the
 * page next to its anchor, outlined. React never knows about it: it is not one
 * of React's nodes, so nothing React renders is moved or replaced. When the
 * code change lands, the real component appears and the draft goes away.
 */

export type Placement = 'before' | 'after' | 'inside';

export interface DropTarget {
  anchor: HTMLElement;
  placement: Placement;
  /** Where to draw the indicator (viewport coordinates) */
  line: { left: number; top: number; width: number; height: number };
}

/** Elements that hold content, not other blocks: a drop lands next to them, never inside */
const LEAF = /^(BUTTON|A|INPUT|TEXTAREA|SELECT|P|H[1-6]|SPAN|LABEL|IMG|SVG|PATH|STRONG|EM|B|I|SMALL|CODE|LI|TD|TH)$/;

/** The element under (x, y) that a drop is relative to: blocks, not the text inside them */
export function elementAt(x: number, y: number): HTMLElement | null {
  let el = document.elementsFromPoint(x, y).find((e): e is HTMLElement =>
    e instanceof HTMLElement && !e.closest('[data-ilse-toolbar]') && !e.closest('[data-ilse-draft]')
    && e !== document.body && e !== document.documentElement) ?? null;
  if (!el) return null;
  // Text inside a button is the button; inline pieces are their block
  while (el.parentElement && el.parentElement !== document.body && getComputedStyle(el).display === 'inline') el = el.parentElement;
  while (el.parentElement && el.parentElement !== document.body && LEAF.test(el.parentElement.tagName)) el = el.parentElement;
  return el;
}

/** Before, after or inside `el`, from where the pointer is over it */
export function placeAt(el: HTMLElement, x: number, y: number, allowInside = true): DropTarget {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const container = allowInside && !LEAF.test(el.tagName) && el.children.length > 0 && /^(flex|grid|block|inline-flex|inline-grid|flow-root)$/.test(cs.display) && r.height >= 40;
  // The middle of a container: inside, at the end
  const inner = container && y > r.top + r.height * 0.3 && y < r.bottom - r.height * 0.3 && x > r.left + r.width * 0.15 && x < r.right - r.width * 0.15;
  if (inner) {
    const last = el.lastElementChild?.getBoundingClientRect();
    const row = /flex/.test(cs.display) && cs.flexDirection.startsWith('row');
    const line = row && last
      ? { left: last.right + 2, top: last.top, width: 2, height: last.height }
      : { left: r.left + 6, top: (last ? last.bottom : r.bottom - 8) + 2, width: r.width - 12, height: 2 };
    return { anchor: el, placement: 'inside', line };
  }
  const parent = el.parentElement;
  const pcs = parent ? getComputedStyle(parent) : null;
  const row = !!pcs && /flex/.test(pcs.display) && pcs.flexDirection.startsWith('row');
  const before = row ? x < r.left + r.width / 2 : y < r.top + r.height / 2;
  const line = row
    ? { left: before ? r.left - 3 : r.right + 1, top: r.top, width: 2, height: r.height }
    : { left: r.left, top: before ? r.top - 3 : r.bottom + 1, width: r.width, height: 2 };
  return { anchor: el, placement: before ? 'before' : 'after', line };
}

/** What a drop at (x, y) means: before or after the element there, or inside a container */
export function dropTarget(x: number, y: number): DropTarget | null {
  const el = elementAt(x, y);
  return el ? placeAt(el, x, y) : null;
}

/** The draft element from a copy's HTML, marked so Ilse can find it and the page can't confuse it */
export function makeDraft(html: string, id: string): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  const el = (tpl.content.firstElementChild as HTMLElement | null) ?? document.createElement('div');
  el.setAttribute('data-ilse-draft', id);
  el.style.outline = '1.5px dashed #FF6C03';
  el.style.outlineOffset = '2px';
  return el;
}

/** A stand-in for a component with no copy yet: its name in a dashed box */
export function placeholderHtml(name: string): string {
  return `<div style="display:inline-flex;align-items:center;justify-content:center;min-width:96px;height:36px;padding:0 12px;box-sizing:border-box;border:1px dashed #a3a3a3;border-radius:8px;font:500 12px system-ui,sans-serif;color:#525252;background:#fafafa">${name.replace(/[<>&"]/g, '')}</div>`;
}

export function placeDraft(draft: HTMLElement, anchor: Element, placement: Placement): void {
  if (placement === 'inside') anchor.appendChild(draft);
  else if (placement === 'before') anchor.parentNode?.insertBefore(draft, anchor);
  else anchor.parentNode?.insertBefore(draft, anchor.nextSibling);
}

/** Swap the draft's look for another copy (a variant picked in the panel), keeping its place and mark */
export function restyleDraft(id: string, html: string): HTMLElement | null {
  const old = document.querySelector<HTMLElement>(`[data-ilse-draft="${id}"]`);
  if (!old) return null;
  const next = makeDraft(html, id);
  for (const a of ['data-ilse-pixel-target']) { const v = old.getAttribute(a); if (v) next.setAttribute(a, v); }
  old.replaceWith(next);
  return next;
}

export function removeDraft(id: string): void {
  document.querySelectorAll(`[data-ilse-draft="${id}"]`).forEach(el => el.remove());
}

/** `<Button variant="contained">Salvar</Button>` — what the card and the agent read */
export function jsxPreview(name: string, props: Record<string, string | number | boolean>, text?: string): string {
  const attrs = Object.entries(props).map(([k, v]) => v === true ? ` ${k}` : typeof v === 'string' ? ` ${k}="${v}"` : ` ${k}={${String(v)}}`).join('');
  return text?.trim() ? `<${name}${attrs}>${text.trim()}</${name}>` : `<${name}${attrs} />`;
}

/**
 * A variant picked for a component already on the page, shown before it's
 * applied: the copy of that variant stands in its place and the real element
 * is hidden — the way the panel previews any edit. `html` null puts the real
 * one back. The copy's text becomes this instance's (a copy may come from a
 * sibling with other words).
 */
export function previewVariant(el: HTMLElement, key: string, html: string | null, texts?: { from?: string; to?: string }): void {
  document.querySelectorAll(`[data-ilse-variant-for="${key}"]`).forEach(n => n.remove());
  if (!html) {
    if (el.dataset.ilseHiddenFor === key) { el.style.display = el.dataset.ilsePrevDisplay ?? ''; delete el.dataset.ilseHiddenFor; delete el.dataset.ilsePrevDisplay; }
    return;
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  const copy = tpl.content.firstElementChild as HTMLElement | null;
  if (!copy) return;
  copy.setAttribute('data-ilse-variant-for', key);
  copy.style.pointerEvents = 'none';
  if (texts?.from && texts.to && texts.from !== texts.to) {
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue?.includes(texts.from)) n.nodeValue = n.nodeValue.replace(texts.from, texts.to);
  }
  if (el.dataset.ilseHiddenFor !== key) { el.dataset.ilsePrevDisplay = el.style.display; el.dataset.ilseHiddenFor = key; }
  el.style.display = 'none';
  el.parentNode?.insertBefore(copy, el.nextSibling);
}
