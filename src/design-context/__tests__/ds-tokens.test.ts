import { describe, it, expect } from 'vitest';
import { cssBlocks, modeOf, nextFonts, scaleSteps, tokenModes } from '../ds-tokens.js';

const css = `
:root { --bg: #fff; --ink: #111; --accent: var(--ink); }
@media (prefers-color-scheme: dark) { :root:not(.dark) { --bg: #fff; } }
.dark { --bg: #000; --accent: var(--bg); }
[data-theme="sepia"] { --bg: #f4ecd8; }
.card { --bg: #eee; }
.dark .card { --bg: #222; }
@theme inline { --color-bg: var(--bg); --font-sans: var(--font-geist-sans); }
`;

describe('DS tokens: themes', () => {
  it('a theme is .dark, [data-theme], .theme-x or a dark :root; a scoped rule is not', () => {
    const modes = cssBlocks(css).map(modeOf);
    expect(modes).toEqual(['base', null, 'dark', 'sepia', null, null, 'base']);
    expect(modeOf({ selector: ':root', media: '@media (prefers-color-scheme: dark)' })).toBe('dark');
    expect(modeOf({ selector: 'html.theme-ocean', media: '' })).toBe('ocean');
  });
  it('each theme is the tokens it changes, vars followed', () => {
    const tokens = [
      { name: 'color.bg', value: '#fff', type: 'color' as const },
      { name: 'color.ink', value: '#111', type: 'color' as const },
      { name: 'color.accent', value: '#111', type: 'color' as const },
    ];
    expect(tokenModes('/x', tokens, css)).toEqual([
      { name: 'dark', values: { 'color.bg': '#000', 'color.accent': '#000' } },
      { name: 'sepia', values: { 'color.bg': '#f4ecd8' } },
    ]);
  });
});

describe('DS tokens: fonts and scale', () => {
  it('next/font and the geist package, by the variable they set', () => {
    const code = `import { Geist_Mono, Instrument_Serif } from "next/font/google";
import { GeistSans } from 'geist/font/sans';
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Instrument_Serif({ weight: "400", variable: '--font-serif' });`;
    expect(Object.fromEntries(nextFonts(code))).toEqual({ 'font-geist-mono': 'Geist Mono', 'font-serif': 'Instrument Serif', 'font-geist-sans': 'Geist' });
  });
  it('the steps the classes use', () => {
    const s = scaleSteps('<div className="md:px-4 gap-1.5 -mt-2 p-0 w-4 rounded rounded-t-lg text-sm text-brand" />');
    expect([...s.spacing]).toEqual(['4', '1.5', '2']);
    expect([...s.radius]).toEqual(['DEFAULT', 'lg']);
    expect([...s.text]).toEqual(['sm']);
  });
});
