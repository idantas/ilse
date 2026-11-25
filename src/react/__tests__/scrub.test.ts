import { describe, expect, it } from 'vitest';
import { isOrdered, nudge, parseNumber, startIndex, stepsFor } from '../scrub.js';

describe('stepsFor', () => {
  it('counts whole steps either way, toward zero', () => {
    expect(stepsFor(11, 12)).toBe(0);
    expect(stepsFor(25, 12)).toBe(2);
    expect(stepsFor(-13, 12)).toBe(-1);
  });
});

describe('nudge', () => {
  it('moves a px value by whole pixels and keeps the unit', () => {
    expect(nudge('12px', 3)).toBe('15px');
    expect(nudge('12px', -20)).toBe('-8px');
    expect(nudge('120', 2)).toBe('122');
  });

  it('moves by 10 with shift and by a tenth with alt', () => {
    expect(nudge('12px', 2, { shift: true })).toBe('32px');
    expect(nudge('12px', 3, { alt: true })).toBe('12.3px');
  });

  it('moves em and small unitless values by tenths', () => {
    expect(nudge('1.5', 2)).toBe('1.7');
    expect(nudge('0.02em', 1)).toBe('0.12em');
  });

  it('leaves words alone', () => {
    expect(nudge('auto', 1)).toBeNull();
    expect(parseNumber('calc(1px + 2px)')).toBeNull();
  });
});

describe('startIndex', () => {
  const scale = ['0px', '4px', '8px', '12px', '16px'];
  it('starts at the current step', () => {
    expect(startIndex(scale, '8px', 'p-2')).toBe(2);
  });
  it('starts at the nearest step for a value off the scale', () => {
    expect(startIndex(scale, undefined, '13px')).toBe(3);
  });
  it('has no start for a word off the scale', () => {
    expect(startIndex(scale, undefined, 'auto')).toBe(-1);
  });
});

describe('isOrdered', () => {
  it('walks sizes, weights and shadows, not names', () => {
    expect(isOrdered(['0px', '4px', '8px'])).toBe(true);
    expect(isOrdered(['400', '500', '700'])).toBe(true);
    expect(isOrdered(['none', '0 1px 2px rgb(0 0 0 / 0.05)'])).toBe(true);
    expect(isOrdered(['static', 'relative', 'absolute'])).toBe(false);
    expect(isOrdered(['8px'])).toBe(false);
  });
});
