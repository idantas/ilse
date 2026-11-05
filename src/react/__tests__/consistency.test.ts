import { describe, expect, it } from 'vitest';
import { families, fixNote, lookDiff, nearestStep, pickSwap, decideEntry, previewable, recommend, reviewEstimate, screenKey, standardOf, swapStyles, ticksLit } from '../consistency.js';
import type { Look } from '../look-alike.js';
import type { CatalogItem } from '../catalog-snapshot.js';

const look = (over: Partial<Look> = {}): Look => ({
  radius: 8, padX: 12, padY: 4, height: 28, fontSize: 12, fontWeight: 500, textTransform: 'none',
  fill: { r: 240, g: 240, b: 240, a: 1 }, text: { r: 20, g: 20, b: 20, a: 1 }, border: { width: 0, color: null }, shadow: false, ...over,
});
const item = (name: string, over: Partial<CatalogItem> = {}): CatalogItem => ({ id: name, name, source: `components/ui/${name}.tsx`, folder: 'ui', library: false, uses: 1, props: [], layer: 'base', ...over });

describe('consistency rules', () => {
  it('a pill where the standard is rounded, and a different fill, are two differences', () => {
    expect(lookDiff(look({ radius: 999, fill: { r: 254, g: 243, b: 199, a: 1 } }), look())).toEqual(['radius', 'fill']);
  });

  it('height counts only when padding does not set it', () => {
    expect(lookDiff(look({ height: 34 }), look())).toEqual([]);
    expect(lookDiff(look({ height: 34, padY: 0 }), look({ padY: 0 }))).toEqual(['height']);
  });

  it('the standard is the base layer when the project has one, else its own components', () => {
    const ui = ['Button', 'Badge', 'Input', 'Select', 'Tabs'].map(n => item(n));
    const product = item('OrderRow', { folder: 'orders', layer: 'product' });
    expect(standardOf([...ui, product]).map(i => i.name)).not.toContain('OrderRow');
    expect(standardOf([ui[0], product]).map(i => i.name)).toEqual(['Button', 'OrderRow']);
  });

  it('the same pieces on the same route are the same screen', () => {
    const p = [{ id: 0, kind: 'chip', text: 'Pago', look: 'radius 8' }];
    expect(screenKey('/a', p)).toBe(screenKey('/a', [...p]));
    expect(screenKey('/a', p)).not.toBe(screenKey('/b', p));
    expect(screenKey('/a', p)).not.toBe(screenKey('/a', [{ ...p[0], text: 'Pendente' }]));
  });

  it('the fix note says what the DS has', () => {
    expect(fixNote({ type: 'copy', text: 'Pago', owner: 'OrderRow', standard: 'Badge color=green', props: [] }))
      .toBe('"Pago" (written in <OrderRow>) is written by hand but looks exactly like the DS\'s Badge color=green. Replace it with that component and drop the hand-written classes; it must look the same after. Every component you put in must be imported in that file (or already defined there).');
    expect(fixNote({ type: 'agent', text: 'Pill à mão', detail: 'Onde o DS tem Badge.', fix: '<Badge>', file: 'a.tsx', line: 3, props: [] }))
      .toBe('"Pill à mão" (a.tsx:3): Onde o DS tem Badge. Should be: <Badge>. Every component you put in must be imported in that file (or already defined there).');
  });

  it('an off-token colour swaps exactly the token the row showed, or becomes a DS token', () => {
    const f = { type: 'off-token', text: '$ npx', owner: 'Playground', props: ['#111111'], swaps: [{ role: 'fill' as const, from: '#111111', token: '--foreground', value: '#0a0a0a', contrast: 17.4, ok: true }] };
    expect(fixNote(f)).toContain('Swap exactly this: #111111 → --foreground (#0a0a0a), contrast 17.4:1.');
    expect(fixNote(f)).toContain("don't add theme or section classes");
    expect(fixNote(f, 'add')).toContain('Add it once as a new colour token');
  });

  it('a finding over several pieces asks for every one of them', () => {
    expect(fixNote({ type: 'agent', text: 'Entrar', detail: 'CTAs by hand.', fix: '<Button>', props: [], pieces: ['"Entrar" in <Landing>', '"Seja fundador" in <Landing>'] }))
      .toContain('This is on 2 pieces of this screen: "Entrar" in <Landing>, "Seja fundador" in <Landing> — fix every one of them');
    const colour = { type: 'off-token', text: 'R$ 429', owner: 'Landing', props: ['#888888'], pieces: ['"R$ 429" in <Landing>', '"Fundadores" in <Label>'] };
    expect(fixNote(colour, 'add')).toContain('use that token in every place it is written by hand');
    expect(fixNote(colour, 'add')).toContain('"Fundadores" in <Label>');
  });

  it('picks the nearest token that still reads, and says when none does', () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const tokens = [{ name: '--muted', c: { r: 170, g: 170, b: 170, a: 1 } }, { name: '--muted-foreground', c: { r: 115, g: 115, b: 115, a: 1 } }];
    const sw = pickSwap('text', { r: 160, g: 160, b: 160, a: 1 }, tokens, white)!;
    expect(sw.token).toBe('--muted-foreground');
    expect(sw.ok).toBe(true);
    expect(pickSwap('text', { r: 160, g: 160, b: 160, a: 1 }, [tokens[0]], white)).toMatchObject({ token: '--muted', ok: false });
    expect(pickSwap('border', { r: 160, g: 160, b: 160, a: 1 }, tokens, white)?.contrast).toBeUndefined();
  });

  it('never swaps a pale fill for a dark token just to pass contrast (live: Pending chip turned black)', () => {
    const warning = { r: 184, g: 134, b: 44, a: 1 };
    const ds = [{ name: 'sand', c: { r: 236, g: 228, b: 214, a: 1 } }, { name: 'foreground', c: { r: 28, g: 28, b: 26, a: 1 } }];
    expect(pickSwap('fill', { r: 243, g: 226, b: 196, a: 1 }, ds, warning)).toMatchObject({ token: 'sand', ok: false });
  });

  it('reads a font stack as its chosen families, without fallbacks or generics', () => {
    expect(families('"Geist", "Geist Fallback", ui-sans-serif, system-ui, sans-serif')).toEqual(['geist']);
    expect(families("Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI'")).toEqual(['inter', 'segoe ui']);
  });

  it('a size off the scale goes to the nearest step, the named token on a tie', () => {
    expect(nearestStep(13, [{ name: '--text-xs', px: 12 }, { name: '--text-sm', px: 14 }, { px: 11 }])).toEqual({ name: '--text-xs', px: 12 });
    expect(nearestStep(11.5, [{ px: 11 }, { name: '--text-xs', px: 12 }])).toEqual({ name: '--text-xs', px: 12 });
  });

  it('a font off the DS swaps only the family', () => {
    const f = { type: 'off-font', text: 'Preço', owner: 'Card', props: ['inter'], swaps: [{ role: 'font' as const, from: 'inter', token: '--font-sans', value: 'geist' }] };
    expect(fixNote(f)).toContain('uses font family "inter", which isn\'t one of the DS\'s fonts. Swap exactly this: inter → --font-sans (geist)');
    expect(fixNote(f)).toContain('Change only the font family.');
  });
});

