import { describe, it, expect } from 'vitest';
import { parseJourneyAction, parseTestOptions } from '../ws-server.js';

describe('journey messages from the page', () => {
  it('passes only the shapes Pro knows', () => {
    expect(parseJourneyAction({ action: 'add', goal: '  criar chave ', start: '/keys' })).toEqual({ action: 'add', goal: 'criar chave', start: '/keys' });
    expect(parseJourneyAction({ action: 'add', goal: '' })).toBeNull();
    expect(parseJourneyAction({ action: 'run' })).toEqual({ action: 'run', id: undefined });
    expect(parseJourneyAction({ action: 'remove' })).toBeNull();
    expect(parseJourneyAction({ action: 'confirm', ok: 'yes' })).toEqual({ action: 'confirm', ok: false });
    expect(parseJourneyAction({ action: 'shell', cmd: 'rm' })).toBeNull();
  });
  it('cuts long strings', () => {
    const a = parseJourneyAction({ action: 'add', goal: 'x'.repeat(1000) });
    expect(a && a.action === 'add' && a.goal.length).toBe(300);
  });
});

describe('test options from the page', () => {
  it('keeps known groups and sizes only', () => {
    expect(parseTestOptions({ groups: ['layout', 'shell', 'layout'], sizes: ['mobile', 'watch'] })).toEqual({ groups: ['layout'], sizes: ['mobile'] });
    expect(parseTestOptions(undefined)).toBeUndefined();
    expect(parseTestOptions({})).toEqual({});
  });
  it('journeys: suggest, and share needs an id', () => {
    expect(parseJourneyAction({ action: 'suggest' })).toEqual({ action: 'suggest' });
    expect(parseJourneyAction({ action: 'share', id: 'k1', on: true })).toEqual({ action: 'share', id: 'k1', on: true });
    expect(parseJourneyAction({ action: 'share' })).toBeNull();
  });
});
