/**
 * `ilse test` findings as the toolbar shows them: the ones for the page that's
 * open, and the note each becomes when the dev hands it to the agent.
 */

import { getLocale } from '../i18n/index.js';

/**
 * axe's titles are written for auditors ("Landmarks should have a unique
 * role or role/label/title (i.e. accessible name) combination"). These say
 * what's wrong for whoever is looking at the screen. A rule not listed keeps
 * axe's title.
 */
const AXE_TITLES: Record<string, { pt: string; en: string }> = {
  'color-contrast': { pt: 'Texto com pouco contraste', en: 'Text with too little contrast' },
  'color-contrast-enhanced': { pt: 'Texto com pouco contraste (nível AAA)', en: 'Text with too little contrast (AAA level)' },
  'link-in-text-block': { pt: 'Link no meio do texto só se distingue pela cor', en: 'A link in the text stands out by color alone' },
  'landmark-unique': { pt: 'Duas áreas iguais sem nome que as diferencie', en: 'Two regions of the same kind with no name to tell them apart' },
  'region': { pt: 'Conteúdo fora das áreas da página (cabeçalho, principal, rodapé)', en: "Content outside the page's regions (header, main, footer)" },
  'landmark-one-main': { pt: 'A página não marca o conteúdo principal', en: "The page doesn't mark its main content" },
  'landmark-no-duplicate-banner': { pt: 'Mais de um cabeçalho de página', en: 'More than one page header' },
  'landmark-no-duplicate-contentinfo': { pt: 'Mais de um rodapé de página', en: 'More than one page footer' },
  'landmark-complementary-is-top-level': { pt: 'Barra lateral dentro de outra área', en: 'A sidebar nested inside another region' },
  'page-has-heading-one': { pt: 'A página não tem título principal (h1)', en: 'The page has no main heading (h1)' },
  'heading-order': { pt: 'Títulos pulam níveis', en: 'Headings skip levels' },
  'empty-heading': { pt: 'Título vazio', en: 'Empty heading' },
  'image-alt': { pt: 'Imagem sem descrição', en: 'Image with no description' },
  'role-img-alt': { pt: 'Imagem sem descrição', en: 'Image with no description' },
  'svg-img-alt': { pt: 'Ícone sem descrição', en: 'Icon with no description' },
  'button-name': { pt: 'Botão sem nome', en: 'Button with no name' },
  'input-button-name': { pt: 'Botão sem nome', en: 'Button with no name' },
  'link-name': { pt: 'Link sem nome', en: 'Link with no name' },
  'label': { pt: 'Campo sem rótulo', en: 'Field with no label' },
  'select-name': { pt: 'Lista de opções sem rótulo', en: 'Dropdown with no label' },
  'label-title-only': { pt: 'Campo com rótulo só no title', en: 'Field labeled only by its title' },
  'document-title': { pt: 'Página sem título na aba', en: 'Page with no title in the tab' },
  'html-has-lang': { pt: 'A página não diz em que idioma está', en: "The page doesn't say what language it's in" },
  'html-lang-valid': { pt: 'Idioma da página inválido', en: "The page's language code isn't valid" },
  'meta-viewport': { pt: 'A página impede o zoom', en: 'The page blocks zooming' },
  'duplicate-id': { pt: 'Ids repetidos na página', en: 'Repeated ids on the page' },
  'duplicate-id-aria': { pt: 'Ids repetidos usados por leitores de tela', en: 'Repeated ids that screen readers rely on' },
  'nested-interactive': { pt: 'Controle dentro de outro controle', en: 'A control inside another control' },
  'aria-hidden-focus': { pt: 'Elemento escondido que ainda recebe foco', en: 'A hidden element that still takes focus' },
  'aria-allowed-attr': { pt: 'Atributo ARIA que não vale para este elemento', en: "An ARIA attribute this element can't have" },
  'aria-required-children': { pt: 'Lista ou menu sem os itens que deveria ter', en: "A list or menu missing the items it should have" },
  'aria-required-parent': { pt: 'Item fora da lista ou menu a que pertence', en: 'An item outside the list or menu it belongs to' },
  'list': { pt: 'Lista com itens fora do lugar', en: 'A list with items out of place' },
  'listitem': { pt: 'Item de lista fora de uma lista', en: 'A list item outside a list' },
  'frame-title': { pt: 'Iframe sem título', en: 'Iframe with no title' },
  'scrollable-region-focusable': { pt: 'Área com rolagem que o teclado não alcança', en: "A scrolling area the keyboard can't reach" },
  'target-size': { pt: 'Alvo de toque pequeno demais', en: 'Touch target too small' },
  'tabindex': { pt: 'Ordem de foco forçada (tabindex maior que 0)', en: 'Forced focus order (tabindex above 0)' },
};

