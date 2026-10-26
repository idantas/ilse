/**
 * Catalog search, shared by the CLI and the toolbar (no Node imports): by name,
 * and by what a component is for — "botão" finds Button, "modal" finds Dialog —
 * from a word list and the element the component renders. No AI: what isn't
 * in the list is found by its name.
 */

/** Words a person types for a kind of component → names that kind usually has */
const FUNCTION_WORDS: Array<[string[], string[]]> = [
  [['botao', 'button', 'acao', 'action', 'cta'], ['Button', 'IconButton', 'Fab', 'ButtonGroup']],
  [['modal', 'dialogo', 'dialog', 'janela', 'popup', 'overlay'], ['Dialog', 'Modal', 'AlertDialog', 'Sheet', 'Drawer']],
  [['gaveta', 'drawer', 'painel lateral', 'sidebar', 'barra lateral'], ['Drawer', 'Sheet', 'Sidebar']],
  [['campo', 'input', 'entrada', 'field', 'formulario', 'form'], ['Input', 'TextField', 'Textarea', 'TextArea', 'Select', 'Form', 'FormField', 'Field']],
  [['texto', 'text', 'tipografia', 'typography', 'paragrafo'], ['Typography', 'Text', 'Paragraph']],
  [['titulo', 'heading', 'title', 'cabecalho', 'header'], ['Heading', 'Title', 'PageHeader', 'Header', 'CardHeader', 'Typography']],
  [['cartao', 'card', 'bloco', 'tile', 'caixa'], ['Card', 'Paper', 'Tile', 'Box']],
  [['tabela', 'table', 'grade de dados', 'datagrid'], ['Table', 'DataTable', 'DataGrid']],
  [['lista', 'list'], ['List', 'ListItem', 'Table']],
  [['menu', 'dropdown', 'suspenso'], ['Menu', 'DropdownMenu', 'Dropdown', 'Select', 'Popover']],
  [['selecao', 'select', 'combo', 'escolha'], ['Select', 'Combobox', 'Autocomplete', 'RadioGroup']],
  [['aba', 'abas', 'tab', 'tabs'], ['Tabs', 'Tab', 'TabsList']],
  [['imagem', 'image', 'foto', 'figura'], ['Image', 'Img', 'Avatar', 'Picture']],
  [['avatar', 'perfil', 'usuario'], ['Avatar', 'AvatarGroup']],
  [['selo', 'badge', 'etiqueta', 'tag', 'chip', 'pill', 'status'], ['Badge', 'Chip', 'Tag', 'Pill', 'StatusBadge']],
  [['alerta', 'aviso', 'alert', 'toast', 'notificacao', 'snackbar', 'banner'], ['Alert', 'Toast', 'Snackbar', 'Banner', 'Callout']],
  [['carregando', 'loading', 'spinner', 'esqueleto', 'skeleton', 'progresso', 'progress'], ['Spinner', 'Skeleton', 'CircularProgress', 'LinearProgress', 'Progress', 'Loader']],
  [['checkbox', 'marcar', 'caixa de selecao'], ['Checkbox']],
  [['interruptor', 'switch', 'toggle', 'chave'], ['Switch', 'Toggle', 'ToggleGroup']],
  [['link', 'ancora', 'anchor'], ['Link', 'Anchor', 'NavLink']],
  [['rodape', 'footer'], ['Footer']],
  [['data', 'date', 'calendario', 'calendar'], ['DatePicker', 'Calendar', 'DateRangePicker']],
  [['dica', 'tooltip', 'hint'], ['Tooltip', 'HoverCard']],
  [['divisor', 'separador', 'divider', 'separator', 'linha'], ['Divider', 'Separator']],
  [['layout', 'grade', 'grid', 'pilha', 'stack', 'container', 'coluna', 'linha'], ['Grid', 'Stack', 'Box', 'Container', 'Flex']],
  [['navegacao', 'nav', 'navbar', 'breadcrumb', 'migalha'], ['Nav', 'Navbar', 'NavigationMenu', 'Breadcrumb', 'Breadcrumbs', 'AppBar', 'Toolbar']],
  [['grafico', 'chart', 'graph'], ['Chart', 'LineChart', 'BarChart', 'PieChart', 'AreaChart']],
  [['acordeao', 'accordion', 'sanfona', 'expandir', 'collapse'], ['Accordion', 'Collapsible', 'Collapse']],
  [['paginacao', 'pagination'], ['Pagination']],
  [['slider', 'controle deslizante', 'range'], ['Slider']],
  [['icone', 'icon'], ['Icon', 'IconButton', 'SvgIcon']],
];

/** Root tags → the same words, for project components named after what they do (`SaveAction` renders a button) */
const TAG_KINDS: Record<string, string[]> = {
  button: ['Button'], a: ['Link'], input: ['Input'], textarea: ['Textarea'], select: ['Select'], table: ['Table'],
  img: ['Image'], dialog: ['Dialog'], nav: ['Nav'], header: ['Header'], footer: ['Footer'], ul: ['List'], ol: ['List'], form: ['Form'],
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Names a query means by function ("botão" → Button, IconButton…) */
export function namesFor(query: string): Set<string> {
  const q = fold(query);
  const out = new Set<string>();
  if (q.length < 2) return out;
  for (const [words, names] of FUNCTION_WORDS) {
    if (words.some(w => w === q || (q.length >= 3 && w.startsWith(q)))) for (const n of names) out.add(n);
  }
  return out;
}

/** Entries matching a query, best first: name, then function, then folder */
export function searchCatalog<T extends { name: string; folder: string; renders?: string }>(list: T[], query: string): T[] {
  const q = fold(query);
  if (!q) return list;
  const meant = namesFor(query);
  const scored = list.map(e => {
    const name = fold(e.name);
    let score = 0;
    if (name === q) score = 10;
    else if (name.startsWith(q)) score = 8;
    else if (name.includes(q)) score = 6;
    else if (meant.has(e.name) || [...meant].some(m => e.name.endsWith(m))) score = 4;
    else if (e.renders && (TAG_KINDS[e.renders] ?? []).some(k => meant.has(k))) score = 3;
    else if (fold(e.folder).includes(q)) score = 1;
    return { e, score };
  });
  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name)).map(s => s.e);
}
