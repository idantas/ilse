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

import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { CatalogEntry, CatalogProp } from './catalog.js';
import type { DetectedToken } from '../setup/token-detect.js';
import type { DsInput, DsNote, AskAgent } from '../pro/types.js';
import { createHash } from 'node:crypto';
import { instructionsFile } from '../git/commit-context.js';

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
  return catalog.filter(c => !c.library).sort((a, b) =>
    (a.layer === b.layer ? 0 : a.layer === 'base' ? -1 : 1) || b.uses - a.uses || a.name.localeCompare(b.name));
}

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

/** The tokens the DS can state truthfully: a "color" that isn't one color stays out */
export function dsTokens(tokens: DetectedToken[]): DetectedToken[] {
  return tokens.filter(t => t.type !== 'color' || ONE_COLOR.test(t.value.trim()));
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

/** DESIGN.md: the front matter Ilse itself reads back (design-md.ts), then prose for agents */
export function buildDesignMd(name: string, catalog: CatalogEntry[], tokens: DetectedToken[], machine: string[] = [], notes: Record<string, DsNote> = {}, rules: string[] = []): string {
  const by = (prefix: string) => tokens.filter(t => t.name.startsWith(prefix + '.')).map(t => [t.name.slice(prefix.length + 1), t.value] as const);
  const front: string[] = ['---', `name: ${yamlValue(name)}`];
  const colors = by('color');
  if (colors.length) front.push('colors:', ...colors.map(([k, v]) => `  ${k}: ${yamlValue(v)}`));
  const spacing = by('spacing');
  if (spacing.length) front.push('spacing:', ...spacing.map(([k, v]) => `  ${k}: ${yamlValue(v)}`));
  const rounded = by('rounded').concat(by('radius'));
  if (rounded.length) front.push('rounded:', ...rounded.map(([k, v]) => `  ${k}: ${yamlValue(v)}`));
  const type = by('typography');
  if (type.length) front.push('typography:', ...type.flatMap(([k, v]) => [`  ${k}:`, `    fontSize: ${yamlValue(v)}`]));
  front.push('---');

  const comps = dsComponents(catalog);
  const describe = (c: CatalogEntry) => {
    // The file, project-relative: the agent writes the import the way this project does (alias or path)
    const imp = c.importAs === 'named' ? `import { ${c.name} }` : `import ${c.name}`;
    const props = c.props.map(p => {
      const values = p.kind === 'enum' && p.values.length ? `: ${p.values.slice(0, 8).map(v => `\`${v}\``).join(' | ')}` : p.kind === 'boolean' ? ': boolean' : '';
      return `\`${p.name}\`${p.required ? '' : '?'}${values}${p.default !== undefined ? ` (default \`${p.default}\`)` : ''}`;
    });
    return [
      `### ${c.name}`,
      `\`${imp}\` from \`${c.source}\` · used ${c.uses}×${c.renders ? ` · renders <${c.renders}>` : ''}`,
      ...(notes[c.name]?.whenToUse ? [`When to use: ${notes[c.name].whenToUse}`] : []),
      ...(notes[c.name]?.avoid ? [`Not for: ${notes[c.name].avoid}`] : []),
      ...(props.length ? [`Props: ${props.join(', ')}`] : []),
      ...(c.example ? ['```tsx', dedent(c.example.code), '```'] : []),
    ].join('\n');
  };
  const base = comps.filter(c => c.layer === 'base');
  const product = comps.filter(c => c.layer !== 'base');
  return [
    ...front,
    '',
    `# ${name} — design system`,
    '',
    'Written by Ilse from this project\'s code (`ilse ds`). It lists what already exists: build with it before writing anything new.',
    '',
    '## Rules for agents',
    '',
    '- Use these components before creating new ones; compose them before writing a new one.',
    '- Use the props and values listed — not new variants, not inline styles to imitate one.',
    '- Colors, spacing and radius come from the tokens above, never raw values when a token exists.',
    '- A component in "Product" belongs to one feature; reuse it there, and ask before moving it to Base.',
    // Learned from the fresh-agent test, approved by the person
    ...rules.map(r => `- ${r}`),
    '',
    ...(base.length ? ['## Base', '', ...base.map(describe).flatMap(s => [s, ''])] : []),
    ...(product.length ? ['## Product', '', ...product.map(describe).flatMap(s => [s, ''])] : []),
    // Only what was written: Free has DESIGN.md alone
    ...(machine.length ? [`Machine-readable, next to this file: ${machine.map(f => `\`${f}\``).join(', ')}.`, ''] : []),
  ].join('\n');
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
export function dsInput(cwd: string, dir: string, name: string, catalog: CatalogEntry[], tokens: DetectedToken[], notes: Record<string, DsNote> = {}): DsInput {
  const comps = dsComponents(catalog);
  const names = new Set(comps.map(c => c.name));
  const homepage = homepageOf(cwd);
  return {
    cwd, dir, name, tokens, ...(homepage ? { homepage } : {}),
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
  const dir = join(cwd, DS_DIR);
  mkdirSync(dir, { recursive: true });
  tokens = dsTokens(tokens);
  let machine: string[] = [];
  // Pro failing must not cost the user the free file
  try { machine = formats?.(dsInput(cwd, dir, name, catalog, tokens, notes)) ?? []; } catch { machine = []; }
  const rules = readDsState(cwd)?.rules ?? [];
  writeFileSync(join(dir, 'DESIGN.md'), buildDesignMd(name, catalog, tokens, machine, notes, rules), 'utf8');
  writeDsState(cwd, catalog, tokens, notes, rules);
  return { dir: DS_DIR, files: ['DESIGN.md', ...machine].map(f => join(DS_DIR, f)), components: dsComponents(catalog).length, tokens: tokens.length };
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
}

export function contractHash(c: CatalogEntry): string {
  const { uses: _u, example: _e, ...shape } = contractOf(c);
  return createHash('sha1').update(JSON.stringify(shape)).digest('hex').slice(0, 12);
}

export function readDsState(cwd: string): DsState | null {
  try { return JSON.parse(readFileSync(join(cwd, DS_DIR, 'state.json'), 'utf8')) as DsState; } catch { return null; }
}

function writeDsState(cwd: string, catalog: CatalogEntry[], tokens: DetectedToken[], notes: Record<string, DsNote>, rules: string[] = []): void {
  const state: DsState = {
    writtenAt: new Date().toISOString(),
    components: Object.fromEntries(dsComponents(catalog).map(c => [c.name, { hash: contractHash(c), ...(notes[c.name] ?? {}) }])),
    tokens: Object.fromEntries(tokens.map(t => [t.name, t.value])),
    ...(rules.length ? { rules } : {}),
  };
  writeFileSync(join(cwd, DS_DIR, 'state.json'), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** The notes still true (same contract), and the components that need one */
export function notesToKeep(cwd: string, catalog: CatalogEntry[]): { kept: Record<string, DsNote>; stale: CatalogEntry[] } {
  const prev = readDsState(cwd)?.components ?? {};
  const kept: Record<string, DsNote> = {};
  const stale: CatalogEntry[] = [];
  for (const c of dsComponents(catalog)) {
    const p = prev[c.name];
    if (p?.whenToUse && p.hash === contractHash(c)) kept[c.name] = { whenToUse: p.whenToUse, ...(p.avoid ? { avoid: p.avoid } : {}) };
    else stale.push(c);
  }
  return { kept, stale };
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
        const fresh = await pro.notes(dsInput(cwd, join(cwd, DS_DIR), projectName(cwd), stale, dsTokens(tokens)), pro.ask);
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
  components: Array<{ name: string; uses: number; layer?: string; feature?: string; props: Array<{ name: string; values?: string[] }>; whenToUse?: string; avoid?: string }>;
  /** This install writes Pro's formats */
  formats: boolean;
  /** The agent-instructions file that already points at the DS, or null; and the one a click would write to */
  agents: { linked: string | null; target: string };
  /** Rules the person added from the fresh-agent test */
  rules: string[];
}

export const DS_FILES = ['DESIGN.md', 'tokens.json', 'registry.json'];
// A registry with every example can be large; the window shows it, it doesn't need all of it
const VIEW_MAX = 200_000;

export function dsView(cwd: string, catalog: CatalogEntry[], tokens: DetectedToken[], formats: boolean): DsView {
  const notes = notesToKeep(cwd, catalog).kept;
  const files = DS_FILES.flatMap(name => {
    const path = join(cwd, DS_DIR, name);
    try {
      if (!statSync(path).isFile()) return [];
      const content = readFileSync(path, 'utf8');
      return [{ name, content: content.length > VIEW_MAX ? content.slice(0, VIEW_MAX) + '\n…' : content }];
    } catch { return []; }
  });
  return {
    dir: DS_DIR, files, formats,
    agents: { linked: dsInstructionsIn(cwd), target: relative(cwd, instructionsFile(cwd).path) },
    rules: readDsState(cwd)?.rules ?? [],
    tokens: dsTokens(tokens),
    components: dsComponents(catalog).map(c => ({
      name: c.name, uses: c.uses, ...(notes[c.name] ?? {}),
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
  const cur = Object.fromEntries(dsTokens(tokens).map(t => [t.name, t.value]));
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