/** The finding's title in the toolbar's language, in plain words */
export function findingTitle(f: Pick<TestFinding, 'title' | 'rule' | 'category'>): string {
  const plain = f.category === 'accessibility' ? AXE_TITLES[f.rule] : undefined;
  return plain ? plain[getLocale()] ?? plain.en : f.title;
}

/** The finding's detail, with axe's contrast sentence said plainly; the rest as found */
export function findingDetail(f: Pick<TestFinding, 'detail' | 'rule'>): string | undefined {
  const m = f.rule === 'color-contrast' && f.detail?.match(/contrast of ([\d.]+) \(foreground color: (#\w+), background color: (#\w+).*?Expected contrast ratio of ([\d.]+)/);
  if (!m) return f.detail;
  const pt = getLocale() === 'pt';
  const n = (x: string) => pt ? x.replace('.', ',') : x;
  return pt
    ? `Contraste ${n(m[1])}:1 (${m[2]} sobre ${m[3]}); texto deste tamanho precisa de ${n(m[4])}:1.`
    : `Contrast ${m[1]}:1 (${m[2]} on ${m[3]}); text this size needs ${m[4]}:1.`;
}

export interface TestFinding {
  id: string;
  category: string;
  severity: 'high' | 'medium' | 'low';
  /** '' for what lives only in the code (consistency not seen on any page) */
  page: string;
  viewport: 'desktop' | 'tablet' | 'mobile';
  title: string;
  detail?: string;
  selector?: string;
  rule: string;
  occurrences: number;
  /** Against the tests before: 'returned' was fixed and came back */
  status?: 'new' | 'known' | 'returned';
  /** Consistency: where in the code, the pages it showed on, the journeys through them, each class list it's written with */
  files?: { file: string; line: number }[];
  pages?: string[];
  journeys?: string[];
  classes?: string[];
  /** Kept from the test before: its group was off this time */
  carried?: boolean;
}

/** What the run tested (Pro's last-run.json), for the report's summary */
export interface TestRunMeta {
  at: string;
  ms: number;
  groups: string[];
  sizes: string[];
  pages: string[];
  fixed?: number;
  journeys?: { total: number; passed: number; stuck: number; flaky: number; never: number };
  journeyList?: { id: string; goal: string; desktop?: { outcome: string; step?: number; reason?: string }; mobile?: { outcome: string; step?: number; reason?: string } }[];
}

/** What travels with the note so the CLI can test the page again after the fix */
export interface TestFindingRef { id: string; page: string; category: string; selector?: string; pages?: string[] }

export function findingRef(f: TestFinding): TestFindingRef {
  return { id: f.id, page: f.page, category: f.category, ...(f.selector ? { selector: f.selector } : {}), ...(f.pages?.length ? { pages: f.pages } : {}) };
}

/** Findings for this page: same path, and same query when the finding has one (any of its pages, for one seen on several) */
export function findingsForPage(findings: TestFinding[], pathname: string, search: string): TestFinding[] {
  return findings.filter(f => (f.pages?.length ? f.pages : [f.page]).some(p => {
    const [path, query] = p.split('?');
    return path === pathname && (!query || `?${query}` === search);
  }));
}

/** What the agent reads — the problem, why it matters, and that it came from a test */
export function findingNote(f: TestFinding): string {
  const where = f.viewport !== 'desktop' && f.occurrences === 1 ? ` (on ${f.viewport})` : '';
  const pages = f.category !== 'consistency' && (f.pages?.length ?? 0) > 1 ? `Same element on ${f.pages!.length} pages: ${f.pages!.slice(0, 8).join(', ')}.` : '';
  const code = f.files?.length ? `In the code: ${f.files.slice(0, 8).map(x => `${x.file}:${x.line}`).join(', ')}.` : '';
  return [`Fix: ${AXE_TITLES[f.rule]?.en ?? f.title}${where}.`, f.detail, pages, code, `Found by ilse test, rule ${f.rule}.`].filter(Boolean).join(' ');
}

/** The element a finding points at, when it's on the page */
export function findingElement(f: TestFinding, doc: Pick<Document, 'querySelector'> = document): Element | null {
  if (!f.selector) return null;
  try { return doc.querySelector(f.selector); } catch { return null; }
}
