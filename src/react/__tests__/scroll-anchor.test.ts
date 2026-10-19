import { describe, expect, it } from 'vitest';
import { scrollShift, visibleIn, type ScrollerNow } from '../scroll-anchor.js';

const box = (scrollTop: number, rect = { top: 100, left: 0, bottom: 260, right: 300 }, scrollLeft = 0): ScrollerNow => ({ scrollTop, scrollLeft, rect });

describe('scrollShift', () => {
  it('moves by how far the box scrolled since the capture', () => {
    const s = scrollShift([{ path: '0/1', top: 0, left: 0 }], () => box(100));
    expect(s.dy).toBe(-100);
    expect(s.dx).toBe(0);
  });

  it('adds nested boxes and keeps only the area all of them show', () => {
    const now: Record<string, ScrollerNow> = {
      inner: box(30, { top: 120, left: 10, bottom: 200, right: 400 }),
      outer: box(50, { top: 100, left: 0, bottom: 300, right: 250 }),
    };
    const s = scrollShift([{ path: 'inner', top: 10, left: 0 }, { path: 'outer', top: 0, left: 0 }], p => now[p]);
    expect(s.dy).toBe(-70);
    expect(s.clip).toEqual({ top: 120, left: 10, bottom: 200, right: 250 });
  });

  it('ignores a box that is gone and does nothing without boxes', () => {
    expect(scrollShift([{ path: 'x', top: 40, left: 0 }], () => null)).toEqual({ dx: 0, dy: 0, clip: null });
    expect(scrollShift(undefined, () => box(5))).toEqual({ dx: 0, dy: 0, clip: null });
  });
});

describe('visibleIn', () => {
  it('hides a point scrolled out of the box', () => {
    const clip = { top: 100, left: 0, bottom: 260, right: 300 };
    expect(visibleIn(clip, 20, 150)).toBe(true);
    expect(visibleIn(clip, 20, 90)).toBe(false);
    expect(visibleIn(null, 20, -500)).toBe(true);
  });
});
