import { describe, it, expect } from 'vitest';
import { componentAt, isReused, sameVariant, sourceNames, variantKey, writtenIn, type CatalogItem } from '../catalog-snapshot.js';

describe('catalog on the page', () => {
  it('a drop climbs out of reused components only, never out of a section written once', () => {
    expect(isReused({ library: true, uses: 1 })).toBe(true);
    expect(isReused({ library: false, layer: 'base', uses: 1 })).toBe(true);
    expect(isReused({ library: false, layer: 'product', uses: 3 })).toBe(true);
    expect(isReused({ library: false, layer: 'product', uses: 1 })).toBe(false);
  });

  it('a prebundled name is also tried without the number the bundler added', () => {
    expect(sourceNames('Button2')).toEqual(['Button2', 'Button']);
    expect(sourceNames('Card')).toEqual(['Card']);
    expect(sourceNames('H1')).toEqual(['H1']);
  });

  it('a library component implemented under another name is also tried as exported', () => {
    expect(sourceNames('LinkComponent')).toEqual(['LinkComponent', 'Link']);
    expect(sourceNames('SelectImpl2')).toEqual(['SelectImpl2', 'SelectImpl', 'Select']);
    expect(sourceNames('Component')).toEqual(['Component']);
  });

  it('the variant is the choosable props as the instance sets them', () => {
    const item = { props: [
      { name: 'variant', required: false, values: ['a', 'b'], kind: 'enum' as const },
      { name: 'disabled', required: false, values: ['true', 'false'], kind: 'boolean' as const },
      { name: 'label', required: true, values: [], kind: 'text' as const },
    ] };
    expect(variantKey(item, { variant: 'b', disabled: true, label: 'x', onClick: () => {} })).toBe('variant=b disabled=true');
    expect(variantKey(item, { label: 'x' })).toBe('');
  });

  it('a prop at its default is the same look as not set', () => {
    const item = { props: [
      { name: 'providerFixed', required: false, values: ['true', 'false'], kind: 'boolean' as const, default: 'false' },
      { name: 'size', required: false, values: ['sm', 'lg'], kind: 'enum' as const, default: 'sm' },
    ] };
    expect(variantKey(item, { providerFixed: false, size: 'sm' })).toBe('');
    expect(variantKey(item, { providerFixed: true })).toBe('providerFixed=true');
    // A copy kept before keys dropped defaults still matches
    expect(sameVariant(item, 'providerFixed=false', '')).toBe(true);
    expect(sameVariant(item, 'size=lg providerFixed=false', 'size=lg')).toBe(true);
    expect(sameVariant(item, 'providerFixed=true', '')).toBe(false);
  });

  it('a Server Component (no fiber of its own) is found by the name React left on what it returned', () => {
    const chip = { name: 'Chip', env: 'Server', props: { variant: 'badge', children: 'ilse' } };
    const span = { __reactFiber$x: { type: 'span', return: null, _debugInfo: [chip], _debugOwner: chip } } as unknown as Element;
    const hit = componentAt(span, [{ name: 'Chip' } as CatalogItem]);
    expect(hit?.item.name).toBe('Chip');
    expect(hit?.props).toEqual({ variant: 'badge' });
    expect(hit?.text).toBe('ilse');
    expect(writtenIn(span)).toBe('Chip');
  });
});
