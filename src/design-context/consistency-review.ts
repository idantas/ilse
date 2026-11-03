/**
 * The Consistency tab's question to the user's agent (Pro): what Ilse hands over for one screen.
 * The agent has no tools, so the code it judges goes in the prompt: the files of the components
 * that write the pieces, lines numbered, so it can answer with file:line.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogEntry } from './catalog.js';
import type { ConsistencyReviewInput } from '../pro/types.js';

type Piece = ConsistencyReviewInput['pieces'][number];

const MAX_FILES = 12;
const MAX_LINES = 300;

/** The standard, as the toolbar reads it: the base layer (components/ui) when there is one, else the project's components */
export function standardEntries(catalog: CatalogEntry[]): CatalogEntry[] {
  const base = catalog.filter(e => e.layer === 'base' && e.folder === 'ui');
  return base.length >= 5 ? base : catalog.filter(e => !e.library || e.layer === 'base');
}

/** Only what the toolbar can have sent: numbers and short strings */
export function cleanPieces(raw: unknown[], max = 120): Piece[] {
  const str = (v: unknown, n = 80) => typeof v === 'string' ? v.slice(0, n) : undefined;
  const out: Piece[] = [];
  for (const r of raw.slice(0, max)) {
    const p = r as Record<string, unknown>;
    if (typeof p?.id !== 'number' || !str(p.kind) || typeof p.look !== 'string') continue;
    const owner = str(p.owner), component = str(p.component);
    out.push({ id: p.id, kind: str(p.kind)!, text: str(p.text) ?? '', look: str(p.look, 200)!, ...(owner ? { owner } : {}), ...(component ? { component } : {}) });
  }
  return out;
}

const numbered = (code: string) => code.split('\n').slice(0, MAX_LINES).map((l, i) => `${i + 1}: ${l}`).join('\n');

export function reviewInput(cwd: string, catalog: CatalogEntry[], tokens: ConsistencyReviewInput['tokens'], req: { route: string; pieces: Piece[]; known: string[]; ignored?: string[] }, name: string, locale: 'pt' | 'en'): ConsistencyReviewInput {
  const byName = new Map(catalog.filter(e => !e.library).map(e => [e.name, e]));
  // The files that write the most pieces first
  const owners = new Map<string, number>();
  for (const p of req.pieces) if (p.owner && byName.has(p.owner)) owners.set(p.owner, (owners.get(p.owner) ?? 0) + 1);
  const sources: ConsistencyReviewInput['sources'] = [];
  const files = new Set<string>();
  for (const [owner] of [...owners].sort((a, b) => b[1] - a[1])) {
    const file = byName.get(owner)!.source;
    if (files.has(file)) continue;
    if (files.size >= MAX_FILES) break;
    try { sources.push({ component: owner, file, code: numbered(readFileSync(join(cwd, file), 'utf8')) }); files.add(file); } catch { /* moved since the scan */ }
  }
  return {
    name, route: req.route, locale,
    components: standardEntries(catalog).map(e => ({
      name: e.name, file: e.source,
      props: e.props.filter(p => p.values.length).map(p => `${p.name}: ${p.values.join(' | ')}`),
    })),
    tokens: tokens.slice(0, 160),
    pieces: req.pieces, sources, known: req.known.slice(0, 60), ignored: (req.ignored ?? []).map(x => x.slice(0, 200)).slice(0, 60),
  };
}

/** The review's cache key: the screen (route + its pieces) and the code that writes it. A fix changes
 *  the code but not the pieces' words, so without the code an old finding would come back forever */
export function reviewKey(screen: string, input: Pick<ConsistencyReviewInput, 'sources' | 'known' | 'ignored'>): string {
  const h = createHash('sha1');
  for (const s of input.sources) h.update(`${s.file}\n${s.code}\n`);
  h.update(input.known.join('\n')).update((input.ignored ?? []).join('\n'));
  return `${screen}@${h.digest('hex').slice(0, 12)}`;
}
