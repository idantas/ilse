import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findConnectedDs, findPackage, manifestNote, projectDependencies, readManifest, workspaceDirs } from '../ds-source.js';
import { libraryChoices } from '../library-types.js';
import { buildCatalog } from '../catalog.js';
import { detectTokens } from '../../setup/token-detect.js';
import { dsNotesByName, dsPackageInfo, buildDesignMd } from '../ds-export.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function write(root: string, files: Record<string, string | object>) {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  }
}

const MANIFEST = {
  categories: [{ id: 'acoes', label: 'Actions' }, { id: 'exibicao', label: 'Display' }],
  components: [
    {
      name: 'Button', category: 'acoes', purpose: 'The action a person takes.', useWhen: ['Submitting a form'],
      avoidWhen: [{ when: 'It only navigates', use: 'a link' }],
      props: { variant: { values: ['default', 'ghost'], default: 'default', notes: 'ghost on toolbars.' } },
    },
    { name: 'Badge', category: 'exibicao', purpose: 'A short static label.' },
  ],
  withoutMeta: ['accordion'],
};

const DTS = `import { VariantProps } from 'class-variance-authority';
declare const buttonVariants: (props?: ({
    variant?: "default" | "ghost" | "glass" | null | undefined;
    size?: "default" | "sm" | "lg" | null | undefined;
} & ClassProp) | undefined) => string;
declare function Button({ className, variant, size, ...props }: Base.Props & VariantProps<typeof buttonVariants>): JSX.Element;
declare function Card({ size, ...props }: React.ComponentProps<"div"> & { size?: "default" | "sm" }): JSX.Element;
export { Button, Card };
`;

/** A monorepo like the Anticaos one: the DS package hoisted to the root, the app in `web/` */
function monorepo(extra: Record<string, string | object> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ilse-ds-'));
  dirs.push(root);
  write(root, {
    'package.json': { name: 'mono', private: true, workspaces: ['packages/*', 'web'] },
    'packages/catalog/package.json': { name: '@mono/catalog' },
    'web/package.json': { name: 'web', dependencies: { '@acme/ui': '1.0.0', react: '19' } },
    'web/src/app/globals.css': '@import "tailwindcss";\n@import "@acme/ui/theme.css";\n:root { --brand: #ff6600; }\n',
    'web/src/app/page.tsx': `import { Button } from '@acme/ui';\nimport { Panel } from '@/components/panel';\nexport default function Page() { return <Panel><Button variant="ghost">Go</Button></Panel>; }\n`,
    'web/src/components/panel.tsx': `export function Panel({ children }: { children?: React.ReactNode }) { return <div>{children}</div>; }\n`,
    'node_modules/@acme/ui/package.json': {
      name: '@acme/ui', version: '1.2.3', description: 'Acme components', types: './dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs' }, './theme.css': './dist/theme.css', './components.json': './dist/components.json', './tokens.json': './dist/tokens.json' },
    },
    'node_modules/@acme/ui/dist/index.d.ts': DTS,
    'node_modules/@acme/ui/dist/components.json': MANIFEST,
    'node_modules/@acme/ui/dist/tokens.json': { color: { primary: { $type: 'color', $value: '#111111' } } },
    'node_modules/@acme/ui/dist/theme.css': ':root { --primary: oklch(0.2 0 0); --radius: 8px; }\n',
    ...extra,
  });
  return root;
}

