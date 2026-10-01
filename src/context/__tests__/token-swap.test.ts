import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planTokenSwap, planTextSwap, classFor, tokenSuffix } from '../token-swap.js';
import { locateSource, clearLocateCache } from '../locate.js';
import type { Annotation, StyleChange } from '../../types.js';

function project(files: Record<string, string>, tailwind = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'ilse-swap-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: tailwind ? { tailwindcss: '^4' } : {} }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

function annotation(cwd: string, element: string, changes: StyleChange[], text?: string): Annotation {
  clearLocateCache();
  const source = locateSource({ element, text }, { cwd });
  return {
    id: 'x1', note: '', element, styles: {}, status: 'pending', timestamp: '',
    intent: 'style', source, styleData: { selector: element, changes },
  };
}

const CARD = `export function Card() {
  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg bg-white">
      <button className={\`\${tone} px-4 py-2 font-medium\`}>Comprar</button>
    </div>
  );
}
`;

describe('classFor', () => {
  it('uses the default scale for spacing, weight, size and radius', () => {
    expect(classFor({ property: 'gap', from: '12px', to: '16px' })).toBe('gap-4');
    expect(classFor({ property: 'padding', from: '8px', to: '10px' })).toBe('p-2.5');
    expect(classFor({ property: 'fontWeight', from: '500', to: '600' })).toBe('font-semibold');
    expect(classFor({ property: 'fontSize', from: '16px', to: '18px' })).toBe('text-lg');
    expect(classFor({ property: 'borderRadius', from: '8px', to: '12px' })).toBe('rounded-xl');
  });

  it('maps named tokens and refuses raw colours', () => {
    expect(classFor({ property: 'backgroundColor', from: '', to: '#c1922e', token: 'color.color-ouro' })).toBe('bg-ouro');
    expect(classFor({ property: 'color', from: '', to: 'oklch(0.5 0.1 20)', token: 'color.primary' })).toBe('text-primary');
    expect(classFor({ property: 'backgroundColor', from: '', to: '#123456' })).toBeNull();
    expect(classFor({ property: 'gap', from: '', to: '13px' })).toBeNull();
  });

  it('never trusts a hand-typed value when tokens exist', () => {
    expect(classFor({ property: 'gap', from: '12px', to: '16px', offToken: true })).toBeNull();
  });

  it('scopes spacing tokens to their property', () => {
    expect(tokenSuffix('spacing.radius-lg', 'borderRadius')).toBe('lg');
    expect(tokenSuffix('spacing.radius-lg', 'padding')).toBeNull();
  });
});

describe('planTokenSwap', () => {
  it('swaps a class in a plain className', () => {
    const cwd = project({ 'src/Card.tsx': CARD });
    const res = planTokenSwap(annotation(cwd, 'div.flex.flex-col.gap-3', [{ property: 'gap', from: '12px', to: '16px' }]), cwd);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.after).toContain('className="flex flex-col p-4 rounded-lg bg-white gap-4"');
    expect(res.plan.edits[0]).toEqual({ property: 'gap', removed: ['gap-3'], added: 'gap-4' });
  });

  it('replaces px/py together when padding is set as one value', () => {
    const cwd = project({ 'src/Card.tsx': CARD });
    const ann = annotation(cwd, 'button.px-4.py-2.font-medium', [{ property: 'padding', from: '8px 16px', to: '12px' }], 'Comprar');
    const res = planTokenSwap(ann, cwd);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Template literal: the space after ${tone} must survive
    expect(res.plan.after).toContain('`${tone} font-medium p-3`');
  });

  it('applies several changes together', () => {
    const cwd = project({ 'src/Card.tsx': CARD });
    const res = planTokenSwap(annotation(cwd, 'div.flex.flex-col.gap-3', [
      { property: 'gap', from: '12px', to: '24px' },
      { property: 'borderRadius', from: '8px', to: '16px' },
    ]), cwd);
    expect(res.ok && res.plan.after).toContain('className="flex flex-col p-4 bg-white gap-6 rounded-2xl"');
  });

  it('falls back to the agent when anything is unsafe', () => {
    const cwd = project({ 'src/Card.tsx': CARD });
    const raw = annotation(cwd, 'div.flex.flex-col.gap-3', [{ property: 'backgroundColor', from: '#fff', to: '#fafafa' }]);
    expect(planTokenSwap(raw, cwd)).toEqual({ ok: false, reason: expect.stringContaining('backgroundColor') });

    const noTw = project({ 'src/Card.tsx': CARD }, false);
    expect(planTokenSwap(annotation(noTw, 'div.flex.flex-col.gap-3', [{ property: 'gap', from: '12px', to: '16px' }]), noTw))
      .toEqual({ ok: false, reason: 'projeto sem Tailwind' });
  });

  it('ignores variant classes like md:gap-8', () => {
    const cwd = project({ 'src/A.tsx': 'export const A = () => <ul className="grid gap-2 md:gap-8">x</ul>;\n' });
    const res = planTokenSwap(annotation(cwd, 'ul.grid.gap-2', [{ property: 'gap', from: '8px', to: '12px' }]), cwd);
    expect(res.ok && res.plan.after).toContain('className="grid md:gap-8 gap-3"');
  });
});

