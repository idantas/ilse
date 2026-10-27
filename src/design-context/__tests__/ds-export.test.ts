import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dsTokens, dsInput, buildDesignMd, writeDs, hasDs, dedent, dsView, componentImports, createDs, readDsState, dsChanges, addDsRule, addDsInstructions, dsInstructionsIn, DS_MARKER } from '../ds-export.js';
import type { DsInput } from '../../pro/types.js';
import { parseFrontMatter, designMdTokens } from '../../setup/design-md.js';
import type { CatalogEntry } from '../catalog.js';

const entry = (name: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: `src/${name}.tsx#${name}`, name, source: `src/components/${name}.tsx`, folder: 'components',
  library: false, importAs: 'named', uses: 3, props: [], ...extra,
});
const catalog: CatalogEntry[] = [
  entry('Button', { layer: 'base', kind: 'actions', renders: 'button', uses: 12,
    props: [{ name: 'variant', required: false, kind: 'enum', values: ['primary', 'ghost'], default: 'primary' }],
    example: { file: 'src/App.tsx', line: 3, code: '<Button variant="ghost">Cancel</Button>' } }),
  entry('OrderCard', { layer: 'product', feature: 'orders' }),
  entry('Dialog', { library: true, source: '@radix-ui/react-dialog' }),
];
const tokens = [
  { name: 'color.brand', value: '#ff6c03', type: 'color' as const },
  { name: 'spacing.cell', value: '72px', type: 'spacing' as const },
];

describe('dsInput — what Pro gets to write its formats', () => {
  it('the project components, Base first, each with its contract', () => {
    const input = dsInput('/p', '/p/.ilse/ds', 'acme', catalog, tokens);
    expect(input.components.map(c => [c.name, c.layer])).toEqual([['Button', 'base'], ['OrderCard', 'product']]);
    expect(input.components[0].contract).toMatchObject({
      source: 'src/components/Button.tsx', uses: 12, renders: 'button',
      props: [{ name: 'variant', values: ['primary', 'ghost'], default: 'primary' }],
      example: '<Button variant="ghost">Cancel</Button>',
    });
  });
});

describe('buildDesignMd — readable, and readable back by Ilse', () => {
  const md = buildDesignMd('acme', catalog, tokens);
  it('its front matter gives the same tokens back', () => {
    const front = parseFrontMatter(md)!;
    expect(designMdTokens(front).map(t => [t.name, t.value])).toEqual([['color.brand', '#ff6c03'], ['spacing.cell', '72px']]);
  });
  it('lists Base and Product with props and examples', () => {
    expect(md).toContain('## Base');
    expect(md).toContain('### Button');
    expect(md).toContain('`variant`?: `primary` | `ghost` (default `primary`)');
    expect(md).toContain('## Product');
    expect(md).not.toContain('Dialog');
  });
});

describe('writeDs', () => {
  const project = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-ds-'));
    writeFileSync(join(cwd, 'package.json'), '{"name":"acme-web"}');
    return cwd;
  };
  it('Free: DESIGN.md only, no machine formats promised in it', () => {
    const cwd = project();
    expect(hasDs(cwd)).toBe(false);
    const out = writeDs(cwd, catalog, tokens);
    expect(out).toMatchObject({ components: 2, tokens: 2, files: [join('.ilse', 'ds', 'DESIGN.md')] });
    const md = readFileSync(join(cwd, '.ilse/ds/DESIGN.md'), 'utf8');
    expect(md).toContain('# acme-web — design system');
    expect(md).not.toContain('Machine-readable');
    expect(existsSync(join(cwd, '.ilse/ds/tokens.json'))).toBe(false);
    expect(hasDs(cwd)).toBe(true);
  });
  it('Pro: its formats are written beside DESIGN.md, which points at them', () => {
    const cwd = project();
    let got: DsInput | undefined;
    const out = writeDs(cwd, catalog, tokens, (input) => {
      got = input;
      writeFileSync(join(input.dir, 'tokens.json'), '{}');
      return ['tokens.json'];
    });
    expect(got?.name).toBe('acme-web');
    expect(out.files).toEqual([join('.ilse', 'ds', 'DESIGN.md'), join('.ilse', 'ds', 'tokens.json')]);
    expect(readFileSync(join(cwd, '.ilse/ds/DESIGN.md'), 'utf8')).toContain('Machine-readable, next to this file: `tokens.json`.');
  });
  it('Pro failing still leaves the free file', () => {
    const cwd = project();
    const out = writeDs(cwd, catalog, tokens, () => { throw new Error('broken pro'); });
    expect(out.files).toEqual([join('.ilse', 'ds', 'DESIGN.md')]);
  });
});

