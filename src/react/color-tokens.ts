/**
 * Colour tokens read from the running page, not from the CSS source.
 *
 * The CLI's static scan (setup/token-detect.ts) reads one globals.css and keeps
 * each variable's first declaration — the light theme. That gave wrong swatches
 * in dark mode, dropped aliases (`--color-x: var(--x)`) and never saw tokens
 * from other stylesheets or Tailwind's own palette.
 *
 * Here every custom property declared on a theme-level selector is resolved by
 * the browser against the element being edited, so the value is the one that
 * element actually sees: current theme, scoped overrides, var() chains and all.
 */

import { readColor, rgbToOklch, type RGBA } from './color.js';
import type { DSToken } from './analyze.js';

export interface ColorToken extends DSToken {
  type: 'color';
  /** The custom property behind it, e.g. `--surface-1` — used for the live preview */
  cssVar?: string;
  /** Resolved colour as the target element sees it right now */
  rgba: RGBA;
  /** Name without the `color.` / `color-` prefixes, for display and grouping */
  label: string;
}

// Selectors that declare theme tokens. Component-local variables (Radix
// popper sizes, Tailwind's --tw-* plumbing) are excluded by this and by prefix.
const THEME_SELECTOR = /(^|[\s,(])(:root|html|:host|body|\.dark|\.light|\[data-(theme|mode)[^\]]*\])/;
const IGNORED_VAR = /^--(tw-|radix-|sonner-|vaul-|ilse-)/;

function collectVarNames(): Set<string> {
  const names = new Set<string>();
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && THEME_SELECTOR.test(rule.selectorText)) {
        for (const prop of Array.from(rule.style)) {
          if (prop.startsWith('--') && !IGNORED_VAR.test(prop)) names.add(prop);
        }
      }
      // @layer, @media, @supports and nested rules all carry their own list
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested) walk(nested);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try { walk(sheet.cssRules); } catch { /* cross-origin sheet — unreadable */ }
  }
  return names;
}

const bare = (name: string) => name.replace(/^--/, '').replace(/^color-/, '');

/**
 * A gradient token: a variable whose value is a whole gradient
 * (`--ai-gradient: linear-gradient(…)`). It paints a background, not a colour,
 * so it's offered for Fill only and applied as `background-image`.
 */
export interface GradientToken {
  /** `gradient.<var name>` — what the agent is told to use */
  name: string;
  /** Resolved gradient, var() chains filled in, as the element sees it */
  value: string;
  cssVar: string;
  label: string;
  type: 'gradient';
}

