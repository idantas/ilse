import { describe, it, expect } from 'vitest';
import { countsAsRepaint, regionRepainted, sameText } from '../repaint-watch.js';

describe('countsAsRepaint — did the app repaint, not Ilse', () => {
  it('the app re-rendering counts', () => {
    expect(countsAsRepaint({ type: 'childList', targetIsIlse: false, nodesAllIlse: false })).toBe(true);
    expect(countsAsRepaint({ type: 'attributes', targetIsIlse: false, attributeName: 'class' })).toBe(true);
    expect(countsAsRepaint({ type: 'characterData', targetIsIlse: false })).toBe(true);
  });

  it("Ilse's own nodes never count: a draft removed, the toolbar, its markers", () => {
    expect(countsAsRepaint({ type: 'childList', targetIsIlse: false, nodesAllIlse: true })).toBe(false);
    expect(countsAsRepaint({ type: 'childList', targetIsIlse: true, nodesAllIlse: false })).toBe(false);
    expect(countsAsRepaint({ type: 'attributes', targetIsIlse: false, attributeName: 'data-ilse-pixel-target' })).toBe(false);
  });
});

describe('regionRepainted — only the annotated region counts', () => {
  const region = (inside: unknown[], isConnected = true) => ({ contains: (n: unknown) => inside.includes(n), isConnected });
  const card = {}, elsewhere = {};

  it('a change inside the region after the run began counts', () => {
    expect(regionRepainted([region([card])], [{ at: 20, target: card }], 10)).toBe(true);
  });

  it('a page changing on its own elsewhere does not (scrambled text, a carousel)', () => {
    expect(regionRepainted([region([card])], [{ at: 20, target: elsewhere }], 10)).toBe(false);
  });

  it('a change before the run does not', () => {
    expect(regionRepainted([region([card])], [{ at: 5, target: card }], 10)).toBe(false);
  });

  it('a region that left the page was replaced by a re-render', () => {
    expect(regionRepainted([region([], false)], [], 10)).toBe(true);
  });
});

describe('sameText', () => {
  it('ignores line breaks and indentation', () => {
    expect(sameText('Mude no seu browser\nO código acompanha', '  Mude no seu browser\n      O código acompanha ')).toBe(true);
    expect(sameText('Mude no seu browser.', 'Mude no seu browser')).toBe(false);
  });
});