describe('dedent — an example cut out of its file', () => {
  it('lines after the first lose the file indentation, keep their nesting', () => {
    expect(dedent('<Frame page="orders">\n      <Orders />\n    </Frame>')).toBe('<Frame page="orders">\n  <Orders />\n</Frame>');
    expect(dedent('<Button />')).toBe('<Button />');
  });
});

describe('dsTokens — only what the DS can state', () => {
  it('keeps single colors, drops a shadow that token-detect filed as color', () => {
    const kept = dsTokens([
      { name: 'color.a', value: '#fff', type: 'color' },
      { name: 'color.b', value: 'oklch(0.7 0.1 250 / 0.5)', type: 'color' },
      { name: 'color.c', value: 'rgba(170, 59, 255, 0.1)', type: 'color' },
      { name: 'color.d', value: 'transparent', type: 'color' },
      { name: 'color.e', value: 'color-mix(in oklch, var(--a), white)', type: 'color' },
      { name: 'color.shadow', value: 'rgba(0, 0, 0, 0.1) 0 10px 15px -3px', type: 'color' },
      { name: 'spacing.x', value: '8px', type: 'spacing' },
    ] as Parameters<typeof dsTokens>[0]);
    expect(kept.map(t => t.name)).toEqual(['color.a', 'color.b', 'color.c', 'color.d', 'spacing.x']);
  });
});

describe('dsView — what the DS window shows', () => {
  it('the files as written, and the reading behind them', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-ds-'));
    writeFileSync(join(cwd, 'package.json'), '{"name":"acme-web"}');
    expect(dsView(cwd, catalog, tokens, false).files).toEqual([]);
    writeDs(cwd, catalog, [...tokens, { name: 'color.shadow', value: 'rgba(0,0,0,.1) 0 4px 8px', type: 'color' }]);
    const view = dsView(cwd, catalog, [...tokens, { name: 'color.shadow', value: 'rgba(0,0,0,.1) 0 4px 8px', type: 'color' }], false);
    expect(view.files.map(f => f.name)).toEqual(['DESIGN.md']);
    expect(view.files[0].content).toContain('# acme-web — design system');
    // Same tokens and components as the file: the shadow stays out, libraries aren't the DS
    expect(view.tokens.map(t => t.name)).toEqual(['color.brand', 'spacing.cell']);
    expect(view.components.map(c => c.name)).toEqual(['Button', 'OrderCard']);
    expect(view.components[0].props).toEqual([{ name: 'variant', values: ['primary', 'ghost'] }]);
    expect(view.components[1]).toMatchObject({ layer: 'product', feature: 'orders' });
  });
});

describe('the DS in AGENTS.md — on the person\'s click', () => {
  it('adds one block to AGENTS.md, never twice, and the view says so', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-ds-'));
    writeFileSync(join(cwd, 'AGENTS.md'), '# Rules\n');
    expect(dsInstructionsIn(cwd)).toBeNull();
    expect(dsView(cwd, catalog, tokens, false).agents).toEqual({ linked: null, target: 'AGENTS.md' });
    expect(addDsInstructions(cwd)).toBe('AGENTS.md');
    addDsInstructions(cwd);
    const text = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
    expect(text.startsWith('# Rules\n')).toBe(true);
    expect(text.split(DS_MARKER)).toHaveLength(2);
    expect(dsView(cwd, catalog, tokens, false).agents.linked).toBe('AGENTS.md');
  });
  it('a path written by hand counts; no file yet: CLAUDE.md is created', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-ds-'));
    writeFileSync(join(cwd, 'CLAUDE.md'), 'Read .ilse/ds/DESIGN.md first.\n');
    expect(dsInstructionsIn(cwd)).toBe('CLAUDE.md');
    const empty = mkdtempSync(join(tmpdir(), 'ilse-ds-'));
    expect(addDsInstructions(empty)).toBe('CLAUDE.md');
    expect(readFileSync(join(empty, 'CLAUDE.md'), 'utf8')).toContain('.ilse/ds/DESIGN.md');
  });
});

describe('componentImports — what an installable registry item needs', () => {
  it('npm packages by package name, the project\'s components by name; the framework and types stay out', () => {
    const code = `import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react/dist/esm/icons'
import type { Order } from '@/types/order'
import { Button, buttonVariants } from '@/components/ui/button'
import Card from './Card'
import { readFileSync } from 'node:fs'
import Link from 'next/link'
`;
    expect(componentImports(code, new Set(['Button', 'Card', 'Order']))).toEqual({
      dependencies: ['@radix-ui/react-slot', 'class-variance-authority', 'lucide-react'],
      requires: ['Button', 'Card'],
    });
  });
});

