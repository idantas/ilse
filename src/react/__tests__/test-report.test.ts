import { describe, it, expect } from 'vitest';
import { summarize, shownGroups, groupOf, isError } from '../test-report.js';
import { parseOffer, duration } from '../test-setup.js';
import type { TestFinding, TestRunMeta } from '../test-findings.js';

const f = (o: Partial<TestFinding>): TestFinding => ({ id: Math.random().toString(36), category: 'layout', severity: 'medium', page: '/', viewport: 'desktop', title: 'x', rule: 'r', occurrences: 1, ...o });
const run = (o: Partial<TestRunMeta> = {}): TestRunMeta => ({ at: '2026-10-21T10:00:00Z', ms: 1000, groups: ['journeys', 'layout', 'consistency'], sizes: ['desktop'], pages: ['/'], ...o });

describe('test report', () => {
  it('errors are what breaks; repetition is counted apart', () => {
    const list = [f({ severity: 'high' }), f({ category: 'console', severity: 'high' }), f({ severity: 'low' }), f({ category: 'consistency', severity: 'medium' })];
    expect(summarize(list, run({ journeys: { total: 3, passed: 1, flaky: 1, stuck: 1, never: 0 } }))).toEqual({
      journeys: { ok: 2, total: 3 }, errors: 2, improvements: 1, repeated: 1,
    });
    expect(groupOf({ category: 'agent' })).toBe('accessibility');
    expect(isError({ severity: 'medium' })).toBe(false);
  });

  it('says what changed only when there was a test before', () => {
    expect(summarize([f({ status: 'new' })], run()).since).toBeUndefined();
    expect(summarize([f({ status: 'new' }), f({ status: 'returned' }), f({ status: 'known' })], run({ fixed: 2 })).since).toEqual({ new: 1, returned: 1, fixed: 2 });
    // Carried findings weren't tested this time: they don't count as new or known
    expect(summarize([f({ status: 'known', carried: true })], run()).since).toBeUndefined();
  });

  it('shows the groups tested, plus one that only carries findings from the run before', () => {
    expect(shownGroups([f({ category: 'agent', carried: true })], run({ groups: ['layout'] }))).toEqual(['accessibility', 'layout']);
    expect(shownGroups([f({ category: 'console' })], null)).toEqual(['errors']);
  });
});

describe('test setup', () => {
  it('keeps only known groups and sizes', () => {
    expect(parseOffer({ available: ['layout', 'x'], groups: ['layout'], sizes: ['mobile', 'tv'], askMobile: true, journeys: 2, lastMs: 3000 }))
      .toEqual({ available: ['layout'], groups: ['layout'], sizes: ['mobile'], askMobile: true, journeys: 2, lastMs: 3000 });
    expect(duration(48_000)).toBe('48 s');
    expect(duration(150_000)).toBe('3 min');
  });
});
