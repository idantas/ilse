import { describe, it, expect, beforeAll } from 'vitest';
import { journeyLine, type JourneySummary } from '../journeys-panel.js';
import { setLocale } from '../../i18n/index.js';

const j = (last: JourneySummary['last']): JourneySummary => ({ id: 'a', goal: 'g', start: '/', steps: 3, mobileVariant: false, last });

beforeAll(() => setLocale('pt'));

describe('journey result line', () => {
  it('never ran, passed with its time', () => {
    expect(journeyLine(j(null))).toEqual({ text: 'nunca rodou', ok: null });
    expect(journeyLine(j({ at: '', ms: 12_300, desktop: { outcome: 'passed' }, mobile: { outcome: 'passed' } }))).toEqual({ text: 'passou · 12s', ok: true });
  });
  it('broke on one screen: that one first, and the whole is red', () => {
    const line = journeyLine(j({ at: '', ms: 41_000, desktop: { outcome: 'passed' }, mobile: { outcome: 'stuck', step: 1, reason: 'coberto pelo <main>' } }));
    expect(line).toEqual({ text: 'no celular: travou no passo 1: coberto pelo <main> · no computador: passou', ok: false });
  });
  it('the reasons Ilse stopped read as such', () => {
    expect(journeyLine(j({ at: '', ms: 1, desktop: { outcome: 'stuck', why: 'safety', reason: 'Excluir' } })).text).toBe('parei antes de clicar em "Excluir"');
    expect(journeyLine(j({ at: '', ms: 1, desktop: { outcome: 'stuck', why: 'no-agent' } })).text).toBe('precisa do Claude Code para gravar');
  });
});
