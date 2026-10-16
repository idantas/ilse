import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { proEntry } from '../load.js';

describe('proEntry', () => {
  it('looks in ~/.ilse/pro/current by default', () => {
    expect(proEntry({}, '/home/dev')).toBe(join('/home/dev', '.ilse', 'pro', 'current', 'index.js'));
  });

  it('ILSE_PRO points somewhere else, for development', () => {
    expect(proEntry({ ILSE_PRO: '/work/ilse-pro/dist/index.js' }, '/home/dev')).toBe('/work/ilse-pro/dist/index.js');
  });
});
