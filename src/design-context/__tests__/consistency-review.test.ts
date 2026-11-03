import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanPieces, reviewInput, reviewKey } from '../consistency-review.js';
import type { CatalogEntry } from '../catalog.js';

const entry = (name: string, source: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: `${source}#${name}`, name, source, folder: 'ui', library: false, importAs: 'named', uses: 1, props: [], layer: 'base', ...over,
});

describe('consistency review input', () => {
  it('keeps only well-formed pieces', () => {
    expect(cleanPieces([{ id: 0, kind: 'chip', text: 'Pago', look: 'radius 8', owner: 'Row' }, { id: 'x' }, null, { id: 1, kind: 'button', look: 'h 32' }]))
      .toEqual([{ id: 0, kind: 'chip', text: 'Pago', look: 'radius 8', owner: 'Row' }, { id: 1, kind: 'button', text: '', look: 'h 32' }]);
  });

  it('hands over the DS, and the code of the components that write the pieces, lines numbered', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-review-'));
    mkdirSync(join(cwd, 'app'));
    writeFileSync(join(cwd, 'app/row.tsx'), 'export function Row() {\n  return <span className="rounded-full">Pago</span>;\n}');
    const catalog = [
      entry('Badge', 'components/ui/badge.tsx', { props: [{ name: 'color', required: false, values: ['gray', 'green'], kind: 'enum' }] }),
      entry('Row', 'app/row.tsx', { folder: 'app', layer: 'product' }),
    ];
    const input = reviewInput(cwd, catalog, [], { route: '/', pieces: [{ id: 0, kind: 'chip', text: 'Pago', look: 'radius pill', owner: 'Row' }], known: [] }, 'shop', 'pt');
    expect(input.components).toContainEqual({ name: 'Badge', file: 'components/ui/badge.tsx', props: ['color: gray | green'] });
    expect(input.sources).toEqual([{ component: 'Row', file: 'app/row.tsx', code: '1: export function Row() {\n2:   return <span className="rounded-full">Pago</span>;\n3: }' }]);
  });
});

describe('reviewKey', () => {
  const base = { sources: [{ component: 'Landing', file: 'app/landing.tsx', code: '1: <Link className="x">' }], known: [], ignored: [] };
  it('changes when the code that writes the screen changes', () => {
    const after = { ...base, sources: [{ ...base.sources[0], code: '1: <Button href="/">' }] };
    expect(reviewKey('/#a', base)).not.toBe(reviewKey('/#a', after));
  });
  it('stays the same for the same screen and code', () => {
    expect(reviewKey('/#a', base)).toBe(reviewKey('/#a', { ...base, sources: [...base.sources] }));
  });
});