describe('classFor — layout', () => {
  it('maps flow and alignment keywords to one class each', () => {
    expect(classFor({ property: 'display', from: 'block', to: 'flex' })).toBe('flex');
    expect(classFor({ property: 'flexDirection', from: 'row', to: 'column' })).toBe('flex-col');
    expect(classFor({ property: 'justifyContent', from: '', to: 'space-between' })).toBe('justify-between');
    expect(classFor({ property: 'alignItems', from: '', to: 'flex-end' })).toBe('items-end');
    expect(classFor({ property: 'flexWrap', from: 'nowrap', to: 'wrap' })).toBe('flex-wrap');
  });

  it('maps scale tokens to the step class', () => {
    expect(classFor({ property: 'gap', from: '8px', to: '12px', token: 'spacing.spacing-3' })).toBe('gap-3');
    expect(classFor({ property: 'padding', from: '8px', to: '10px', token: 'spacing.spacing-2.5' })).toBe('p-2.5');
    expect(classFor({ property: 'borderRadius', from: '6px', to: '8px', token: 'spacing.radius-lg' })).toBe('rounded-lg');
  });
});

describe('classFor — sizing', () => {
  it('maps Fixed / Hug / Fill to w-/h- and flex-1', () => {
    expect(classFor({ property: 'width', from: '989px', to: '100%' })).toBe('w-full');
    expect(classFor({ property: 'width', from: '989px', to: 'fit-content' })).toBe('w-fit');
    expect(classFor({ property: 'width', from: '989px', to: '320px' })).toBe('w-80');
    expect(classFor({ property: 'width', from: '989px', to: '893px' })).toBe('w-[893px]');
    expect(classFor({ property: 'height', from: '', to: '50%' })).toBe('h-[50%]');
    expect(classFor({ property: 'flexGrow', from: '0', to: '1' })).toBe('flex-1');
    expect(classFor({ property: 'flexGrow', from: '1', to: '0' })).toBe('grow-0');
  });
});

describe('classFor — padding/margin per axis and side', () => {
  it('maps longhands to their prefix, margins take auto and negatives', () => {
    expect(classFor({ property: 'paddingInline', from: '8px', to: '16px' })).toBe('px-4');
    expect(classFor({ property: 'paddingTop', from: '', to: '12px', token: 'spacing.spacing-3' })).toBe('pt-3');
    expect(classFor({ property: 'paddingLeft', from: '', to: '23px' })).toBe('pl-[23px]');
    expect(classFor({ property: 'margin', from: '', to: 'auto' })).toBe('m-auto');
    expect(classFor({ property: 'marginTop', from: '', to: '-8px' })).toBe('-mt-2');
    expect(classFor({ property: 'marginBlock', from: '', to: '0px' })).toBe('my-0');
  });
});

