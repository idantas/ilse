/**
 * The scales a project actually has, beyond its named tokens.
 *
 * Tailwind v4 doesn't declare `--spacing-2: 8px` — it declares one base
 * (`--spacing: 0.25rem`) and every `p-2`/`gap-3` is a multiple of it. Reading
 * only named variables made `gap-2` look "fora do padrão" in a Tailwind
 * project, with nothing on-standard to pick instead. Here the base becomes the
 * list of steps a designer would reach for, named the way the class is.
 *
 * Token names follow token-detect (`spacing.spacing-2`, `spacing.radius-md`),
 * so token-swap turns a pick straight into `p-2` / `rounded-md`.
 */

import type { DSToken } from './analyze.js';

export const SPACING_STEPS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24];
export const RADIUS_NAMES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;
/** Tailwind v4 defaults, used when the page runs Tailwind v4 but hasn't emitted the radius it didn't use yet */
const RADIUS_DEFAULT_PX: Record<string, number> = { xs: 2, sm: 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, '4xl': 32 };

const pxString = (n: number) => `${Math.round(n * 100) / 100}px`;

/** `p-2` steps from the spacing base, labelled "2 · 8px". */
export function spacingScale(basePx: number): DSToken[] {
  return SPACING_STEPS.map(step => ({
    name: `spacing.spacing-${step}`,
    value: pxString(basePx * step),
    type: 'spacing' as const,
    label: `${step} · ${pxString(basePx * step)}`,
  }));
}

/** `rounded-md` steps — resolved values where the page has them, Tailwind defaults otherwise. */
export function radiusScale(resolved: Partial<Record<string, number>>, useDefaults: boolean): DSToken[] {
  const out: DSToken[] = [];
  for (const name of RADIUS_NAMES) {
    const px = resolved[name] ?? (useDefaults ? RADIUS_DEFAULT_PX[name] : undefined);
    if (px === undefined) continue;
    out.push({ name: `spacing.radius-${name}`, value: pxString(px), type: 'spacing', label: `${name} · ${pxString(px)}` });
  }
  return out;
}

/** Scale first; project tokens after, minus the ones that repeat a step's value. */
export function mergeScale(scale: DSToken[], project: DSToken[]): DSToken[] {
  const seen = new Set(scale.map(t => t.value));
  return [...scale, ...project.filter(t => !seen.has(t.value) && (seen.add(t.value), true))];
}

/**
 * Shorthands (`padding: 4px 8px`) are on-standard when every side is — the
 * select can't name them as one token, but they aren't a stray value either.
 */
export function onScale(value: string, tokens: DSToken[]): boolean {
  const parts = value.trim().split(/\s+/);
  return parts.length > 1 && parts.every(p => tokens.some(t => t.value === p));
}

// ── Browser side ────────────────────────────────────────────────────────────

/** Resolve any length expression (`var(--radius-md)`, a calc) to px through the browser. */
function probePx(expr: string): number | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;height:0;width:${expr}`;
  document.body.appendChild(probe);
  const w = parseFloat(getComputedStyle(probe).width);
  probe.remove();
  return Number.isFinite(w) && w > 0 ? w : null;
}

export interface PageScales { spacing: DSToken[]; radius: DSToken[] }

/** Tailwind v4 declares one spacing base; v3 doesn't */
export const isTailwindV4 = (): boolean => probePx('var(--spacing)') !== null;

export function readPageScales(project: DSToken[]): PageScales {
  const base = probePx('var(--spacing)');
  const resolved: Partial<Record<string, number>> = {};
  for (const name of RADIUS_NAMES) {
    const px = probePx(`var(--radius-${name})`);
    if (px !== null) resolved[name] = px;
  }
  const projectSpacing = project.filter(t => t.type === 'spacing');
  const isRadius = (t: DSToken) => /radius|rounded/.test(t.name);
  return {
    spacing: mergeScale(base ? spacingScale(base) : [], projectSpacing.filter(t => !isRadius(t))),
    radius: mergeScale(radiusScale(resolved, base !== null), projectSpacing.filter(isRadius)),
  };
}
