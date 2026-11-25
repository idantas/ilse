import { describe, expect, it } from 'vitest';
import { componentizeNote, kitFolderOf, parseComponentized } from '../componentize.js';

describe('componentizeNote', () => {
  it('names a hand-written element, the kit folder and the reply line', () => {
    const note = componentizeNote({ tag: 'button', text: 'Chamar o LLM', kitFolder: 'src/components/ui', locale: 'pt' });
    expect(note).toContain('this <button> ("Chamar o LLM")');
    expect(note).toContain('in src/components/ui/');
    expect(note).toContain('#<id>: component {"name"');
    expect(note).toContain('Brazilian Portuguese');
  });
  it('names a local component instead', () => {
    expect(componentizeNote({ tag: 'button', component: 'Button', locale: 'en' })).toContain('<Button> (declared in one file');
  });
});

describe('parseComponentized', () => {
  it('reads the agent line', () => {
    expect(parseComponentized('component {"name":"ActionButton","file":"src/ui/action-button.tsx","replaced":18,"whenToUse":"Ações secundárias.","avoid":""}'))
      .toEqual({ name: 'ActionButton', file: 'src/ui/action-button.tsx', replaced: 18, whenToUse: 'Ações secundárias.' });
  });
  it('ignores ordinary summaries and bad names', () => {
    expect(parseComponentized('Adjusted padding on Button')).toBeNull();
    expect(parseComponentized('component {"name":"not a name"}')).toBeNull();
    expect(parseComponentized('component {broken')).toBeNull();
    expect(parseComponentized(undefined)).toBeNull();
  });
});

describe('kitFolderOf', () => {
  it('prefers the base components folder', () => {
    expect(kitFolderOf([
      { source: 'src/components/ui/button.tsx', library: false, layer: 'base' },
      { source: 'src/components/ui/card.tsx', library: false, layer: 'base' },
      { source: 'src/features/keys/KeysTable.tsx', library: false, layer: 'product' },
      { source: 'src/features/keys/KeyRow.tsx', library: false, layer: 'product' },
      { source: 'src/features/keys/KeyForm.tsx', library: false, layer: 'product' },
      { source: '@mui/material', library: true },
    ])).toBe('src/components/ui');
  });
  it('is undefined without project components', () => {
    expect(kitFolderOf([{ source: '@mui/material', library: true }])).toBeUndefined();
  });
});
