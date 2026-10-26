/**
 * Where a catalog component belongs, the way design systems sort a library —
 * read from the code, no AI.
 *
 * Two layers, as product code is usually laid out: **base** is what any screen
 * could use (a library, the kit folder, a pattern used across features) and is
 * grouped by what it's for — actions, fields, overlays… like MUI's or Polaris's
 * docs; **product** belongs to one part of the business and is grouped by it
 * (keys, providers), as `features/<name>` folders are.
 *
 * What it's for comes from the name, read right to left (`KeyExpiryPicker` is a
 * picker), then from the component it renders (`FormDialog` → `Dialog`), then
 * from its root tag (`<table>`). Nothing matches: "other". Nothing is guessed.
 */

import type { CatalogEntry } from './catalog.js';

export type CatalogKind = 'actions' | 'inputs' | 'overlays' | 'navigation' | 'data' | 'charts' | 'feedback' | 'layout' | 'text' | 'media' | 'other';
export type CatalogLayer = 'base' | 'product';

/** The order groups are listed in */
export const KIND_ORDER: CatalogKind[] = ['actions', 'inputs', 'overlays', 'navigation', 'data', 'charts', 'feedback', 'layout', 'text', 'media', 'other'];

const WORDS: Array<[CatalogKind, RegExp]> = [
  ['actions', /^(Button|Btn|Link|Fab|Cta|Action|Actions)$/],
  ['inputs', /^(Field|Input|Select|Picker|Checkbox|Radio|Switch|Toggle|Slider|Autocomplete|Combobox|Textarea|Form|Upload|Dropzone|Search|Rating|Calendar|Otp)$/],
  ['overlays', /^(Dialog|Drawer|Modal|Popover|Popper|Tooltip|Menu|Sheet|Dropdown|Overlay|Lightbox|Command|Confirm)$/],
  ['navigation', /^(Tabs|Tab|Nav|Navbar|Navigation|Breadcrumb|Breadcrumbs|Pagination|Stepper|Step|Sidebar|Menubar|Toc)$/],
  ['data', /^(Table|Row|Cell|List|Card|Badge|Chip|Tag|Avatar|Stat|Stats|Metric|Kpi|Indicator|Fact|Facts|Detail|Details|Timeline|Accordion|Tree|Pill|Counter|Usage|Summary)$/],
  ['charts', /^(Chart|Charts|Gauge|Heatmap|Treemap|Sparkline|Graph|Plot|Meter|Donut|Pie)$/],
  ['feedback', /^(Alert|Toast|Snackbar|Banner|Notice|Empty|Error|Errors|Loading|Loader|Skeleton|Spinner|Progress|Placeholder|Fallback|Forbidden|NotFound|Status|Health|Callout)$/],
  ['layout', /^(Layout|Stack|Grid|Section|Shell|Header|Footer|Box|Container|Paper|Divider|Separator|Panel|Page|Screen|Frame|Toolbar|AppBar|Bar|Column|Columns|Split|Aside|Main|Wrapper|Group)$/],
  ['text', /^(Typography|Text|Title|Heading|Label|Caption|Paragraph|Kbd|Code|Prose|Markdown|Quote)$/],
  ['media', /^(Icon|Icons|Logo|Image|Img|Avatar|Illustration|Video|Brand|Mascot)$/],
];

/** Words that name a part of something, not what it is: `DialogTitle` is the dialog's */
const PART = /^(Title|Content|Header|Footer|Actions|Body|Item|Text|Group|Root|Label|Description|Trigger|Close|Icon|Head|Cell|Row|Separator|Overlay|Portal|Provider|Fallback|Indicator|Thumb|Track|Value|Viewport|List)$/;

// Portuguese names (`CampoDeSegredo`, `CartaoDeBarras`): the same groups
const PT_WORDS: Array<[CatalogKind, RegExp]> = [
  ['actions', /^(Botao|Botoes|Acao|Acoes)$/],
  ['inputs', /^(Campo|Campos|Seletor|Alternador|Formulario|Busca|Entrada|Opcao|Opcoes)$/],
  ['overlays', /^(Dialogo|Gaveta|Janela|Ajuda|Confirmacao)$/],
  ['navigation', /^(Abas|Aba|Navegacao|Paginacao|Etapas|Etapa|Trilha)$/],
  ['data', /^(Cartao|Cartoes|Tabela|Linha|Linhas|Lista|Etiqueta|Selo|Estatisticas|Estatistica|Indicador|Indicadores|Resumo|Detalhes|Contador)$/],
  ['charts', /^(Grafico|Graficos|Barras|Medidor|Mapa|Pizza|Rosca)$/],
  ['feedback', /^(Alerta|Aviso|Vazio|Erro|Carregando|Esqueleto|Progresso|Situacao)$/],
  ['layout', /^(Cabecalho|Rodape|Secao|Painel|Tela|Pagina|Moldura|Coluna|Colunas|Grade|Barra|Fundo)$/],
  ['text', /^(Texto|Titulo|Rotulo|Legenda|Paragrafo|Citacao)$/],
  ['media', /^(Icone|Icones|Imagem|Marca|Logotipo|Ilustracao)$/],
];
const plain = (w: string) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const kindOfWord = (w: string): CatalogKind | null =>
  WORDS.find(([, re]) => re.test(w))?.[0] ?? PT_WORDS.find(([, re]) => re.test(plain(w)))?.[0] ?? null;
/** `CampoDeSegredo`: in Portuguese the thing comes first, then "de …" */
const PT_LINK = /^(De|Do|Da|Dos|Das|Para|Com)$/;

