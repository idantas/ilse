/**
 * Bundled frames → the project file they came from.
 *
 * React's dev stack says where each element was created. Vite serves files
 * under their own path (`/src/App.tsx`) and webpack names them
 * (`webpack-internal:///./src/App.tsx`), but Turbopack — Next 16's default —
 * points at a chunk: `/_next/static/chunks/_0c7ltkze4d_x1._.js:8188:422`. The
 * chunk's source map says which file that line and column were, so the toolbar
 * keeps the position (`#L8188:422`) and this reads the map from the dev server
 * the page came from. Loopback only; any doubt → null, and the caller works
 * as it did without it.
 */

import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

interface RawMap { sources: string[]; mappings: string; sourceRoot?: string }
interface IndexMap { sections: Array<{ offset: { line: number; column: number }; map: RawMap }> }

const CHUNK = /^(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/_next\/static\/.+?\.js)(?:\?[^#]*)?#L(\d+):(\d+)$/;

/** A frame URL that needs a source map: the chunk, and the 0-based line and column in it */
export function chunkPosition(url: string): { chunk: string; line: number; column: number } | null {
  const m = CHUNK.exec(url);
  return m ? { chunk: m[1], line: +m[2] - 1, column: +m[3] - 1 } : null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 VLQ segment → its numbers */
function decodeSegment(seg: string): number[] {
  const out: number[] = [];
  let value = 0, shift = 0;
  for (const ch of seg) {
    const d = B64.indexOf(ch);
    if (d < 0) return out;
    value += (d & 31) << shift;
    if (d & 32) { shift += 5; continue; }
    out.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0; shift = 0;
  }
  return out;
}

/** The source a plain map gives for a generated line/column (both 0-based) */
export function sourceAt(map: RawMap, line: number, column: number): string | null {
  if (map.sources.length === 1) return map.sources[0];
  let source = 0;
  const lines = map.mappings.split(';');
  if (line >= lines.length) return null;
  let found: number | null = null;
  for (let l = 0; l <= line; l++) {
    let col = 0;
    for (const seg of lines[l].split(',')) {
      if (!seg) continue;
      const f = decodeSegment(seg);
      col += f[0] ?? 0;
      if (f.length >= 4) source += f[1];
      if (l === line && f.length >= 4) {
        if (col > column) return found !== null ? map.sources[found] : map.sources[source] ?? null;
        found = source;
      }
    }
  }
  return found !== null ? map.sources[found] ?? null : null;
}

/** The source for a position in an index map (Turbopack's: one section per module) or a plain one */
export function sourceInMap(map: RawMap | IndexMap, line: number, column: number): string | null {
  if (!('sections' in map)) return sourceAt(map, line, column);
  let pick: IndexMap['sections'][number] | undefined;
  for (const s of map.sections) {
    const { line: l, column: c } = s.offset;
    if (l < line || (l === line && c <= column)) pick = s; else break;
  }
  if (!pick) return null;
  const dl = line - pick.offset.line;
  return sourceAt(pick.map, dl, dl === 0 ? column - pick.offset.column : column);
}

/** `file:///…/app/x.tsx` or `turbopack:///[project]/app/x.tsx` → project-relative path */
export function projectPath(source: string, cwd: string): string | null {
  let rel: string | null = null;
  if (source.startsWith('file://')) {
    try { rel = relative(cwd, fileURLToPath(source)).split(sep).join('/'); } catch { return null; }
  } else {
    const m = /^(?:turbopack|webpack):\/\/\/?(?:\[project\]\/)?(.+)$/.exec(source);
    rel = m ? m[1].replace(/^\.\//, '') : null;
  }
  if (!rel || rel.startsWith('..') || rel.includes('node_modules')) return null;
  return rel;
}

// Chunks change name when their code changes, so a URL's map stays right; kept briefly anyway
const maps = new Map<string, { at: number; map: Promise<RawMap | IndexMap | null> }>();
const TTL = 30_000;

async function loadMap(chunk: string): Promise<RawMap | IndexMap | null> {
  const hit = maps.get(chunk);
  if (hit && Date.now() - hit.at < TTL) return hit.map;
  const map = fetch(`${chunk}.map`, { signal: AbortSignal.timeout(3000) })
    .then(r => (r.ok ? r.json() as Promise<RawMap | IndexMap> : null))
    .catch(() => null);
  maps.set(chunk, { at: Date.now(), map });
  if (maps.size > 50) maps.delete(maps.keys().next().value!);
  return map;
}

/**
 * A chunk frame (`…/_next/static/chunks/x.js#L12:5`) as the file it was
 * (`http://localhost:3000/components/keys/KeyDialog.tsx`), the shape every
 * caller already reads. Anything else is returned as it came.
 */
export async function resolveFrameUrl(url: string, cwd: string): Promise<string> {
  const at = chunkPosition(url);
  if (!at) return url;
  const map = await loadMap(at.chunk);
  const source = map ? sourceInMap(map, at.line, at.column) : null;
  const rel = source ? projectPath(source, cwd) : null;
  return rel ? `${new URL(at.chunk).origin}/${rel}` : url;
}
