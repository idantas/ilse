import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groupOfTitle, readStory } from '../design-system.js';
import { buildCatalog } from '../catalog.js';

describe('a connected design system', () => {
  it("reads a story's title and component", () => {
    expect(readStory("const meta = { title: 'Forms/Text Input', component: TextInput } satisfies Meta")).toEqual({ title: 'Forms/Text Input', component: 'TextInput' });
    expect(groupOfTitle('Components/Forms/Input')).toBe('Forms');
    expect(groupOfTitle('UI/Badge')).toBe('');
    expect(groupOfTitle('Feedback/Alert')).toBe('Feedback');
  });

  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  const put = (rel: string, code: string) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), code); };

  it('Storybook groups, the shadcn kit folder and a design system package make Base, named by the design system', () => {
    dir = mkdtempSync(join(tmpdir(), 'ilse-ds-'));
    put('.storybook/main.ts', 'export default {}');
    put('package.json', JSON.stringify({ dependencies: { '@acme/ui': '1.0.0', react: '19' } }));
    put('node_modules/@acme/ui/package.json', JSON.stringify({ name: '@acme/ui', description: 'Acme design system' }));
    put('components.json', JSON.stringify({ aliases: { ui: '@/kit' } }));
    put('src/kit/Toggle.tsx', 'export function Toggle() { return <button /> }');
    put('src/features/keys/KeyField.tsx', 'export function KeyField() { return <input /> }');
    put('src/features/keys/KeyField.stories.tsx', "export default { title: 'Forms/Key field', component: KeyField };");
    put('src/App.tsx', "import { Toggle } from './kit/Toggle';\nimport { KeyField } from './features/keys/KeyField';\nimport { Button } from '@acme/ui';\nexport default function App() { return <><Toggle /><KeyField /><Button /></>; }");
    const byName = new Map(buildCatalog(dir).map(e => [e.name, e]));
    expect(byName.get('KeyField')).toMatchObject({ layer: 'base', ds: 'Storybook', dsGroup: 'Forms' });
    expect(byName.get('Toggle')).toMatchObject({ layer: 'base', ds: 'shadcn/ui' });
    expect(byName.get('Button')).toMatchObject({ layer: 'base', ds: '@acme/ui', kind: 'actions' });
  });
});
