/**
 * "Create DS": the project's design system, written down from its code — no AI.
 *
 * The catalog already knows each component (props, values, defaults, where it's used,
 * Base or Product) and token-detect knows the project's tokens. Free writes them as
 * `.ilse/ds/DESIGN.md` (Google's DESIGN.md format: tokens in the front matter, components
 * in prose), so the user reads their DS and any agent — with or without Ilse running —
 * builds with it. Taking the DS to other tools is Pro (`ProPlugin.dsFormats`): tokens.json
 * (W3C, Figma / Tokens Studio) and the shadcn registry, from the data handed over here.
 *
 * Written only when the user asks (`ilse ds`, or Create DS in the toolbar).
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, appendFileSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import type { CatalogEntry, CatalogProp } from './catalog.js';
import type { DetectedToken } from '../setup/token-detect.js';
import type { DsInput, DsNote, AskAgent } from '../pro/types.js';
import { connectedDs, manifestNote } from './ds-source.js';
import { createHash } from 'node:crypto';
import { instructionsFile } from '../git/commit-context.js';
import { moreTokens, tokenModes, type DsToken, type DsMode } from './ds-tokens.js';
import { ensureScanIgnore } from '../config/scan-ignore.js';
import { t } from '../i18n/index.js';
import { zipStore } from './zip.js';

export const DS_DIR = join('.ilse', 'ds');

/** What Ilse knows of a component that shadcn's schema has no field for */
export interface ComponentContract {
  source: string;
  importAs: 'named' | 'default';
  layer?: string;
  kind?: string;
  feature?: string;
  renders?: string;
  uses: number;
  props: Array<{ name: string; required: boolean; kind: CatalogProp['kind']; values?: string[]; default?: string }>;
  example?: string;
}

/** The project's own components: the ones the DS is made of (libraries are dependencies, not the DS) */
export function dsComponents(catalog: CatalogEntry[]): CatalogEntry[] {
  // A design system package's components are the project's DS too (`@acme/ui`); other libraries aren't
  return catalog.filter(c => !c.library || isDsPackage(c.ds)).sort((a, b) =>
    (a.layer === b.layer ? 0 : a.layer === 'base' ? -1 : 1) || b.uses - a.uses || a.name.localeCompare(b.name));
}

/** `@acme/ui`, not Storybook or shadcn/ui (those name the project's own files) */
const isDsPackage = (ds?: string) => !!ds && ds !== 'Storybook' && ds !== 'shadcn/ui';

export function contractOf(c: CatalogEntry): ComponentContract {
  return {
    source: c.source,
    importAs: c.importAs,
    ...(c.layer ? { layer: c.layer } : {}),
    ...(c.kind ? { kind: c.kind } : {}),
    ...(c.featureLabel ?? c.feature ? { feature: c.featureLabel ?? c.feature } : {}),
    ...(c.renders ? { renders: c.renders } : {}),
    uses: c.uses,
    props: c.props.map(p => ({
      name: p.name, required: p.required, kind: p.kind,
      ...(p.kind === 'enum' && p.values.length ? { values: p.values } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
    })),
    ...(c.example ? { example: c.example.code } : {}),
  };
}

// One color: `#hex`, a name, or one color function with nothing after it.
// token-detect files `--shadow: rgba(…) 0 10px 15px` under color because it holds rgba —
// as a DTCG color it's invalid, and an agent would paint with a shadow string.
const ONE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*(\([^()]*\)[^()]*)*\))$/i;

/**
 * The tokens the DS can state truthfully: a "color" that isn't one color stays out.
 * With the project's folder, also its fonts and the Tailwind steps it uses (ds-tokens.ts).
 */
export function dsTokens(tokens: Array<DetectedToken | DsToken>, cwd?: string): DsToken[] {
  const own = tokens.filter(t => t.type !== 'color' || ONE_COLOR.test(t.value.trim()));
  if (!cwd) return own;
  // The person's words on a token travel with it into every format
  const said = readDsEdits(cwd).tokens;
  return moreTokens(cwd, own).map(t => said[t.name]?.description ? { ...t, description: said[t.name].description } : t);
}

// ── What the person wrote: `.ilse/ds/edits.json` ───────────────────────────
// Every component and token can carry its reasoning, like a registry item's description. The
// agent writes one when there's none (Pro); what the person writes wins and is never rewritten.

export interface DsEdits {
  components: Record<string, Partial<DsNote>>;
  tokens: Record<string, { description?: string }>;
}

export function readDsEdits(cwd: string): DsEdits {
  try {
    const raw = JSON.parse(readFileSync(join(cwd, DS_DIR, 'edits.json'), 'utf8')) as Partial<DsEdits>;
    return { components: raw.components ?? {}, tokens: raw.tokens ?? {} };
  } catch { return { components: {}, tokens: {} }; }
}

