import { describe, it, expect } from 'vitest';
import { classify, featureOfFile, kindOfName } from '../catalog-kinds.js';
import type { CatalogEntry } from '../catalog.js';

describe('what a component is for', () => {
  it('reads the name right to left; a part belongs to its family', () => {
    expect(kindOfName('KeyExpiryPicker')).toBe('inputs');
    expect(kindOfName('IconButton')).toBe('actions');
    expect(kindOfName('DialogTitle')).toBe('overlays');
    expect(kindOfName('TableCell')).toBe('data');
    expect(kindOfName('KeysEmpty')).toBe('feedback');
    expect(kindOfName('LineChart')).toBe('charts');
    expect(kindOfName('PageHeader')).toBe('layout');
    expect(kindOfName('Typography')).toBe('text');
    expect(kindOfName('Wobble')).toBeNull();
  });

  it('reads Portuguese names from the front: CampoDeSegredo is a field', () => {
    expect(kindOfName('CampoDeSegredo')).toBe('inputs');
    expect(kindOfName('CartaoDeBarras')).toBe('data');
    expect(kindOfName('Alternador')).toBe('inputs');
  });

  it('the feature of a file: its folder under components, or the route group', () => {
    expect(featureOfFile('components/keys/detail/KeyFact.tsx')).toBe('keys');
    expect(featureOfFile('app/(sign-in)/login/PasswordForm.tsx')).toBe('sign-in');
    expect(featureOfFile('app/reports/_parts/Chart.tsx')).toBe('reports');
    expect(featureOfFile('lib/theme.tsx')).toBeUndefined();
  });
});

describe('base or product', () => {
  const entry = (name: string, source: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
    id: `${source}#${name}`, name, source, folder: source.split('/').slice(-2, -1)[0], library: false, importAs: 'named', uses: 1, props: [], ...extra,
  });

  it('libraries, the kit and shared folders are base; a feature folder is product', () => {
    const all = [
      entry('Button', '@mui/material', { library: true }),
      entry('Dialog', 'components/ui/dialog.tsx', { renders: 'div' }),
      entry('Gauge', 'components/comum/gauge/Gauge.tsx'),
      entry('KeyDialog', 'components/keys/KeyDialog.tsx', { renders: 'FormDialog' }),
      entry('FormDialog', 'components/screen/FormDialog.tsx', { renders: 'Dialog' }),
      entry('ProviderCard', 'components/providers/ProviderCard.tsx'),
      entry('AreaRow', 'components/areas/AreaRow.tsx'),
    ];
    const used = new Map([
      ['components/screen/FormDialog.tsx#FormDialog', ['components/keys/KeyDialog.tsx', 'components/areas/AreaDialog.tsx']],
      ['components/keys/KeyDialog.tsx#KeyDialog', ['components/keys/KeysScreen.tsx', 'components/providers/ProviderScreen.tsx']],
    ]);
    const c = classify(all, used);
    expect(c.get('@mui/material#Button')).toEqual({ layer: 'base', kind: 'actions' });
    expect(c.get('components/ui/dialog.tsx#Dialog')?.layer).toBe('base');
    expect(c.get('components/comum/gauge/Gauge.tsx#Gauge')).toEqual({ layer: 'base', kind: 'charts' });
    // Named for none of the features and used by two: a shared pattern
    expect(c.get('components/screen/FormDialog.tsx#FormDialog')?.layer).toBe('base');
    // Used by two features but named for one (Key…): still that feature's
    expect(c.get('components/keys/KeyDialog.tsx#KeyDialog')).toEqual({ layer: 'product', kind: 'overlays', feature: 'keys' });
  });

  it('with no word in the name, what it renders decides', () => {
    const all = [
      entry('Wobble', 'components/keys/Wobble.tsx', { renders: 'FormDialog' }),
      entry('FormDialog', 'components/screen/FormDialog.tsx', { renders: 'Dialog' }),
      entry('Plain', 'components/keys/Plain.tsx', { renders: 'table' }),
      entry('Nothing', 'components/keys/Nothing.tsx', { renders: 'div' }),
    ];
    const c = classify(all, new Map());
    expect(c.get('components/keys/Wobble.tsx#Wobble')?.kind).toBe('overlays');
    expect(c.get('components/keys/Plain.tsx#Plain')?.kind).toBe('data');
    expect(c.get('components/keys/Nothing.tsx#Nothing')?.kind).toBe('other');
  });
});
