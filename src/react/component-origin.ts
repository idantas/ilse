/**
 * Which component an element really is: by where it was written, not by its name.
 *
 * A project can have its own `Badge` next to its design system's `Badge`. Same
 * name, two components: picking by name sent "All · 65 <Badge>" to the DS's file
 * while the screen showed the project's. React's dev build records where each
 * element's JSX ran (`_debugStack`): the elements a component renders were
 * created in the file that defines it, so that file — a project path, or a
 * package under node_modules — tells the two apart.
 */

/** The fewest fields of a catalog entry this needs */
export interface Origin { name: string; source: string; library: boolean }

/** React's own frames, never where a component is defined */
const REACT_FRAME = /react-stack|jsx-dev-runtime|jsx-runtime|react-dom|react-server-dom|jsxDEV|\/react\/cjs\//;

/** The file the first non-React frame of a dev stack points at — packages included */
export function creatorUrl(stack: string | undefined): string | undefined {
  for (const line of (stack ?? '').split('\n')) {
    // `at Badge (url:12:3)` or `at url:12:3`
    const m = /^\s*at\s+(?:.*?\s\()?([^()\s]+?)(?::\d+)?(?::\d+)?\)?\s*$/.exec(line);
    if (!m) continue;
    const file = m[1];
    if (REACT_FRAME.test(line)) continue;
    // Turbopack's chunk of React itself
    if (/\/chunks\/(?:\w+_)?(?:next_dist_compiled_react|react)/.test(file)) continue;
    return file;
  }
  return undefined;
}

/** A package's file: node_modules in the path (webpack, Vite) or in a Turbopack chunk's name */
export function isPackageUrl(url: string): boolean {
  return /node_modules|\/chunks\/(?:\w+_)?node_modules_|\/\.vite\/deps\//.test(url);
}

/** Letters and digits only, so `@idantas/ui` matches `node_modules_@idantas_ui_dist…` and `components/badge.tsx` matches `src_components_badge_tsx` */
const flat = (s: string) => decodeURIComponent(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Among same-named catalog entries, the one written where this element's
 * component is defined. One candidate: itself. Several and no way to tell
 * (no dev stack, or nothing matches): null — never a guess, since a wrong one
 * edits a file that isn't on screen.
 */
export function pickByOrigin<T extends Origin>(candidates: T[], url: string | undefined): T | null {
  if (candidates.length <= 1) return candidates[0] ?? null;
  if (!url) return null;
  const inPackage = isPackageUrl(url);
  const side = candidates.filter(c => c.library === inPackage);
  if (side.length === 1) return side[0];
  if (side.length === 0) return null;
  const where = flat(url);
  // The package name, or the project file (without its extension: chunks rename `.tsx`)
  const hits = side.filter(c => where.includes(flat(inPackage ? c.source : c.source.replace(/\.(tsx|ts|jsx|js)$/, ''))));
  return hits.length === 1 ? hits[0] : null;
}

/** `@idantas/ui` from a package file's url, when the path says it */
export function packageOfUrl(url: string): string | undefined {
  const m = /node_modules\/((?:@[\w.-]+\/)?[\w.-]+)/.exec(decodeURIComponent(url));
  return m?.[1];
}