/** `KeyExpiryPicker` → Key, Expiry, Picker */
export function nameWords(name: string): string[] {
  return name.replace(/\d+$/, '').match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [name];
}

/** What a name says it is: its last word that means something; a part (`DialogTitle`) belongs to its family */
export function kindOfName(name: string): CatalogKind | null {
  const words = nameWords(name);
  const link = words.findIndex(w => PT_LINK.test(w));
  if (link > 0) for (let i = link - 1; i >= 0; i--) { const k = kindOfWord(words[i]); if (k) return k; }
  if (words.length > 1 && PART.test(words.at(-1)!)) {
    const family = kindOfWord(words[0]);
    if (family) return family;
  }
  for (let i = words.length - 1; i >= 0; i--) {
    const k = kindOfWord(words[i]);
    if (k) return k;
  }
  return null;
}

const TAGS: Record<string, CatalogKind> = {
  button: 'actions', a: 'actions',
  input: 'inputs', select: 'inputs', textarea: 'inputs', form: 'inputs', fieldset: 'inputs',
  dialog: 'overlays',
  nav: 'navigation',
  table: 'data', ul: 'data', ol: 'data', dl: 'data',
  img: 'media', svg: 'media', picture: 'media', video: 'media',
  h1: 'text', h2: 'text', h3: 'text', h4: 'text', h5: 'text', h6: 'text', p: 'text', label: 'text', code: 'text',
  header: 'layout', footer: 'layout', section: 'layout', main: 'layout', aside: 'layout',
};

/** Boxes that hold anything: rendering one says nothing about what the component is */
const WRAPPER = /^(div|span|Box|Stack|Flex|Grid|Container|Fragment|Slot|motion|Primitive)$/;

const SHARED_SEGMENT = /^(ui|common|comum|commons|shared|compartilhado|compartilhados|primitives|design-system|ds|base|core|kit)$/;

const singular = (s: string) => s.replace(/ies$/, 'y').replace(/s$/, '');
const norm = (s: string) => singular(s.toLowerCase().replace(/[-_\s]/g, ''));

/** The part of the business a component's folder is: `keys` for `keys` or `keys/detail` */
export function featureOf(folder: string): string {
  return folder.split('/')[0];
}

/**
 * The feature a file belongs to. Under `components/`, its first folder there
 * (`components/keys/detail/X.tsx` → keys). In a route tree (`app/`, `pages/`),
 * the route group when there is one (`app/(sign-in)/login/…` → sign-in), else
 * the first route segment. Elsewhere, nothing.
 */
export function featureOfFile(rel: string): string | undefined {
  const parts = rel.split('/').slice(0, -1);
  const c = parts.lastIndexOf('components');
  if (c >= 0) return parts[c + 1];
  const r = parts.findIndex(p => p === 'app' || p === 'pages');
  if (r < 0) return undefined;
  const route = parts.slice(r + 1);
  const group = route.find(p => /^\(.+\)$/.test(p));
  if (group) return group.slice(1, -1);
  return route.find(p => !/^[_@[]/.test(p));
}

export interface Classified { layer: CatalogLayer; kind: CatalogKind; feature?: string }

/**
 * Layer, kind and (for product components) feature for every entry. `usedIn`
 * gives the project files each entry is used in, to tell a shared pattern
 * from one feature's own piece.
 */
export function classify(entries: CatalogEntry[], usedIn: Map<string, string[]>): Map<string, Classified> {
  const byName = new Map<string, CatalogEntry>();
  for (const e of entries) if (!byName.has(e.name)) byName.set(e.name, e);

  // The project's features: top folders of what isn't the kit or shared
  const features = new Set<string>();
  for (const e of entries) {
    const f = e.library ? undefined : featureOfFile(e.source);
    if (f && !SHARED_SEGMENT.test(f) && f.length >= 3) features.add(f);
  }
  const entityOf = (name: string): string | undefined => {
    const lower = name.toLowerCase();
    return [...features].find(f => { const n = norm(f); return n.length >= 3 && lower.startsWith(n); });
  };

  const kindOf = (e: CatalogEntry): CatalogKind => {
    const own = kindOfName(e.name);
    if (own) return own;
    // What it renders, down a few levels: KeyPanel → FormDialog → Dialog
    let next = e.renders;
    for (let d = 0; next && d < 5; d++) {
      if (!WRAPPER.test(next)) {
        if (/^[a-z]/.test(next)) return TAGS[next] ?? 'other';
        const k = kindOfName(next);
        if (k) return k;
      }
      next = byName.get(next)?.renders;
    }
    return TAGS[e.renders ?? ''] ?? 'other';
  };

  const out = new Map<string, Classified>();
  for (const e of entries) {
    const kind = kindOf(e);
    if (e.library || /(^|\/)(packages|components\/ui)\//.test(e.source) || e.source.split('/').slice(0, -1).some(s => SHARED_SEGMENT.test(s))) {
      out.set(e.id, { layer: 'base', kind });
      continue;
    }
    const own = featureOfFile(e.source);
    // Used across features and named for none of them: a pattern, base
    const across = new Set((usedIn.get(e.id) ?? []).map(featureOfFile).filter((f): f is string => !!f && features.has(f)));
    // (or used by three or more, whatever its name: `Screen` in screen/ is everyone's)
    if (across.size >= 3 || (!entityOf(e.name) && across.size >= 2)) { out.set(e.id, { layer: 'base', kind }); continue; }
    out.set(e.id, { layer: 'product', kind, ...(own ? { feature: own } : {}) });
  }
  return out;
}
