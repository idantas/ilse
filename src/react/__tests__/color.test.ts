import { describe, it, expect } from 'vitest';
import {
  parseHex, rgbaToHex, rgbToHsv, hsvToRgb, rgbToOklch, deltaE, formatColor,
} from '../color.js';
import { sortByColor, colorSections, familyRows, isGradient, gradientIn, type ColorToken, type GradientToken } from '../color-tokens.js';

const tok = (label: string): ColorToken => ({
  name: `color.${label}`, value: '#000', type: 'color', label, rgba: { r: 0, g: 0, b: 0, a: 1 },
});

describe('hex', () => {
  it('parses short, long and alpha forms', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHex('6B97FF')).toEqual({ r: 107, g: 151, b: 255, a: 1 });
    expect(parseHex('#00000080')?.a).toBeCloseTo(0.502, 2);
    expect(parseHex('#12')).toBeNull();
  });

  it('round-trips, with alpha only when translucent', () => {
    expect(rgbaToHex({ r: 107, g: 151, b: 255, a: 1 })).toBe('#6B97FF');
    expect(rgbaToHex({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('#00000080');
  });
});

describe('hsv', () => {
  it('round-trips through rgb', () => {
    for (const c of [
      { r: 255, g: 0, b: 0, a: 1 }, { r: 12, g: 200, b: 99, a: 1 },
      { r: 128, g: 128, b: 128, a: 0.4 }, { r: 0, g: 0, b: 0, a: 1 },
    ]) {
      expect(hsvToRgb(rgbToHsv(c))).toEqual(c);
    }
  });
});

describe('oklch', () => {
  it('matches reference values', () => {
    const white = rgbToOklch({ r: 255, g: 255, b: 255, a: 1 });
    expect(white.L).toBeCloseTo(1, 3);
    expect(white.C).toBeCloseTo(0, 3);
    // Tailwind's red-500 is oklch(0.637 0.237 25.331) ≈ #FB2C36
    const red = rgbToOklch({ r: 0xfb, g: 0x2c, b: 0x36, a: 1 });
    expect(red.L).toBeCloseTo(0.637, 2);
    expect(red.C).toBeCloseTo(0.237, 2);
    expect(red.h).toBeCloseTo(25.3, 0);
  });
});

describe('deltaE', () => {
  it('is zero for equal colours and grows with difference', () => {
    const a = { r: 250, g: 250, b: 250, a: 1 };
    expect(deltaE(a, a)).toBe(0);
    expect(deltaE(a, { r: 255, g: 255, b: 255, a: 1 })).toBeLessThan(2);
    expect(deltaE(a, { r: 0, g: 0, b: 0, a: 1 })).toBeGreaterThan(90);
  });

  it('counts alpha', () => {
    expect(deltaE({ r: 0, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 0, a: 0.5 })).toBeGreaterThan(20);
  });
});

describe('formatColor', () => {
  const c = { r: 107, g: 151, b: 255, a: 1 };
  it('writes every format', () => {
    expect(formatColor(c, 'hex')).toBe('#6B97FF');
    expect(formatColor(c, 'rgb')).toBe('rgb(107 151 255)');
    expect(formatColor(c, 'hsl')).toBe('hsl(222 100% 71%)');
    expect(formatColor(c, 'oklch')).toMatch(/^oklch\(0\.\d+ 0\.\d+ \d+(\.\d)?\)$/);
  });
  it('adds alpha when translucent', () => {
    expect(formatColor({ ...c, a: 0.5 }, 'rgb')).toBe('rgb(107 151 255 / 0.5)');
  });
});

describe('sortByColor', () => {
  const c = (label: string, r: number, g: number, b: number, a = 1): ColorToken =>
    ({ ...tok(label), rgba: { r, g, b, a } });
  it('puts neutrals first light → dark, then walks the hue wheel', () => {
    const sorted = sortByColor([
      c('blue', 40, 90, 230), c('black', 0, 0, 0), c('red', 220, 40, 40),
      c('white', 255, 255, 255), c('green', 40, 180, 80), c('grey', 128, 128, 128),
      c('light-red', 250, 200, 200),
    ]);
    expect(sorted.map(t => t.label)).toEqual(['white', 'grey', 'black', 'light-red', 'red', 'green', 'blue']);
  });
});

describe('colorSections', () => {
  const c = (label: string, r: number, g: number, b: number, a = 1): ColorToken =>
    ({ ...tok(label), rgba: { r, g, b, a } });
  it('collapses equal colours onto the base token and splits by kind', () => {
    const sections = colorSections([
      c('surface-2', 255, 255, 255), c('background', 255, 255, 255), c('card', 255, 255, 255),
      c('primary', 40, 90, 230), c('hover', 0, 0, 0, 0.04), c('foreground', 10, 10, 10),
    ]);
    expect(sections.map(s => s.name)).toEqual(['neutral', 'color', 'translucent']);
    const white = sections[0].swatches[0];
    expect(white.token.label).toBe('card');
    expect(white.all.map(t => t.label)).toEqual(['card', 'surface-2', 'background']);
    expect(sections[0].swatches.map(s => s.token.label)).toEqual(['card', 'foreground']);
  });
});

describe('familyRows', () => {
  it('groups a token with its variants under the family name', () => {
    const rows = familyRows(['card-foreground', 'card', 'surface-10', 'surface-2', 'primary'].map(tok));
    expect(rows.map(r => r.name)).toEqual(['card', 'primary', 'surface']);
    expect(rows[0].tokens.map(t => t.label)).toEqual(['card', 'card-foreground']);
    expect(rows[2].tokens.map(t => t.label)).toEqual(['surface-2', 'surface-10']);
  });
});

describe('gradient tokens', () => {
  const ai: GradientToken = { name: 'gradient.ai-gradient', value: 'linear-gradient(135deg, oklch(0.769 0.188 70.08), oklch(0.627 0.265 303.9))', cssVar: '--ai-gradient', label: 'ai-gradient', type: 'gradient' };
  it('tells a gradient from a colour', () => {
    expect(isGradient('linear-gradient(90deg, red, blue)')).toBe(true);
    expect(isGradient(' repeating-conic-gradient(red 0 10%, blue 0 20%)')).toBe(true);
    expect(isGradient('oklch(0.7 0.1 70)')).toBe(false);
    expect(isGradient('none')).toBe(false);
  });
  it("finds the token an element's background-image already is, spacing aside", () => {
    expect(gradientIn('linear-gradient(135deg,oklch(0.769 0.188 70.08),oklch(0.627 0.265 303.9))', [ai])?.name).toBe('gradient.ai-gradient');
    expect(gradientIn('none', [ai])).toBeUndefined();
    expect(gradientIn('linear-gradient(red, blue)', [ai])).toBeUndefined();
  });
});
