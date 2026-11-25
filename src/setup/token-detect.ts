/**
 * Auto-detect design tokens from the project.
 * Scans for tailwind.config, tokens.json, components.json (shadcn), theme files.
 * Returns a simplified token list for the browser analysis engine.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readDesignMd } from './design-md.js';
import { connectedDs, exportedFile, packageName, workspaceDirs } from '../design-context/ds-source.js';

export interface DetectedToken {
  name: string;
  value: string;
  type: 'color' | 'spacing' | 'typography';
}

export interface TokenDetectionResult {
  source: string;       // e.g. "tailwind.config.ts", "tokens.json"
  tokens: DetectedToken[];
  libraries: string[];  // detected UI libs: shadcn, radix, etc.
}

function readJSON(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function readFile(path: string): string | null {
  if (!existsSync(path)) return null;
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

/**
 * Any CSS colour notation, not just hex.
 *
 * This used to accept hex only, which meant a Tailwind v4 / shadcn project —
 * where the generated theme is entirely oklch — yielded zero colour tokens.
 * Values are kept in their authored form; the browser canonicalises them at
 * comparison time, so oklch tokens match oklch computed styles directly.
 */
function isColorValue(value: string): boolean {
  return /^#[\da-fA-F]{3,8}$/.test(value)
    || /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i.test(value);
}

// ── Tailwind config extraction ─────────────────────────────────────────────