export function isGradient(value: string): boolean {
  return /^(repeating-)?(linear|radial|conic)-gradient\(/i.test(value.trim());
}

/** Every gradient token visible from `el` (or the root) */
export function collectGradientTokens(el?: Element | null): GradientToken[] {
  if (typeof document === 'undefined') return [];
  const computed = getComputedStyle(el ?? document.documentElement);
  const out: GradientToken[] = [];
  for (const cssVar of collectVarNames()) {
    const value = computed.getPropertyValue(cssVar).trim();
    if (!isGradient(value)) continue;
    out.push({ name: `gradient.${cssVar.slice(2)}`, value, cssVar, label: bare(cssVar), type: 'gradient' });
  }
  return out.sort((a, b) => naturalCompare(a.label, b.label));
}

/** The gradient token an element's `background-image` already is, if any */
export function gradientIn(backgroundImage: string | undefined, tokens: GradientToken[]): GradientToken | undefined {
  if (!backgroundImage || !isGradient(backgroundImage)) return undefined;
  const flat = (v: string) => v.toLowerCase().replace(/\s+/g, '');
  return tokens.find(t => flat(t.value) === flat(backgroundImage));
}

/**
 * Every colour token visible from `el` (or the root), deduplicated so that a
 * Tailwind alias and the variable it points at show up once.
 *
 * Token names keep token-detect's convention (`color.<var name>`), which is
 * what token-swap maps back to a utility class.
 */
export function collectColorTokens(el?: Element | null): ColorToken[] {
  if (typeof document === 'undefined') return [];
  const scope = el ?? document.documentElement;
  const computed = getComputedStyle(scope);
  const byLabel = new Map<string, ColorToken>();

  for (const cssVar of collectVarNames()) {
    const value = computed.getPropertyValue(cssVar).trim();
    if (!value) continue; // declared only for another theme / another scope
    const rgba = readColor(value);
    if (!rgba) continue; // not a colour (shadows, sizes, bare channel triples)

    const label = bare(cssVar);
    const token: ColorToken = { name: `color.${cssVar.slice(2)}`, value, type: 'color', cssVar, rgba, label };
    const existing = byLabel.get(label);
    // Prefer `--color-x` over `--x`: it is the one Tailwind generates classes from.
    if (!existing || (cssVar.startsWith('--color-') && !existing.cssVar?.startsWith('--color-'))) {
      byLabel.set(label, token);
    }
  }

  return [...byLabel.values()].sort((a, b) => naturalCompare(a.label, b.label));
}

/**
 * Tokens the CLI found on disk but the page doesn't expose (e.g. unused in the
 * current route) — still offered, painted from their authored value.
 */
export function withStaticTokens(runtime: ColorToken[], fromDisk: DSToken[]): ColorToken[] {
  const seen = new Set(runtime.map(t => t.label));
  const extra: ColorToken[] = [];
  for (const t of fromDisk) {
    if (t.type !== 'color') continue;
    const label = t.name.replace(/^color\./, '').replace(/^color-/, '');
    if (seen.has(label)) continue;
    const rgba = readColor(t.value);
    if (!rgba) continue;
    seen.add(label);
    extra.push({ ...t, type: 'color', rgba, label });
  }
  return [...runtime, ...extra].sort((a, b) => naturalCompare(a.label, b.label));
}

/**
 * Order a palette the way the eye reads it: neutrals first (light → dark), then
 * chromatic colours around the hue wheel, each hue band light → dark. Near-
 * duplicates end up side by side, which is what makes a grid scannable.
 */
export function sortByColor(tokens: ColorToken[]): ColorToken[] {
  const HUE_BANDS = 12;
  const key = (t: ColorToken) => {
    const { L, C, h } = rgbToOklch(t.rgba);
    const neutral = C < 0.03;
    // Translucent tokens sit after opaque ones within their band
    return { neutral, band: neutral ? -1 : Math.floor(((h + 15) % 360) / (360 / HUE_BANDS)), L, a: t.rgba.a };
  };
  const keyed = tokens.map(t => ({ t, k: key(t) }));
  keyed.sort((x, y) =>
    (Number(y.k.neutral) - Number(x.k.neutral))
    || (x.k.band - y.k.band)
    || (Number(x.k.a < 1) - Number(y.k.a < 1))
    || (y.k.L - x.k.L));
  return keyed.map(x => x.t);
}

export interface Swatch {
  /** The token a click applies: the base one among equals */
  token: ColorToken;
  /** Every token painting exactly this colour (token first) */
  all: ColorToken[];
}

export interface SwatchSection {
  name: 'neutral' | 'color' | 'translucent';
  swatches: Swatch[];
}

/**
 * The "by colour" view: one swatch per distinct colour (surface-2…8 all being
 * white shouldn't fill a row with white), split into neutrals, colours and
 * translucent overlays, each in eye order.
 */
export function colorSections(tokens: ColorToken[]): SwatchSection[] {
  const byHex = new Map<string, ColorToken[]>();
  for (const t of tokens) {
    const { r, g, b, a } = t.rgba;
    const key = `${r},${g},${b},${Math.round(a * 255)}`;
    const list = byHex.get(key) ?? [];
    list.push(t);
    byHex.set(key, list);
  }
  const swatches = [...byHex.values()].map(list => {
    const all = [...list].sort(byBaseness);
    return { token: all[0], all };
  });
  const order = new Map(sortByColor(swatches.map(s => s.token)).map((t, i) => [t.name, i]));
  swatches.sort((x, y) => order.get(x.token.name)! - order.get(y.token.name)!);

  const sections: SwatchSection[] = [
    { name: 'neutral', swatches: [] },
    { name: 'color', swatches: [] },
    { name: 'translucent', swatches: [] },
  ];
  for (const s of swatches) {
    const { a } = s.token.rgba;
    const { C } = rgbToOklch(s.token.rgba);
    sections[a < 1 ? 2 : C < 0.03 ? 0 : 1].swatches.push(s);
  }
  return sections.filter(s => s.swatches.length > 0);
}

/**
 * The "by token" view: one row per family — `card` + `card-foreground`,
 * `surface-1…8`, `red-50…950` — named by the family, so the row label is the
 * token's own vocabulary and the chips show its variants.
 */
export function familyRows(tokens: ColorToken[]): { name: string; tokens: ColorToken[] }[] {
  const rows = new Map<string, ColorToken[]>();
  for (const t of tokens) {
    const family = t.label.split('-')[0] || t.label;
    const list = rows.get(family) ?? [];
    list.push(t);
    rows.set(family, list);
  }
  return [...rows.entries()]
    .map(([name, list]) => ({ name, tokens: list.sort((a, b) => a.label.length - b.label.length || naturalCompare(a.label, b.label)) }))
    .sort((a, b) => naturalCompare(a.name, b.name));
}

/** Among tokens with the same colour, the shortest name is usually the base one. */
export function byBaseness(a: DSToken, b: DSToken): number {
  return a.name.length - b.name.length || naturalCompare(a.name, b.name);
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}
