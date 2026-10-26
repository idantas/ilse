import { describe, it, expect } from 'vitest';
import { chunkPosition, projectPath, sourceAt, sourceInMap } from '../chunk-source.js';

describe('chunk frames → project files', () => {
  it('reads the position the toolbar kept, loopback chunks only', () => {
    expect(chunkPosition('http://localhost:3000/_next/static/chunks/_0c7l._.js#L8188:422')).toEqual({ chunk: 'http://localhost:3000/_next/static/chunks/_0c7l._.js', line: 8187, column: 421 });
    expect(chunkPosition('http://localhost:5173/src/App.tsx')).toBeNull();
    expect(chunkPosition('http://evil.com/_next/static/chunks/a.js#L1:1')).toBeNull();
  });

  it('finds the source at a column, across segments and lines', () => {
    // line 0: col 0 → a.tsx, col 5 → b.tsx; line 1: col 0 → b.tsx (source index carries over)
    const map = { sources: ['a.tsx', 'b.tsx'], mappings: 'AAAA,KCAA;AAAA' };
    expect(sourceAt(map, 0, 2)).toBe('a.tsx');
    expect(sourceAt(map, 0, 7)).toBe('b.tsx');
    expect(sourceAt(map, 1, 0)).toBe('b.tsx');
  });

  it("picks the section of Turbopack's index map, one module each", () => {
    const map = { sections: [
      { offset: { line: 5, column: 0 }, map: { sources: ['file:///p/app/theme.ts'], mappings: 'AAAA' } },
      { offset: { line: 40, column: 0 }, map: { sources: ['file:///p/components/keys/KeyDialog.tsx'], mappings: 'AAAA' } },
    ] };
    expect(sourceInMap(map, 39, 3)).toBe('file:///p/app/theme.ts');
    expect(sourceInMap(map, 52, 3)).toBe('file:///p/components/keys/KeyDialog.tsx');
    expect(sourceInMap(map, 2, 0)).toBeNull();
  });

  it('keeps project files, never packages or outside', () => {
    expect(projectPath('file:///p/components/keys/KeyDialog.tsx', '/p')).toBe('components/keys/KeyDialog.tsx');
    expect(projectPath('turbopack:///[project]/app/page.tsx', '/p')).toBe('app/page.tsx');
    expect(projectPath('file:///p/node_modules/next/x.js', '/p')).toBeNull();
    expect(projectPath('file:///other/x.tsx', '/p')).toBeNull();
  });
});
