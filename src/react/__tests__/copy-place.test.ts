import { describe, it, expect } from 'vitest';
import { copyPlacement, lineOf } from '../copy-place.js';

const n = (name: string, text: string, twin = false) => ({ name, text, twin });

describe('copyPlacement — where the copy stands on the page', () => {
  it('still right after its original: nothing to add', () => {
    expect(copyPlacement(n('<a>', 'Conhecer o Pro', true), n('<CopyCommand>', '$ npx ilse-design@latest'), null)).toBeUndefined();
  });
  it('dragged after another element: named by it', () => {
    expect(copyPlacement(n('<CopyCommand>', '$ npx ilse-design@latest'), null, n('<div>', ''))).toBe('logo depois de <CopyCommand> "$ npx ilse-design@latest"');
  });
  it('dragged to the start of a container: before its first child', () => {
    expect(copyPlacement(null, n('<a>', 'Conhecer o Pro', true), n('<div>', ''))).toBe('logo antes de <a> "Conhecer o Pro"');
  });
  it('alone in a container', () => {
    expect(copyPlacement(null, null, n('<section>', 'Preços'))).toBe('dentro de <section> "Preços"');
  });
});

describe('lineOf', () => {
  it('one line, cut', () => {
    expect(lineOf('  $\n npx   ilse ')).toBe('$ npx ilse');
    expect(lineOf('a'.repeat(70)).length).toBe(60);
  });
});
