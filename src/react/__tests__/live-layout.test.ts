import { describe, it, expect } from 'vitest';
import { targetIndex, moveItem, formatReorder, sameBox, type Slot } from '../live-layout.js';

const col: Slot[] = [0, 40, 80, 120].map(top => ({ left: 0, top, width: 200, height: 32 }));
const row: Slot[] = [0, 110, 220].map(left => ({ left, top: 0, width: 100, height: 40 }));
const grid: Slot[] = [
  { left: 0, top: 0, width: 100, height: 100 }, { left: 110, top: 0, width: 100, height: 100 },
  { left: 0, top: 110, width: 100, height: 100 }, { left: 110, top: 110, width: 100, height: 100 },
];

describe('targetIndex', () => {
  it('takes the place of the item under the pointer', () => {
    // dragging item 3 of a column (others: 0,1,2,4 at slots 0,40,80,120)
    expect(targetIndex({ x: 50, y: 10 }, col, 3)).toBe(0);
    expect(targetIndex({ x: 50, y: 50 }, col, 3)).toBe(1);
    // an item after the current slot: land after it
    expect(targetIndex({ x: 50, y: 130 }, col, 3)).toBe(4);
  });
  it('stays put over a gap or its own empty slot', () => {
    expect(targetIndex({ x: 50, y: 36 }, col, 2)).toBe(2);   // between 0–32 and 40–72
    expect(targetIndex({ x: 105, y: 20 }, row, 1)).toBe(1);  // gap between cells in a row
    expect(targetIndex({ x: 105, y: 105 }, grid, 2)).toBe(2); // grid gap crossing
  });
  it('works the same in a grid', () => {
    expect(targetIndex({ x: 150, y: 150 }, grid, 0)).toBe(4);
    expect(targetIndex({ x: 50, y: 50 }, grid, 3)).toBe(0);
  });
  it('handles an empty list', () => {
    expect(targetIndex({ x: 0, y: 0 }, [], 0)).toBe(0);
  });
});

describe('moveItem', () => {
  it('moves without mutating', () => {
    const a = ['a', 'b', 'c', 'd'];
    expect(moveItem(a, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveItem(a, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(a).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('formatReorder', () => {
  it('tells the agent what moved, in React terms, and to change the source order', () => {
    const text = formatReorder({
      kind: 'reorder', from: 3, to: 1,
      before: ['Visão geral', 'Usuários', 'Provedores', 'Consumo'],
      after: ['Visão geral', 'Consumo', 'Usuários', 'Provedores'],
      item: 'Consumo', container: '<ul data-sidebar="menu">',
      react: { key: 'consumo', owner: 'SidebarMenuItem' }, listOwner: 'NavMain',
    });
    expect(text).toContain('<ul data-sidebar="menu"> no componente <NavMain>');
    expect(text).toContain('"Consumo" (key "consumo") — da posição 4 para a 2');
    expect(text).toContain('Nova ordem: 1. Visão geral · 2. Consumo · 3. Usuários · 4. Provedores');
    expect(text).toMatch(/Não use CSS `order`/);
  });
});

import { inInnerZone, insertionIndex, formatReparent } from '../live-layout.js';

describe('into / out of a container', () => {
  const card = { left: 0, top: 0, width: 400, height: 200 };

  it('the middle of a box means "into", its edges mean "beside"', () => {
    expect(inInnerZone({ x: 200, y: 100 }, card)).toBe(true);
    expect(inInnerZone({ x: 200, y: 20 }, card)).toBe(false); // top edge
    expect(inInnerZone({ x: 10, y: 100 }, card)).toBe(false); // left edge
    // Edge band is capped: a huge box doesn't need the pointer at its dead centre
    expect(inInnerZone({ x: 60, y: 60 }, { left: 0, top: 0, width: 2000, height: 2000 })).toBe(true);
  });

  it('inserts before the first child the pointer comes before', () => {
    const col = [{ left: 0, top: 0, width: 100, height: 40 }, { left: 0, top: 50, width: 100, height: 40 }];
    expect(insertionIndex({ x: 50, y: 10 }, col, 'column')).toBe(0);
    expect(insertionIndex({ x: 50, y: 30 }, col, 'column')).toBe(1);
    expect(insertionIndex({ x: 50, y: 200 }, col, 'column')).toBe(2);
    expect(insertionIndex({ x: 50, y: 10 }, [], 'column')).toBe(0);
    const row = [{ left: 0, top: 0, width: 40, height: 40 }, { left: 50, top: 0, width: 40, height: 40 }];
    expect(insertionIndex({ x: 60, y: 20 }, row, 'row')).toBe(1);
  });

  it('tells the agent to move the JSX, not fake it with CSS', () => {
    const text = formatReparent({
      kind: 'reparent', item: 'OpenAI produção', react: { owner: 'ProviderCard' },
      from: '<div>', into: '<div data-slot="card">', intoLabel: 'gpt-4o', intoOwner: 'ProviderCard',
      target: {} as HTMLElement, index: 0, after: 'gpt-4o', out: false,
    }, 'data-slot="card"');
    expect(text).toContain('Mover elemento para dentro de outro container');
    expect(text).toContain('no início, antes de "gpt-4o"');
    expect(text).toContain('localizar por: data-slot="card"');
    expect(text).toContain('Não use CSS');
  });
});

describe('sameBox', () => {
  it('treats a wrapper hugging its child as the same box', () => {
    expect(sameBox({ width: 580, height: 320 }, { width: 580, height: 321.5 })).toBe(true);
  });
  it('tells a real container apart', () => {
    expect(sameBox({ width: 580, height: 320 }, { width: 628, height: 430 })).toBe(false);
  });
});
