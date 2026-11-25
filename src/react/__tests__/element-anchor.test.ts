import { describe, it, expect } from 'vitest';
import { anchorOf, findByAnchor, type AnchorNode } from '../element-anchor.js';

/** A tiny DOM: enough tree for paths, classes and text */
function node(tag: string, cls = '', text = '', kids: AnchorNode[] = []): AnchorNode {
  const n: AnchorNode = {
    tagName: tag, parentElement: null, children: kids,
    get textContent() { return text + kids.map(k => k.textContent).join(''); },
    getAttribute: (name: string) => (name === 'class' ? cls || null : null),
  };
  for (const k of kids) k.parentElement = n;
  return n;
}

function page(mentionText = '@ana-teste', extra: AnchorNode[] = []) {
  const mention = node('SPAN', 'mention mention-person text-sm', mentionText);
  const p = node('P', '', 'olhada nisso aqui ', [...extra, mention]);
  const root = node('HTML', '', '', [node('BODY', '', '', [node('DIV', '', '', [p])])]);
  return { root, mention };
}

describe('element anchor', () => {
  it('finds the same element in a re-rendered tree (React replaced the node)', () => {
    const before = page();
    const a = anchorOf(before.mention);
    const after = page();
    expect(after.mention).not.toBe(before.mention);
    expect(findByAnchor(after.root, a)).toBe(after.mention);
  });

  it('follows a one-step shift among siblings, and finds nothing rather than another element', () => {
    const a = anchorOf(page().mention);
    const shifted = page('@ana-teste', [node('SPAN', 'mention mention-person text-sm', '@caos')]);
    expect(findByAnchor(shifted.root, a)).toBe(shifted.mention);
    // Another mention took its place: not the same element
    expect(findByAnchor(page('@caos').root, a)).toBeNull();
  });

  it('while its text is retyped, the classes identify it', () => {
    const a = anchorOf(page().mention);
    const retyped = page('@ana');
    expect(findByAnchor(retyped.root, a)).toBeNull();
    expect(findByAnchor(retyped.root, a, true)).toBe(retyped.mention);
  });
});
