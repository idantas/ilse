/**
 * Markers inside scrolling boxes.
 *
 * A marker is placed from the page coordinates of what was selected, which
 * only follow the window's scroll. Inside a list, a side panel or an app
 * shell's `<main>` that scrolls on its own, the element moves and the marker
 * would stay over whatever scrolled under it. So a capture also records the
 * boxes that scroll around the element and how far they were scrolled; the
 * marker moves by how much they have scrolled since, and hides when the
 * element is scrolled out of a box.
 */

export interface ScrollerMark {
  /** Element path from <body> by child index — survives a reload, unlike a reference */
  path: string;
  top: number;
  left: number;
}

export interface ScrollerNow {
  scrollTop: number;
  scrollLeft: number;
  /** The box's visible area, viewport coordinates */
  rect: { top: number; left: number; bottom: number; right: number };
}

export interface ScrollShift {
  dx: number;
  dy: number;
  /** Visible area shared by every box, viewport coordinates; null when nothing clips */
  clip: { top: number; left: number; bottom: number; right: number } | null;
}

const NONE: ScrollShift = { dx: 0, dy: 0, clip: null };

/** How far the boxes have scrolled since the capture, and what they still show */
export function scrollShift(marks: ScrollerMark[] | undefined, now: (path: string) => ScrollerNow | null): ScrollShift {
  if (!marks?.length) return NONE;
  let dx = 0, dy = 0;
  let clip: ScrollShift['clip'] = null;
  for (const m of marks) {
    const s = now(m.path);
    if (!s) continue; // the box is gone (another page, a re-render): leave it out
    dx += m.left - s.scrollLeft;
    dy += m.top - s.scrollTop;
    clip = clip
      ? { top: Math.max(clip.top, s.rect.top), left: Math.max(clip.left, s.rect.left), bottom: Math.min(clip.bottom, s.rect.bottom), right: Math.min(clip.right, s.rect.right) }
      : { ...s.rect };
  }
  return { dx, dy, clip };
}

/** Is a viewport point inside what the boxes still show? */
export function visibleIn(clip: ScrollShift['clip'], x: number, y: number): boolean {
  return !clip || (x >= clip.left && x <= clip.right && y >= clip.top && y <= clip.bottom);
}

// ── DOM ─────────────────────────────────────────────────────────────────────

function scrolls(el: Element): boolean {
  const s = getComputedStyle(el);
  const y = /(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight;
  const x = /(auto|scroll|overlay)/.test(s.overflowX) && el.scrollWidth > el.clientWidth;
  return x || y;
}

export function elementPath(el: Element): string {
  const parts: number[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && cur.parentElement) {
    parts.unshift(Array.prototype.indexOf.call(cur.parentElement.children, cur));
    cur = cur.parentElement;
  }
  return parts.join('/');
}

function byPath(path: string): Element | null {
  let cur: Element | null = document.body;
  for (const i of path ? path.split('/') : []) {
    cur = cur?.children[+i] ?? null;
    if (!cur) return null;
  }
  return cur;
}

/** The boxes that scroll around `el`, innermost first (the window's own scroll is not one) */
export function recordScrollers(el: Element | null | undefined): ScrollerMark[] | undefined {
  const marks: ScrollerMark[] = [];
  for (let cur = el?.parentElement ?? null; cur && cur !== document.body && cur !== document.documentElement; cur = cur.parentElement) {
    if (scrolls(cur)) marks.push({ path: elementPath(cur), top: cur.scrollTop, left: cur.scrollLeft });
  }
  return marks.length ? marks : undefined;
}

export function scrollerNow(path: string): ScrollerNow | null {
  const el = byPath(path);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, rect: { top: r.top, left: r.left, bottom: r.top + el.clientHeight, right: r.left + el.clientWidth } };
}
