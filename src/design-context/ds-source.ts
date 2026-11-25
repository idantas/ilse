/**
 * The design system a project is connected to: a package it depends on
 * (`@acme/ui`) that is one. Read only, no AI, no network.
 *
 * Found the way Node finds packages — `node_modules` in the project or any
 * folder above it, so a monorepo's hoisted install counts — among the
 * dependencies of the project and, at a workspace root, of its workspaces.
 *
 * What makes a dependency "the DS", strongest first:
 * 1. declared: `.ilserc.json` → `"designSystem": "@acme/ui"`;
 * 2. it ships a components manifest (`components.json` with `components[]`,
 *    or a shadcn `registry.json`) or W3C tokens (`tokens.json`);
 * 3. the project's CSS imports its theme (`@import "@acme/ui/theme.css"`);
 * 4. its description or keywords say "design system".
 *
 * What the package ships is read as is: its components manifest (purpose,
 * when to use, props and values) and its tokens. Nothing is copied into the
 * project.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface DsManifestProp { values?: string[]; default?: string; notes?: string }
export interface DsManifestComponent {
  name: string;
  /** The group the DS puts it in, by its label (`Actions`) */
  category?: string;
  purpose?: string;
  useWhen?: string[];
  avoidWhen?: Array<{ when: string; use?: string }>;
  props?: Record<string, DsManifestProp>;
}
export interface DsManifest {
  components: DsManifestComponent[];
  /** Components the package exports without documentation (`accordion`) */
  withoutMeta: string[];
  /** The file it was read from (absolute) */
  file: string;
}

export interface ConnectedDs {
  name: string;
  version?: string;
  /** The package's folder */
  root: string;
  signal: 'declared' | 'manifest' | 'css' | 'description';
  manifest?: DsManifest;
  /** Its W3C tokens file, when it ships one */
  tokensFile?: string;
  /** Its stylesheet with the theme's values (`theme.css`, `tokens.css`) */
  themeFile?: string;
  /** Its type declarations (`types` in package.json) */
  typesFile?: string;
}

function readJson(file: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return null; }
}