describe('review meter', () => {
  it('estimates 25s with no past reviews, else the mean of the last five', () => {
    expect(reviewEstimate([])).toBe(25_000);
    expect(reviewEstimate([1, 1, 10_000, 20_000, 30_000, 20_000, 20_000])).toBe(20_000);
  });
  it('fills with time but keeps the last tick for the answer', () => {
    expect(ticksLit(0, 20_000, 24)).toEqual({ lit: 1, slow: false });
    expect(ticksLit(10_000, 20_000, 24)).toEqual({ lit: 12, slow: false });
    expect(ticksLit(60_000, 20_000, 24)).toEqual({ lit: 23, slow: true });
  });
});

describe('swapStyles', () => {
  const st = (o: Partial<Record<'color' | 'backgroundColor' | 'borderColor' | 'borderTopWidth' | 'fontSize', string>>) =>
    ({ color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', borderColor: 'rgb(0, 0, 0)', borderTopWidth: '0px', fontSize: '16px', ...o });
  const grey = { role: 'text' as const, from: '#888888', token: '--muted', value: '#757575' };
  it('writes the colour where this piece uses it', () => {
    expect(swapStyles(st({ color: 'rgb(136, 136, 136)' }), [grey])).toEqual({ color: '#757575' });
    expect(swapStyles(st({ borderColor: 'rgb(136, 136, 136)', borderTopWidth: '1px' }), [grey])).toEqual({ borderColor: '#757575' });
  });
  it('leaves a border of that colour alone when there is no border', () => {
    expect(swapStyles(st({ borderColor: 'rgb(136, 136, 136)' }), [grey])).toEqual({});
  });
  it('swaps a size on the piece that has it', () => {
    expect(swapStyles(st({ fontSize: '28px' }), [{ role: 'size', from: '28px', token: '--text-2xl', value: '24px' }])).toEqual({ fontSize: '24px' });
  });
  it('previews colours and sizes, not fonts', () => {
    expect(previewable([grey])).toBe(true);
    expect(previewable([{ role: 'font', from: 'Fraunces', token: '--font-sans', value: 'Inter' }])).toBe(false);
    expect(previewable([])).toBe(false);
  });
});

describe('override notes', () => {
  const f = { type: 'override', text: 'Shop', owner: 'Home', standard: 'Button variant=solid', props: ['radius', 'fill'] };
  it('goes back to the standard by default', () => {
    expect(fixNote(f)).toContain('looks like Button variant=solid again');
  });
  it('keeps the look as a variant when asked', () => {
    expect(fixNote(f, 'variant')).toContain('Nothing may look different after');
  });
});

describe('the recommended fix', () => {
  const els = (n: number) => Array.from({ length: n }, () => ({}) as HTMLElement);
  const near = { role: 'fill' as const, from: '#6b6b6b', token: 'muted', value: '#737373' };
  it('a colour near a token goes back to the token, however often it shows', () => {
    expect(recommend({ type: 'off-token', swaps: [near], els: els(5) })).toBe('fix');
  });
  it('a colour far from every token, on 3 pieces or more, goes into the DS', () => {
    expect(recommend({ type: 'off-token', swaps: [{ ...near, far: true }], els: els(3) })).toBe('ds');
    expect(recommend({ type: 'off-token', swaps: [{ ...near, far: true }], els: els(2) })).toBe('fix');
  });
  it('no token that reads goes into the DS too; a repeated override becomes a variant', () => {
    expect(recommend({ type: 'off-token', swaps: [{ ...near, ok: false }], els: els(4) })).toBe('ds');
    expect(recommend({ type: 'override', els: els(3) })).toBe('ds');
    expect(recommend({ type: 'override', els: els(1) })).toBe('fix');
  });
});

describe('what the agent is asked to decide', () => {
  const els = (n: number) => Array.from({ length: n }, () => ({}) as HTMLElement);
  const f = { id: 'c1', type: 'off-token' as const, text: 'Export', props: ['#5b6b3a'], pieces: ['"Export" in <Admin>', '"Place order" in <Checkout>', '"Save" in <Admin>'] };
  it('only a finding whose recommended fix is the DS', () => {
    expect(decideEntry({ ...f, els: els(3), swaps: [{ role: 'fill', from: '#5b6b3a', token: 'muted', value: '#737373' }] })).toBeNull();
    const d = decideEntry({ ...f, els: els(3), swaps: [{ role: 'fill', from: '#5b6b3a', token: 'brand', value: '#c2410c', far: true }] });
    expect(d?.options).toEqual(['fix', 'ds']);
    expect(d?.about).toContain('colour #5b6b3a (nearest token brand #c2410c, far) on 3 pieces');
  });
});
