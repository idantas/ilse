/**
 * The DS's tokens beyond what token-detect reads for the panel — what a designer expects
 * to find in Figma next to the colors:
 *   - fonts: `--font-sans: var(--font-geist-sans)` resolved through next/font (or a CSS font stack);
 *   - the Tailwind scale steps the project actually uses (`p-4`, `rounded-lg`, `text-sm`):
 *     the project never declares them, but they are its spacing, radius and type;
 *   - themes as modes: `.dark`, `[data-theme=x]`, `.theme-x`, a dark `prefers-color-scheme`.
 * No AI, read only from files.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CSS_CANDIDATES, type DetectedToken } from '../setup/token-detect.js';

export interface DsToken {
  name: string;
  value: string;
  type: DetectedToken['type'] | 'font';
  /** A Tailwind default the project uses, not one it declares: another project already has it */
  scale?: boolean;
}

/** A theme: the tokens whose value differs from the default one */
export interface DsMode { name: string; values: Record<string, string> }

// ── CSS blocks ─────────────────────────────────────────────────────────────

interface Block { selector: string; media: string; vars: Map<string, string> }

/** Each rule that declares custom properties: its selector, the @media around it, its `--vars` */
export function cssBlocks(css: string): Block[] {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Block[] = [];
  const stack: Array<{ prelude: string; vars: Map<string, string> }> = [];
  let buf = '';
  const decl = () => {
    const m = buf.match(/^\s*--([\w-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (m && stack.length) stack[stack.length - 1].vars.set(m[1], m[2]);
    buf = '';
  };
  for (const ch of css) {
    if (ch === '{') { stack.push({ prelude: buf.trim(), vars: new Map() }); buf = ''; }
    else if (ch === ';') decl();
    else if (ch === '}') {
      decl();
      const b = stack.pop();
      if (b?.vars.size) {
        const at = (p: string) => p.startsWith('@');
        // `@theme { … }` is Tailwind v4's default theme: the same as :root
        const own = /^@theme\b/.test(b.prelude) ? ':root' : b.prelude;
        out.push({
          selector: [...stack.filter(s => !at(s.prelude)).map(s => s.prelude), own].join(' '),
          media: stack.filter(s => s.prelude.startsWith('@media')).map(s => s.prelude).join(' '),
          vars: b.vars,
        });
      }
    } else buf += ch;
  }
  return out;
}

/** 'base' for the default theme, a mode's name for a theme, null for a scoped rule (`.card`, `.dark .lp`) */
export function modeOf(b: Pick<Block, 'selector' | 'media'>): string | null {
  for (const part of b.selector.split(',').map(s => s.trim())) {
    if (/^(:root|html|:host)$/.test(part)) {
      if (!b.media) return 'base';
      return /prefers-color-scheme:\s*dark/.test(b.media) ? 'dark' : null;
    }
    const m = part.match(/^(?::root|html|body)?(?:\.(dark|light)|\.theme-([\w-]+)|\[data-(?:theme|mode|color-scheme)=["']?([\w-]+)["']?\])$/);
    if (m && !b.media) return m[1] ?? m[2] ?? m[3];
  }
  return null;
}

function cssOf(cwd: string): string | null {
  for (const f of CSS_CANDIDATES) {
    try { return readFileSync(join(cwd, f), 'utf8'); } catch { /* next */ }
  }
  return null;
}

/** `var(--x)` (with or without a fallback), followed through other vars */
function resolve(value: string, lookup: (name: string) => string | undefined, depth = 0): string | undefined {
  const m = value.trim().match(/^var\(\s*--([\w-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (!m) return value.trim();
  if (depth > 6) return undefined;
  const next = lookup(m[1]) ?? m[2];
  return next === undefined ? undefined : resolve(next, lookup, depth + 1);
}

function baseVars(blocks: Block[]): Map<string, string> {
  const base = new Map<string, string>();
  for (const b of blocks) if (modeOf(b) === 'base') for (const [k, v] of b.vars) base.set(k, v);
  return base;
}

// ── Modes ──────────────────────────────────────────────────────────────────

/**
 * The project's themes, each as the tokens it changes. token-detect names a CSS token after
 * its variable (`--brand` → `color.brand`), so a theme's override is found by that name.
 */
export function tokenModes(cwd: string, tokens: DsToken[], css = cssOf(cwd)): DsMode[] {
  if (!css) return [];
  const blocks = cssBlocks(css);
  const base = baseVars(blocks);
  const themes = new Map<string, Map<string, string>>();
  for (const b of blocks) {
    const mode = modeOf(b);
    if (!mode || mode === 'base') continue;
    const vars = themes.get(mode) ?? new Map<string, string>();
    for (const [k, v] of b.vars) vars.set(k, v);
    themes.set(mode, vars);
  }
  const out: DsMode[] = [];
  for (const [name, vars] of themes) {
    const lookup = (n: string) => vars.get(n) ?? base.get(n);
    const values: Record<string, string> = {};
    for (const t of tokens) {
      if (t.type === 'font' || t.scale) continue;
      const v = t.name.slice(t.name.indexOf('.') + 1);
      if (!vars.has(v)) continue;
      const value = resolve(vars.get(v)!, lookup);
      if (value && value !== t.value) values[t.name] = value;
    }
    if (Object.keys(values).length) out.push({ name, values });
  }
  return out;
}

// ── Fonts ──────────────────────────────────────────────────────────────────

const LAYOUTS = [
  'app/layout.tsx', 'app/layout.jsx', 'src/app/layout.tsx', 'src/app/layout.jsx',
  'pages/_app.tsx', 'pages/_app.jsx', 'src/pages/_app.tsx', 'src/pages/_app.jsx',
  'app/fonts.ts', 'src/app/fonts.ts', 'lib/fonts.ts', 'src/lib/fonts.ts', 'src/fonts.ts',
];
const GENERIC = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-(sans-serif|serif|monospace|rounded)|-apple-system|BlinkMacSystemFont|inherit|initial)$/i;
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** next/font's families by the CSS variable they set: `Geist({ variable: '--font-geist-sans' })` → Geist */
export function nextFonts(code: string): Map<string, string> {
  const out = new Map<string, string>();
  const google = new Set<string>();
  for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]next\/font\/google['"]/g)) {
    for (const n of m[1].split(',')) { const id = n.trim().split(/\s+as\s+/)[0]; if (id) google.add(id); }
  }
  for (const m of code.matchAll(/\b([A-Z]\w*)\(\s*\{([^}]*)\}/g)) {
    const v = m[2].match(/variable\s*:\s*['"]--([\w-]+)['"]/);
    if (v && google.has(m[1])) out.set(v[1], m[1].replace(/_/g, ' '));
  }
  // The geist package: `GeistSans` sets --font-geist-sans and is the family "Geist"
  for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]geist\/font\/[\w-]+['"]/g)) {
    for (const n of m[1].split(',')) {
      const id = n.trim().split(/\s+as\s+/)[0];
      if (!/^Geist\w+$/.test(id)) continue;
      out.set(`font-${kebab(id)}`, id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/ Sans$/, ''));
    }
  }
  return out;
}

/** `--font-sans` and friends as font families — the family's name, not a stack */
export function fontTokens(cwd: string, css = cssOf(cwd)): DsToken[] {
  let code = '';
  for (const f of LAYOUTS) { try { code += readFileSync(join(cwd, f), 'utf8') + '\n'; } catch { /* absent */ } }
  const loaded = nextFonts(code);
  const base = css ? baseVars(cssBlocks(css)) : new Map<string, string>();
  const out: DsToken[] = [];
  for (const [k, v] of base) {
    const m = k.match(/^font-([\w-]+)$/);
    // Tailwind's --font-weight-* are weights; next/font's own variables are what the aliases point at
    if (!m || /^(weight|size|feature|variation)/.test(m[1]) || loaded.has(k)) continue;
    const ref = v.trim().match(/^var\(\s*--([\w-]+)/);
    const family = ref ? loaded.get(ref[1]) : v.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (family && !GENERIC.test(family) && !family.startsWith('var(')) out.push({ name: `font.${m[1]}`, value: family, type: 'font' });
  }
  // No aliases in the CSS: the fonts the app loads, by their own variable
  if (!out.length) for (const [k, family] of loaded) out.push({ name: `font.${k.replace(/^font-/, '')}`, value: family, type: 'font' });
  return out;
}

// ── Tailwind's scale, the steps in use ─────────────────────────────────────

const RADIUS: Record<3 | 4, Record<string, number>> = {
  4: { xs: 2, sm: 4, DEFAULT: 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, '4xl': 32 },
  3: { sm: 2, DEFAULT: 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24 },
};
const TEXT: Record<string, number> = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72, '8xl': 96, '9xl': 128 };
const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.vercel', '.ilse', 'public', 'storybook-static']);
const MAX_FILES = 1500;

function sources(dir: string, out: string[], depth = 0): void {
  if (depth > 10 || out.length >= MAX_FILES) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name.startsWith('.') || out.length >= MAX_FILES) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { if (!SKIP.has(name)) sources(full, out, depth + 1); }
    else if (/\.(tsx|jsx|vue|svelte|astro|html|mdx)$/.test(name) && !/\.(test|spec|stories)\./.test(name)) out.push(full);
  }
}

/** The steps a file's classes use: `md:px-4` → spacing 4, `rounded-lg` → lg, `text-sm` → sm */
export function scaleSteps(code: string, into = { spacing: new Set<string>(), radius: new Set<string>(), text: new Set<string>() }) {
  for (const m of code.matchAll(/(?<![\w-])-?(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy])-(\d+(?:\.5)?)(?![\w.\-\/])/g)) {
    if (m[1] !== '0') into.spacing.add(m[1]);
  }
  for (const m of code.matchAll(/(?<![\w-])rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?(?:-(xs|sm|md|lg|xl|[2-4]xl))?(?![\w-])/g)) {
    into.radius.add(m[1] ?? 'DEFAULT');
  }
  for (const m of code.matchAll(/(?<![\w-])text-(xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g)) into.text.add(m[1]);
  return into;
}

const px = (v: string | undefined): number | undefined => {
  const m = v?.trim().match(/^(-?[\d.]+)(px|rem)$/);
  return m ? parseFloat(m[1]) * (m[2] === 'rem' ? 16 : 1) : undefined;
};
const fmt = (n: number) => `${Math.round(n * 100) / 100}px`;

export function tailwindMajor(cwd: string): 3 | 4 | null {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const v = pkg.dependencies?.tailwindcss ?? pkg.devDependencies?.tailwindcss;
    if (!v) return null;
    return parseInt(v.replace(/^[^\d]*/, ''), 10) >= 4 ? 4 : 3;
  } catch { return null; }
}

/** The Tailwind steps the project uses, with the value the project's theme gives them (else Tailwind's) */
export function tailwindScale(cwd: string, css = cssOf(cwd)): DsToken[] {
  const major = tailwindMajor(cwd);
  if (!major) return [];
  const files: string[] = [];
  sources(cwd, files);
  const used = { spacing: new Set<string>(), radius: new Set<string>(), text: new Set<string>() };
  for (const f of files) { try { scaleSteps(readFileSync(f, 'utf8'), used); } catch { /* unreadable */ } }
  const theme = css ? baseVars(cssBlocks(css)) : new Map<string, string>();
  const unit = px(theme.get('spacing')) ?? 4;
  const num = (a: string, b: string) => parseFloat(a) - parseFloat(b);
  const out: DsToken[] = [];
  for (const s of [...used.spacing].sort(num)) {
    // A dot can't be in a DTCG name: `0.5` is `0_5`, as Tailwind v4 names its variables
    out.push({ name: `spacing.${s.replace('.', '_')}`, value: fmt(px(theme.get(`spacing-${s.replace('.', '_')}`)) ?? parseFloat(s) * unit), type: 'spacing', scale: true });
  }
  const radii = RADIUS[major];
  for (const k of Object.keys(radii)) if (used.radius.has(k)) {
    const own = px(theme.get(k === 'DEFAULT' ? 'radius' : `radius-${k}`));
    out.push({ name: `rounded.${k === 'DEFAULT' ? 'default' : k}`, value: fmt(own ?? radii[k]), type: 'spacing', scale: own === undefined });
  }
  for (const k of Object.keys(TEXT)) if (used.text.has(k)) {
    const own = px(theme.get(`text-${k}`));
    out.push({ name: `typography.${k}`, value: fmt(own ?? TEXT[k]), type: 'typography', scale: own === undefined });
  }
  return out;
}

// The Library asks on every refresh; reading the app's files once every few seconds is enough
const recent = new Map<string, { at: number; tokens: DsToken[] }>();

/**
 * Fonts and the scale in use, added to the tokens the project declares (those win on a clash).
 * The DS's own DESIGN.md is read back as declared tokens: the same name and value is the same
 * token, kept as found here (a scale step stays one).
 */
export function moreTokens(cwd: string, tokens: DsToken[]): DsToken[] {
  if (!existsSync(cwd)) return tokens;
  let found = recent.get(cwd);
  if (!found || Date.now() - found.at > 5000) {
    const css = cssOf(cwd);
    found = { at: Date.now(), tokens: [...fontTokens(cwd, css), ...tailwindScale(cwd, css)] };
    recent.set(cwd, found);
  }
  const mine = new Map(found.tokens.map(t => [t.name, t]));
  const kept = tokens.map(t => mine.get(t.name)?.value === t.value ? mine.get(t.name)! : t);
  const have = new Set(kept.map(t => t.name));
  return [...kept, ...found.tokens.filter(t => !have.has(t.name))];
}