const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** `@acme/ui/theme.css` → `@acme/ui` */
export function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The folder of package `name` as Node resolves it from `cwd`: its node_modules or one above */
export function findPackage(cwd: string, name: string): string | null {
  let dir = resolve(cwd);
  for (let i = 0; i < 12; i++) {
    const root = join(dir, 'node_modules', name);
    if (isDir(root)) return root;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** `packages/*`, `web` → the workspace folders that exist, from the root's package.json (npm/yarn) or pnpm-workspace.yaml */
export function workspaceDirs(cwd: string): string[] {
  const pkg = readJson(join(cwd, 'package.json'));
  const ws = pkg?.workspaces;
  let globs: string[] = Array.isArray(ws) ? ws.map(String)
    : ws && typeof ws === 'object' && Array.isArray((ws as { packages?: unknown }).packages) ? (ws as { packages: unknown[] }).packages.map(String)
    : [];
  if (!globs.length) {
    try {
      const yaml = readFileSync(join(cwd, 'pnpm-workspace.yaml'), 'utf8');
      globs = [...yaml.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map(m => m[1]);
    } catch { /* not a pnpm workspace */ }
  }
  const out: string[] = [];
  for (const g of globs) {
    if (g.startsWith('!')) continue;
    const clean = g.replace(/\/\*\*?$/, '').replace(/^\.\//, '');
    if (g.endsWith('*')) {
      const base = join(cwd, clean);
      let names: string[] = [];
      try { names = readdirSync(base); } catch { /* missing */ }
      for (const n of names) if (!n.startsWith('.') && existsSync(join(base, n, 'package.json'))) out.push(join(base, n));
    } else if (existsSync(join(cwd, clean, 'package.json'))) out.push(join(cwd, clean));
  }
  return out.slice(0, 60);
}

const depsOf = (pkg: Record<string, unknown> | null) =>
  Object.keys({ ...(pkg?.dependencies as object ?? {}), ...(pkg?.peerDependencies as object ?? {}) });

/** The dependencies of the project at `cwd` and, at a workspace root, of every workspace */
export function projectDependencies(cwd: string): string[] {
  const all = new Set(depsOf(readJson(join(cwd, 'package.json'))));
  for (const dir of workspaceDirs(cwd)) for (const d of depsOf(readJson(join(dir, 'package.json')))) all.add(d);
  return [...all];
}

/** `./theme.css` in `exports` → its file in the package (string targets, or `default`/`import`/`types` conditions) */
export function exportedFile(root: string, sub: string, meta?: Record<string, unknown> | null): string | null {
  const pkg = meta ?? readJson(join(root, 'package.json'));
  const exp = pkg?.exports as Record<string, unknown> | string | undefined;
  const key = sub ? `./${sub.replace(/^\.?\//, '')}` : '.';
  let target: unknown = typeof exp === 'string' ? (key === '.' ? exp : undefined) : exp?.[key];
  if (target && typeof target === 'object') {
    const t = target as Record<string, unknown>;
    target = t.style ?? t.default ?? t.import ?? t.require ?? t.types;
  }
  const candidates = [typeof target === 'string' ? target : null, sub ? sub : null, sub ? `dist/${sub}` : null].filter((x): x is string => !!x);
  for (const c of candidates) {
    const file = join(root, c);
    if (existsSync(file) && !isDir(file)) return file;
  }
  return null;
}

const pascal = (s: string) => s.replace(/(^|[-_\s])(\w)/g, (_, __, c: string) => c.toUpperCase());
const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];

/** A components manifest in Ilse's reading: the anticaos format (`components[]`) or a shadcn registry (`items[]`) */
export function readManifest(file: string): DsManifest | null {
  const json = readJson(file);
  if (!json) return null;
  if (Array.isArray(json.components)) {
    const labels = new Map<string, string>();
    for (const c of Array.isArray(json.categories) ? json.categories : []) {
      const cat = c as Record<string, unknown>;
      if (typeof cat?.id === 'string') labels.set(cat.id, typeof cat.label === 'string' ? cat.label : cat.id);
    }
    const components: DsManifestComponent[] = [];
    for (const raw of json.components as unknown[]) {
      const c = raw as Record<string, unknown>;
      if (typeof c?.name !== 'string' || !/^[A-Z][\w]*$/.test(c.name)) continue;
      const props: Record<string, DsManifestProp> = {};
      for (const [k, v] of Object.entries((c.props as Record<string, unknown>) ?? {})) {
        const p = v as Record<string, unknown>;
        const values = strings(p?.values);
        props[k] = {
          ...(values.length ? { values } : {}),
          ...(typeof p?.default === 'string' || typeof p?.default === 'number' ? { default: String(p.default) } : {}),
          ...(typeof p?.notes === 'string' ? { notes: p.notes } : {}),
        };
      }
      const avoid = (Array.isArray(c.avoidWhen) ? c.avoidWhen : []).flatMap((a): Array<{ when: string; use?: string }> => {
        if (typeof a === 'string') return [{ when: a }];
        const o = a as Record<string, unknown>;
        return typeof o?.when === 'string' ? [{ when: o.when, ...(typeof o.use === 'string' ? { use: o.use } : {}) }] : [];
      });
      const category = typeof c.category === 'string' ? labels.get(c.category) ?? c.category : undefined;
      components.push({
        name: c.name,
        ...(category ? { category } : {}),
        ...(typeof c.purpose === 'string' ? { purpose: c.purpose } : typeof c.description === 'string' ? { purpose: c.description } : {}),
        ...(strings(c.useWhen).length ? { useWhen: strings(c.useWhen) } : {}),
        ...(avoid.length ? { avoidWhen: avoid } : {}),
        ...(Object.keys(props).length ? { props } : {}),
      });
    }
    return components.length ? { components, withoutMeta: strings(json.withoutMeta), file } : null;
  }
  // shadcn registry: `items[]` of `registry:ui` with a description
  if (Array.isArray(json.items)) {
    const components = (json.items as unknown[]).flatMap((raw): DsManifestComponent[] => {
      const i = raw as Record<string, unknown>;
      if (typeof i?.name !== 'string' || (typeof i.type === 'string' && i.type !== 'registry:ui' && i.type !== 'registry:component')) return [];
      const name = typeof i.title === 'string' && /^[A-Z]\w*$/.test(i.title) ? i.title : pascal(i.name);
      return [{ name, ...(typeof i.description === 'string' ? { purpose: i.description } : {}) }];
    });
    return components.length ? { components, withoutMeta: [], file } : null;
  }
  return null;
}

/** A W3C (DTCG) tokens file: some leaf with `$value` */
function isDtcg(file: string): boolean {
  const json = readJson(file);
  if (!json) return false;
  let found = false;
  const walk = (o: unknown, depth: number) => {
    if (found || depth > 6 || !o || typeof o !== 'object') return;
    if ('$value' in (o as object)) { found = true; return; }
    for (const v of Object.values(o as object)) walk(v, depth + 1);
  };
  walk(json, 0);
  return found;
}

/** The package specs the project's stylesheets `@import` (`@acme/ui/theme.css`) */
function cssPackageImports(dirs: string[]): string[] {
  const files = ['src/app/globals.css', 'app/globals.css', 'src/globals.css', 'src/styles/globals.css', 'styles/globals.css', 'src/index.css', 'src/app/layout.css'];
  const out: string[] = [];
  for (const d of dirs) for (const f of files) {
    let css: string;
    try { css = readFileSync(join(d, f), 'utf8'); } catch { continue; }
    for (const m of css.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g)) if (!/^(\.|\/|https?:)/.test(m[1])) out.push(m[1]);
  }
  return out;
}

function describe(name: string, root: string, signal: ConnectedDs['signal']): ConnectedDs {
  const meta = readJson(join(root, 'package.json'));
  const file = (sub: string) => exportedFile(root, sub, meta);
  const manifestFile = file('components.json') ?? file('registry.json');
  const manifest = manifestFile ? readManifest(manifestFile) ?? undefined : undefined;
  const tokensFile = file('tokens.json');
  const themeFile = file('theme.css') ?? file('tokens.css');
  const types = typeof meta?.types === 'string' ? meta.types : typeof meta?.typings === 'string' ? meta.typings : null;
  const typesFile = types && existsSync(join(root, types)) ? join(root, types) : exportedFile(root, '', { exports: { '.': (meta?.exports as Record<string, unknown> | undefined)?.['.'] } }) ?? undefined;
  return {
    name, root, signal,
    ...(typeof meta?.version === 'string' ? { version: meta.version } : {}),
    ...(manifest ? { manifest } : {}),
    ...(tokensFile && isDtcg(tokensFile) ? { tokensFile } : {}),
    ...(themeFile ? { themeFile } : {}),
    ...(typesFile && /\.d\.[mc]?ts$/.test(typesFile) ? { typesFile } : {}),
  };
}

const cache = new Map<string, { at: number; ds: ConnectedDs | null }>();

/** The design system package this project is connected to, or null. Cached a few seconds: the catalog asks often */
export function connectedDs(cwd: string, now = Date.now()): ConnectedDs | null {
  const hit = cache.get(cwd);
  if (hit && now - hit.at < 5000) return hit.ds;
  const ds = findConnectedDs(cwd);
  cache.set(cwd, { at: now, ds });
  return ds;
}

export function findConnectedDs(cwd: string): ConnectedDs | null {
  // 1. Declared by the person
  const declared = readJson(join(cwd, '.ilserc.json'))?.designSystem;
  if (typeof declared === 'string' && declared.trim()) {
    const root = findPackage(cwd, declared.trim());
    if (root) return describe(declared.trim(), root, 'declared');
  }
  const deps = projectDependencies(cwd).filter(d => !/^(react|react-dom|next|vite|typescript|tailwindcss|@types\/.*)$/.test(d));
  const found = deps.flatMap(d => { const root = findPackage(cwd, d); return root ? [{ d, root }] : []; });
  // 2. Ships a manifest or W3C tokens
  for (const { d, root } of found) {
    const meta = readJson(join(root, 'package.json'));
    const hasManifest = !!(exportedFile(root, 'components.json', meta) && readManifest(exportedFile(root, 'components.json', meta)!))
      || !!(exportedFile(root, 'registry.json', meta) && readManifest(exportedFile(root, 'registry.json', meta)!));
    const tokens = exportedFile(root, 'tokens.json', meta);
    if (hasManifest || (tokens && isDtcg(tokens))) return describe(d, root, 'manifest');
  }
  // 3. Its theme imported by the project's CSS
  const imported = new Set(cssPackageImports([cwd, ...workspaceDirs(cwd)]).map(packageName));
  for (const { d, root } of found) if (imported.has(d) && !/^(tailwindcss|tw-animate-css|@tailwindcss\/.*)$/.test(d)) return describe(d, root, 'css');
  // 4. Says it's a design system
  for (const { d, root } of found) {
    const meta = readJson(join(root, 'package.json'));
    const words = [String(meta?.description ?? ''), ...((meta?.keywords as unknown[]) ?? []).map(String)].join(' ');
    if (/design[\s-]?system/i.test(words)) return describe(d, root, 'description');
  }
  return null;
}

/** "Quando usar" and "Não use para" as the DS writes them, for the Library's card */
export function manifestNote(c: DsManifestComponent): { whenToUse?: string; avoid?: string } {
  // "Purpose. Case one; case two." — the manifest's cases are fragments without a full stop
  const dot = (t: string) => /[.!?…]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`;
  const cases = (c.useWhen ?? []).map(u => u.trim()).filter(Boolean);
  const when = [c.purpose ? dot(c.purpose) : '', cases.length ? dot(cases.join('; ')) : ''].filter(Boolean).join(' ');
  const avoid = (c.avoidWhen ?? []).map(a => a.use ? `${a.when} → ${a.use}` : a.when).join('; ');
  return { ...(when ? { whenToUse: when } : {}), ...(avoid ? { avoid } : {}) };
}
