import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canViewAsFree, readViewAsFree, writeViewAsFree } from '../view-as.js';

describe('view as Free (owner)', () => {
  it('only the owner plan can switch Pro off', () => {
    expect(canViewAsFree('owner')).toBe(true);
    expect(canViewAsFree('founder')).toBe(false);
    expect(canViewAsFree(undefined)).toBe(false);
  });

  it('is off until written, and survives a restart', () => {
    const home = mkdtempSync(join(tmpdir(), 'ilse-view-as-'));
    expect(readViewAsFree(home)).toBe(false);
    writeViewAsFree(true, home);
    expect(readViewAsFree(home)).toBe(true);
    writeViewAsFree(false, home);
    expect(readViewAsFree(home)).toBe(false);
  });
});
