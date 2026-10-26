// Marks the element under a right-click, so "Open with Ilse" in the browser's
// menu knows what was clicked. The page and the toolbar share the DOM, not the
// extension's world: an attribute is how the element crosses over.
document.addEventListener('contextmenu', (e) => {
  for (const old of document.querySelectorAll('[data-ilse-context]')) old.removeAttribute('data-ilse-context');
  const el = e.target instanceof Element ? e.target : e.target?.parentElement;
  el?.setAttribute('data-ilse-context', '');
}, true);
