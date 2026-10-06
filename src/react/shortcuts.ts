/**
 * Keyboard shortcuts — one list for the Settings → Keyboard shortcuts modal and
 * the toolbar tooltips, so what the designer reads is what the keys do.
 */

import type { MessageKey } from '../i18n/index.js';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** ⌘ on a Mac, Ctrl elsewhere */
export function mod(keys: string, mac = isMac): string {
  return mac ? keys.replace(/Mod\+click/g, '⌘-click').replace(/Mod\+?/g, '⌘').replace(/Shift\+?/g, '⇧').replace(/Enter/g, '↵')
    : keys.replace(/Mod\+?/g, 'Ctrl+').replace(/Shift\+?/g, 'Shift+').replace(/Enter/g, 'Enter');
}

/** "Label (V)" — the tooltip of a control that has a shortcut */
export function withShortcut(label: string, keys: string, mac = isMac): string {
  return `${label} (${mod(keys, mac)})`;
}

/** Typing in a field keeps its keys: no single-letter shortcut fires there */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
}

/** Two presses of the same key within this window count as a double press (ii) */
export const DOUBLE_PRESS_MS = 450;

/** Tracks a double press of one key. Returns true on the second press in time. */
export function doublePress(key: string, windowMs = DOUBLE_PRESS_MS) {
  let last = 0;
  return (pressed: string, now = Date.now()): boolean => {
    if (pressed.toLowerCase() !== key) { last = 0; return false; }
    if (now - last <= windowMs) { last = 0; return true; }
    last = now;
    return false;
  };
}

export interface Shortcut { keys: string; label: MessageKey }
export interface ShortcutGroup { title: MessageKey; items: Shortcut[] }

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'shortcuts.group.toolbar',
    items: [
      { keys: 'V', label: 'shortcuts.select' },
      { keys: 'I I', label: 'shortcuts.recenter' },
      { keys: 'Esc', label: 'shortcuts.escape' },
    ],
  },
  {
    title: 'shortcuts.group.selection',
    items: [
      { keys: 'Mod+click', label: 'shortcuts.deepSelect' },
      { keys: 'Mod+Enter', label: 'shortcuts.send' },
      { keys: 'Delete', label: 'shortcuts.remove' },
    ],
  },
  {
    title: 'shortcuts.group.undo',
    items: [
      { keys: 'Mod+Z', label: 'shortcuts.undo' },
      { keys: 'Shift+Mod+Z', label: 'shortcuts.redo' },
    ],
  },
  {
    title: 'shortcuts.group.pencil',
    items: [
      { keys: 'Enter', label: 'shortcuts.pencilDone' },
      { keys: 'Mod+Z', label: 'shortcuts.pencilUndo' },
      { keys: 'Esc', label: 'shortcuts.pencilDiscard' },
    ],
  },
];