describe('createDs — Pro\'s "when to use", asked only for what changed', () => {
  const project = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-ds-'));
    writeFileSync(join(cwd, 'package.json'), '{"name":"acme-web"}');
    return cwd;
  };
  const ask = async () => '';
  it('notes go into DESIGN.md, the contract Pro writes and state.json; unchanged ones aren\'t asked again', async () => {
    const cwd = project();
    const asked: string[][] = [];
    const notes = async (input: DsInput) => {
      asked.push(input.components.map(c => c.name));
      return Object.fromEntries(input.components.map(c => [c.name, { whenToUse: `${c.name} for X`, avoid: 'not Y' }]));
    };
    let seen: DsInput | null = null;
    const formats = (input: DsInput) => { seen = input; return []; };
    const out = await createDs(cwd, catalog, tokens, { notes, formats, ask });
    expect(out.notes).toBe(2);
    const md = readFileSync(join(cwd, '.ilse/ds/DESIGN.md'), 'utf8');
    expect(md).toContain('When to use: Button for X');
    expect(md).toContain('Not for: not Y');
    expect(seen!.components[0].contract.whenToUse).toBe('Button for X');
    expect(readDsState(cwd)!.components.Button.whenToUse).toBe('Button for X');
    expect(dsView(cwd, catalog, tokens, true).components[0].whenToUse).toBe('Button for X');

    // Button gains a value: only Button is asked again
    const changed = catalog.map(c => c.name === 'Button' ? { ...c, props: [{ ...c.props[0], values: ['primary', 'ghost', 'link'] }] } : c);
    await createDs(cwd, changed, tokens, { notes, formats, ask });
    expect(asked).toEqual([['Button', 'OrderCard'], ['Button']]);
  });
  it('the agent failing still writes the DS; Free keeps notes written earlier', async () => {
    const cwd = project();
    const out = await createDs(cwd, catalog, tokens, { notes: async () => { throw new Error('no agent'); }, ask });
    expect(out.notes).toBe(0);
    expect(hasDs(cwd)).toBe(true);
    await createDs(cwd, catalog, tokens, { notes: async (i) => Object.fromEntries(i.components.map(c => [c.name, { whenToUse: 'w' }])), ask });
    expect((await createDs(cwd, catalog, tokens)).notes).toBe(2);
  });
});

describe('dsChanges — the live DS: what the code changed since it was written', () => {
  it('new, changed (contract, not usage), removed components and changed tokens', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-ds-'));
    expect(dsChanges(cwd, catalog, tokens)).toBeNull();
    writeDs(cwd, catalog, tokens);
    expect(dsChanges(cwd, catalog, tokens)).toEqual({ added: [], removed: [], changed: [], tokens: [] });
    const now = [
      { ...catalog[0], uses: 40 }, // used more: not a change to the DS
      catalog[2],
      entry('Badge', { layer: 'base' }),
    ];
    now[0] = { ...now[0], props: [{ ...catalog[0].props[0], values: ['primary', 'ghost', 'link'] }] };
    expect(dsChanges(cwd, now, [{ ...tokens[0], value: '#000' }])).toEqual({ added: ['Badge'], removed: ['OrderCard'], changed: ['Button'], tokens: ['color.brand', 'spacing.cell'] });
  });
});

describe('addDsRule — a rule from the fresh-agent test, approved by the person', () => {
  it('kept in state.json, written into the rules of DESIGN.md, survives rewrites, no duplicates', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-ds-'));
    expect(addDsRule(cwd, 'x')).toBe(false); // no DS yet
    writeDs(cwd, catalog, tokens);
    expect(addDsRule(cwd, '- Use Button variant="ghost" for secondary actions.')).toBe(true);
    addDsRule(cwd, 'Use Button variant="ghost" for secondary actions.');
    await createDs(cwd, catalog, tokens);
    expect(readDsState(cwd)!.rules).toEqual(['Use Button variant="ghost" for secondary actions.']);
    expect(readFileSync(join(cwd, '.ilse/ds/DESIGN.md'), 'utf8')).toContain('- Use Button variant="ghost" for secondary actions.');
    expect(dsView(cwd, catalog, tokens, true).rules).toEqual(['Use Button variant="ghost" for secondary actions.']);
  });
});