/** One edit: a component's "when to use / not for", or a token's description. Empty text clears it */
export function writeDsEdit(cwd: string, kind: 'component' | 'token', name: string, fields: { whenToUse?: string; avoid?: string; description?: string }): DsEdits {
  const edits = readDsEdits(cwd);
  const clean = (v?: string) => v === undefined ? undefined : v.trim().slice(0, 600);
  if (kind === 'component') {
    const next = { ...edits.components[name] };
    for (const k of ['whenToUse', 'avoid'] as const) {
      const v = clean(fields[k]);
      if (v === undefined) continue;
      if (v) next[k] = v; else delete next[k];
    }
    if (Object.keys(next).length) edits.components[name] = next; else delete edits.components[name];
  } else {
    const v = clean(fields.description);
    if (v) edits.tokens[name] = { description: v }; else if (v !== undefined) delete edits.tokens[name];
  }
  ensureScanIgnore(cwd);
  mkdirSync(join(cwd, DS_DIR), { recursive: true });
  writeFileSync(join(cwd, DS_DIR, 'edits.json'), JSON.stringify(edits, null, 2) + '\n', 'utf8');
  return edits;
}

// Plain only when YAML can't misread it: `#` starts a comment, `:` a map, a leading digit a number
const yamlValue = (v: string) => /^[a-zA-Z][\w.-]*$/.test(v) ? v : JSON.stringify(v);

/** An example cut out of a file keeps its indentation after the first line: take it off */
export function dedent(code: string): string {
  const [first, ...rest] = code.split('\n');
  const indents = rest.filter(l => l.trim()).map(l => l.match(/^ */)![0].length);
  if (!indents.length) return code;
  const pad = Math.min(...indents);
  return [first, ...rest.map(l => l.slice(pad))].join('\n');
}

// What every element takes: an agent knows these without being told, and on 700 components they were half the file
const COMMON_PROPS = new Set(['id', 'role', 'tabIndex', 'autoComplete', 'autoFocus', 'form', 'style', 'className', 'ref', 'key', 'dir', 'lang', 'hidden', 'draggable', 'spellCheck']);
const HTML_TYPES = new Set(['button', 'submit', 'reset', 'text', 'email', 'password', 'number', 'search', 'tel', 'url', 'date', 'time', 'datetime-local', 'month', 'week', 'checkbox', 'radio', 'file', 'hidden', 'range', 'color', 'image']);
// `type` is the element's when its values are HTML's (`submit | button`); an Alert's `type: error | warning` is the component's own
const commonProp = (p: CatalogProp) => COMMON_PROPS.has(p.name) || /^(aria|data)-/.test(p.name)
  || (p.name === 'type' && (p.kind !== 'enum' || p.values.every(v => HTML_TYPES.has(v))));
