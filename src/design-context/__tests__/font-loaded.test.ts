import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fontTokens, SYSTEM_SANS } from '../ds-tokens.js';

const TW = '{"dependencies":{"tailwindcss":"^4.1.0"}}';
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ilse-font-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}
const names = (cwd: string) => fontTokens(cwd).map(t => `${t.name}=${t.value}`);

describe('fonts a page loads outside next/font', () => {
  it('reads a Google Fonts link in index.html', () => {
    const cwd = project({ 'package.json': TW, 'src/index.css': "@import 'tailwindcss';", 'index.html': '<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&amp;family=JetBrains+Mono&display=swap" rel="stylesheet" />' });
    expect(names(cwd)).toEqual(['font.inter=Inter', 'font.jet-brains-mono=JetBrains Mono']);
  });

  it('reads an @fontsource package', () => {
    const cwd = project({ 'package.json': '{"dependencies":{"tailwindcss":"^4.1.0","@fontsource-variable/inter":"^5.0.0"}}', 'src/index.css': "@import 'tailwindcss';" });
    expect(names(cwd)).toEqual(['font.inter=Inter']);
  });
});

describe('a page that loads no font', () => {
  it("says it shows the system's, as Ilse's reading", () => {
    const cwd = project({ 'package.json': TW, 'app/globals.css': "@import 'tailwindcss';\n:root { --brand: #123; }" });
    const sans = fontTokens(cwd).find(t => t.name === 'font.sans');
    expect(sans?.value).toBe(SYSTEM_SANS);
    expect(sans?.description).toMatch(/not declared by the project/);
  });

  it('never says "system" when a font is named some way it does not read', () => {
    expect(fontTokens(project({ 'package.json': TW, 'app/globals.css': 'body { font-family: var(--brand-face); }' }))).toEqual([]);
    expect(fontTokens(project({ 'package.json': '{"dependencies":{"tailwindcss":"^3.4.0"}}', 'tailwind.config.js': "module.exports = { theme: { fontFamily: { sans: ['Inter'] } } }", 'app/globals.css': '@tailwind base;' }))).toEqual([]);
  });
});
