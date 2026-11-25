/**
 * Scrubbing: drag sideways on a value to change it, like Figma's number fields. A press
 * that doesn't move is still a click (opens the list, focuses the input).
 *
 * On a scale (spacing, radius, the project's tokens) a drag walks the scale one step at a
 * time, so it never lands off the design system. On a free number (X, Y, letter spacing,
 * a fixed width) it moves the number itself, keeping its unit.
 */

import { uiDocument, uiWindow } from './screens.js';

/** Movement before a press becomes a drag: a shaky click stays a click */
export const SCRUB_THRESHOLD = 3;
/** Pixels of drag per step of a scale: a scale has few steps, each should be easy to hit */
export const PX_PER_STEP = 12;
/** Pixels of drag per unit of a free number */
export const PX_PER_UNIT = 2;

/** Steps a horizontal drag of `dx` px covers, rounded toward zero */
export function stepsFor(dx: number, pxPerStep: number): number {
  const s = dx / pxPerStep;
  return s < 0 ? Math.ceil(s) : Math.floor(s);
}

const NUMBER = /^(-?\d*\.?\d+)([a-z%]*)$/i;

/** A number with an optional unit ("12px", "-0.5em", "1.5"), or null for anything else */
export function parseNumber(value: string): { n: number; unit: string; decimals: number } | null {
  const m = NUMBER.exec(value.trim());
  if (!m) return null;
  const decimals = m[1].includes('.') ? m[1].split('.')[1].length : 0;
  return { n: parseFloat(m[1]), unit: m[2], decimals };
}

/**
 * `value` moved by `units` (1 per PX_PER_UNIT of drag). Shift moves 10 at a time, Alt a tenth;
 * em / rem / unitless values move by tenths, since a whole em is a big jump.
 */
export function nudge(value: string, units: number, mods: { shift?: boolean; alt?: boolean } = {}): string | null {
  const p = parseNumber(value);
  if (!p) return null;
  const fine = p.unit === 'em' || p.unit === 'rem' || (p.unit === '' && (p.decimals > 0 || Math.abs(p.n) < 4));
  let step = fine ? 0.1 : 1;
  if (mods.shift) step *= 10;
  if (mods.alt) step /= 10;
  const decimals = Math.max(p.decimals, step < 1 ? Math.round(-Math.log10(step)) : 0);
  const n = Number((p.n + units * step).toFixed(decimals));
  return `${n}${p.unit}`;
}

/** Where a drag starts on a scale: the current value, else the nearest step by size */
export function startIndex(options: string[], current: string | undefined, shown: string): number {
  const exact = current === undefined ? -1 : options.indexOf(current);
  if (exact >= 0) return exact;
  const at = parseNumber(shown)?.n;
  if (at === undefined) return -1;
  let best = -1, gap = Infinity;
  options.forEach((o, i) => {
    const n = parseNumber(o)?.n;
    if (n !== undefined && Math.abs(n - at) < gap) { gap = Math.abs(n - at); best = i; }
  });
  return best;
}

/** A scale with an order to walk (sizes, weights, shadows), not names like `static` / `relative` */
export function isOrdered(options: string[]): boolean {
  return options.length > 1 && !options.every(o => /^[a-z-]+$/i.test(o));
}

/**
 * Starts tracking a press. `onDrag(dx, event)` runs for every move once past the threshold;
 * `onTap()` runs if the press ends without dragging. Listens on the window, so the element
 * re-rendering (its value changes while dragging) doesn't end the drag.
 */
export function startScrub(e: React.PointerEvent, onDrag: (dx: number, ev: PointerEvent) => void, onTap: () => void): void {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  let dragging = false;
  const win = uiWindow();
  const body = uiDocument().body;
  const prevCursor = body.style.cursor;
  const prevSelect = body.style.userSelect;
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    if (!dragging && Math.abs(dx) < SCRUB_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      body.style.cursor = 'ew-resize';
      body.style.userSelect = 'none';
    }
    ev.preventDefault();
    onDrag(dx, ev);
  };
  const up = () => {
    win.removeEventListener('pointermove', move, true);
    win.removeEventListener('pointerup', up, true);
    win.removeEventListener('pointercancel', up, true);
    if (dragging) {
      body.style.cursor = prevCursor;
      body.style.userSelect = prevSelect;
      // The click that follows a drag isn't a click on the control
      const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      win.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => win.removeEventListener('click', swallow, true), 0);
    } else onTap();
  };
  win.addEventListener('pointermove', move, true);
  win.addEventListener('pointerup', up, true);
  win.addEventListener('pointercancel', up, true);
}

/**
 * Press handler for a free number input: dragging moves the number (live, through `apply`);
 * a plain click focuses it for typing. While it has focus, a drag selects text as usual.
 */
export function scrubInput(apply: (value: string) => void) {
  return (e: React.PointerEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (uiDocument().activeElement === input || !parseNumber(input.value)) return;
    const start = input.value;
    // No focus on press: the field takes focus only if this turns out to be a click
    e.preventDefault();
    let last = start;
    startScrub(e, (dx, ev) => {
      const next = nudge(start, stepsFor(dx, PX_PER_UNIT), { shift: ev.shiftKey, alt: ev.altKey });
      if (!next || next === last) return;
      last = next;
      input.value = next;
      apply(next);
    }, () => { input.focus(); input.select(); });
  };
}
