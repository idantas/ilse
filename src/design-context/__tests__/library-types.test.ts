import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declarationFile, libraryChoices } from '../library-types.js';

function project(files: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ilse-lib-'));
  for (const [path, code] of Object.entries(files)) {
    mkdirSync(join(cwd, path, '..'), { recursive: true });
    writeFileSync(join(cwd, path), code);
  }
  return cwd;
}

describe('library choices from .d.ts', () => {
  const cwd = project({
    'node_modules/@ui/kit/Button/Button.d.ts': `import { OverridableStringUnion } from '@ui/types';
import { Tone } from "../styles/tone.js";
export interface ButtonOwnProps {
  /**
   * The variant to use.
   * @default 'text'
   */
  variant?: OverridableStringUnion<'text' | 'outlined' | 'contained', {}>;
  tone?: Tone | 'inherit';
  disabled?: boolean;
  label?: string;
}`,
    'node_modules/@ui/kit/styles/tone.d.ts': `export type Tone = 'calm' | 'loud';`,
    'node_modules/antlike/es/tag/index.d.ts': `export * from './tag';`,
    'node_modules/antlike/es/tag/tag.d.ts': `type Size = 'small' | 'large';\nexport interface TagProps { size?: Size; closable?: boolean }`,
  });

  it('reads literal unions, through wrappers and imported aliases', () => {
    expect(declarationFile(cwd, '@ui/kit', 'Button')).toMatch(/Button\/Button\.d\.ts$/);
    expect(Object.fromEntries(libraryChoices(cwd, '@ui/kit', 'Button'))).toEqual({
      variant: { values: ['text', 'outlined', 'contained'], def: 'text' },
      tone: { values: ['calm', 'loud', 'inherit'] },
    });
  });

  it('follows an index that only re-exports; nothing for an unknown layout', () => {
    expect(Object.fromEntries(libraryChoices(cwd, 'antlike', 'Tag'))).toEqual({ size: { values: ['small', 'large'] } });
    expect(libraryChoices(cwd, 'missing-lib', 'Button').size).toBe(0);
  });
});
