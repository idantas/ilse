import { describe, it, expect } from 'vitest';
import { rootComponents, htmlLabel } from '../element-tree.js';
import type { Fiber } from '../live-layout.js';

/** A fiber chain from the outermost down to the host: each entry is a `type` */
function chain(...types: unknown[]): Fiber {
  let parent: Fiber | null = null;
  for (const type of types) parent = { key: null, type, return: parent };
  return parent!;
}

function Field() {}
function FieldRoot() {}
function Select() {}

describe('rootComponents', () => {
  it('names the components between the element and the DOM element above, outermost first', () => {
    expect(rootComponents(chain('form', Field, FieldRoot, 'div'))).toEqual(['Field', 'FieldRoot']);
  });
  it('is empty for an element written inside another element', () => {
    expect(rootComponents(chain(Select, 'div', 'span'))).toEqual([]);
  });
  it('reads memo and forwardRef wrappers and skips framework internals', () => {
    const memo = { type: Select };
    const ref = { render: function Trigger() {} };
    function InnerLayoutRouter() {}
    expect(rootComponents(chain('main', InnerLayoutRouter, memo, ref, 'button'))).toEqual(['Select', 'Trigger']);
  });
  it('skips lowercase functions and nameless providers', () => {
    function helper() {}
    expect(rootComponents(chain('div', { $$typeof: Symbol('context') }, helper, 'span'))).toEqual([]);
  });
  it('is empty without React', () => {
    expect(rootComponents(null)).toEqual([]);
  });
});

describe('htmlLabel', () => {
  const el = (tagName: string, id = '', attrs: Record<string, string> = {}) =>
    ({ tagName, id, getAttribute: (k: string) => attrs[k] ?? null });

  it('tells the element apart by id, then data-slot, then role', () => {
    expect(htmlLabel(el('DIV', 'main', { role: 'region' }))).toBe('div#main');
    expect(htmlLabel(el('BUTTON', '', { 'data-slot': 'select-trigger', role: 'combobox' }))).toBe('button[select-trigger]');
    expect(htmlLabel(el('UL', '', { role: 'listbox' }))).toBe('ul[role=listbox]');
    expect(htmlLabel(el('SPAN'))).toBe('span');
  });
});
