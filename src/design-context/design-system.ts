/**
 * The design system a project already has, read from where it's declared — so
 * the catalog uses its names and groups instead of Ilse's.
 *
 * - **Storybook:** each story's `title` (`'Forms/Input'`) says the group and
 *   the official name; `component: Input` ties it to the code.
 * - **shadcn:** `components.json` says where the kit lives (`aliases.ui`).
 * - **A design system package** (`@acme/ui`): a dependency whose package.json
 *   calls itself one (keywords or description).
 *
 * Read only, no AI; anything it can't read is left to the rules.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

export interface DesignSystem {
  /** Component name → the group its stories put it in (`Forms`); '' when the title only says "Components" */
  storyGroups: Map<string, string>;
  /** Folders (project-relative) holding the kit: shadcn's `aliases.ui` */
  kitFolders: string[];
  /** Dependencies that are design systems: `@acme/ui` */
  packages: string[];
  /** What to call it in the panel: the package, or "Storybook", or "shadcn/ui" */
  name?: string;
}

/** First title segments that only say "this is a component", not what kind */
const GENERIC_GROUP = /^(components?|componentes?|ui|primitives?|core|base|elements?|general|library|lib|design system|ds)$/i;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'out', 'coverage', 'storybook-static', '.git']);

function storyFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 8 || out.length >= 600) return;
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) storyFiles(full, out, depth + 1);
    else if (/\.stories\.(tsx|ts|jsx|js)$/.test(name)) out.push(full);
  }
}

/** `title: 'Forms/Text Input'` and `component: TextInput` from one story file */
export function readStory(code: string): { title?: string; component?: string } {
  const title = /\btitle\s*:\s*(['"`])([^'"`]+)\1/.exec(code)?.[2];
  const component = /\bcomponent\s*:\s*([A-Z][\w.]*)/.exec(code)?.[1]?.split('.').pop();
  return { title, component };
}

/** `Components/Forms/Input` → Forms; `UI/Badge` → '' (generic) */
export function groupOfTitle(title: string): string {
  const parts = title.split('/').map(p => p.trim()).filter(Boolean).slice(0, -1);
  while (parts.length && GENERIC_GROUP.test(parts[0])) parts.shift();
  return parts.join(' / ');
}

function readJson(file: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return null; }
}

/** `@/components/ui` → `src/components/ui` (or `components/ui` without src/) */
function aliasFolder(cwd: string, alias: string): string | null {
  const rest = alias.replace(/^[@~]\//, '');
  for (const base of alias.startsWith('@/') || alias.startsWith('~/') ? ['src', ''] : ['']) {
    const rel = base ? `${base}/${rest}` : rest;
    if (existsSync(join(cwd, rel))) return rel;
  }
  return null;
}

export function readDesignSystem(cwd: string): DesignSystem {
  const ds: DesignSystem = { storyGroups: new Map(), kitFolders: [], packages: [] };

  // Storybook: the stories in the project say each component's group
  if (existsSync(join(cwd, '.storybook'))) {
    const files: string[] = [];
    storyFiles(cwd, files);
    for (const f of files) {
      let code: string;
      try { code = readFileSync(f, 'utf8'); } catch { continue; }
      const { title, component } = readStory(code);
      if (!title) continue;
      const name = component ?? title.split('/').pop()!.replace(/\s+/g, '');
      if (!ds.storyGroups.has(name)) ds.storyGroups.set(name, groupOfTitle(title));
    }
    if (ds.storyGroups.size) ds.name = 'Storybook';
  }

  // shadcn: where the kit was installed
  const shadcn = readJson(join(cwd, 'components.json'));
  const ui = (shadcn?.aliases as Record<string, unknown> | undefined)?.ui;
  if (typeof ui === 'string') {
    const folder = aliasFolder(cwd, ui);
    if (folder) { ds.kitFolders.push(folder.split(sep).join('/')); ds.name ??= 'shadcn/ui'; }
  }

  // A dependency that says it's a design system
  const pkg = readJson(join(cwd, 'package.json'));
  const deps = Object.keys({ ...(pkg?.dependencies as object ?? {}), ...(pkg?.peerDependencies as object ?? {}) });
  for (const dep of deps) {
    const meta = readJson(join(cwd, 'node_modules', dep, 'package.json'));
    if (!meta) continue;
    const words = [String(meta.description ?? ''), ...((meta.keywords as unknown[]) ?? []).map(String)].join(' ');
    if (/design[\s-]?system/i.test(words)) ds.packages.push(dep);
  }
  if (ds.packages.length) ds.name = ds.packages[0];

  return ds;
}

/** Is this project file part of the kit the design system declares? */
export function inKit(ds: DesignSystem, rel: string): boolean {
  return ds.kitFolders.some(f => rel === f || rel.startsWith(`${f}/`));
}

