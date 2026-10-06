import { describe, it, expect } from 'vitest';
import { compareVersions, pickUpdate } from '../update-check.js';

describe('compareVersions', () => {
  it('orders releases and prereleases', () => {
    expect(compareVersions('0.5.0-beta.1', '0.5.0-beta.2')).toBeLessThan(0);
    expect(compareVersions('0.5.0-beta.10', '0.5.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('0.5.0-beta.3', '0.5.0')).toBeLessThan(0);
    expect(compareVersions('0.4.2', '0.5.0-beta.1')).toBeLessThan(0);
    expect(compareVersions('0.5.0', '0.5.0')).toBe(0);
  });
});

describe('pickUpdate', () => {
  const tags = { latest: '0.4.2', next: '0.5.0-beta.2' };
  it('a beta install follows next', () => {
    expect(pickUpdate('0.5.0-beta.1', tags)).toEqual({ version: '0.5.0-beta.2', tag: 'next' });
  });
  it('a beta install moves to the release once latest is newer', () => {
    expect(pickUpdate('0.5.0-beta.2', { latest: '0.5.0', next: '0.5.0-beta.2' })).toEqual({ version: '0.5.0', tag: 'latest' });
  });
  it('a stable install is never offered a beta', () => {
    expect(pickUpdate('0.4.2', tags)).toEqual({ version: '0.4.2', tag: 'latest' });
  });
});
