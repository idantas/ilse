import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSetup } from '../check-run.js';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ilse-check-'));
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { vitest: '4', typescript: '5' } }));
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  for (const bin of ['tsc', 'vitest']) writeFileSync(join(dir, 'node_modules', '.bin', bin), '');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('checkSetup', () => {
  it('finds the typecheck and the test runner the project has', () => {
    const setup = checkSetup(dir, {}, undefined)!;
    expect(setup.typecheck).toEqual({ bin: join(dir, 'node_modules', '.bin', 'tsc') });
    expect(setup.tests).toMatchObject({ runner: 'vitest' });
  });
  it('has an off switch, and a types-only one', () => {
    expect(checkSetup(dir, {}, 'off')).toBeNull();
    const types = checkSetup(dir, {}, 'types')!;
    expect(types.tests).toBeNull();
    expect(types.typecheck).not.toBeNull();
  });
  it('takes the project\'s own commands and protected paths from .ilserc.json', () => {
    const setup = checkSetup(dir, { check: { typecheck: 'pnpm typecheck', test: false, timeoutMs: 5000 }, protected: ['components/ui/**'] }, undefined)!;
    expect(setup.typecheck).toEqual({ command: 'pnpm typecheck' });
    expect(setup.tests).toBeNull();
    expect(setup.timeoutMs).toBe(5000);
    expect(setup.protected).toEqual([{ path: 'components/ui/**' }]);
  });
  it('is null when there is nothing to check', () => {
    const empty = mkdtempSync(join(tmpdir(), 'ilse-check-empty-'));
    expect(checkSetup(empty, {}, undefined)).toBeNull();
    rmSync(empty, { recursive: true, force: true });
  });
});
