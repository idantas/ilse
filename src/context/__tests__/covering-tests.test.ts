import { describe, it, expect } from 'vitest';
import { coveringTests } from '../covering-tests.js';

describe('coveringTests', () => {
  const tests = [
    { path: 'components/shell/UserFooter.test.tsx', source: "import { UserFooter } from './UserFooter'" },
    { path: 'components/shell/ShellNav.test.tsx', source: "import { ShellNav } from './ShellNav'\nimport { UserFooter } from '@/components/shell/UserFooter'" },
    { path: 'lib/nav.test.ts', source: "import { nav } from './nav'" },
  ];
  it('finds the test named after the file first, then the ones importing it', () => {
    expect(coveringTests('components/shell/UserFooter.tsx', tests)).toEqual(['components/shell/UserFooter.test.tsx', 'components/shell/ShellNav.test.tsx']);
  });
  it('does not take a longer name for the same one', () => {
    expect(coveringTests('lib/na.ts', tests)).toEqual([]);
  });
  it('says nothing for index files', () => {
    expect(coveringTests('components/index.ts', tests)).toEqual([]);
  });
});
