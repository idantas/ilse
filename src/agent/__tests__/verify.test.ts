import { describe, it, expect } from 'vitest';
import { syntaxBreaks, syntaxError, repairPrompt } from '../verify.js';

const BEFORE = `export function Row({ temAcao }: { temAcao: boolean }) {
  return (
    <tr>
      {temAcao ? (
        <td className="text-right">menu</td>
      ) : null}
    </tr>
  );
}
`;
// What the agent wrote in a real session: a JSX comment before the only element of `( … )`
const AFTER = BEFORE.replace('      {temAcao ? (\n', '      {temAcao ? (\n        {/* O menu não abre os detalhes */}\n');

describe('syntaxBreaks', () => {
  it('catches a JSX comment where only one element fits', () => {
    const breaks = syntaxBreaks([{ path: 'app/tela.tsx', before: BEFORE, after: AFTER }]);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].file).toBe('app/tela.tsx');
    expect(breaks[0].line).toBeGreaterThanOrEqual(5);
    expect(breaks[0].excerpt).toContain('>');
    expect(repairPrompt(breaks)).toContain('app/tela.tsx:');
  });

  it('passes valid edits, new files and non-code files', () => {
    expect(syntaxBreaks([
      { path: 'a.tsx', before: BEFORE, after: BEFORE.replace('menu', 'Menu') },
      { path: 'new.ts', before: null, after: 'export const x = <T,>(v: T) => v;\n' },
      { path: 'notes.md', before: '', after: '{ <' },
      { path: 'gone.tsx', before: BEFORE, after: null },
    ])).toEqual([]);
  });

  it('never blames the agent for syntax that was already there', () => {
    expect(syntaxBreaks([{ path: 'odd.tsx', before: 'const = ;', after: 'const = ; // still' }])).toEqual([]);
  });

  it('reads TypeScript generics in .ts without JSX', () => {
    expect(syntaxError('const v = <string>x;\n', 'cast.ts')).toBeNull();
  });
});
