/**
 * Effects in the panel: drop shadow, layer blur, background blur.
 *
 * Each is a Tailwind scale (`shadow-md`, `blur-md`, `backdrop-blur-md`). The
 * options are resolved through the browser, so they read the same way the
 * element's computed style does and a pick can be matched back to its class.
 *
 * Tailwind v4 composes `box-shadow` from several layers (inset shadow, ring,
 * ring offset, shadow); the unused ones are transparent and zero-sized.
 * `cleanShadow` drops them, so `shadow-md` reads as `shadow-md` and an element
 * with only empty layers reads as no shadow.
 */

import type { DSToken } from './analyze.js';

/** Split a comma list without breaking `rgba(0, 0, 0, 0.1)` apart */
export function splitLayers(value: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const TRANSPARENT = /^(transparent|rgba?\([^)]*[,/]\s*0(\.0+)?\s*\)|#[0-9a-f]{6}00|#[0-9a-f]{3}0)$/i;
const COLOR = /(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b|transparent)/i;

/** A layer that paints nothing: transparent, or every length zero */
function emptyLayer(layer: string): boolean {
  const colour = layer.match(COLOR)?.[0];
  if (colour && TRANSPARENT.test(colour.trim())) return true;
  const lengths = layer.replace(COLOR, '').replace(/\binset\b/, '').trim().split(/\s+/).filter(Boolean);
  return lengths.length > 0 && lengths.every(l => /^-?0(\.0+)?(px)?$/.test(l));
}

/** The box-shadow layers that paint something; `none` when there are none */
export function cleanShadow(value: string | undefined): string {
  if (!value || value.trim() === 'none') return 'none';
  const layers = splitLayers(value).filter(l => !emptyLayer(l));
  return layers.length ? layers.join(', ') : 'none';
}

/** The `blur(…)` inside a filter list, or `none` */
export function blurOf(filter: string | undefined): string {
  return filter?.match(/blur\([^)]*\)/)?.[0] ?? 'none';
}

/** Put a blur into a filter list, keeping its other functions (brightness, grayscale…) */
export function withBlur(filter: string | undefined, blur: string): string {
  const others = (filter ?? '').replace(/blur\([^)]*\)/, '').replace(/\bnone\b/, '').trim().replace(/\s+/g, ' ');
  const next = [blur === 'none' ? '' : blur, others].filter(Boolean).join(' ');
  return next || 'none';
}

// ── Scales ───────────────────────────────────────────────────────────────────

/** Tailwind v4 defaults (v3 names the first steps differently, below) */
const SHADOW_V4: Array<[string, string]> = [
  ['2xs', '0 1px rgb(0 0 0 / 0.05)'],
  ['xs', '0 1px 2px 0 rgb(0 0 0 / 0.05)'],
  ['sm', '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)'],
  ['md', '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'],
  ['lg', '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)'],
  ['xl', '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)'],
  ['2xl', '0 25px 50px -12px rgb(0 0 0 / 0.25)'],
];
const SHADOW_V3: Array<[string, string]> = [
  ['sm', '0 1px 2px 0 rgb(0 0 0 / 0.05)'],
  ['', '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)'],
  ...SHADOW_V4.slice(3),
];
const BLUR_V4: Array<[string, number]> = [['xs', 4], ['sm', 8], ['md', 12], ['lg', 16], ['xl', 24], ['2xl', 40], ['3xl', 64]];
const BLUR_V3: Array<[string, number]> = [['sm', 4], ['', 8], ['md', 12], ['lg', 16], ['xl', 24], ['2xl', 40], ['3xl', 64]];

/** `shadow` + `md` → `shadow-md`; the bare v3 step is the bare class */
const cls = (prefix: string, step: string) => step ? `${prefix}-${step}` : prefix;

export interface EffectScales { shadow: DSToken[]; blur: DSToken[]; backdrop: DSToken[] }

/**
 * Options for each effect. `resolve` turns a CSS expression into its computed
 * form (the browser's), so options and the element compare as equals.
 * Token names are the class (`effect.shadow-md`), which token-swap writes as is.
 */
export function effectScales(v4: boolean, resolve: (prop: 'boxShadow' | 'filter', expr: string) => string): EffectScales {
  const none = (prefix: string): DSToken => ({ name: `effect.${prefix}-none`, value: 'none', type: 'spacing', label: 'None', hint: `${prefix}-none` });
  const shadow = (v4 ? SHADOW_V4 : SHADOW_V3).map(([step, def]) => ({
    name: `effect.${cls('shadow', step)}`,
    value: cleanShadow(resolve('boxShadow', v4 ? `var(--shadow-${step}, ${def})` : def)),
    type: 'spacing' as const,
    label: step || 'default',
    hint: cls('shadow', step),
  }));
  const blurs = (prefix: string) => (v4 ? BLUR_V4 : BLUR_V3).map(([step, px]) => {
    const value = blurOf(resolve('filter', `blur(${v4 ? `var(--blur-${step || 'md'}, ${px}px)` : `${px}px`})`));
    return { name: `effect.${cls(prefix, step)}`, value, type: 'spacing' as const, label: `${step || 'default'} · ${value.slice(5, -1)}`, hint: cls(prefix, step) };
  });
  return {
    shadow: [none('shadow'), ...shadow],
    blur: [none('blur'), ...blurs('blur')],
    backdrop: [none('backdrop-blur'), ...blurs('backdrop-blur')],
  };
}

/** Effect scales of the page in front of us */
export function readEffectScales(v4: boolean): EffectScales {
  const resolve = (prop: 'boxShadow' | 'filter', expr: string): string => {
    if (typeof document === 'undefined' || !document.body) return expr;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0';
    probe.style[prop] = expr;
    probe.setAttribute('data-ilse-toolbar', ''); // Ilse's own: never read as the page repainting
    document.body.appendChild(probe);
    const v = getComputedStyle(probe)[prop];
    probe.remove();
    return v || expr;
  };
  return effectScales(v4, resolve);
}
