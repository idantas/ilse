import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quickBlocker, buildQuickPrompt, QUICK_SCHEMA } from '../quick-edit.js';
import { locateSource, clearLocateCache } from '../../context/locate.js';
import type { Annotation } from '../../types.js';

const CARD = `export function Card() {
  return <div className="flex flex-col gap-3 p-4 rounded-lg">x</div>;
}
`;

function setup(): { cwd: string; ann: (extra?: Partial<Annotation>) => Annotation } {
  const cwd = mkdtempSync(join(tmpdir(), 'ilse-quick-'));
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { tailwindcss: '^4' } }));
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src/Card.tsx'), CARD);
  clearLocateCache();
  const source = locateSource({ element: 'div.flex.flex-col.gap-3' }, { cwd });
  return {
    cwd,
    ann: (extra = {}) => ({
      id: 'q1', note: '', element: 'div.flex.flex-col.gap-3', styles: {}, status: 'pending', timestamp: '',
      intent: 'fix', designerNote: 'mais espaço entre os itens', source, ...extra,
    } as Annotation),
  };
}

describe('quick path', () => {
  it('takes located class changes, leaves the rest to the agent', () => {
    const { cwd, ann } = setup();
    expect(quickBlocker(ann(), cwd, {})).toBeNull();
    expect(quickBlocker(ann(), cwd, { ILSE_QUICK: '0' })).toBe('desligado');
    // Removing is structural: always the agent
    expect(quickBlocker(ann({ remove: true }), cwd, {})).toBe('remover elemento');
    expect(quickBlocker(ann({ textEdit: { from: 'a', to: 'b' } }), cwd, {})).toBe('texto');
    expect(quickBlocker(ann({ intent: 'create' }), cwd, {})).toBe('intent create');
    expect(quickBlocker(ann({ imageRefs: ['data:'] }), cwd, {})).toBe('tem imagem');
    expect(quickBlocker(ann({ designerNote: undefined }), cwd, {})).toBe('sem pedido');
    // An older toolbar sends only `note` — still quick
    expect(quickBlocker(ann({ designerNote: undefined, note: 'mais espaço' }), cwd, {})).toBeNull();
    expect(quickBlocker(ann({ source: undefined }), cwd, {})).toBe('elemento não localizado');
  });

  it('prompt carries the code, the classes, the note and the escape hatch', () => {
    const { cwd, ann } = setup();
    const p = buildQuickPrompt(ann(), cwd, ['primary', 'muted-foreground']);
    expect(p).toContain('src/Card.tsx:2');
    expect(p).toContain('Its static classes now: flex flex-col gap-3 p-4 rounded-lg');
    expect(p).toContain('mais espaço entre os itens');
    expect(p).toContain('primary, muted-foreground');
    expect(p).toContain('needsAgent: true');
    expect(JSON.parse(QUICK_SCHEMA).required).toEqual(['remove', 'add', 'needsAgent']);
  });
});

describe('quick path — structural notes go straight to the agent', () => {
  const notes: Array<[string, boolean]> = [
    ['remover o título e usar nomes das máquinas como títulos das abas', true],
    ['troque esse ícone pelo gauge', true],
    ['Transformar em carrossel com 20% de visibilidade', true],
    ['coloque a saudação com o nome do usuário', true],
    ['remove this badge', true],
    ['um pouco mais de espaço entre os itens', false],
    ['título mais forte e um pouco maior', false],
    ['texto menor e mais claro', false],
    ['cantos mais arredondados no botão', false],
  ];
  it.each(notes)('"%s" → structural: %s', (note, structural) => {
    const { cwd, ann } = setup();
    expect(quickBlocker(ann({ designerNote: note }), cwd, {}) === 'pedido estrutural').toBe(structural);
  });
});