// `<Spinner />` or `<Badge>New</Badge>`: the import line says as much
const trivialExample = (code: string) => /^<([\w.]+)\s*(\/>|>[^<{]*<\/\1>)$/.test(code.trim());

/** Above this many components DESIGN.md keeps the most used in full and sends the rest to one file per area */
export const DS_SPLIT_AT = 60;
const FULL_BASE = 40;
const FULL_PRODUCT = 30;
export const DS_AREAS_DIR = 'components';

const areaOf = (c: CatalogEntry) => c.featureLabel ?? c.feature ?? 'other';
export const areaFile = (area: string) => `${DS_AREAS_DIR}/${area.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other'}.md`;

/**
 * The DS as files: DESIGN.md (front matter Ilse itself reads back, design-md.ts, then prose for agents)
 * and, on a large project, `components/<area>.md`. An agent pays for every line it reads on every task:
 * the rules, tokens, Base and the most used Product components stay in DESIGN.md; the rest get one line
 * there and their full entry in their area's file, read only when working in that area.
 */
export function buildDsFiles(name: string, catalog: CatalogEntry[], tokens: DsToken[], machine: string[] = [], notes: Record<string, DsNote> = {}, rules: string[] = [], modes: DsMode[] = [], pkg?: DsPackageInfo): Record<string, string> {
  const by = (prefix: string) => tokens.filter(t => t.name.startsWith(prefix + '.')).map(t => [t.name.slice(prefix.length + 1), t.value] as const);
  // A scale reads small to large, however the tokens were found
  const scale = (prefix: string) => by(prefix).sort((a, b) => (parseFloat(a[1]) || 0) - (parseFloat(b[1]) || 0));
  const front: string[] = ['---', `name: ${yamlValue(name)}`];
  const colors = by('color');
  if (colors.length) front.push('colors:', ...colors.map(([k, v]) => `  ${k}: ${yamlValue(v)}`));
  const spacing = scale('spacing');
  if (spacing.length) front.push('spacing:', ...spacing.map(([k, v]) => `  ${k}: ${yamlValue(v)}`));
  const rounded = scale('rounded').concat(scale('radius'));
  if (rounded.length) front.push('rounded:', ...rounded.map(([k, v]) => `  ${k}: ${yamlValue(v)}`));
  const type = scale('typography');
  const fonts = by('font');
  // DESIGN.md's typography levels carry fontSize or fontFamily: a font is a level with only its family
  if (type.length || fonts.length) front.push('typography:',
    ...fonts.flatMap(([k, v]) => [`  font-${k}:`, `    fontFamily: ${yamlValue(v)}`]),
    ...type.flatMap(([k, v]) => [`  ${k}:`, `    fontSize: ${yamlValue(v)}`]));
  front.push('---');

  const comps = dsComponents(catalog);
  const describe = (c: CatalogEntry) => {
    // The file, project-relative: the agent writes the import the way this project does (alias or path)
    const imp = c.importAs === 'named' ? `import { ${c.name} }` : `import ${c.name}`;
    const prop = (p: CatalogProp) => {
      const values = p.kind === 'enum' && p.values.length ? `: ${p.values.slice(0, 8).map(v => `\`${v}\``).join(' | ')}${p.values.length > 8 ? ' | …' : ''}` : p.kind === 'boolean' ? ': boolean' : '';
      return `\`${p.name}\`${p.required ? '' : '?'}${values}${p.default !== undefined ? ` (default \`${p.default}\`)` : ''}`;
    };
    const own = c.props.filter(p => !commonProp(p));
    // A prop the code comments carries the team's rule for it (which size where): one line each, rule beside it
    const props = own.filter(p => !p.doc).map(prop);
    const ruled = own.filter(p => p.doc).map(p => `- ${prop(p)}: ${p.doc}`);
    return [
      `### ${c.name}`,
      `\`${imp}\` from \`${c.source}\` · used ${c.uses}×${c.renders ? ` · renders <${c.renders}>` : ''}`,
      ...(notes[c.name]?.whenToUse ? [`When to use: ${notes[c.name].whenToUse}`] : []),
      ...(notes[c.name]?.avoid ? [`Not for: ${notes[c.name].avoid}`] : []),
      ...(ruled.length ? ['Props:', ...ruled, ...(props.length ? [`- ${props.join(', ')}`] : [])] : props.length ? [`Props: ${props.join(', ')}`] : []),
      ...(c.example && !trivialExample(c.example.code) ? ['```tsx', dedent(c.example.code), '```'] : []),
    ].join('\n');
  };
  const base = comps.filter(c => c.layer === 'base');
  const product = comps.filter(c => c.layer !== 'base');
  // dsComponents sorts by uses: the head of Product is what the agent reaches for most
  const split = comps.length > DS_SPLIT_AT;
  const fullBase = split ? base.slice(0, FULL_BASE) : base;
  const full = split ? product.slice(0, FULL_PRODUCT) : product;
  const areas = new Map<string, CatalogEntry[]>();
  // The rest of Base is one more area: a project can have 170 of them
  if (split && base.length > FULL_BASE) areas.set('Base', base.slice(FULL_BASE));
  for (const c of split ? product.slice(FULL_PRODUCT) : []) areas.set(areaOf(c), [...(areas.get(areaOf(c)) ?? []), c]);
  const short = (text: string) => text.length > 100 ? text.slice(0, 99).trimEnd() + '…' : text;
  const index = [...areas].flatMap(([area, list]) => [
    `### ${area} · \`${areaFile(area)}\``, '',
    ...list.map(c => `- \`${c.name}\` (${c.uses}×)${notes[c.name]?.whenToUse ? `: ${short(notes[c.name].whenToUse)}` : ''}`), '',
  ]);
  const main = [
    ...front,
    '',
    `# ${name} — design system`,
    '',
    'Written by Ilse from this project\'s code (`ilse ds`). It lists what already exists: build with it before writing anything new.',
    '',
    // The design system the project is connected to: where its components and rules really live
    ...(pkg ? [
      '## Design system',
      '',
      `This project uses the \`${pkg.name}\` design system${pkg.version ? ` (${pkg.version})` : ''}. Its components below come from the package: import them from \`${pkg.name}\`, never copy them into the project.${pkg.manifest ? ` Its own documentation of each component: \`${pkg.manifest}\`.` : ''}`,
      '',
    ] : []),
    '## Rules for agents',
    '',
    '- Use these components before creating new ones; compose them before writing a new one.',
    '- Use the props and values listed — not new variants, not inline styles to imitate one.',
    '- Colors, spacing and radius come from the tokens above, never raw values when a token exists.',
    '- A component in "Product" belongs to one feature; reuse it there, and ask before moving it to Base.',
    ...(split ? [`- Components under "More, by area" have one line here: before using or changing one, read its area's file in \`${DS_AREAS_DIR}/\`, next to this one.`] : []),
    // Learned from the fresh-agent test, approved by the person
    ...rules.map(r => `- ${r}`),
    '',
    // Themes: what each one changes, so an agent writing for dark mode uses the right token
    ...(modes.length ? ['## Themes', '', ...modes.map(m => `- **${m.name}**: ${Object.entries(m.values).map(([k, v]) => `\`${k}\` ${v}`).join(', ')}`), ''] : []),
    // Why a token exists, in the team's words: an agent picks `brand` over `clay` for the right reason
    ...(tokens.some(t => t.description) ? ['## Tokens, and why', '', ...tokens.filter(t => t.description).map(t => `- \`${t.name}\` (${t.value}): ${t.description}`), ''] : []),
    ...(fullBase.length ? [split ? '## Base, most used' : '## Base', '', ...fullBase.map(describe).flatMap(s => [s, ''])] : []),
    ...(full.length ? [split ? '## Product, most used' : '## Product', '', ...full.map(describe).flatMap(s => [s, ''])] : []),
    ...(index.length ? ['## More, by area', '', ...index] : []),
    // Only what was written: Free has DESIGN.md alone
    ...(machine.length ? [`Machine-readable, next to this file: ${machine.map(f => `\`${f}\``).join(', ')}.`, ''] : []),
  ].join('\n');
  return {
    'DESIGN.md': main,
    ...Object.fromEntries([...areas].map(([area, list]) => [areaFile(area), [
      `# ${name} — ${area}`, '',
      'Part of `../DESIGN.md`: its rules and tokens apply here.', '',
      ...list.map(describe).flatMap(s => [s, '']),
    ].join('\n')])),
  };
}

