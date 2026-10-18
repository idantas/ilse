import { describe, it, expect } from 'vitest';
import {
  parseTsc, relevantTypeErrors, newTypeErrors, parseTestJson, newTestFailures, weakenedTests,
  globToRegExp, protectedEdits, readProtected, checkRepairPrompt, emptyReport, hasProblems,
} from '../project-check.js';

describe('parseTsc', () => {
  it('reads errors and keeps their continuation lines', () => {
    const out = [
      "components/a.tsx(384,70): error TS2322: Type '{ x: 1 }' is not assignable.",
      "  Property 'labelClassName' does not exist.",
      'components/ui/button.tsx(160,7): error TS2339: Property \'labelClassName\' does not exist on type \'ButtonProps\'.',
      'Found 2 errors.',
    ].join('\n');
    const errors = parseTsc(out);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ file: 'components/a.tsx', line: 384, column: 70, code: 'TS2322' });
    expect(errors[0].message).toContain("labelClassName' does not exist");
    expect(errors[1]).toMatchObject({ file: 'components/ui/button.tsx', line: 160, code: 'TS2339' });
  });
});

describe('relevantTypeErrors', () => {
  const err = (file: string) => ({ file, line: 1, column: 1, code: 'TS1', message: 'x' });
  it('keeps errors in changed files and in files importing them', () => {
    const sources: Record<string, string> = {
      'app/screen.tsx': "import { Button } from '@/components/ui/button'",
      'app/other.tsx': "import { Card } from '@/components/ui/card'",
    };
    const kept = relevantTypeErrors([err('components/ui/button.tsx'), err('app/screen.tsx'), err('app/other.tsx')], ['components/ui/button.tsx'], f => sources[f] ?? null);
    expect(kept.map(e => e.file)).toEqual(['components/ui/button.tsx', 'app/screen.tsx']);
  });
});

describe('newTypeErrors', () => {
  it('matches an old error even when its line moved', () => {
    const before = [{ file: 'a.ts', line: 3, column: 1, code: 'TS2339', message: 'nope' }];
    const after = [{ file: 'a.ts', line: 9, column: 1, code: 'TS2339', message: 'nope' }, { file: 'a.ts', line: 10, column: 1, code: 'TS2322', message: 'new' }];
    expect(newTypeErrors(after, before).map(e => e.code)).toEqual(['TS2322']);
  });
});

describe('parseTestJson', () => {
  it('reads failed assertions and files that did not load, relative to the root', () => {
    const json = JSON.stringify({ testResults: [
      { name: '/p/lib/rows.test.ts', status: 'failed', assertionResults: [
        { status: 'failed', title: 'keeps ten', ancestorTitles: ['rows'], failureMessages: ['\x1b[31mAssertionError: expected 10 to be 11\x1b[39m\n    at foo (/p/node_modules/x.js:1:1)'] },
        { status: 'passed', title: 'ok', ancestorTitles: [] },
      ] },
      { name: '/p/app/x.test.tsx', status: 'failed', message: 'Cannot find module ./gone', assertionResults: [] },
    ] });
    expect(parseTestJson(json, '/p')).toEqual([
      { file: 'lib/rows.test.ts', name: 'rows > keeps ten', message: 'AssertionError: expected 10 to be 11' },
      { file: 'app/x.test.tsx', name: '(file)', message: 'Cannot find module ./gone' },
    ]);
  });
  it('is empty for output that is not JSON', () => {
    expect(parseTestJson('boom', '/p')).toEqual([]);
  });
});

describe('newTestFailures', () => {
  it('drops what already failed before the change', () => {
    const old = [{ file: 'a.test.ts', name: 'x', message: '' }];
    const now = [{ file: 'a.test.ts', name: 'x', message: 'still' }, { file: 'a.test.ts', name: 'y', message: 'new' }];
    expect(newTestFailures(now, old).map(f => f.name)).toEqual(['y']);
  });
});

describe('weakenedTests', () => {
  const before = "it('a', () => { expect(1).toBe(1) })\nit('b', () => { expect(2).toBe(2) })";
  it('passes a test whose expected value changed', () => {
    expect(weakenedTests([{ path: 'a.test.ts', before, after: before.replace('toBe(2)', 'toBe(3)') }])).toEqual([]);
  });
  it('flags a removed assertion, a removed test and a new skip', () => {
    expect(weakenedTests([{ path: 'a.test.ts', before, after: "it('a', () => { expect(1).toBe(1) })\nit('b', () => {})" }])).toEqual(['a.test.ts']);
    expect(weakenedTests([{ path: 'b.spec.tsx', before, after: "it('a', () => { expect(1).toBe(1); expect(2).toBe(2) })" }])).toEqual(['b.spec.tsx']);
    expect(weakenedTests([{ path: 'c.test.ts', before, after: before.replace("it('b'", "it.skip('b'") }])).toEqual(['c.test.ts']);
  });
  it('ignores files that are not tests, and new test files', () => {
    expect(weakenedTests([{ path: 'a.ts', before, after: '' }, { path: 'n.test.ts', before: null, after: '' }])).toEqual([]);
  });
});

describe('protected paths', () => {
  it('matches globs and bare folders', () => {
    expect(globToRegExp('components/ui/**').test('components/ui/button.tsx')).toBe(true);
    expect(globToRegExp('components/ui/**').test('components/uix/button.tsx')).toBe(false);
    expect(globToRegExp('**/*.css').test('styles/a/b.css')).toBe(true);
    expect(globToRegExp('*.css').test('styles/b.css')).toBe(false);
    expect(globToRegExp('vendor').test('vendor/lib/x.js')).toBe(true);
  });
  it('lists changed files under a protected path, with the project\'s note', () => {
    const rules = readProtected(['vendor/**', { path: 'components/ui/**', note: 'patch it' }, 3]);
    const hits = protectedEdits([{ path: 'components/ui/badge.tsx', before: 'a', after: 'b' }, { path: 'lib/x.ts', before: 'a', after: 'b' }], rules);
    expect(hits).toEqual([{ file: 'components/ui/badge.tsx', note: 'patch it' }]);
  });
});

describe('checkRepairPrompt', () => {
  it('names what broke and how to tell a test to update from code to fix', () => {
    const report = { ...emptyReport(), testFailures: [{ file: 'lib/rows.test.ts', name: 'audit > caps at 100', message: 'expected 10 to be 100' }] };
    expect(hasProblems(report)).toBe(true);
    const prompt = checkRepairPrompt(report);
    expect(prompt).toContain('lib/rows.test.ts › audit > caps at 100');
    expect(prompt).toContain('expected 10 to be 100');
    expect(prompt).toMatch(/behaviour.*fix the code/);
    expect(prompt).toMatch(/Never delete, skip or loosen/);
  });
});
