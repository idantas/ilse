/**
 * Finding the selected element again after the app replaced it.
 *
 * The selection is a marker attribute on the DOM node. When React re-creates
 * that node (a renderer that isn't stable between renders, a hover card that
 * remounts), the new node has no marker: the panel lost its element mid-edit
 * and fell back to reading a plain box — no text section, no width, a second
 * colour row. The anchor remembers where the node was (its path from the
 * document root) and what it was (tag, classes, text), so the same element
 * is found again, or nothing is: a different element is never taken for it.
 */

export interface AnchorNode {
  tagName: string;
  parentElement: AnchorNode | null;
  children: ArrayLike<AnchorNode>;
  textContent: string | null;
  getAttribute(name: string): string | null;
}

export interface ElementAnchor {
  /** Child indices from the document's root down to the element */
  path: number[];
  tag: string;
  cls: string;
  text: string;
}

const textOf = (n: AnchorNode) => (n.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

export function anchorOf(el: AnchorNode): ElementAnchor {
  const path: number[] = [];
  for (let n: AnchorNode = el; n.parentElement; n = n.parentElement) {
    path.unshift(Array.prototype.indexOf.call(n.parentElement.children, n));
  }
  return { path, tag: el.tagName, cls: el.getAttribute('class') ?? '', text: textOf(el) };
}

/** Same tag, and the same text or (text being edited) the same classes */
function same(n: AnchorNode, a: ElementAnchor, textChanged: boolean): boolean {
  if (n.tagName !== a.tag) return false;
  const cls = n.getAttribute('class') ?? '';
  return textChanged ? cls === a.cls : textOf(n) === a.text && (cls === a.cls || !a.cls);
}

/**
 * The element at the anchor's place, if it is still the same element; else the one sibling
 * there that is (the list moved by one). `textChanged`: the panel is retyping its text, so
 * the text can't be compared.
 */
export function findByAnchor(root: AnchorNode, a: ElementAnchor, textChanged = false): AnchorNode | null {
  let parent: AnchorNode | null = root;
  for (const i of a.path.slice(0, -1)) {
    parent = parent?.children[i] ?? null;
    if (!parent) return null;
  }
  const at = parent.children[a.path[a.path.length - 1]];
  if (at && same(at, a, textChanged)) return at;
  const like = Array.from(parent.children).filter(n => same(n, a, textChanged));
  return like.length === 1 ? like[0] : null;
}
