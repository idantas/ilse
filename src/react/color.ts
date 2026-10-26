/**
 * Colour reading, conversion and formatting for the property panel and the
 * colour picker.
 *
 * Reading goes through the browser (readColor) so any notation the page can
 * render — oklch, color-mix(), named colours — is readable. Everything after
 * that is plain math on 0–255 sRGB channels, so it runs (and is tested) in Node.
 */

export interface RGBA { r: number; g: number; b: number; a: number }
export interface HSVA { h: number; s: number; v: number; a: number }

export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'oklch';

// ── Reading (browser) ──────────────────────────────────────────────────────

function norm(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Canonicalise any CSS colour by painting one pixel and reading it back.
 *
 * Reading `ctx.fillStyle` back as a string does NOT work: the canvas serialises
 * a CSS Color 4 value in the format it was given, so `oklch(...)` stays
 * `oklch(...)`. That was the bug behind every swatch rendering black — the hex
 * and rgb() patterns both missed, and the fallback was #000000.
 *
 * Painting sidesteps parsing entirely: whatever the browser can render, we can
 * read, including oklch, oklab, color(), hsl, named colours and hex. What the
 * canvas rejects (color-mix(), relative colours in older engines) goes through
 * a probe element first, whose computed `color` the canvas does understand.
 */
const colorCache = new Map<string, RGBA | null>();
let probeCtx: CanvasRenderingContext2D | null | undefined;

function paint(value: string): RGBA | null {
  if (probeCtx === undefined) {
    probeCtx = typeof document !== 'undefined'
      ? document.createElement('canvas').getContext('2d', { willReadFrequently: true })
      : null;
  }
  if (!probeCtx) return null;
  try {
    // Two sentinels detect a rejected value without ever colliding with a
    // real colour: an invalid assignment leaves each sentinel in place, so
    // the two reads disagree. A valid one overwrites both identically.
    probeCtx.fillStyle = '#000000';
    probeCtx.fillStyle = value;
    const first = probeCtx.fillStyle;
    probeCtx.fillStyle = '#ffffff';
    probeCtx.fillStyle = value;
    const second = probeCtx.fillStyle;
    if (first !== second) return null;
    probeCtx.clearRect(0, 0, 1, 1);
    probeCtx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probeCtx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  } catch {
    return null;
  }
}

function viaComputedStyle(value: string): string | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const probe = document.createElement('span');
  probe.style.color = value;
  if (!probe.style.color) return null; // the browser rejected it outright
  probe.style.display = 'none';
  probe.setAttribute('data-ilse-toolbar', ''); // Ilse's own: never read as the page repainting
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed || null;
}

export function readColor(value: string): RGBA | null {
  const key = norm(value);
  if (!key) return null;
  if (colorCache.has(key)) return colorCache.get(key)!;
  let out = paint(value);
  if (!out) {
    const computed = viaComputedStyle(value);
    if (computed && norm(computed) !== key) out = paint(computed);
  }
  colorCache.set(key, out);
  return out;
}

export function canonicalColor(value: string): string {
  const c = readColor(value);
  if (!c) return norm(value);
  // Fully transparent reads the same regardless of channel values.
  if (c.a === 0) return 'transparent';
  return `rgba(${c.r},${c.g},${c.b},${c.a.toFixed(3)})`;
}

/** Hex form for display, #RRGGBB (alpha dropped). */
export function toHex(value: string): string {
  const c = readColor(value);
  return c ? rgbaToHex({ ...c, a: 1 }) : '#000000';
}

export function isTransparent(value: string): boolean {
  const c = readColor(value);
  return !!c && c.a === 0;
}

// ── Conversion (pure) ──────────────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export function rgbaToHex({ r, g, b, a }: RGBA): string {
  return ('#' + hex2(r) + hex2(g) + hex2(b) + (a < 1 ? hex2(a * 255) : '')).toUpperCase();
}

export function parseHex(input: string): RGBA | null {
  const m = input.trim().replace(/^#/, '');
  if (!/^([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(m)) return null;
  const full = m.length <= 4 ? m.split('').map(c => c + c).join('') : m;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? round(n(6) / 255, 3) : 1 };
}

export function rgbToHsv({ r, g, b, a }: RGBA): HSVA {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max, a };
}

export function hsvToRgb({ h, s, v, a }: HSVA): RGBA {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: Math.round(f(5)), g: Math.round(f(3)), b: Math.round(f(1)), a };
}

export function rgbToHsl({ r, g, b }: RGBA): { h: number; s: number; l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const { h } = rgbToHsv({ r, g, b, a: 1 });
  return { h, s, l };
}

const toLinear = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

/** sRGB → OKLab (Björn Ottosson's reference matrices). */
export function rgbToOklab({ r, g, b }: RGBA): { L: number; a: number; b: number } {
  const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

export function rgbToOklch(c: RGBA): { L: number; C: number; h: number } {
  const { L, a, b } = rgbToOklab(c);
  const C = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h: C < 0.0001 ? 0 : h };
}

/**
 * Perceptual distance in OKLab, scaled ×100 so it reads like the familiar ΔE:
 * under ~2 is hard to tell apart, above ~10 is clearly a different colour.
 * Alpha counts too — a 50% black is not black.
 */
export function deltaE(x: RGBA, y: RGBA): number {
  const p = rgbToOklab(x);
  const q = rgbToOklab(y);
  const da = (x.a - y.a) * 0.5;
  return Math.sqrt((p.L - q.L) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2 + da ** 2) * 100;
}

export function formatColor(c: RGBA, format: ColorFormat): string {
  const alpha = c.a < 1 ? ` / ${round(c.a, 2)}` : '';
  switch (format) {
    case 'hex':
      return rgbaToHex(c);
    case 'rgb':
      return `rgb(${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)}${alpha})`;
    case 'hsl': {
      const { h, s, l } = rgbToHsl(c);
      return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%${alpha})`;
    }
    case 'oklch': {
      const { L, C, h } = rgbToOklch(c);
      return `oklch(${round(L, 3)} ${round(C, 3)} ${round(h, 1)}${alpha})`;
    }
  }
}
