import { describe, it, expect } from 'vitest';
import { cleanShadow, blurOf, withBlur, effectScales, splitLayers } from '../effects.js';

describe('cleanShadow', () => {
  it('drops the empty layers Tailwind v4 composes around a shadow', () => {
    const v4 = 'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0px 2px 4px -2px';
    expect(cleanShadow(v4)).toBe('rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0px 2px 4px -2px');
  });
  it('reads only-empty layers as no shadow', () => {
    expect(cleanShadow('rgba(0, 0, 0, 0) 0px 0px 0px 0px')).toBe('none');
    expect(cleanShadow('none')).toBe('none');
    expect(cleanShadow(undefined)).toBe('none');
  });
  it('keeps a ring (spread only) as a shadow', () => {
    expect(cleanShadow('rgb(59, 130, 246) 0px 0px 0px 2px')).toBe('rgb(59, 130, 246) 0px 0px 0px 2px');
  });
  it('splits layers without breaking colour functions', () => {
    expect(splitLayers('rgb(0 0 0 / 0.1) 0 1px, rgba(1, 2, 3, 0.5) 0 2px')).toEqual(['rgb(0 0 0 / 0.1) 0 1px', 'rgba(1, 2, 3, 0.5) 0 2px']);
  });
});

describe('blur in a filter list', () => {
  it('reads and replaces only the blur', () => {
    expect(blurOf('blur(8px) grayscale(1)')).toBe('blur(8px)');
    expect(blurOf('grayscale(1)')).toBe('none');
    expect(withBlur('blur(8px) grayscale(1)', 'blur(16px)')).toBe('blur(16px) grayscale(1)');
    expect(withBlur('blur(8px) grayscale(1)', 'none')).toBe('grayscale(1)');
    expect(withBlur('blur(8px)', 'none')).toBe('none');
  });
});

describe('effectScales', () => {
  const asIs = (_p: 'boxShadow' | 'filter', expr: string) => expr.replace(/var\(--[\w-]+, (.*)\)$/, '$1');
  it('names v4 steps by class, None first', () => {
    const s = effectScales(true, asIs);
    expect(s.shadow.map(t => t.hint)).toEqual(['shadow-none', 'shadow-2xs', 'shadow-xs', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl', 'shadow-2xl']);
    expect(s.backdrop[3]).toMatchObject({ name: 'effect.backdrop-blur-md', label: 'md · 12px' });
  });
  it('uses the bare v3 class for the default step', () => {
    const s = effectScales(false, asIs);
    expect(s.shadow.map(t => t.name)).toContain('effect.shadow');
    expect(s.blur.find(t => t.value === 'blur(8px)')?.name).toBe('effect.blur');
  });
});
