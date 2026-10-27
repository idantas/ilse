/**
 * Consistency for test mode (Pro's report reads it through ProContext): what
 * the app writes by hand over and over, and values scattered too wide. Reads the code only, no AI.
 *
 * Only the app's own files count as repetition. A monorepo's `packages/` and
 * an installed kit (`components/ui`) are the catalog of what already exists —
 * "7 places rebuild a Button that packages/ui has" is the useful finding, not
 * the repetition inside the library, which is on purpose.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { findPatterns, type ImplicitComponent } from './find-patterns.js';
import { indexTokens } from './index-tokens.js';
import { findInconsistencies } from './find-inconsistencies.js';
import type { ConsistencyItem } from '../pro/types.js';
import { hasDs, dsComponents, dsTokens } from './ds-export.js';
import { buildCatalog } from './catalog.js';
import { detectTokens } from '../setup/token-detect.js';

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.vercel', '.ilse', 'public', 'storybook-static']);
const MAX_FILES = 800;

/** The app's .tsx/.jsx files (no tests, stories or build output), up to MAX_FILES */
export function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 10 || out.length >= MAX_FILES) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name.startsWith('.') || out.length >= MAX_FILES) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    // Demos and examples are copies on purpose: their repetition isn't the app's
    if (st.isDirectory()) { if (!SKIP.has(name) && !/__tests__|__mocks__|stories|^(demos?|examples?|playground|sandbox)$/.test(name)) walk(full, out, depth + 1); }
    else if (/\.(tsx|jsx)$/.test(name) && !/\.(test|spec|stories)\./.test(name)) out.push(full);
  }
}

/** A kit's files: a monorepo package, or the components a kit installed into the app */
export const isCatalog = (rel: string) => /(^|\/)packages\//.test(rel) || /(^|\/)components\/ui\//.test(rel);

/** Component names a file exports: `export function Button`, `export const Card =`, or the file's own name */
export function exportedNames(rel: string, code: string): string[] {
  const names = [...code.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z]\w+)/g)].map(m => m[1]);
  const own = basename(rel).replace(/\.(tsx|jsx)$/, '').split(/[-_]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return [...new Set(names.length ? names : [own])];
}

/** What a hand-written element would be as a component, to look for in the catalog */
const WOULD_BE: Record<string, string[]> = {
  button: ['Button', 'IconButton'], a: ['Link'], input: ['Input', 'TextField'], select: ['Select'],
  textarea: ['Textarea', 'TextArea'], img: ['Image', 'Avatar'], label: ['Label'], table: ['Table'],
};

const key = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);

/** What a person would call the element; `f`: feminine in Portuguese ("Mesma imagem", "uma imagem") */
const DESCRIBE: Record<string, { pt: string; en: string; f?: true }> = {
  button: { pt: 'botão', en: 'button' }, a: { pt: 'link', en: 'link' }, input: { pt: 'campo', en: 'field' },
  img: { pt: 'imagem', en: 'image', f: true }, div: { pt: 'bloco', en: 'block' }, span: { pt: 'trecho de texto', en: 'text span' },
  p: { pt: 'parágrafo', en: 'paragraph' }, li: { pt: 'item de lista', en: 'list item' }, ul: { pt: 'lista', en: 'list', f: true },
  ol: { pt: 'lista', en: 'list', f: true }, tr: { pt: 'linha de tabela', en: 'table row', f: true }, td: { pt: 'célula', en: 'table cell', f: true },
  select: { pt: 'seleção', en: 'select', f: true }, label: { pt: 'rótulo', en: 'label' }, section: { pt: 'seção', en: 'section', f: true },
  h1: { pt: 'título', en: 'heading' }, h2: { pt: 'título', en: 'heading' }, h3: { pt: 'título', en: 'heading' }, h4: { pt: 'título', en: 'heading' },
  nav: { pt: 'menu', en: 'menu' }, header: { pt: 'cabeçalho', en: 'header' }, footer: { pt: 'rodapé', en: 'footer' },
};

