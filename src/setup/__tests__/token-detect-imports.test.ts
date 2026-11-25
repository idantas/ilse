import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectTokens } from '../token-detect.js';

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ilse-tokens-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

describe('theme CSS split across files', () => {
  it('reads the colours a local @import brings in, and leaves packages out', () => {
    const cwd = project({
      'app/globals.css': `@import 'tailwindcss';\n@import '../styles/theme.css';\n@theme { --spacing-18: 72px; }`,
      'styles/theme.css': `@theme inline { --color-surface-1: var(--surface-1); }\n:root { --surface-1: #FAFAFA; }\n.dark { --surface-1: #171717; }`,
    });
    const tokens = detectTokens(cwd).tokens;
    expect(tokens).toContainEqual({ name: 'color.surface-1', value: '#FAFAFA', type: 'color' });
    expect(tokens).toContainEqual({ name: 'spacing.spacing-18', value: '72px', type: 'spacing' });
  });

  it('survives a file that imports itself', () => {
    const cwd = project({ 'app/globals.css': `@import './globals.css';\n:root { --brand: #123456; }` });
    expect(detectTokens(cwd).tokens).toContainEqual({ name: 'color.brand', value: '#123456', type: 'color' });
  });

  it("reads Tailwind v4's --text-* as font sizes, not spacing", () => {
    const cwd = project({ 'app/globals.css': `@theme { --text-2xs: 0.625rem; --text-2xs--line-height: 0.875rem; }` });
    const tokens = detectTokens(cwd).tokens;
    expect(tokens).toEqual([{ name: 'typography.2xs', value: '0.625rem', type: 'typography' }]);
  });
});