export interface DsPackageInfo { name: string; version?: string; /** Its components manifest, project-relative (`node_modules/@acme/ui/dist/components.json`) */ manifest?: string; components: number }

/** The connected design system package, as the Library and DESIGN.md name it; null without one */
export function dsPackageInfo(cwd: string): DsPackageInfo | null {
  const pkg = connectedDs(cwd);
  if (!pkg) return null;
  const manifestPath = pkg.manifest?.file;
  return {
    name: pkg.name,
    ...(pkg.version ? { version: pkg.version } : {}),
    ...(manifestPath ? { manifest: relative(cwd, manifestPath).split(sep).join('/') } : {}),
    components: pkg.manifest ? pkg.manifest.components.length + pkg.manifest.withoutMeta.length : 0,
  };
}

/** DESIGN.md alone */
export function buildDesignMd(...args: Parameters<typeof buildDsFiles>): string {
  return buildDsFiles(...args)['DESIGN.md'];
}

/** The project's name for the files: package.json's, else the folder's */
export function projectName(cwd: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name) return pkg.name;
  } catch { /* no package.json */ }
  return basename(cwd);
}

export interface DsExport { dir: string; files: string[]; components: number; tokens: number }

// The framework is the receiving project's, not something an item installs
const PROVIDED = new Set(['react', 'react-dom', 'next', 'react/jsx-runtime']);
const IMPORT_RE = /(?:^|\n)\s*import\s+(?:type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g;

/** What a component's file imports: npm packages, and the project's own components (by name) */
export function componentImports(code: string, names: Set<string>): { dependencies: string[]; requires: string[] } {
  const deps = new Set<string>();
  const req = new Set<string>();
  for (const m of code.matchAll(IMPORT_RE)) {
    const [, what, from] = m;
    if (/^import\s+type\b/.test(m[0].trim())) continue;
    const local = from.startsWith('.') || from.startsWith('/') || /^[@~#]\//.test(from);
    if (!local) {
      if (from.startsWith('node:')) continue;
      const pkg = from.startsWith('@') ? from.split('/').slice(0, 2).join('/') : from.split('/')[0];
      if (!PROVIDED.has(pkg)) deps.add(pkg);
      continue;
    }
    // `import { Button, buttonVariants } from '@/components/ui/button'`, `import Card from './Card'`
    for (const id of what.replace(/[{}]/g, ',').split(',').map(s => s.trim().split(/\s+as\s+/).pop()!.replace(/^type\s+/, '')).filter(Boolean)) {
      if (names.has(id)) req.add(id);
    }
  }
  return { dependencies: [...deps].sort(), requires: [...req].sort() };
}

function homepageOf(cwd: string): string | undefined {
  try {
    const h = (JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { homepage?: unknown }).homepage;
    return typeof h === 'string' && h ? h : undefined;
  } catch { return undefined; }
}

/** What Pro's formats are given: the core's reading, no paths to resolve again */
export function dsInput(cwd: string, dir: string, name: string, catalog: CatalogEntry[], tokens: DsToken[], notes: Record<string, DsNote> = {}): DsInput {
  // Pro's formats carry the project's own files: a DS package's components are in the package already
  const comps = dsComponents(catalog).filter(c => !c.library);
  const names = new Set(comps.map(c => c.name));
  const homepage = homepageOf(cwd);
  const modes = tokenModes(cwd, tokens);
  return {
    cwd, dir, name, tokens, ...(homepage ? { homepage } : {}), ...(modes.length ? { modes } : {}),
    components: comps.map(c => {
      let code = '';
      try { code = readFileSync(join(cwd, c.source), 'utf8'); } catch { /* moved since the catalog was read */ }
      const { dependencies, requires } = componentImports(code, names);
      return { name: c.name, folder: c.folder, layer: c.layer, contract: { ...contractOf(c), ...(notes[c.name] ?? {}) }, dependencies, requires: requires.filter(r => r !== c.name) };
    }),
  };
}

/** DESIGN.md always; Pro's formats (tokens.json, registry.json) when `formats` is given */
export function writeDs(cwd: string, catalog: CatalogEntry[], tokens: DetectedToken[], formats?: (input: DsInput) => string[], notes: Record<string, DsNote> = {}): DsExport {
  const name = projectName(cwd);
  ensureScanIgnore(cwd);
  const dir = join(cwd, DS_DIR);
  mkdirSync(dir, { recursive: true });
  const all = dsTokens(tokens, cwd);
  let machine: string[] = [];
  // Pro failing must not cost the user the free file
  try { machine = formats?.(dsInput(cwd, dir, name, catalog, all, notes)) ?? []; } catch { machine = []; }
  const prev = readDsState(cwd);
  const rules = prev?.rules ?? [];
  const docs = buildDsFiles(name, catalog, all, machine, notes, rules, tokenModes(cwd, all), dsPackageInfo(cwd) ?? undefined);
  // The area files are Ilse's alone: an area that's gone takes its file with it
  rmSync(join(dir, DS_AREAS_DIR), { recursive: true, force: true });
  for (const [file, content] of Object.entries(docs)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content, 'utf8');
  }
  writeDsState(cwd, catalog, all, notes, rules, prev?.publishTo);
  // The copy for people without Ilse follows every write; a folder that went away isn't recreated by surprise
  if (prev?.publishTo) try { publishDs(cwd, prev.publishTo, { components: dsComponents(catalog).length, tokens: all.length }); } catch { /* not ours any more, or unwritable */ }
  const areas = Object.keys(docs).length > 1 ? [DS_AREAS_DIR] : [];
  return { dir: DS_DIR, files: ['DESIGN.md', ...machine, ...areas].map(f => join(DS_DIR, f)), components: dsComponents(catalog).length, tokens: all.length };
}

// ── What the DS was written from: `.ilse/ds/state.json` ─────────────────────
// Each component's contract hash (props, values, layer — not how often it's used) and its note.
// Pro asks the agent only for components whose hash changed; the live DS diffs against it.

export interface DsState {
  writtenAt: string;
  components: Record<string, { hash: string } & Partial<DsNote>>;
  tokens: Record<string, string>;
  /** Rules for agents the person added (from the fresh-agent test); kept across rewrites */
  rules?: string[];
  /** Where the person publishes a copy for people without Ilse (project-relative, or absolute / `~/…`) */
  publishTo?: string;
}

export function contractHash(c: CatalogEntry): string {
  const { uses: _u, example: _e, ...shape } = contractOf(c);
  return createHash('sha1').update(JSON.stringify(shape)).digest('hex').slice(0, 12);
}

export function readDsState(cwd: string): DsState | null {
  try { return JSON.parse(readFileSync(join(cwd, DS_DIR, 'state.json'), 'utf8')) as DsState; } catch { return null; }
}

function writeDsState(cwd: string, catalog: CatalogEntry[], tokens: DsToken[], notes: Record<string, DsNote>, rules: string[] = [], publishTo?: string): void {
  const state: DsState = {
    writtenAt: new Date().toISOString(),
    components: Object.fromEntries(dsComponents(catalog).map(c => [c.name, { hash: contractHash(c), ...(notes[c.name] ?? {}) }])),
    tokens: Object.fromEntries(tokens.map(t => [t.name, t.value])),
    ...(rules.length ? { rules } : {}),
    ...(publishTo ? { publishTo } : {}),
  };
  writeFileSync(join(cwd, DS_DIR, 'state.json'), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** The notes still true (same contract), and the components that need one */
export function notesToKeep(cwd: string, catalog: CatalogEntry[]): { kept: Record<string, DsNote>; stale: CatalogEntry[] } {
  const prev = readDsState(cwd)?.components ?? {};
  const kept: Record<string, DsNote> = {};
  const stale: CatalogEntry[] = [];
  const said = readDsEdits(cwd).components;
  // The connected DS's own words: its purpose and "when to use" stand in for an agent's draft
  const pkg = connectedDs(cwd);
  const fromDs = new Map((pkg?.manifest?.components ?? []).map(c => [c.name, manifestNote(c)]));
  for (const c of dsComponents(catalog)) {
    const p = prev[c.name];
    const mine = said[c.name];
    const theirs = c.library && c.ds === pkg?.name ? fromDs.get(c.name) : undefined;
    if (theirs?.whenToUse && !mine?.whenToUse) {
      kept[c.name] = { whenToUse: theirs.whenToUse, ...(mine?.avoid ?? theirs.avoid ? { avoid: mine?.avoid ?? theirs.avoid! } : {}) };
      continue;
    }
    // The person's reasoning stands whatever the code does; the agent only fills what they left empty
    if (mine?.whenToUse) kept[c.name] = { whenToUse: mine.whenToUse, ...(mine.avoid ?? p?.avoid ? { avoid: mine.avoid ?? p!.avoid! } : {}) };
    else if (p?.whenToUse && p.hash === contractHash(c)) kept[c.name] = { whenToUse: p.whenToUse, ...(mine?.avoid ?? p.avoid ? { avoid: mine?.avoid ?? p.avoid! } : {}) };
    else stale.push(c);
  }
  return { kept, stale };
}

/** Each component's reasoning as the DS has it now (the person's words win), for the Library's card */
export function dsNotesByName(cwd: string, catalog: CatalogEntry[]): Record<string, DsNote & { edited?: boolean; fromDs?: boolean }> {
  const { kept } = notesToKeep(cwd, catalog);
  const said = readDsEdits(cwd).components;
  const out: Record<string, DsNote & { edited?: boolean; fromDs?: boolean }> = {};
  const pkg = connectedDs(cwd);
  const fromDs = new Set(pkg ? catalog.filter(c => c.library && c.ds === pkg.name).map(c => c.name) : []);
  for (const [name, note] of Object.entries(kept)) {
    out[name] = said[name]?.whenToUse ? { ...note, edited: true } : fromDs.has(name) ? { ...note, fromDs: true, ...(said[name] ? { edited: true } : {}) } : said[name] ? { ...note, edited: true } : note;
  }
  return out;
}

/**
 * Create DS with Pro's notes: the agent writes "when to use" for the new or changed components,
 * then everything is written. No Pro, no agent, or the agent failing: the DS is written without them.
 */
export async function createDs(
  cwd: string, catalog: CatalogEntry[], tokens: DetectedToken[],
  pro?: { formats?: (input: DsInput) => string[]; notes?: (input: DsInput, ask: AskAgent) => Promise<Record<string, DsNote>>; ask?: AskAgent },
): Promise<DsExport & { notes: number }> {
  let notes: Record<string, DsNote> = {};
  if (pro?.notes && pro.ask) {
    const { kept, stale } = notesToKeep(cwd, catalog);
    notes = kept;
    if (stale.length) {
      try {
        const fresh = await pro.notes(dsInput(cwd, join(cwd, DS_DIR), projectName(cwd), stale, dsTokens(tokens, cwd)), pro.ask);
        for (const [k, v] of Object.entries(fresh)) if (v?.whenToUse) notes[k] = v;
      } catch { /* the agent's turn failed: written without the new notes */ }
    }
  } else {
    // Free keeps notes written earlier with Pro (same contract) instead of dropping them
    notes = notesToKeep(cwd, catalog).kept;
  }
  return { ...writeDs(cwd, catalog, tokens, pro?.formats, notes), notes: Object.keys(notes).length };
}

/** Whether the project already has one (Create DS then says "Update") */
export function hasDs(cwd: string): boolean {
  return existsSync(join(cwd, DS_DIR, 'DESIGN.md'));
}

/** What the toolbar shows of the DS: the files as written, and the reading behind them drawn as a DS */
export interface DsView {
  dir: string;
  /** The files in .ilse/ds that Ilse writes, as they are on disk */
  files: Array<{ name: string; content: string }>;
  tokens: Array<{ name: string; value: string; type: string }>;
  components: Array<{ name: string; uses: number; layer?: string; feature?: string; props: Array<{ name: string; values?: string[] }>; whenToUse?: string; avoid?: string; edited?: boolean }>;
  /** This install writes Pro's formats */
  formats: boolean;
  /** The agent-instructions file that already points at the DS, or null; and the one a click would write to */
  agents: { linked: string | null; target: string };
  /** Rules the person added from the fresh-agent test */
  rules: string[];
  /** One tokens file per theme (`tokens.dark.json`), as on disk: each is a mode in Figma */
  modes: Array<{ name: string; content: string }>;
  /** The themes as read from the CSS: what each one changes */
  themes: DsMode[];
  /** The copy for people without Ilse: the folder named, and the one Ilse suggests */
  publish: { to: string | null; suggested: string; path?: string };
}

export const DS_FILES = ['DESIGN.md', 'tokens.json', 'registry.json'];
// A registry with every example can be large; the window shows it, it doesn't need all of it
const VIEW_MAX = 200_000;

export function dsView(cwd: string, catalog: CatalogEntry[], tokens: DetectedToken[], formats: boolean): DsView {
  const notes = notesToKeep(cwd, catalog).kept;
  const edited = new Set(Object.keys(readDsEdits(cwd).components));
  const all = dsTokens(tokens, cwd);
  const files = DS_FILES.flatMap(name => {
    const path = join(cwd, DS_DIR, name);
    try {
      if (!statSync(path).isFile()) return [];
      const content = readFileSync(path, 'utf8');
      return [{ name, content: content.length > VIEW_MAX ? content.slice(0, VIEW_MAX) + '\n…' : content }];
    } catch { return []; }
  });
  let modes: DsView['modes'] = [];
  try {
    modes = readdirSync(join(cwd, DS_DIR)).filter(f => /^tokens\.[\w-]+\.json$/.test(f)).sort()
      .map(name => ({ name, content: readFileSync(join(cwd, DS_DIR, name), 'utf8') }));
  } catch { /* no DS folder yet */ }
  return {
    dir: DS_DIR, files, formats,
    agents: { linked: dsInstructionsIn(cwd), target: relative(cwd, instructionsFile(cwd).path) },
    rules: readDsState(cwd)?.rules ?? [], modes, themes: tokenModes(cwd, all),
    publish: publishInfo(cwd),
    tokens: all,
    components: dsComponents(catalog).map(c => ({
      name: c.name, uses: c.uses, ...(notes[c.name] ?? {}), ...(edited.has(c.name) ? { edited: true } : {}),
      ...(c.layer ? { layer: c.layer } : {}),
      ...(c.featureLabel ?? c.feature ? { feature: c.featureLabel ?? c.feature } : {}),
      props: c.props.map(p => ({ name: p.name, ...(p.kind === 'enum' && p.values.length ? { values: p.values } : {}) })),
    })),
  };
}

// ── Pointing the project's agents at the DS ────────────────────────────────
// Any agent — with or without Ilse running — reads AGENTS.md (or CLAUDE.md). One short block, on the person's click.

export const DS_MARKER = '<!-- ilse:design-system -->';

export const DS_BLOCK = `
${DS_MARKER}
## Design system

Before building or changing UI, read \`.ilse/ds/DESIGN.md\`: the project's components (props, values, an example) and tokens.
Use those components and tokens before writing new ones; no new variants or raw colors/sizes when a token exists.
`;

/** Which instructions file already points at the DS (the block, or the path written by hand), or null */
export function dsInstructionsIn(cwd: string): string | null {
  for (const name of ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md']) {
    try {
      const text = readFileSync(join(cwd, name), 'utf8');
      if (text.includes(DS_MARKER) || text.includes('.ilse/ds/DESIGN.md')) return name;
    } catch { /* not there */ }
  }
  return null;
}

/** Adds the block (once); returns the file, project-relative */
export function addDsInstructions(cwd: string): string {
  const linked = dsInstructionsIn(cwd);
  if (linked) return linked;
  const { path, exists } = instructionsFile(cwd);
  if (exists) appendFileSync(path, `\n${DS_BLOCK}`, 'utf8');
  else writeFileSync(path, DS_BLOCK.trimStart(), 'utf8');
  return relative(cwd, path);
}

/** What changed in the code since the DS was written: the live DS's notice (Pro) */
export interface DsChanges { added: string[]; removed: string[]; changed: string[]; tokens: string[] }

export function dsChanges(cwd: string, catalog: CatalogEntry[], tokens: DetectedToken[]): DsChanges | null {
  const prev = readDsState(cwd);
  if (!prev) return null;
  const now = dsComponents(catalog);
  const names = new Set(now.map(c => c.name));
  const added = now.filter(c => !prev.components[c.name]).map(c => c.name);
  const changed = now.filter(c => prev.components[c.name] && prev.components[c.name].hash !== contractHash(c)).map(c => c.name);
  const removed = Object.keys(prev.components).filter(n => !names.has(n));
  const cur = Object.fromEntries(dsTokens(tokens, cwd).map(t => [t.name, t.value]));
  const keys = new Set([...Object.keys(cur), ...Object.keys(prev.tokens)]);
  return { added, removed, changed, tokens: [...keys].filter(k => cur[k] !== prev.tokens[k]).sort() };
}

/** A rule the person approved: kept in state.json; the next write puts it in DESIGN.md */
export function addDsRule(cwd: string, rule: string): boolean {
  const state = readDsState(cwd);
  const text = rule.trim().replace(/^[-*]\s*/, '');
  if (!state || !text) return false;
  const rules = state.rules ?? [];
  if (!rules.includes(text)) rules.push(text);
  writeFileSync(join(cwd, DS_DIR, 'state.json'), JSON.stringify({ ...state, rules }, null, 2) + '\n', 'utf8');
  return true;
}

// ── A copy for people without Ilse: a folder the person names ──────────────────
// `.ilse/ds` is Ilse's working copy (state, edits). The published folder is what a teammate opens,
// sends to a prototyping tool or commits to a DS repo: the same files, and a README saying what
// they are, who wrote them and how to use them. Written again with every write of the DS.

export const PUBLISH_MARKER = '<!-- ilse:published-design-system -->';
const PUBLISHED = (f: string) => f === 'DESIGN.md' || f === 'README.md' || f === 'registry.json' || f === DS_AREAS_DIR || /^tokens(\.[\w-]+)?\.json$/.test(f) || f === '.ignore';

export function publishPath(cwd: string, to: string): string {
  const raw = to.trim();
  return raw.startsWith('~/') || raw === '~' ? join(homedir(), raw.slice(1)) : isAbsolute(raw) ? raw : resolve(cwd, raw);
}

/** Why a folder can't take the copy, or null: never the project itself, Ilse's folder, or a folder of someone else's files */
export function publishProblem(cwd: string, to: string): 'empty' | 'project' | 'ilse' | 'not-ours' | null {
  if (!to.trim()) return 'empty';
  const dest = publishPath(cwd, to);
  const root = resolve(cwd);
  const up = relative(dest, root);
  if (dest === root || (!up.startsWith('..') && !isAbsolute(up))) return 'project';
  const inside = relative(root, dest);
  if (inside === '.ilse' || inside.startsWith('.ilse/') || inside.startsWith('.ilse\\')) return 'ilse';
  let entries: string[] = [];
  try { entries = readdirSync(dest); } catch { return null; }
  if (!entries.length) return null;
  try { if (readFileSync(join(dest, 'README.md'), 'utf8').includes(PUBLISH_MARKER)) return null; } catch { /* no README */ }
  return 'not-ours';
}

function publishReadme(name: string, counts: { components: number; tokens: number }, files: string[]): string {
  const has = (f: string) => files.includes(f);
  return [
    PUBLISH_MARKER,
    `# ${name} · design system`,
    '',
    t('dsPub.intro', { name, components: counts.components, tokens: counts.tokens, date: new Date().toISOString().slice(0, 10) }),
    '',
    `## ${t('dsPub.use')}`,
    '',
    t('dsPub.agents'),
    ...(has(DS_AREAS_DIR) ? [t('dsPub.agentsAreas')] : []),
    ...(has('tokens.json') ? [t('dsPub.figma')] : []),
    ...(has('registry.json') ? [t('dsPub.shadcn')] : []),
    '',
    `## ${t('dsPub.files')}`,
    '',
    t('dsPub.designMd'),
    ...(has(DS_AREAS_DIR) ? [t('dsPub.areas')] : []),
    ...(has('tokens.json') ? [t('dsPub.tokens')] : []),
    ...(has('registry.json') ? [t('dsPub.registry')] : []),
    '',
  ].join('\n');
}

/** The folder as the person reads it: home as ~, so "spine.ds" shows where it really is */
export function shownPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + sep) ? '~' + path.slice(home.length) : path;
}

function publishInfo(cwd: string): DsView['publish'] {
  const to = readDsState(cwd)?.publishTo ?? null;
  return { to, suggested: 'design-system', ...(to ? { path: shownPath(publishPath(cwd, to)) } : {}) };
}

/** The whole DS as one .zip, the same files a published copy gets (README included) */
export function dsZip(cwd: string, counts: { components: number; tokens: number }): { name: string; data: Buffer } {
  const src = join(cwd, DS_DIR);
  const top = readdirSync(src).filter(f => PUBLISHED(f) && f !== 'README.md' && f !== '.ignore');
  const name = projectName(cwd);
  const folder = `${name.replace(/[^\w.-]+/g, '-')}-design-system`;
  const entries: Array<{ path: string; data: Buffer }> = [
    { path: `${folder}/README.md`, data: Buffer.from(publishReadme(name, counts, top), 'utf8') },
  ];
  const add = (rel: string) => {
    const abs = join(src, rel);
    if (statSync(abs).isDirectory()) for (const f of readdirSync(abs).sort()) add(join(rel, f));
    else entries.push({ path: `${folder}/${rel.split(sep).join('/')}`, data: readFileSync(abs) });
  };
  for (const f of top) add(f);
  return { name: `${folder}.zip`, data: zipStore(entries) };
}

/** Copies the DS files to the folder (replacing only what Ilse writes there) with a README; returns the files */
export function publishDs(cwd: string, to: string, counts: { components: number; tokens: number }): string[] {
  const problem = publishProblem(cwd, to);
  if (problem) throw new Error(problem);
  const src = join(cwd, DS_DIR);
  const dest = publishPath(cwd, to);
  mkdirSync(dest, { recursive: true });
  try { for (const f of readdirSync(dest)) if (PUBLISHED(f)) rmSync(join(dest, f), { recursive: true, force: true }); } catch { /* new folder */ }
  const files = readdirSync(src).filter(f => PUBLISHED(f) && f !== 'README.md' && f !== '.ignore');
  for (const f of files) cpSync(join(src, f), join(dest, f), { recursive: true });
  writeFileSync(join(dest, 'README.md'), publishReadme(projectName(cwd), counts, files), 'utf8');
  // Inside the project, the dev server's scanner would reload the page on every write (scan-ignore.ts)
  const inside = relative(resolve(cwd), dest);
  if (!inside.startsWith('..') && !isAbsolute(inside)) writeFileSync(join(dest, '.ignore'), '# Written by Ilse: file scanners (Tailwind) skip this folder. Git still tracks it.\n*\n', 'utf8');
  return ['README.md', ...files];
}

/** The person names the folder (or clears it with null): kept in state.json, published at once */
export function setDsPublish(cwd: string, to: string | null, counts: { components: number; tokens: number }): { to: string | null; files: string[] } {
  const state = readDsState(cwd);
  if (!state) throw new Error('no-ds');
  if (to === null) {
    const { publishTo: _, ...rest } = state;
    writeFileSync(join(cwd, DS_DIR, 'state.json'), JSON.stringify(rest, null, 2) + '\n', 'utf8');
    return { to: null, files: [] };
  }
  const files = publishDs(cwd, to, counts);
  writeFileSync(join(cwd, DS_DIR, 'state.json'), JSON.stringify({ ...state, publishTo: to.trim() }, null, 2) + '\n', 'utf8');
  return { to: to.trim(), files };
}
