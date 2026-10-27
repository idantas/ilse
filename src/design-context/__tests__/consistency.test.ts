import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkConsistency, mergeAlike, exportedNames, isCatalog } from '../consistency.js';

function project(files: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ilse-cons-'));
  for (const [path, code] of Object.entries(files)) {
    mkdirSync(join(cwd, path, '..'), { recursive: true });
    writeFileSync(join(cwd, path), code);
  }
  return cwd;
}

const btn = (cls: string) => `<button onClick={go} className="${cls}">Save</button>`;

describe('consistency', () => {
  it('kits are the catalog, not repetition', () => {
    expect(isCatalog('packages/ui/src/button.tsx')).toBe(true);
    expect(isCatalog('src/components/ui/button.tsx')).toBe(true);
    expect(isCatalog('src/app/page.tsx')).toBe(false);
    expect(exportedNames('src/components/ui/button.tsx', 'export function Button() {}')).toEqual(['Button']);
    expect(exportedNames('src/components/ui/icon-button.tsx', 'const X = 1; export default X')).toEqual(['IconButton']);
  });

  it('a button written by hand in the app, when the kit has one, says so; the kit itself is not counted', async () => {
    const cwd = project({
      'src/app/a/page.tsx': `export default function A() { return <div>${btn('px-3 py-1 rounded bg-blue-500')}${btn('px-3 py-1 rounded bg-blue-600')}</div> }`,
      'src/app/b/page.tsx': `export default function B() { return <div>${btn('px-3 py-1 rounded bg-blue-500')}</div> }`,
      'src/components/ui/button.tsx': `export function Button() { return <div>${btn('px-3 rounded bg-x')}${btn('px-3 rounded bg-x')}${btn('px-3 rounded bg-x')}</div> }`,
    });
    const items = await checkConsistency(cwd);
    const repeated = items.find(i => i.kind === 'repeated')!;
    expect(repeated.title.en).toBe('3 places rebuild a button by hand; the project already has Button');
    expect(repeated.existing).toBe('Button (src/components/ui/button.tsx)');
    expect(repeated.severity).toBe('medium');
    expect(repeated.files.every(f => f.file.startsWith('src/app/'))).toBe(true);
    // Whole class lists: test mode looks for them on the pages
    expect(repeated.variants).toContain('px-3 py-1 rounded bg-blue-500');
  });

  it('twice is not a finding; layout wrappers, captions and demos are not components', async () => {
    const link = (n: string) => `export const ${n} = () => <div className="flex gap-2"><a href="/x" className="text-sm rounded hover:underline">x</a><span className="text-xs text-muted-foreground font-mono">id</span></div>`;
    const two = project({ 'src/a.tsx': link('A'), 'src/b.tsx': link('B') });
    expect(await checkConsistency(two)).toEqual([]);
    const three = project({ 'src/a.tsx': link('A'), 'src/b.tsx': link('B'), 'src/c.tsx': link('C'), 'src/demo/d.tsx': link('D'), 'src/demo/e.tsx': link('E') });
    // The link counts (3, not 5: demo/ is left out); the caption span repeated with it does not
    expect((await checkConsistency(three)).map(i => i.title.en)).toEqual(['Same link written 3× in 3 files']);
  });

  it('the same block with different insides is one finding', () => {
    const p = (sig: string, n: number, file: string) => ({ signature: sig, occurrences: n, files: [{ file, line: 1 }], variants: ['border-destructive/40 bg-destructive/5 p-4'] }) as never;
    const merged = mergeAlike([p('div|a,button|x', 6, 'a.tsx'), p('div|a|x', 3, 'b.tsx')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ occurrences: 9 });
  });
});

describe('rawTokenValues — the DS\'s drift check', () => {
  it('a DS color written by hand, in any case or short form, with where it is', async () => {
    const { rawTokenValues } = await import('../consistency.js');
    const app = [
      { path: 'app/a.tsx', code: 'import x from "y"\n<div className="bg-[#FF6C03] text-[#fff]" />\n<p style={{ color: "#ff6c03" }} />' },
      { path: 'app/b.tsx', code: '// #ff6c03 in a comment\n<span className="border-[#ff6c03aa]" />' },
    ];
    const tokens = [
      { name: 'color.brand', value: '#ff6c03', type: 'color' },
      { name: 'color.panel', value: '#ffffff', type: 'color' },
      { name: 'spacing.cell', value: '72px', type: 'spacing' },
    ];
    const items = rawTokenValues(app, tokens);
    expect(items.map(i => [i.title.en, i.files])).toEqual([
      ['#ff6c03 written by hand in 2 places; the design system has the token brand', [{ file: 'app/a.tsx', line: 2 }, { file: 'app/a.tsx', line: 3 }]],
      ['#ffffff written by hand in 1 place; the design system has the token panel', [{ file: 'app/a.tsx', line: 2 }]],
    ]);
    expect(rawTokenValues(app, [])).toEqual([]);
  });
});
