import { describe, it, expect, beforeAll, vi } from 'vitest';

// A DOM just big enough for reorderUnit: boxes, parents and computed display
class El {
  parentElement: El | null = null;
  children: El[] = [];
  constructor(public rect: { width: number; height: number }, public style: Record<string, string> = { display: 'block', position: 'static' }) {}
  add(...kids: El[]) { for (const k of kids) { k.parentElement = this; this.children.push(k); } return this; }
  getBoundingClientRect() { return this.rect; }
  closest() { return null; }
}

let reorderUnit: (el: HTMLElement) => HTMLElement;
const body = new El({ width: 1440, height: 900 });

beforeAll(async () => {
  vi.stubGlobal('HTMLElement', El);
  vi.stubGlobal('document', { body });
  vi.stubGlobal('getComputedStyle', (el: El) => ({ flexWrap: 'nowrap', flexDirection: 'row', ...el.style }));
  ({ reorderUnit } = await import('../live-layout.js'));
});

const unit = (el: El) => reorderUnit(el as unknown as HTMLElement) as unknown as El;

describe('reorderUnit — what a drag moves', () => {
  it('moves the selected cell, not the table row around it', () => {
    const td = new El({ width: 24, height: 64 }, { display: 'table-cell', position: 'static' });
    const tr = new El({ width: 1200, height: 64 }, { display: 'table-row', position: 'static' }).add(td, new El({ width: 600, height: 64 }, { display: 'table-cell', position: 'static' }));
    body.add(new El({ width: 1200, height: 400 }, { display: 'table', position: 'static' }).add(tr));
    expect(unit(td)).toBe(td);
  });

  it('moves the title, not the card it sits in', () => {
    const title = new El({ width: 120, height: 20 });
    const card = new El({ width: 240, height: 120 }, { display: 'flex', flexDirection: 'column', position: 'static' }).add(title, new El({ width: 120, height: 30 }));
    body.add(card);
    expect(unit(title)).toBe(title);
  });

  it('climbs through a same-size wrapper to the list item', () => {
    const button = new El({ width: 200, height: 32 });
    const li = new El({ width: 200, height: 32 }).add(button);
    body.add(new El({ width: 200, height: 96 }, { display: 'flex', flexDirection: 'column', position: 'static' }).add(li, new El({ width: 200, height: 32 }), new El({ width: 200, height: 32 })));
    expect(unit(button)).toBe(li);
  });

  it('stops at an element that already is a list item', () => {
    const item = new El({ width: 200, height: 32 });
    const list = new El({ width: 200, height: 32 }, { display: 'flex', position: 'static' }).add(item, new El({ width: 0, height: 0 }));
    body.add(new El({ width: 200, height: 32 }).add(list));
    expect(unit(item)).toBe(item);
  });
});