function extractTailwindTokens(cwd: string): DetectedToken[] | null {
  const candidates = [
    'tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs',
  ];

  for (const file of candidates) {
    const content = readFile(join(cwd, file));
    if (!content) continue;

    const tokens: DetectedToken[] = [];

    // Extract colors from theme.extend.colors or theme.colors
    // Pattern: key: '#hex' or key: 'rgb(...)' in the colors block
    const colorMatches = content.matchAll(/['"]?([\w.-]+)['"]?\s*:\s*['"]([#][\da-fA-F]{3,8}|rgb[a]?\([^)]+\))['"],?/g);
    for (const m of colorMatches) {
      tokens.push({ name: `color.${m[1]}`, value: m[2], type: 'color' });
    }

    // Extract spacing/sizing from theme.extend.spacing
    const spacingMatches = content.matchAll(/['"]?([\w.-]+)['"]?\s*:\s*['"](\d+(?:\.\d+)?(?:px|rem|em))['"],?/g);
    for (const m of spacingMatches) {
      tokens.push({ name: `spacing.${m[1]}`, value: m[2], type: 'spacing' });
    }

    // Extract fontSize
    const fontMatches = content.matchAll(/['"]?([\w.-]+)['"]?\s*:\s*['"]([\d.]+(?:px|rem))['"],?/g);
    for (const m of fontMatches) {
      if (m[1].includes('font') || m[1].includes('text') || m[1].includes('size')) {
        tokens.push({ name: `typography.${m[1]}`, value: m[2], type: 'typography' });
      }
    }

    if (tokens.length > 0) return tokens;
  }
  return null;
}

// ── CSS variables extraction (globals.css, theme) ──────────────────────────

/** Where a project keeps its CSS theme (also read by the DS for themes and fonts) */
export const CSS_CANDIDATES = [
  'src/app/globals.css', 'app/globals.css', 'src/globals.css',
  'src/styles/globals.css', 'styles/globals.css',
  'src/index.css', 'src/app/layout.css',
];

/**
 * A stylesheet with its local `@import`s put in place, as the browser reads it. A theme often
 * lives in its own file (`@import '../styles/theme.css'` in globals.css): seen live, a project's
 * colours were all there and the DS showed none. Packages (`@import 'tailwindcss'`) stay out.
 */
export function withImports(file: string, depth = 0, seen = new Set<string>(), pkg?: (spec: string) => string | null): string | null {
  const content = readFile(file);
  if (content === null) return null;
  if (depth > 4 || seen.has(file)) return '';
  seen.add(file);
  return content.replace(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]\s*\)?[^;]*;/g, (whole, spec: string) => {
    // A package's stylesheet only when it's the connected design system's theme (`@acme/ui/theme.css`)
    const target = /^\.{1,2}\//.test(spec) ? resolve(dirname(file), spec) : pkg?.(spec) ?? null;
    if (!target) return whole;
    const inner = withImports(target, depth + 1, seen, pkg);
    return inner === null ? whole : inner;
  });
}

/** `@acme/ui/theme.css` → its file, when `@acme/ui` is the project's connected design system */
function dsImports(cwd: string): ((spec: string) => string | null) | undefined {
  const ds = connectedDs(cwd);
  if (!ds) return undefined;
  return (spec) => packageName(spec) === ds.name ? exportedFile(ds.root, spec.slice(ds.name.length).replace(/^\//, '')) : null;
}

/** The project's main stylesheet, imports included (also read by the DS for themes and fonts) */
export function themeCss(cwd: string): string | null {
  const pkg = dsImports(cwd);
  // At a monorepo's root the app's stylesheet is in a workspace (`web/src/app/globals.css`)
  for (const dir of [cwd, ...workspaceDirs(cwd)]) {
    for (const file of CSS_CANDIDATES) {
      const css = withImports(join(dir, file), 0, new Set(), pkg);
      if (css !== null) return css;
    }
  }
  // No stylesheet of its own: the connected design system's theme is the project's
  const ds = connectedDs(cwd);
  return ds?.themeFile ? withImports(ds.themeFile) : null;
}

function extractCSSVariableTokens(cwd: string): DetectedToken[] | null {
  const content = themeCss(cwd);
  if (!content) return null;

  const tokens: DetectedToken[] = [];

  // Extract --color-* or --*: <value> from :root / @theme
  const varMatches = content.matchAll(/--([a-zA-Z][\w-]*)\s*:\s*([^;]+);/g);
  const seen = new Set<string>();
  for (const m of varMatches) {
    const name = m[1].trim();
    const value = m[2].trim();

    // `--color-primary: var(--primary)` is an alias, not a value. Skipping it
    // keeps the real declaration (`--primary: oklch(...)`) as the token.
    if (value.startsWith('var(')) continue;
    if (seen.has(name)) continue;

    if (isColorValue(value)) {
      seen.add(name);
      tokens.push({ name: `color.${name}`, value, type: 'color' });
    } else if (/^\d+(\.\d+)?(px|rem|em)$/.test(value)) {
      seen.add(name);
      // Tailwind v4 names font sizes `--text-*` (and their line heights `--text-*--line-height`)
      if (/^text-/.test(name)) { if (!name.includes('--')) tokens.push({ name: `typography.${name.slice(5)}`, value, type: 'typography' }); }
      else tokens.push({ name: `spacing.${name}`, value, type: 'spacing' });
    }
  }

  return tokens.length > 0 ? tokens : null;
}

// ── W3C tokens.json ────────────────────────────────────────────────────────

function extractW3CTokens(cwd: string): DetectedToken[] | null {
  const candidates = [
    'tokens.json', 'design-tokens.json', 'src/tokens.json',
    'tokens/tokens.json', 'design/tokens.json',
  ];

  for (const file of candidates) {
    const json = readJSON(join(cwd, file));
    if (!json) continue;

    const tokens: DetectedToken[] = [];
    walkW3C(json, [], tokens);
    if (tokens.length > 0) return tokens;
  }
  return null;
}

function walkW3C(obj: Record<string, unknown>, path: string[], tokens: DetectedToken[]) {
  for (const [key, val] of Object.entries(obj)) {
    if (val && typeof val === 'object' && '$value' in (val as Record<string, unknown>)) {
      const v = val as Record<string, unknown>;
      const value = String(v.$value ?? '');
      const declaredType = String(v.$type ?? '');
      let type: DetectedToken['type'] = 'typography';
      if (declaredType === 'color' || /^#|^rgb|^hsl/.test(value)) type = 'color';
      else if (declaredType === 'dimension' || declaredType === 'spacing' || /^\d+(px|rem|em|%)$/.test(value)) type = 'spacing';
      tokens.push({ name: [...path, key].join('.'), value, type });
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      walkW3C(val as Record<string, unknown>, [...path, key], tokens);
    }
  }
}

// ── UI library detection ───────────────────────────────────────────────────

function detectLibraries(cwd: string): string[] {
  const pkg = readJSON(join(cwd, 'package.json'));
  if (!pkg) return [];

  const deps = {
    ...(pkg.dependencies as Record<string, string> ?? {}),
    ...(pkg.devDependencies as Record<string, string> ?? {}),
  };

  const libs: string[] = [];
  if (deps['@radix-ui/react-dialog'] || deps['@radix-ui/react-popover'] || Object.keys(deps).some(k => k.startsWith('@radix-ui/'))) libs.push('radix-ui');
  if (existsSync(join(cwd, 'components.json'))) libs.push('shadcn');
  if (deps['@mui/material'] || deps['@mui/system']) libs.push('mui');
  if (deps['@chakra-ui/react']) libs.push('chakra-ui');
  if (deps['@mantine/core']) libs.push('mantine');
  if (deps['tailwindcss'] || deps['@tailwindcss/vite']) libs.push('tailwind');
  if (deps['styled-components']) libs.push('styled-components');
  if (deps['@emotion/react']) libs.push('emotion');

  return libs;
}

// ── Main detection ─────────────────────────────────────────────────────────

export function detectTokens(cwd: string = process.cwd()): TokenDetectionResult {
  const found = detectCodeTokens(cwd);
  // DESIGN.md adds what the code doesn't declare (yet); the code wins on a clash
  const design = readDesignMd(cwd);
  // Ilse's own DESIGN.md is written from these tokens: reading it back would keep a token the
  // code no longer has (or one read wrong once) in the DS forever
  if (!design || design.tokens.length === 0 || design.path === '.ilse/ds/DESIGN.md') return found;
  const label = (t: DetectedToken) => t.name.replace(/^[a-z]+\./, '');
  const have = new Set(found.tokens.map(t => `${t.type}:${label(t)}`));
  const extra = design.tokens.filter(t => !have.has(`${t.type}:${label(t)}`));
  return {
    ...found,
    source: found.source === 'none' ? design.path : `${found.source} + ${design.path}`,
    tokens: [...found.tokens, ...extra],
  };
}

function detectCodeTokens(cwd: string): TokenDetectionResult {
  const libraries = detectLibraries(cwd);

  // Try sources in priority order
  const w3c = extractW3CTokens(cwd);
  if (w3c) return { source: 'tokens.json (W3C)', tokens: w3c, libraries };

  const tailwind = extractTailwindTokens(cwd);
  if (tailwind) return { source: 'tailwind.config', tokens: tailwind, libraries };

  const css = extractCSSVariableTokens(cwd);
  if (css) return { source: 'globals.css', tokens: css, libraries };

  // The connected design system's W3C tokens, when the project's CSS gave none
  const ds = connectedDs(cwd);
  const json = ds?.tokensFile ? readJSON(ds.tokensFile) : null;
  if (ds && json) {
    const tokens: DetectedToken[] = [];
    walkW3C(json, [], tokens);
    if (tokens.length) return { source: `${ds.name} tokens.json`, tokens, libraries };
  }

  return { source: 'none', tokens: [], libraries };
}
