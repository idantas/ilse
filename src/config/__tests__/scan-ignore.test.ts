import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureScanIgnore } from '../scan-ignore.js';

describe('ensureScanIgnore', () => {
  it('writes .ilse/.ignore once and never overwrites the one there', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-ign-'));
    ensureScanIgnore(cwd);
    expect(readFileSync(join(cwd, '.ilse/.ignore'), 'utf8')).toMatch(/^\*$/m);
    writeFileSync(join(cwd, '.ilse/.ignore'), 'mine\n');
    ensureScanIgnore(cwd);
    expect(readFileSync(join(cwd, '.ilse/.ignore'), 'utf8')).toBe('mine\n');
  });
});
