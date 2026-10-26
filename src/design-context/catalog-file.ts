/**
 * `.ilse/catalog.md` — how the team wants the catalog organized, in words.
 *
 * The rules in `catalog-kinds.ts` sort the catalog on their own; this file is
 * where people correct them and name things their way: areas shown as
 * "Chaves" instead of `keys`, a component moved to another group, pieces that
 * shouldn't be listed at all. Plain Markdown, versioned with the project like
 * `.ilse/journeys.md`, read again every time the catalog opens. Lines it
 * doesn't understand are ignored.
 *
 * ```md
 * ## Areas
 * - keys: Chaves
 * ## Components
 * - MetricCard: Base, Data display
 * - OwnerBillingField: Product, Cobrança
 * ## Hidden
 * - ThemeScript
 * ```
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIND_ORDER, type CatalogKind, type CatalogLayer } from './catalog-kinds.js';

export const CATALOG_FILE = '.ilse/catalog.md';

export interface CatalogFile {
  /** Folder (`keys`) → the name shown (`Chaves`) */
  areas: Map<string, string>;
  /** Component name → where it goes; `feature` may be a folder or an area's shown name */
  components: Map<string, { layer?: CatalogLayer; kind?: CatalogKind; feature?: string }>;
  hidden: Set<string>;
}

/** What people write for each kind, both languages, without accents */
const KIND_WORDS: Record<CatalogKind, string[]> = {
  actions: ['actions', 'acoes', 'acao'],
  inputs: ['inputs', 'campos', 'campo', 'fields', 'forms', 'formularios'],
  overlays: ['overlays', 'sobreposicoes', 'dialogos', 'modais'],
  navigation: ['navigation', 'navegacao'],
  data: ['data', 'data display', 'exibicao de dados', 'dados'],
  charts: ['charts', 'graficos'],
  feedback: ['feedback', 'feedback and states', 'feedback e estados', 'estados', 'states'],
  layout: ['layout'],
  text: ['text', 'texto', 'typography', 'tipografia'],
  media: ['media', 'icons and images', 'icones e imagens', 'icones', 'imagens', 'midia'],
  other: ['other', 'outros'],
};

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function kindFromWord(word: string): CatalogKind | undefined {
  const w = plain(word);
  return KIND_ORDER.find(k => k === w || KIND_WORDS[k].includes(w));
}

const SECTION: Array<[keyof CatalogFile, RegExp]> = [
  ['areas', /^(areas?|features?|funcionalidades?)$/],
  ['components', /^(componentes?|components?)$/],
  ['hidden', /^(ocultos?|escondidos?|hidden)$/],
];

export function parseCatalogFile(text: string): CatalogFile {
  const out: CatalogFile = { areas: new Map(), components: new Map(), hidden: new Set() };
  let section: keyof CatalogFile | null = null;
  for (const raw of text.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const line = raw.trim();
    const head = /^#{2,3}\s+(.+)$/.exec(line);
    if (head) { section = SECTION.find(([, re]) => re.test(plain(head[1])))?.[0] ?? null; continue; }
    const item = /^[-*]\s+`?([^`:]+?)`?\s*(?::\s*(.+))?$/.exec(line);
    if (!item || !section) continue;
    const name = item[1].trim();
    const value = item[2]?.trim();
    if (section === 'hidden') { out.hidden.add(name); continue; }
    if (!value) continue;
    if (section === 'areas') { out.areas.set(name, value); continue; }
    const place: { layer?: CatalogLayer; kind?: CatalogKind; feature?: string } = {};
    for (const part of value.split(/[,›>/|]/).map(p => p.trim()).filter(Boolean)) {
      const p = plain(part);
      if (p === 'base') place.layer = 'base';
      else if (p === 'produto' || p === 'product') place.layer = 'product';
      else if (kindFromWord(part)) place.kind = kindFromWord(part);
      else place.feature = part;
    }
    // A group only an area can be (Cobrança) puts it in Product; a kind alone, in Base
    if (!place.layer) place.layer = place.feature ? 'product' : place.kind ? 'base' : undefined;
    out.components.set(name, place);
  }
  return out;
}

export function readCatalogFile(cwd: string): CatalogFile | null {
  const file = join(cwd, CATALOG_FILE);
  if (!existsSync(file)) return null;
  try { return parseCatalogFile(readFileSync(file, 'utf8')); } catch { return null; }
}

/** `data-sources` → Data sources */
export function areaLabel(folder: string): string {
  const s = folder.replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The file as a starting point, the project's areas listed with their names
 * as they are now, so renaming one is editing a word. Never overwrites.
 */
export function createCatalogFile(cwd: string, areas: string[], locale: 'pt' | 'en'): { path: string; created: boolean } {
  const path = join(cwd, CATALOG_FILE);
  if (existsSync(path)) return { path, created: false };
  const pt = locale === 'pt';
  const lines = [
    pt ? '# Catálogo' : '# Catalog',
    '',
    pt
      ? 'Como o catálogo da Ilse organiza os componentes deste projeto. Edite à vontade: ele é relido toda vez que o catálogo abre.'
      : "How Ilse's catalog organizes this project's components. Edit freely: it's read again every time the catalog opens.",
    '',
    pt ? '## Áreas' : '## Areas',
    pt ? '<!-- pasta: nome mostrado -->' : '<!-- folder: name shown -->',
    ...[...areas].sort().map(a => `- ${a}: ${areaLabel(a)}`),
    '',
    pt ? '## Componentes' : '## Components',
    pt
      ? '<!-- Componente: Base ou Produto, e o grupo. Ex.: "- MetricCard: Base, Exibição de dados" · "- OwnerBillingField: Produto, Cobrança" -->'
      : '<!-- Component: Base or Product, and the group. E.g. "- MetricCard: Base, Data display" · "- OwnerBillingField: Product, Billing" -->',
    '',
    pt ? '## Ocultos' : '## Hidden',
    pt ? '<!-- Componentes que não aparecem no catálogo -->' : "<!-- Components the catalog doesn't list -->",
    '',
  ];
  mkdirSync(join(cwd, '.ilse'), { recursive: true });
  writeFileSync(path, lines.join('\n'));
  return { path, created: true };
}
