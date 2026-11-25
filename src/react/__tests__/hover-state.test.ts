import { describe, it, expect } from 'vitest';
import { forced, jsHover, resolveNested, splitList } from '../hover-state.js';

describe('held hover: CSS', () => {
  it('turns :hover into the attribute Ilse sets, and nothing that only looks like it', () => {
    expect(forced('.hover\\:bg-accent:hover')).toBe('.hover\\:bg-accent[data-ilse-hover]');
    expect(forced('.group:hover .x, a:hover')).toBe('.group[data-ilse-hover] .x, a[data-ilse-hover]');
    expect(forced('.a:hover-ish')).toBe('.a:hover-ish');
  });

  it('resolves nested rules (Tailwind v4 writes `&:hover` inside the class)', () => {
    expect(resolveNested(undefined, '.a')).toBe('.a');
    expect(resolveNested('.hover\\:bg-x', '&:hover')).toBe(':is(.hover\\:bg-x):hover');
    expect(resolveNested('.a', '.b, .c')).toBe(':is(.a) .b, :is(.a) .c');
  });

  it('splits a selector list without breaking :is(…) or attributes', () => {
    expect(splitList(':is(.a, .b):hover, [data-x="1,2"] .c')).toEqual([':is(.a, .b):hover', '[data-x="1,2"] .c']);
  });
});

describe('held hover: handlers', () => {
  const el = (props: Record<string, unknown> | null, parent: unknown = null) =>
    ({ parentElement: parent, ...(props ? { '__reactProps$abc': props } : {}) }) as unknown as Element;

  it('a tooltip trigger (Radix opens on pointer move) has a hover', () => {
    expect(jsHover(el({ onPointerMove: () => {}, onPointerLeave: () => {} }))).toBe(true);
  });

  it('an enter handler just above counts; a move handler above (a drag area) does not', () => {
    expect(jsHover(el({}, el({ onMouseEnter: () => {} })))).toBe(true);
    expect(jsHover(el({}, el({ onPointerMove: () => {} })))).toBe(false);
    expect(jsHover(el({ onClick: () => {} }))).toBe(false);
  });
});
