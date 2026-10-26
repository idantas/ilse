import { describe, it, expect } from 'vitest';
import { ago } from '../memory-panel.js';
import { setLocale } from '../../i18n/index.js';

describe('ago', () => {
  const now = Date.parse('2026-10-18T12:00:00.000Z');
  it('says how long ago, short', () => {
    setLocale('pt');
    expect(ago('2026-10-18T11:59:40.000Z', now)).toBe('agora');
    expect(ago('2026-10-18T11:55:00.000Z', now)).toBe('há 5 min');
    expect(ago('2026-10-18T09:00:00.000Z', now)).toBe('há 3 h');
    expect(ago('2026-10-17T10:00:00.000Z', now)).toBe('ontem');
    expect(ago('2026-10-15T12:00:00.000Z', now)).toBe('há 3 dias');
    expect(ago('2026-10-01T12:00:00.000Z', now)).toBe('01/10');
    expect(ago('nope', now)).toBe('');
  });
});

describe('journeys line', () => {
  it('leaves out zeros; nothing with no journeys', async () => {
    const { journeysLine } = await import('../memory-panel.js');
    const { setLocale } = await import('../../i18n/index.js');
    setLocale('pt');
    expect(journeysLine({ total: 6, passed: 4, stuck: 1, flaky: 1, never: 0 })).toBe('Jornadas: 4 passam · 1 travou · 1 intermitente');
    expect(journeysLine({ total: 0, passed: 0, stuck: 0, flaky: 0, never: 0 })).toBeNull();
    expect(journeysLine(undefined)).toBeNull();
  });
});
