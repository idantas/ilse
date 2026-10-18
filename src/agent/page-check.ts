import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import type { FileChange } from './changeset.js';

// ── Did the change land on the page the designer was looking at? ───────────
//
// The agent can edit the right kind of screen in the wrong place: a note that
// describes "providers with their areas below" matched a list screen while the
// designer was on the provider's edit canvas. The toolbar sends the names of the
// components rendered on the page; a run whose edited components are none of
// them changed another screen, and the toolbar says so instead of "done".

/** Below this, the page told us too little (not React, or nothing rendered) to judge */
const MIN_PAGE_COMPONENTS = 3;

const COMPONENT_FILE = /\.(tsx|jsx)$/;
/** Next.js route files render on the server: their names never reach the browser */
const ROUTE_FILE = /^(page|layout|template|loading|error|not-found|default|global-error)\.(tsx|jsx)$/;

/** Capitalized names a file declares: `function X`, `const X =`, `class X` */
export function declaredComponents(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/\b(?:function|const|let|class)\s+([A-Z][\w$]*)/g)) names.add(m[1]);
  return [...names];
}

/** A Next.js app-router file as the URL it serves: groups and the file name dropped */
export function routeOf(file: string): string | null {
  const parts = file.split(/[\\/]/);
  const app = parts.lastIndexOf('app');
  if (app < 0 || !/^page\.(tsx|jsx|ts|js)$/.test(parts[parts.length - 1])) return null;
  const segments = parts.slice(app + 1, -1).filter(s => !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  return '/' + segments.join('/');
}

export interface OffPage {
  /** Edited component files with nothing rendered on the page */
  files: string[];
  /** Pages that use them, when a route imports one directly */
  routes: string[];
}

/**
 * The run's edits to existing component files, when none of them renders on the
 * page. Null when the page can't tell (too few names), when nothing judgeable
 * changed (new files, messages, styles, route files), or when any edit is on it.
 */
export function offPageEdits(
  files: FileChange[],
  pageComponents: Iterable<string>,
  routesFor: (paths: string[]) => string[] = () => [],
): OffPage | null {
  const page = new Set(pageComponents);
  if (page.size < MIN_PAGE_COMPONENTS) return null;
  // Created files can't be on the page yet; whoever imports them is the edit that counts
  const judged = files.filter(f => f.before !== null && f.after !== null
    && COMPONENT_FILE.test(f.path) && !ROUTE_FILE.test(basename(f.path)));
  if (judged.length === 0) return null;
  const onPage = judged.some(f => declaredComponents(`${f.before}\n${f.after}`).some(name => page.has(name)));
  if (onPage) return null;
  const paths = judged.map(f => f.path);
  return { files: paths, routes: routesFor(paths) };
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo']);

/** The app-router pages that import one of these files directly, as URLs */
export function routesImporting(paths: string[], cwd: string, limit = 3): string[] {
  const stems = paths.map(p => basename(p, extname(p)));
  const routes: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 12 || routes.length >= limit) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (routes.length >= limit || SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let isDir = false;
      try { isDir = statSync(full).isDirectory(); } catch { continue; }
      if (isDir) { visit(full, depth + 1); continue; }
      const route = routeOf(relative(cwd, full).split(sep).join('/'));
      if (!route) continue;
      let source = '';
      try { source = readFileSync(full, 'utf8'); } catch { continue; }
      if (stems.some(stem => new RegExp(`from\\s+['"][^'"]*/${stem}['"]`).test(source)) && !routes.includes(route)) routes.push(route);
    }
  };
  for (const root of ['app', 'src/app']) visit(join(cwd, root), 0);
  return routes;
}
