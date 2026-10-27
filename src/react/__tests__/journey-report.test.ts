import { describe, it, expect } from 'vitest';
import { journeyFinding, journeyHtml, journeyLog, parseReport, seconds, type JourneyReport } from '../journey-report.js';

const step = (en: string, state: 'ok' | 'fail' | 'skipped', ms?: number) => ({ text: { pt: en, en }, state, ...(ms !== undefined ? { ms } : {}) });
const report: JourneyReport = {
  id: 'abc', goal: 'Create a client', start: '/clients',
  runs: [
    {
      at: '2026-10-26T18:00:00Z', ms: 4200, verdict: 'stuck',
      desktop: { outcome: 'passed', steps: [step('click the link "New"', 'ok', 300), step('see "Saved"', 'ok', 120)] },
      mobile: { outcome: 'stuck', step: 2, reason: 'no button "Save"', page: '/clients/new', steps: [step('click the link "New"', 'ok', 400), step('click the button "Save"', 'fail'), step('see "Saved"', 'skipped')], shot: 'data:image/jpeg;base64,AAA' },
    },
    { at: '2026-10-25T18:00:00Z', ms: 3000, verdict: 'passed', desktop: { outcome: 'passed', steps: [] } },
  ],
};

describe("a journey's report in the toolbar", () => {
  it('the log says each step, its time, and where and why it broke', () => {
    const log = journeyLog(report, report.runs[0], 'http://localhost:3000');
    expect(log).toContain('Journey: Create a client');
    expect(log).toContain('Starts at: http://localhost:3000/clients');
    expect(log).toContain('  ✓ 1. click the link "New" (0.3 s)');
    expect(log).toContain('Phone: stuck at step 2');
    expect(log).toContain('  ✗ 2. click the button "Save"');
    expect(log).toContain('  · 3. see "Saved"');
    expect(log).toContain('Why: no button "Save"');
    expect(log).toContain('Page: http://localhost:3000/clients/new');
  });

  it('stuck while recording: the log says no next step was found', () => {
    const r = { ...report.runs[0], mobile: undefined, desktop: { outcome: 'stuck' as const, step: 2, reason: 'agent gave up', steps: [step('a', 'ok', 10)] } };
    expect(journeyLog(report, r)).toContain('✗ 2. no next step found');
  });

  it('a stuck run becomes a finding on the page where it stopped, with the log', () => {
    const f = journeyFinding(report, report.runs[0])!;
    expect(f).toMatchObject({ category: 'journey', severity: 'high', page: '/clients/new', viewport: 'mobile', rule: 'journey-abc' });
    expect(f.detail).toContain('no button "Save"');
    expect(f.detail).toContain('✗ 2.');
    expect(journeyFinding(report, report.runs[1])).toBeNull();
  });

  it('the download is one page: steps, both screens, the screenshot, text escaped', () => {
    const html = journeyHtml({ ...report, goal: 'Create <b>' }, report.runs[0], { desktop: 'Desktop', mobile: 'Phone', why: 'Why' });
    expect(html).toContain('<title>Create &lt;b&gt;</title>');
    expect(html).toContain('Phone · stuck');
    expect(html).toContain('<img src="data:image/jpeg;base64,AAA"');
    expect(html).toContain('class="fail"');
  });

  it('seconds read short; a report without runs or id is refused', () => {
    expect(seconds(420)).toBe('0.4 s');
    expect(seconds(12_400)).toBe('12 s');
    expect(parseReport(report)?.id).toBe('abc');
    expect(parseReport({ goal: 'x' })).toBeNull();
    expect(parseReport(null)).toBeNull();
  });
});
