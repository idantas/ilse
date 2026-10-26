import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCatalogFile, parseCatalogFile } from '../catalog-file.js';
import { buildCatalog } from '../catalog.js';

describe('.ilse/catalog.md', () => {
  it('reads areas, moves and hidden pieces, in either language', () => {
    const f = parseCatalogFile([
      '## Áreas', '<!-- pasta: nome -->', '- keys: Chaves', '- data-sources: Fontes de dados',
      '## Componentes', '- MetricCard: Base, Exibição de dados', '- OwnerBillingField: Produto, Cobrança', '- KeyDialog: Chaves', '- Gauge: Charts',
      '## Hidden', '- ThemeScript',
    ].join('\n'));
    expect(f.areas.get('keys')).toBe('Chaves');
    expect(f.components.get('MetricCard')).toEqual({ layer: 'base', kind: 'data' });
    expect(f.components.get('OwnerBillingField')).toEqual({ layer: 'product', feature: 'Cobrança' });
    expect(f.components.get('KeyDialog')).toEqual({ layer: 'product', feature: 'Chaves' });
    expect(f.components.get('Gauge')).toEqual({ layer: 'base', kind: 'charts' });
    expect([...f.hidden]).toEqual(['ThemeScript']);
  });

  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('the catalog follows it: areas named, components moved, hidden ones gone', () => {
    dir = mkdtempSync(join(tmpdir(), 'ilse-catfile-'));
    mkdirSync(join(dir, 'src/components/keys'), { recursive: true });
    mkdirSync(join(dir, 'src/components/billing'), { recursive: true });
    writeFileSync(join(dir, 'src/components/keys/KeyDialog.tsx'), 'export function KeyDialog() { return <div /> }\n');
    writeFileSync(join(dir, 'src/components/keys/OwnerField.tsx'), 'export function OwnerField() { return <input /> }\n');
    writeFileSync(join(dir, 'src/components/billing/Invoice.tsx'), 'export function Invoice() { return <div /> }\n');
    writeFileSync(join(dir, 'src/App.tsx'), "import { KeyDialog } from './components/keys/KeyDialog';\nimport { OwnerField } from './components/keys/OwnerField';\nimport { Invoice } from './components/billing/Invoice';\nexport default function App() { return <><KeyDialog /><OwnerField /><Invoice /></>; }\n");
    const created = createCatalogFile(dir, ['keys', 'billing'], 'pt');
    expect(created.created).toBe(true);
    expect(readFileSync(created.path, 'utf8')).toContain('- keys: Keys');
    expect(createCatalogFile(dir, [], 'pt').created).toBe(false); // never overwrites

    writeFileSync(created.path, '## Áreas\n- keys: Chaves\n- billing: Cobrança\n## Componentes\n- OwnerField: Cobrança\n## Ocultos\n- Invoice\n');
    const byName = new Map(buildCatalog(dir).map(e => [e.name, e]));
    expect(byName.get('KeyDialog')).toMatchObject({ layer: 'product', feature: 'keys', featureLabel: 'Chaves' });
    expect(byName.get('OwnerField')).toMatchObject({ feature: 'billing', featureLabel: 'Cobrança' });
    expect(byName.has('Invoice')).toBe(false);
  });
});
