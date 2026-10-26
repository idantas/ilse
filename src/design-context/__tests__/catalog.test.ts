import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalog, folderOf, packageRoot, relativeImport, resolveImport } from '../catalog.js';
import { namesFor, searchCatalog } from '../catalog-search.js';

function project(files: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ilse-cat-'));
  for (const [path, code] of Object.entries(files)) {
    mkdirSync(join(cwd, path, '..'), { recursive: true });
    writeFileSync(join(cwd, path), code);
  }
  return cwd;
}

const BUTTON = `
import { cva, type VariantProps } from 'class-variance-authority';
const buttonVariants = cva('inline-flex', {
  variants: {
    variant: { default: 'bg-primary', outline: 'border', ghost: '' },
    size: { sm: 'h-8', lg: 'h-10' },
  },
  defaultVariants: { variant: 'default' },
});
export function Button({ className, variant, size, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  return <button className={buttonVariants({ variant, size, className })} {...props} />;
}`;

const STAT = `
interface StatProps { label: string; value: string; tone?: 'good' | 'bad'; compact?: boolean }
export function StatCard({ label, value, tone = 'good' }: StatProps) {
  return <div className="p-4"><span>{label}</span><b>{value}</b></div>;
}`;

const APP = `
import { Button as MuiButton, Typography } from '@mui/material';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatCard } from '../components/stat-card';
export function Screen() {
  return (
    <div>
      <Typography variant="h4">Hi</Typography>
      <Typography variant="body2">There</Typography>
      <MuiButton variant="contained">Go</MuiButton>
      <Button variant="outline">Save</Button>
      <Button variant="outline">Save</Button>
      <StatCard label="A" value="1" tone="bad" />
      <Save />
    </div>
  );
}`;

describe('catalog', () => {
  const cwd = project({
    'src/components/ui/button.tsx': BUTTON,
    'src/components/ui/unused-card.tsx': 'export function Card() { return <div className="rounded" /> }',
    'src/components/stat-card.tsx': STAT,
    'src/screens/screen.tsx': APP,
    'src/main.tsx': `import { Screen } from './screens/screen'; export function App() { return <Screen /> }`,
  });
  const list = buildCatalog(cwd);
  const by = (id: string) => list.find(e => e.id === id);

  it('lists the project components, the kit even unused, and the library pieces the code imports', () => {
    expect(list.map(e => e.id).sort()).toEqual([
      '@mui/material#Button',
      '@mui/material#Typography',
      'src/components/stat-card.tsx#StatCard',
      'src/components/ui/button.tsx#Button',
      'src/components/ui/unused-card.tsx#Card',
      'src/screens/screen.tsx#Screen',
    ]);
    // Icons and the app root are not pieces
    expect(list.some(e => e.name === 'Save' || e.name === 'App')).toBe(false);
  });

  it('reads cva variants, typed unions, and what the code passes', () => {
    const button = by('src/components/ui/button.tsx#Button')!;
    expect(button.uses).toBe(2);
    expect(button.folder).toBe('ui');
    expect(button.props.find(p => p.name === 'variant')).toMatchObject({ kind: 'enum', values: ['default', 'outline', 'ghost'] });
    expect(button.props.find(p => p.name === 'size')?.values).toEqual(['sm', 'lg']);
    // What it is when left out: cva's defaultVariants; nothing said, nothing shown
    expect(button.props.find(p => p.name === 'variant')?.default).toBe('default');
    expect(button.props.find(p => p.name === 'size')?.default).toBeUndefined();
    expect(button.renders).toBe('button');
    expect(button.example?.code).toBe('<Button variant="outline">Save</Button>');

    const stat = by('src/components/stat-card.tsx#StatCard')!;
    expect(stat.props.find(p => p.name === 'tone')).toMatchObject({ kind: 'enum', values: ['good', 'bad'], required: false });
    expect(stat.props.find(p => p.name === 'label')).toMatchObject({ required: true, kind: 'text' });
    expect(stat.props.find(p => p.name === 'compact')).toMatchObject({ kind: 'boolean', default: 'false' });
    expect(stat.props.find(p => p.name === 'tone')?.default).toBe('good');

    const typo = by('@mui/material#Typography')!;
    expect(typo).toMatchObject({ library: true, folder: '@mui/material', uses: 2, module: '@mui/material' });
    expect(typo.props.find(p => p.name === 'variant')).toMatchObject({ kind: 'enum', values: ['h4', 'body2'] });
    // Imported under another local name, still the library's Button
    expect(by('@mui/material#Button')?.uses).toBe(1);
  });

  it('paths and folders', () => {
    expect(packageRoot('@mui/material/Button')).toBe('@mui/material');
    expect(packageRoot('antd')).toBe('antd');
    expect(folderOf('src/components/ui/button.tsx')).toBe('ui');
    expect(folderOf('src/components/stat-card.tsx')).toBe('components');
    expect(folderOf('packages/design/src/x.tsx')).toBe('design');
    expect(resolveImport(cwd, 'src/screens/screen.tsx', '../components/stat-card')).toBe('src/components/stat-card.tsx');
    expect(resolveImport(cwd, 'src/screens/screen.tsx', '@/components/ui/button')).toBe('src/components/ui/button.tsx');
    expect(resolveImport(cwd, 'src/screens/screen.tsx', '@mui/material')).toBeNull();
    expect(relativeImport('src/screens/screen.tsx', 'src/components/stat-card.tsx')).toBe('../components/stat-card');
  });
});

describe('catalog search', () => {
  const list = [
    { name: 'Button', folder: 'ui' }, { name: 'IconButton', folder: '@mui/material' }, { name: 'Dialog', folder: 'ui' },
    { name: 'SaveAction', folder: 'forms', renders: 'button' }, { name: 'TextField', folder: '@mui/material' }, { name: 'Card', folder: 'ui' },
  ];
  const names = (q: string) => searchCatalog(list, q).map(e => e.name);

  it('by name first', () => {
    // "but" is also the start of "button": what renders a button follows the names
    expect(names('but')).toEqual(['Button', 'IconButton', 'SaveAction']);
    expect(names('card')).toEqual(['Card']);
  });

  it('by what it is for, in Portuguese or English, accents or not', () => {
    expect(names('botão')).toEqual(['Button', 'IconButton', 'SaveAction']);
    expect(names('botao')).toEqual(['Button', 'IconButton', 'SaveAction']);
    expect(names('modal')).toEqual(['Dialog']);
    expect(names('campo')).toEqual(['TextField']);
    expect(namesFor('x').size).toBe(0);
  });

  it('by folder last, nothing when nothing matches', () => {
    expect(names('forms')).toEqual(['SaveAction']);
    expect(names('zzz')).toEqual([]);
  });
});
