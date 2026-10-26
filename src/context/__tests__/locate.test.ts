import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { locateSource, parseSelector, clearLocateCache } from '../locate.js';

const cwd = join(__dirname, '../../../test/fixtures/sample-project');

describe('parseSelector', () => {
  it('unescapes Tailwind arbitrary classes and drops nth-child', () => {
    expect(parseSelector('button.bg-\\[\\#6366f1\\].text-white:nth-child(2)')).toEqual({
      tag: 'button',
      classes: ['bg-[#6366f1]', 'text-white'],
    });
  });

  it('reads ids', () => {
    expect(parseSelector('#hero')).toEqual({ id: 'hero', classes: [] });
  });
});

describe('locateSource', () => {
  beforeEach(() => clearLocateCache());

  it('finds a host element by classes + text, inside its owner component', () => {
    const hits = locateSource({
      element: 'button.bg-\\[\\#6366f1\\].text-white.px-4',
      component: 'Card',
      componentStack: ['Card', 'ProductPage'],
      text: 'Buy',
    }, { cwd });

    expect(hits[0]).toMatchObject({
      file: 'src/components/Card.tsx',
      line: 14,
      owner: 'Card',
      kind: 'element',
    });
    expect(hits[0].snippet).toContain('Buy');
    expect(hits[0].reasons.join(' ')).toContain('text');
  });

  it('matches classes built in template literals', () => {
    const hits = locateSource({ element: 'button.px-4.py-2.rounded-md', component: 'Button' }, { cwd });
    expect(hits[0]).toMatchObject({ file: 'src/components/Button.tsx', owner: 'Button' });
  });

  it('prefers the element whose classes all match', () => {
    const hits = locateSource({ element: 'div.border.rounded-lg.overflow-hidden' }, { cwd });
    expect(hits[0]).toMatchObject({ file: 'src/components/ProductList.tsx', line: 12 });
  });

  it('returns nothing rather than guessing when there is no signal', () => {
    expect(locateSource({ element: 'div' }, { cwd })).toEqual([]);
  });

  it('caps the snippet and says where the element ends', () => {
    const hits = locateSource({ element: 'div.grid.grid-cols-3.gap-6' }, { cwd, maxSnippetLines: 3 });
    expect(hits[0].snippet.split('\n')).toHaveLength(4);
    expect(hits[0].snippet).toContain('more lines');
  });
});

import { componentCard } from '../locate.js';
import { formatComponentCard } from '../../bridge/augment.js';

