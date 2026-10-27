/**
 * Above the toolbar there is one column of space, and many things want it: the
 * agent's reasoning lines, a bubble with actions ("Redo on this page", page
 * errors, reload), and the panels (settings, journeys, run list, scan, chat).
 * Each overlay that opens there is marked `data-ilse-above`; the reasoning
 * lines rise over the highest one instead of being covered by it.
 */
import { useEffect, useState, type RefObject } from 'react';

export const ABOVE = 'data-ilse-above';

/** How far above its anchor the reasoning must sit: past the highest overlay over the anchor, else its own gap */
export function liftOver(anchorTop: number, overlays: Array<{ top: number; bottom: number; height: number }>, gap: number, spacing = 8): number {
  const over = overlays.filter(r => r.height > 0 && r.bottom <= anchorTop + 4);
  if (!over.length) return gap;
  const highest = Math.min(...over.map(r => r.top));
  return Math.max(gap, anchorTop - highest + spacing);
}

/** The bottom offset (px) for lines anchored above `anchor`'s containing block; checked while `active` */
export function useLift(feed: RefObject<HTMLElement | null>, active: boolean, gap: number): number {
  const [lift, setLift] = useState(gap);
  useEffect(() => {
    if (!active) { setLift(gap); return; }
    const measure = () => {
      const box = (feed.current?.offsetParent as HTMLElement | null)?.getBoundingClientRect();
      if (!box) return;
      const rects = [...document.querySelectorAll(`[${ABOVE}]`)].map(el => el.getBoundingClientRect());
      const next = liftOver(box.top, rects, gap);
      setLift(prev => (Math.abs(prev - next) < 1 ? prev : next));
    };
    measure();
    // Bubbles and panels open, grow and close without the toolbar knowing: look again a few times a second
    const timer = setInterval(measure, 200);
    return () => clearInterval(timer);
  }, [active, gap, feed]);
  return lift;
}