describe('classFor — stroke', () => {
  it('maps weight, sides and style', () => {
    expect(classFor({ property: 'borderWidth', from: '0px', to: '1px' })).toBe('border');
    expect(classFor({ property: 'borderWidth', from: '1px', to: '2px' })).toBe('border-2');
    expect(classFor({ property: 'borderWidth', from: '1px', to: '0px' })).toBe('border-0');
    expect(classFor({ property: 'borderBottomWidth', from: '0px', to: '1px' })).toBe('border-b');
    expect(classFor({ property: 'borderTopWidth', from: '1px', to: '3px' })).toBe('border-t-[3px]');
    expect(classFor({ property: 'borderStyle', from: 'solid', to: 'dashed' })).toBe('border-dashed');
  });
});

import { planClassEdit } from '../token-swap.js';

describe('planClassEdit (quick path)', () => {
  it('removes and adds classes on the located element only', () => {
    const cwd = project({ 'src/Card.tsx': CARD });
    const a = annotation(cwd, 'div.flex.flex-col.gap-3', [], undefined);
    const res = planClassEdit(a, cwd, ['gap-3'], ['gap-4']);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.after).toContain('className="flex flex-col p-4 rounded-lg bg-white gap-4"');
  });

  it('refuses classes that are not there, or that are not classes', () => {
    const cwd = project({ 'src/Card.tsx': CARD });
    const a = annotation(cwd, 'div.flex.flex-col.gap-3', [], undefined);
    expect(planClassEdit(a, cwd, ['gap-9'], ['gap-4'])).toMatchObject({ ok: false });
    expect(planClassEdit(a, cwd, [], ['gap-4; rm -rf'])).toMatchObject({ ok: false, reason: 'classe inválida' });
    expect(planClassEdit(a, cwd, [], [])).toMatchObject({ ok: false });
  });
});

describe('planClassEdit — element without className', () => {
  it('adds the attribute instead of giving up', () => {
    const cwd = project({ 'src/List.tsx': `export function List() {\n  return <ul><li>primeiro item</li></ul>;\n}\n` });
    const a = annotation(cwd, 'li', [], 'primeiro item');
    const res = planClassEdit(a, cwd, [], ['px-2', 'py-1']);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.after).toContain('<li className="px-2 py-1">primeiro item</li>');
    expect(planClassEdit(a, cwd, ['gap-2'], ['gap-3'])).toMatchObject({ ok: false });
  });
});

describe('planTextSwap', () => {
  const textAnn = (cwd: string, element: string, from: string, to: string): Annotation => {
    clearLocateCache();
    return {
      id: 't1', note: '', element, styles: {}, status: 'pending', timestamp: '',
      intent: 'fix', source: locateSource({ element, text: from }, { cwd }), textEdit: { from, to },
    };
  };

  it('rewrites plain JSX text, keeping the indentation', () => {
    const cwd = project({ 'src/Plans.tsx': `export function Plans() {
  return (
    <h2 className="text-xl">
      Escolha seu plano
    </h2>
  );
}
` });
    const res = planTextSwap(textAnn(cwd, 'h2.text-xl', 'Escolha seu plano', 'Planos'), cwd);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.after).toContain('<h2 className="text-xl">\n      Planos\n    </h2>');
  });

  it('writes characters JSX would read as code as a string', () => {
    const cwd = project({ 'src/Card.tsx': CARD });
    const res = planTextSwap(textAnn(cwd, 'button.px-4', 'Comprar', 'Comprar {agora}'), cwd);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.after).toContain('>{"Comprar {agora}"}</button>');
  });

  it('hands text from an expression to the agent', () => {
    const cwd = project({ 'src/Title.tsx': `export function Title({ label }: { label: string }) {
  return <h1 className="font-bold">{label}</h1>;
}
` });
    const res = planTextSwap(textAnn(cwd, 'h1.font-bold', 'Olá', 'Oi'), cwd);
    expect(res.ok).toBe(false);
  });
});