describe('componentCard', () => {
  it('finds where a component lives, whether it forwards className, and its usages', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-card-'));
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src/Card.tsx'), `import { cn } from './cn';
export function Card({ className, children }) {
  return <div className={cn('rounded-lg border p-4', className)}>{children}</div>;
}
export function Plain() { return <span className="x">y</span>; }
`);
    writeFileSync(join(cwd, 'src/page.tsx'), `export default function Page() {
  return <main><Card>a</Card><Card className="mt-2">b</Card><Plain /></main>;
}
`);
    const card = componentCard('Card', { cwd })!;
    expect(card.def).toEqual({ file: 'src/Card.tsx', line: 2 });
    expect(card.acceptsClassName).toBe(true);
    expect(card.usages).toHaveLength(2);
    expect(componentCard('Plain', { cwd })!.acceptsClassName).toBe(false);
    expect(formatComponentCard(card)).toContain('used 2×');
    expect(formatComponentCard(componentCard('Plain', { cwd })!)).toBeUndefined(); // used once: no card
  });
});

import { frameFile } from '../locate.js';
import { firstAppFrame } from '../../react/annotator.js';

describe('React stack as a second signal', () => {
  const STACK = [
    'Error: react-stack-top-frame',
    '    at exports.jsxDEV (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/compiled/react/cjs/react-jsx-dev-runtime.development.js:321:13)',
    '    at Metric (webpack-internal:///(app-pages-browser)/./src/Metric.tsx:160:96)',
    '    at Object.react_stack_bottom_frame (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:23584:20)',
  ].join('\n');

  it('reads the first app frame and maps bundler URLs to project files', () => {
    expect(firstAppFrame(STACK)).toEqual({ fn: 'Metric', url: 'webpack-internal:///(app-pages-browser)/./src/Metric.tsx' });
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-frame-'));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src/Metric.tsx'), 'x');
    expect(frameFile('webpack-internal:///(app-pages-browser)/./src/Metric.tsx', cwd)).toBe('src/Metric.tsx');
    expect(frameFile('http://localhost:5173/src/Metric.tsx?t=1', cwd)).toBe('src/Metric.tsx');
    expect(frameFile('http://localhost:3000/_next/static/chunks/abc.js', cwd)).toBeNull();
    expect(frameFile('webpack-internal:///./src/Missing.tsx', cwd)).toBeNull();
  });

  it('pins the right JSX when classes are shared and the text comes from a prop', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-frame-'));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src/Metric.tsx'), `export function Metric({ label }) {
  return <div><span className="text-muted-foreground text-xs">{label}</span></div>;
}
`);
    writeFileSync(join(cwd, 'src/Other.tsx'), `export function Other() {
  return <p><span className="text-muted-foreground text-xs">{x}</span></p>;
}
`);
    writeFileSync(join(cwd, 'src/Page.tsx'), `export function Page() {
  return <main><Metric label="Custo" /><Other /></main>;
}
`);
    clearLocateCache();
    const q = { element: 'span.text-muted-foreground.text-xs' };
    const frames = {
      element: { fn: 'Metric', url: 'webpack-internal:///(app-pages-browser)/./src/Metric.tsx' },
      owner: { fn: 'Page', url: 'webpack-internal:///(app-pages-browser)/./src/Page.tsx' },
    };
    const withStack = locateSource({ ...q, frames }, { cwd });
    expect(withStack[0]).toMatchObject({ file: 'src/Metric.tsx', kind: 'element', owner: 'Metric' });
    expect(withStack.find(h => h.kind === 'usage')).toMatchObject({ file: 'src/Page.tsx' });
  });
});

describe('firstAppFrame — callbacks', () => {
  it('skips a .map() callback and takes the component in the same file', () => {
    const stack = [
      'Error: react-stack-top-frame',
      '    at exports.jsxDEV (webpack-internal:///./node_modules/react/jsx-dev-runtime.js:1:1)',
      '    at eval (webpack-internal:///./src/List.tsx:20:5)',
      '    at Array.map (<anonymous>)',
      '    at List (webpack-internal:///./src/List.tsx:18:3)',
    ].join('\n');
    expect(firstAppFrame(stack)).toEqual({ fn: 'List', url: 'webpack-internal:///./src/List.tsx' });
  });
});

describe('look-alikes on other screens (no React frames: a copy Ilse put on the page)', () => {
  beforeEach(() => clearLocateCache());

  const project = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ilse-lookalike-'));
    mkdirSync(join(dir, 'components/areas'), { recursive: true });
    mkdirSync(join(dir, 'components/comum'), { recursive: true });
    // Same classes, two screens: alphabetically, areas/ comes first
    writeFileSync(join(dir, 'components/areas/TenantPanel.tsx'),
      'export function TenantPanel() {\n  return <section className="bg-card border border-border flex">x</section>\n}\n');
    writeFileSync(join(dir, 'components/comum/BarCard.tsx'),
      'export function BarCard() {\n  return <section className="bg-card border border-border relative">y</section>\n}\n');
    return dir;
  };
  const element = 'section.bg-card.border.border-border:nth-child(2)';

  it('marks a tie between files as ambiguous instead of picking the first file', () => {
    const hits = locateSource({ element }, { cwd: project() });
    expect(hits[0].ambiguous).toBe(true);
  });

  it('drops look-alikes written in components that are not on this page', () => {
    const hits = locateSource({ element, pageComponents: ['AuditPage', 'BarCard'] }, { cwd: project() });
    expect(hits.map(h => h.owner)).toEqual(['BarCard']);
    expect(hits[0].ambiguous).toBeUndefined();
  });

  it('trusts React frames over the page list', () => {
    const cwd = project();
    const hits = locateSource({
      element, pageComponents: ['AuditPage'],
      frames: { element: { fn: 'TenantPanel', url: 'http://localhost:3000/components/areas/TenantPanel.tsx' } },
    }, { cwd });
    expect(hits[0]).toMatchObject({ owner: 'TenantPanel', kind: 'element' });
  });
});
