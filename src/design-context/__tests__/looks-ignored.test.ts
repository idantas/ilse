import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ignoreLook, readIgnoredLooks, unignoreLook } from '../looks-ignored.js';

describe('ignored look-alikes', () => {
  it('kept in the project, once per look, and brought back', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-looks-'));
    expect(readIgnoredLooks(cwd)).toEqual([]);
    ignoreLook(cwd, 'chip:radius=pill', 'Chip “Lovable”');
    ignoreLook(cwd, 'chip:radius=pill', 'Chip “Lovable”');
    expect(readIgnoredLooks(cwd).map(x => x.id)).toEqual(['chip:radius=pill']);
    expect(unignoreLook(cwd, 'chip:radius=pill')).toEqual([]);
  });

  it('in a git repo, kept in .git/ilse — a file in the project reloads the dev server — and the old list still counts', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ilse-looks-git-'));
    execFileSync('git', ['init', '-q'], { cwd });
    mkdirSync(join(cwd, '.ilse'));
    writeFileSync(join(cwd, '.ilse', 'looks-ignored.json'), JSON.stringify([{ id: 'old', label: 'Old', at: '2026-11-01T00:00:00Z' }]));
    expect(readIgnoredLooks(cwd).map(x => x.id)).toEqual(['old']);
    ignoreLook(cwd, 'new', 'New');
    expect(existsSync(join(cwd, '.git', 'ilse', 'looks-ignored.json'))).toBe(true);
    expect(readIgnoredLooks(cwd).map(x => x.id)).toEqual(['old', 'new']);
  });
});
