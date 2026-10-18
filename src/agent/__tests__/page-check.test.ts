import { describe, it, expect } from 'vitest';
import { declaredComponents, routeOf, offPageEdits } from '../page-check.js';
import type { FileChange } from '../changeset.js';

const edit = (path: string, before: string | null, after: string | null): FileChange => ({ path, before, after });
const PAGE = ['ProviderScreen', 'KeyColumn', 'ProviderKeyCardHeader', 'Button'];

describe('declaredComponents', () => {
  it('reads functions, consts and classes with a capital name', () => {
    const src = `export function ProviderScreen() {}\nconst KeyColumn = () => null\nclass Board {}\nfunction helper() {}`;
    expect(declaredComponents(src)).toEqual(['ProviderScreen', 'KeyColumn', 'Board']);
  });
});

describe('routeOf', () => {
  it('turns an app-router page into its URL, without route groups', () => {
    expect(routeOf('app/(console)/ai/providers/areas/page.tsx')).toBe('/ai/providers/areas');
    expect(routeOf('src/app/(console)/ai/providers/[id]/edit/page.tsx')).toBe('/ai/providers/[id]/edit');
    expect(routeOf('app/page.tsx')).toBe('/');
  });
  it('is null for anything that is not a page', () => {
    expect(routeOf('app/(console)/layout.tsx')).toBeNull();
    expect(routeOf('components/providers/page.tsx')).toBeNull();
  });
});

describe('offPageEdits', () => {
  it('flags a run whose edited components are not on the page', () => {
    const files = [
      edit('components/providers/by-area/ProviderKeysByAreaScreen.tsx', 'export function ProviderKeysByAreaScreen() {}', 'export function ProviderKeysByAreaScreen() { /* bar */ }'),
      edit('components/providers/by-area/ProviderKeysByAreaLayoutBar.tsx', null, 'export function ProviderKeysByAreaLayoutBar() {}'),
      edit('messages/en.json', '{}', '{"a":1}'),
    ];
    expect(offPageEdits(files, PAGE, () => ['/ai/providers/areas'])).toEqual({
      files: ['components/providers/by-area/ProviderKeysByAreaScreen.tsx'],
      routes: ['/ai/providers/areas'],
    });
  });
  it('passes when any edited component renders on the page', () => {
    const files = [
      edit('components/providers/form/ProviderScreen.tsx', 'export function ProviderScreen() {}', 'export function ProviderScreen() { /* bar */ }'),
      edit('components/providers/by-area/ProviderAreaGroup.tsx', 'function ProviderAreaGroup() {}', 'function ProviderAreaGroup() { }'),
    ];
    expect(offPageEdits(files, PAGE)).toBeNull();
  });
  it('does not judge new files, data files or route files', () => {
    expect(offPageEdits([edit('components/New.tsx', null, 'export function New() {}')], PAGE)).toBeNull();
    expect(offPageEdits([edit('messages/en.json', '{}', '{"a":1}')], PAGE)).toBeNull();
    expect(offPageEdits([edit('app/(console)/ai/page.tsx', 'export default function Page() {}', 'x')], PAGE)).toBeNull();
  });
  it('does not judge when the page said too little', () => {
    const files = [edit('components/Other.tsx', 'function Other() {}', 'function Other() { }')];
    expect(offPageEdits(files, ['App'])).toBeNull();
  });
});
