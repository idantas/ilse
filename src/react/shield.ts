// Ilse's UI lives inside the page, so to the page's menus and popovers (Radix,
// shadcn) a click or focus in it is "outside" and they close. A hover menu the
// designer paused to annotate vanished the moment they clicked into the card.
//
// Installed once per window and never removed: the page-side listeners we beat
// are added on document when a menu opens, so ours has to be there first —
// re-adding it on HMR would put it behind a menu that is already open.

declare global {
  interface Window {
    __ilseShield?: boolean;
  }
}

const inIlse = (node: EventTarget | null) => node instanceof Element && !!node.closest('[data-ilse-toolbar]');

export function shieldPage(): void {
  if (typeof window === 'undefined' || window.__ilseShield) return;
  window.__ilseShield = true;

  // Document, bubble: React (whose root listener came first) and Ilse's own
  // capture listeners have run; the page's outside-click/focus listeners haven't
  const fromIlse = (e: Event) => { if (inIlse(e.target)) e.stopImmediatePropagation(); };
  for (const type of ['pointerdown', 'mousedown', 'touchstart', 'focusin', 'focusout']) document.addEventListener(type, fromIlse);

  // Window, capture: the page element losing focus to Ilse never hears of it,
  // so a focus trap doesn't pull focus back and a blur doesn't close the menu
  const toIlse = (e: Event) => {
    const { target, relatedTarget } = e as FocusEvent;
    if (inIlse(relatedTarget) && !inIlse(target)) e.stopImmediatePropagation();
  };
  for (const type of ['focusout', 'blur']) window.addEventListener(type, toIlse, true);
}
