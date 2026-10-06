import { describe, it, expect } from 'vitest';
import { mod, withShortcut, doublePress, isTyping, SHORTCUT_GROUPS } from '../shortcuts.js';
import messages from '../../i18n/messages.js';

describe('mod', () => {
  it('Mac symbols, Ctrl elsewhere', () => {
    expect(mod('Shift+Mod+Z', true)).toBe('⇧⌘Z');
    expect(mod('Mod+Enter', true)).toBe('⌘↵');
    expect(mod('Mod+click', true)).toBe('⌘-click');
    expect(mod('Mod+Z', false)).toBe('Ctrl+Z');
    expect(mod('Mod+click', false)).toBe('Ctrl+click');
  });
  it('tooltip with the shortcut', () => {
    expect(withShortcut('Close', 'Esc', true)).toBe('Close (Esc)');
  });
});

describe('doublePress', () => {
  it('fires on the second press in time, not on a slow one or another key', () => {
    const ii = doublePress('i', 450);
    expect(ii('i', 1000)).toBe(false);
    expect(ii('I', 1300)).toBe(true);
    expect(ii('i', 2000)).toBe(false);
    expect(ii('i', 2600)).toBe(false); // too slow — this one starts a new pair
    expect(ii('x', 2700)).toBe(false);
    expect(ii('i', 2800)).toBe(false); // another key in between breaks the pair
    expect(ii('i', 3000)).toBe(true);
  });
});

describe('isTyping', () => {
  it('fields and contenteditable keep their keys', () => {
    expect(isTyping({ tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: 'BODY', isContentEditable: false } as unknown as EventTarget)).toBe(false);
  });
});

describe('SHORTCUT_GROUPS', () => {
  it('every label exists in both languages', () => {
    for (const g of SHORTCUT_GROUPS) for (const key of [g.title, ...g.items.map(i => i.label)]) {
      expect(messages[key]?.pt, key).toBeTruthy();
      expect(messages[key]?.en, key).toBeTruthy();
    }
  });
});
