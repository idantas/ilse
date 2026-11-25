/**
 * "Make it a component": an element the design system doesn't list — a `<button>`
 * written by hand, or a component declared inside one file and never exported —
 * becomes a component of the project. The agent finds where the same piece
 * repeats, writes the component next to the others and puts it in every place.
 *
 * The note is the whole request (a resumed agent session only gets the note), and
 * it asks for one line back that Ilse reads: the name, the file and why it exists,
 * shown to the person in a card to keep or rename. Pure: the toolbar and the CLI
 * both use it.
 */

export interface ComponentizeTarget {
  /** The tag (`button`) */
  tag: string;
  /** A local component it already is in the code (`Button` declared in the page file) */
  component?: string;
  /** Its visible text, to recognise it by */
  text?: string;
  /** Where the project keeps its components (`src/components/ui`), when the catalog says */
  kitFolder?: string;
  /** The language the person reads Ilse in: the "when to use" is written in it */
  locale: 'pt' | 'en';
}

export interface Componentized {
  name: string;
  file?: string;
  whenToUse?: string;
  avoid?: string;
  /** Places the agent says it put the component in */
  replaced?: number;
}

/** The summary line's marker: `#<id>: component {"name":…}` */
export const COMPONENTIZE_MARK = 'component';

export function componentizeNote(target: ComponentizeTarget): string {
  const what = target.component
    ? `<${target.component}> (declared in one file and not exported, so the design system doesn't see it)`
    : `this <${target.tag}>${target.text ? ` ("${target.text.slice(0, 40)}")` : ''}, written by hand`;
  const lang = target.locale === 'pt' ? 'Brazilian Portuguese' : 'English';
  return [
    `Make ${what} a component of the project's design system.`,
    '1. Search the codebase for where the same piece repeats: the same markup and classes (or styles), or uses of this local component. A different colour or size of the same piece is a variant of it, not another component.',
    '2. If a catalog component already fits, use it instead of creating one. Otherwise create it',
    target.kitFolder ? `   in ${target.kitFolder}/, next to the project's other components,` : '   next to the project\'s other shared components,',
    '   exported, named the way this team names components, with the design tokens the code already uses (never new raw values). Variants become one prop (e.g. `variant`), with the most common look as the default.',
    '3. Replace every instance you found with the new component, keeping how each one looks and behaves (handlers, text, icons, disabled state). Remove the old local declaration if there was one.',
    '4. Do not change anything else.',
    `When done, instead of the usual summary, print exactly one line: #<id>: ${COMPONENTIZE_MARK} {"name":"<ComponentName>","file":"<path from the project root>","replaced":<places you changed>,"whenToUse":"<one sentence>","avoid":"<one sentence, or empty>"}`,
    `— valid JSON on a single line; whenToUse and avoid in ${lang}, written for a designer: when to reach for this component and when another one fits better.`,
  ].join('\n');
}

/** The agent's line back, or null when it didn't say (then the card asks the catalog) */
export function parseComponentized(summary: string | undefined): Componentized | null {
  if (!summary) return null;
  const at = summary.indexOf('{');
  const end = summary.lastIndexOf('}');
  if (at < 0 || end <= at || !summary.slice(0, at).trim().toLowerCase().startsWith(COMPONENTIZE_MARK)) return null;
  try {
    const raw = JSON.parse(summary.slice(at, end + 1)) as Record<string, unknown>;
    const str = (v: unknown, max: number) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
    const name = str(raw.name, 80);
    if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
    const replaced = typeof raw.replaced === 'number' && raw.replaced >= 0 ? Math.round(raw.replaced) : undefined;
    return {
      name,
      ...(str(raw.file, 300) ? { file: str(raw.file, 300) } : {}),
      ...(str(raw.whenToUse, 600) ? { whenToUse: str(raw.whenToUse, 600) } : {}),
      ...(str(raw.avoid, 600) ? { avoid: str(raw.avoid, 600) } : {}),
      ...(replaced !== undefined ? { replaced } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Where the project keeps its shared components: the folder holding most of the
 * catalog's base project components (`src/components/ui`), else most of any project's.
 */
export function kitFolderOf(items: Array<{ source: string; library: boolean; layer?: string }>): string | undefined {
  const own = items.filter(i => !i.library && i.source.includes('/'));
  const pick = (list: typeof own) => {
    const n = new Map<string, number>();
    for (const i of list) { const dir = i.source.slice(0, i.source.lastIndexOf('/')); n.set(dir, (n.get(dir) ?? 0) + 1); }
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  };
  return pick(own.filter(i => i.layer === 'base')) ?? pick(own);
}