const TEXT_TAGS = new Set(['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'small', 'strong', 'em', 'code']);

/**
 * The same thing found twice with different children (an error banner with a
 * retry button and one without): one finding when they're written with the
 * same classes most of the time.
 */
export function mergeAlike(patterns: ImplicitComponent[]): ImplicitComponent[] {
  const out: ImplicitComponent[] = [];
  for (const p of patterns) {
    const tag = p.signature.split('|')[0];
    const same = out.find(o => o.signature.split('|')[0] === tag && o.variants[0] && o.variants[0] === p.variants[0]);
    if (!same) { out.push({ ...p, files: [...p.files], variants: [...p.variants] }); continue; }
    same.occurrences += p.occurrences;
    for (const f of p.files) if (!same.files.some(x => x.file === f.file && x.line === f.line)) same.files.push(f);
    for (const v of p.variants) if (!same.variants.includes(v)) same.variants.push(v);
  }
  return out.sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Worth a finding: something a person clicks or reads as a unit — interactive
 * (onClick, href, a control) or a styled block holding 2+ things. A bare
 * `<div className="flex gap-2">` repeated 80 times is layout, not a component.
 */
function worthIt(p: ImplicitComponent): boolean {
  const [tag, ...rest] = p.signature.split('|');
  // Twice is a coincidence more often than a component
  if (p.occurrences < 3) return false;
  const interactive = rest.includes('onClick') || rest.includes('href') || ['button', 'a', 'input', 'select', 'textarea'].includes(tag);
  const classPattern = rest.at(-1) ?? '';
  const styled = /themed|rounded/.test(classPattern);
  const children = rest.find(r => r.includes(',')) ?? '';
  // Text alone (a muted caption, a mono id) is a type style — the token scale's business, not a component
  if (!interactive && TEXT_TAGS.has(tag)) return false;
  return interactive ? styled || p.variants.length > 1 : styled && children.split(',').length >= 2 && p.occurrences <= 40;
}

export async function checkConsistency(cwd: string): Promise<ConsistencyItem[]> {
  const paths: string[] = [];
  walk(cwd, paths);
  const app: { path: string; code: string }[] = [];
  const catalog = new Map<string, string>();
  for (const full of paths) {
    let code: string;
    try { code = readFileSync(full, 'utf8'); } catch { continue; }
    if (code.length > 300_000) continue;
    const rel = relative(cwd, full).split(sep).join('/');
    if (isCatalog(rel)) for (const n of exportedNames(rel, code)) { if (!catalog.has(n)) catalog.set(n, rel); }
    else app.push({ path: rel, code });
  }

  // With a DS written (Create DS), its components count as what already exists, and its tokens are the rule
  const ds = hasDs(cwd);
  if (ds) for (const c of dsComponents(buildCatalog(cwd))) { if (!catalog.has(c.name)) catalog.set(c.name, c.source); }

  const items: ConsistencyItem[] = [];
  if (ds) items.push(...rawTokenValues(app, dsTokens(detectTokens(cwd).tokens)));

  // Repeated by hand
  const patterns = await findPatterns(app, 2);
  if (patterns.ok) {
    for (const p of mergeAlike(patterns.value.filter(worthIt)).slice(0, 12)) {
      const tag = p.signature.split('|')[0];
      const files = new Set(p.files.map(f => f.file)).size;
      const existing = (WOULD_BE[tag] ?? []).find(n => catalog.has(n));
      const what = DESCRIBE[tag] ?? { pt: `<${tag}>`, en: `<${tag}>` };
      const ways = p.variants.length;
      const severity = p.occurrences >= 3 || ways >= 3 ? 'medium' : 'low';
      items.push({
        key: key(`repeated|${p.signature}`),
        kind: 'repeated',
        severity,
        occurrences: p.occurrences,
        files: p.files,
        variants: p.variants,
        ...(existing ? { existing: `${existing} (${catalog.get(existing)})` } : {}),
        title: existing
          ? { pt: `${p.occurrences} lugares recriam à mão ${what.f ? 'uma' : 'um'} ${what.pt}; o projeto já tem ${existing}`, en: `${p.occurrences} places rebuild a ${what.en} by hand; the project already has ${existing}` }
          : { pt: `${what.f ? 'Mesma' : 'Mesmo'} ${what.pt} ${what.f ? 'escrita' : 'escrito'} ${p.occurrences}× em ${files} ${files === 1 ? 'arquivo' : 'arquivos'}`, en: `Same ${what.en} written ${p.occurrences}× in ${files} ${files === 1 ? 'file' : 'files'}` },
        detail: {
          pt: [
            ways > 1 ? `${ways} combinações de classe diferentes.` : 'Todas com as mesmas classes.',
            existing ? `Trocar pelo ${existing} de ${catalog.get(existing)} deixa igual em todo lugar.` : 'Um componente só deixaria igual em todo lugar e muda num lugar.',
            p.variants[0] ? `Mais comum: ${p.variants[0]}` : '',
          ].filter(Boolean).join(' '),
          en: [
            ways > 1 ? `${ways} different class combinations.` : 'All with the same classes.',
            existing ? `Using ${existing} from ${catalog.get(existing)} keeps it the same everywhere.` : 'One component would keep it the same everywhere, and change in one place.',
            p.variants[0] ? `Most common: ${p.variants[0]}` : '',
          ].filter(Boolean).join(' '),
        },
      });
    }
  }

  // Families drifting apart (`compare-family.ts`) are left out: "components of X differ in
  // radius, padding, gap" was true of almost any folder and never said what to do (test 22/10)

  // Values scattered too wide: radius, shadows, hand-picked colors
  const tokens = await indexTokens(app);
  if (tokens.ok) {
    for (const inc of findInconsistencies(tokens.value).filter(i => /radius|shadow|arbitr/.test(i.category) && i.values.length >= 5).slice(0, 4)) {
      const n = inc.values.length;
      const label = inc.category === 'cores arbitrárias' ? { pt: 'cores escolhidas à mão', en: 'hand-picked colors' } : { pt: inc.category, en: inc.category };
      items.push({
        key: key(`tokens|${inc.category}`),
        kind: 'tokens',
        severity: n >= 8 ? 'medium' : 'low',
        occurrences: inc.total,
        files: [],
        title: { pt: `${n} valores diferentes de ${label.pt}`, en: `${n} different ${label.en} values` },
        detail: {
          pt: `Os mais usados: ${inc.values.slice(0, 4).map(v => `${v.value} (${v.count}×)`).join(', ')}. Uma escala menor deixa o visual coerente.`,
          en: `Most used: ${inc.values.slice(0, 4).map(v => `${v.value} (${v.count}×)`).join(', ')}. A shorter scale keeps the look coherent.`,
        },
      });
    }
  }
  return items;
}

/** `#abc` → `#aabbcc`, lowercase: the same color written two ways is one value */
export function normalizeHex(hex: string): string {
  const h = hex.toLowerCase();
  return h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h;
}

/**
 * The DS's drift check: a color the DS has as a token, written by hand in the app's code
 * (`bg-[#ff6c03]`, `color: '#ff6c03'`). When the token changes, these places stay behind.
 */
export function rawTokenValues(app: { path: string; code: string }[], tokens: Array<{ name: string; value: string; type: string }>): ConsistencyItem[] {
  const byValue = new Map<string, string>();
  for (const t of tokens) if (t.type === 'color' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(t.value.trim())) {
    const v = normalizeHex(t.value.trim());
    if (!byValue.has(v)) byValue.set(v, t.name);
  }
  if (!byValue.size) return [];
  const found = new Map<string, { file: string; line: number }[]>();
  for (const f of app) {
    f.code.split('\n').forEach((line, i) => {
      if (/^\s*(import|\/\/|\*|\/\*)/.test(line)) return;
      for (const m of line.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
        const token = byValue.get(normalizeHex(m[0]));
        if (!token) continue;
        const list = found.get(token) ?? [];
        list.push({ file: f.path, line: i + 1 });
        found.set(token, list);
      }
    });
  }
  return [...found.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6).map(([token, places]) => {
    const value = tokens.find(t => t.name === token)!.value;
    const leaf = token.split('.').slice(1).join('-') || token;
    const n = places.length;
    return {
      key: key(`ds-raw|${token}`),
      kind: 'tokens' as const,
      severity: n >= 3 ? 'medium' as const : 'low' as const,
      occurrences: n,
      files: places.slice(0, 20),
      title: {
        pt: `${value} escrito à mão ${n === 1 ? 'em 1 lugar' : `em ${n} lugares`}; o design system tem o token ${leaf}`,
        en: `${value} written by hand ${n === 1 ? 'in 1 place' : `in ${n} places`}; the design system has the token ${leaf}`,
      },
      detail: {
        pt: `Use o token (var(--${leaf}) ou a classe com ${leaf}). Se a cor do DS mudar, esses lugares ficam para trás.`,
        en: `Use the token (var(--${leaf}) or the ${leaf} class). If the DS's color changes, these places stay behind.`,
      },
    };
  });
}