describe('connected design system', () => {
  it('finds a hoisted package from the root and from the app, by its manifest', () => {
    const root = monorepo();
    expect(workspaceDirs(root).map(d => d.slice(root.length + 1)).sort()).toEqual(['packages/catalog', 'web']);
    expect(projectDependencies(root)).toContain('@acme/ui');
    expect(findPackage(join(root, 'web'), '@acme/ui')).toBe(join(root, 'node_modules/@acme/ui'));
    for (const cwd of [root, join(root, 'web')]) {
      const ds = findConnectedDs(cwd);
      expect(ds).toMatchObject({ name: '@acme/ui', version: '1.2.3', signal: 'manifest' });
      expect(ds?.manifest?.components.map(c => c.name)).toEqual(['Button', 'Badge']);
      expect(ds?.manifest?.components[0].category).toBe('Actions');
      expect(ds?.typesFile).toBe(join(root, 'node_modules/@acme/ui/dist/index.d.ts'));
    }
  });

  it('counts a package whose theme the CSS imports, and one the person declares', () => {
    const root = monorepo({
      'node_modules/@acme/ui/dist/components.json': '{}',
      'node_modules/@acme/ui/dist/tokens.json': '{}',
    });
    expect(findConnectedDs(root)?.signal).toBe('css');
    write(root, {
      'web/.ilserc.json': { designSystem: '@other/kit' },
      'node_modules/@other/kit/package.json': { name: '@other/kit', version: '0.1.0' },
    });
    expect(findConnectedDs(join(root, 'web'))).toMatchObject({ name: '@other/kit', signal: 'declared' });
  });

  it('no design system: null, and nothing else changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'ilse-ds-'));
    dirs.push(root);
    write(root, { 'package.json': { dependencies: { react: '19' } } });
    expect(findConnectedDs(root)).toBeNull();
    expect(dsPackageInfo(root)).toBeNull();
  });

  it('reads choices from one bundled .d.ts (tsup): cva variants and inline props', () => {
    const root = monorepo();
    const button = libraryChoices(join(root, 'web'), '@acme/ui', 'Button');
    expect(button.get('variant')?.values).toEqual(['default', 'ghost', 'glass']);
    expect(button.get('size')?.values).toEqual(['default', 'sm', 'lg']);
    expect(libraryChoices(root, '@acme/ui', 'Card').get('size')?.values).toEqual(['default', 'sm']);
  });

  it('reads a shadcn registry as a manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'ilse-ds-'));
    dirs.push(root);
    write(root, { 'registry.json': { items: [{ name: 'date-picker', type: 'registry:ui', description: 'Pick a day.' }, { name: 'use-x', type: 'registry:hook' }] } });
    expect(readManifest(join(root, 'registry.json'))?.components).toEqual([{ name: 'DatePicker', purpose: 'Pick a day.' }]);
  });

  it('turns the manifest into the card note', () => {
    expect(manifestNote(readManifest(join(monorepo(), 'node_modules/@acme/ui/dist/components.json'))!.components[0]))
      .toEqual({ whenToUse: 'The action a person takes. Submitting a form.', avoid: 'It only navigates → a link' });
  });
});

describe('the connected DS in the catalog, tokens and DESIGN.md', () => {
  it('lists every DS component, used or not, with the manifest\'s group, values and notes', () => {
    const root = monorepo();
    for (const cwd of [root, join(root, 'web')]) {
      const catalog = buildCatalog(cwd);
      const button = catalog.find(e => e.name === 'Button')!;
      expect(button).toMatchObject({ library: true, ds: '@acme/ui', dsGroup: 'Actions', layer: 'base', uses: 1 });
      const variant = button.props.find(p => p.name === 'variant')!;
      expect(variant.values.slice(0, 2)).toEqual(['default', 'ghost']);
      expect(variant).toMatchObject({ default: 'default', doc: 'ghost on toolbars.' });
      expect(catalog.find(e => e.name === 'Badge')).toMatchObject({ uses: 0, ds: '@acme/ui', dsGroup: 'Display' });
      // `@/components/panel` is web's own src, also from the monorepo's root
      expect(catalog.find(e => e.name === 'Panel')).toMatchObject({ library: false, uses: 1 });
      expect(dsNotesByName(cwd, catalog).Badge).toEqual({ whenToUse: 'A short static label.', fromDs: true });
    }
  });

  it('the person\'s words win over the DS\'s', () => {
    const root = monorepo({ '.ilse/ds/edits.json': { components: { Badge: { whenToUse: 'Only for counts here.' } }, tokens: {} } });
    expect(dsNotesByName(root, buildCatalog(root)).Badge).toEqual({ whenToUse: 'Only for counts here.', edited: true });
  });

  it('follows the DS theme the CSS imports, from the root too', () => {
    const root = monorepo();
    for (const cwd of [root, join(root, 'web')]) {
      const names = detectTokens(cwd).tokens.map(t => t.name);
      expect(names).toEqual(expect.arrayContaining(['color.brand', 'color.primary', 'spacing.radius']));
    }
  });

  it('DESIGN.md names the package and where its documentation is', () => {
    const root = monorepo();
    const info = dsPackageInfo(root)!;
    expect(info).toEqual({ name: '@acme/ui', version: '1.2.3', manifest: 'node_modules/@acme/ui/dist/components.json', components: 3 });
    const md = buildDesignMd('mono', buildCatalog(root), [], [], {}, [], [], info);
    expect(md).toContain('This project uses the `@acme/ui` design system (1.2.3)');
    expect(md).toContain('### Badge');
  });
});
