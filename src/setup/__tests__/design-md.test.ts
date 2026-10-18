import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFrontMatter, designMdTokens, readDesignMd } from '../design-md.js';
import { detectTokens } from '../token-detect.js';

const DOC = `---
version: alpha
name: Harbor Notes
omitted:
  - spacing
colors:
  primary: "#2B3A4A"
  accent: "#D9822B"   # brand orange
  surface: oklch(0.98 0.01 80)
  link: "{colors.accent}"
typography:
  body-md:
    fontFamily: Inter
    fontSize: 16px
    lineHeight: 1.5
rounded:
  md: 6px
spacing:
  base: 8px
  ratio: 1.5
components:
  button-primary:
    backgroundColor: "{colors.accent}"
---

# Harbor Notes

## Colors
Accent is for actions only.
`;

describe('DESIGN.md', () => {
  it('reads the front matter Ilse needs, lists aside', () => {
    const front = parseFrontMatter(DOC)!;
    expect(front.name).toBe('Harbor Notes');
    expect(front.colors).toMatchObject({ primary: '#2B3A4A', accent: '#D9822B', surface: 'oklch(0.98 0.01 80)' });
    expect(front.components).toMatchObject({ 'button-primary': { backgroundColor: '{colors.accent}' } });
  });

  it('turns it into tokens, references followed, unitless values left out', () => {
    const tokens = designMdTokens(parseFrontMatter(DOC)!);
    expect(tokens).toEqual(expect.arrayContaining([
      { name: 'color.primary', value: '#2B3A4A', type: 'color' },
      { name: 'color.link', value: '#D9822B', type: 'color' },
      { name: 'spacing.base', value: '8px', type: 'spacing' },
      { name: 'rounded.md', value: '6px', type: 'spacing' },
      { name: 'typography.body-md', value: '16px', type: 'typography' },
    ]));
    expect(tokens.find(t => t.name === 'spacing.ratio')).toBeUndefined();
  });

  it('no front matter: found, no tokens', () => {
    expect(parseFrontMatter('# Just prose')).toBeNull();
    const dir = mkdtempSync(join(tmpdir(), 'ilse-dm-'));
    writeFileSync(join(dir, 'DESIGN.md'), '# Just prose\n');
    expect(readDesignMd(dir)).toEqual({ path: 'DESIGN.md', tokens: [] });
  });

  it('adds to the code tokens without overriding them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ilse-dm-'));
    writeFileSync(join(dir, 'DESIGN.md'), DOC);
    writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ color: { primary: { $value: '#000000', $type: 'color' } } }));
    const r = detectTokens(dir);
    expect(r.source).toBe('tokens.json (W3C) + DESIGN.md');
    expect(r.tokens.filter(t => t.name.endsWith('primary'))).toEqual([{ name: 'color.primary', value: '#000000', type: 'color' }]);
    expect(r.tokens.some(t => t.name === 'color.accent')).toBe(true);
  });
});
