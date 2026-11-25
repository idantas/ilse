/**
 * The DS window's colours by what they're for, not in the order the CSS declared them. No AI:
 * the names say it (shadcn's, Tailwind's, a team's own, English or Portuguese).
 *
 *   - `primary` + `primary-foreground` are one colour: the fill and the text that goes on it
 *   - a component's own set (`sidebar-*`, 2+ tokens sharing a first word that isn't a role)
 *     stays together, named after it
 *   - the rest by role: brand & actions, surfaces, text, borders & focus, states, feedback, data
 */

export type ColorRole = 'brand' | 'surface' | 'text' | 'border' | 'state' | 'status' | 'data' | 'family' | 'other';

export interface ColorItem {
  /** Name without `color.` */
  name: string;
  /** Its `-foreground`, drawn on it */
  on?: string;
}

export interface ColorGroup {
  role: ColorRole;
  /** The family's first word, for role `family` */
  family?: string;
  items: ColorItem[];
}

const ROLES: Array<[Exclude<ColorRole, 'family' | 'other'>, RegExp]> = [
  ['status', /^(destructive|danger|error|erro|perigo|success|sucesso|warning|aviso|alerta|caution|info|informacao|positive|negative|critical|attention)(-|$)/i],
  ['border', /(^|-)(border|borda|input|ring|outline|divider|separator|stroke|focus)(-|$)/i],
  ['state', /^(hover|active|selected|pressed|disabled|checked|dragging|drop)(-|$)/i],
  ['text', /^(foreground|text|texto|fg|heading|body|link|placeholder)(-|$)/i],
  ['brand', /^(primary|primaria|secondary|secundaria|tertiary|accent|destaque|brand|marca|cta|action)(-|$)/i],
  ['surface', /^(background|bg|surface|superficie|card|popover|muted|canvas|panel|overlay|fundo|backdrop|layer|base)(-|$)/i],
  ['data', /^(chart|graph|grafico|data|viz|series|serie|heatmap|heat)(-|$)/i],
];

export const ROLE_ORDER: ColorRole[] = ['brand', 'surface', 'text', 'border', 'state', 'status', 'data', 'family', 'other'];

function roleOf(name: string): Exclude<ColorRole, 'family'> {
  for (const [role, re] of ROLES) if (re.test(name)) return role;
  return 'other';
}

const first = (name: string) => name.split('-')[0].toLowerCase();

export function groupColors(names: string[]): ColorGroup[] {
  const all = new Set(names);
  // A `-foreground` with its fill is drawn on it; alone it's text
  const onOf = new Map<string, string>();
  for (const n of names) {
    const m = /^(.*)-foreground$/.exec(n);
    if (m && all.has(m[1])) onOf.set(m[1], n);
  }
  const paired = new Set(onOf.values());
  const items: ColorItem[] = names.filter(n => !paired.has(n)).map(n => ({ name: n, ...(onOf.has(n) ? { on: onOf.get(n) } : {}) }));

  // A component's own set: a first word shared by 2+ colours, when that word isn't a role
  // (`surface-1..8` are surfaces, `sidebar-*` is the sidebar's)
  const count = new Map<string, number>();
  for (const it of items) if (it.name.includes('-')) count.set(first(it.name), (count.get(first(it.name)) ?? 0) + 1);
  const familyOf = (name: string): string | null => {
    const word = first(name);
    // `sidebar` itself joins `sidebar-*`
    const size = (count.get(word) ?? 0) + (all.has(word) ? 1 : 0);
    return size >= 2 && roleOf(word) === 'other' ? word : null;
  };

  const groups = new Map<string, ColorGroup>();
  for (const it of items) {
    const family = familyOf(it.name);
    const role: ColorRole = family ? 'family' : roleOf(it.name);
    const key = family ? `family:${family}` : role;
    const g = groups.get(key) ?? { role, ...(family ? { family } : {}), items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  // Numbered steps in order (surface-2 before surface-10), names otherwise as declared
  const step = (n: string) => { const m = /-(\d+)$/.exec(n); return m ? Number(m[1]) : null; };
  for (const g of groups.values()) {
    g.items = g.items.map((it, i) => ({ it, i })).sort((a, b) => {
      const sa = step(a.it.name), sb = step(b.it.name);
      const pa = a.it.name.replace(/-\d+$/, ''), pb = b.it.name.replace(/-\d+$/, '');
      return sa !== null && sb !== null && pa === pb ? sa - sb : a.i - b.i;
    }).map(x => x.it);
  }
  return [...groups.values()].sort((a, b) =>
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || (a.family ?? '').localeCompare(b.family ?? ''));
}
