/**
 * `ilse test` findings as the toolbar shows them: the ones for the page that's
 * open, and the note each becomes when the dev hands it to the agent.
 */

export interface TestFinding {
  id: string;
  category: string;
  severity: 'high' | 'medium' | 'low';
  /** '' for what lives only in the code (consistency not seen on any page) */
  page: string;
  viewport: 'desktop' | 'tablet' | 'mobile';
  title: string;
  detail?: string;
  selector?: string;
  rule: string;
  occurrences: number;
  /** Against the tests before: 'returned' was fixed and came back */
  status?: 'new' | 'known' | 'returned';
  /** Consistency: where in the code, the pages it showed on, the journeys through them, each class list it's written with */
  files?: { file: string; line: number }[];
  pages?: string[];
  journeys?: string[];
  classes?: string[];
  /** Kept from the test before: its group was off this time */
  carried?: boolean;
}

/** What the run tested (Pro's last-run.json), for the report's summary */
export interface TestRunMeta {
  at: string;
  ms: number;
  groups: string[];
  sizes: string[];
  pages: string[];
  fixed?: number;
  journeys?: { total: number; passed: number; stuck: number; flaky: number; never: number };
  journeyList?: { id: string; goal: string; desktop?: { outcome: string; step?: number; reason?: string }; mobile?: { outcome: string; step?: number; reason?: string } }[];
}

/** What travels with the note so the CLI can test the page again after the fix */
export interface TestFindingRef { id: string; page: string; category: string; selector?: string }

export function findingRef(f: TestFinding): TestFindingRef {
  return { id: f.id, page: f.page, category: f.category, ...(f.selector ? { selector: f.selector } : {}) };
}

/** Findings for this page: same path, and same query when the finding has one */
export function findingsForPage(findings: TestFinding[], pathname: string, search: string): TestFinding[] {
  return findings.filter(f => {
    const [path, query] = f.page.split('?');
    return path === pathname && (!query || `?${query}` === search);
  });
}

/** What the agent reads — the problem, why it matters, and that it came from a test */
export function findingNote(f: TestFinding): string {
  const where = f.viewport !== 'desktop' && f.occurrences === 1 ? ` (on ${f.viewport})` : '';
  const code = f.files?.length ? `In the code: ${f.files.slice(0, 8).map(x => `${x.file}:${x.line}`).join(', ')}.` : '';
  return [`Fix: ${f.title}${where}.`, f.detail, code, `Found by ilse test, rule ${f.rule}.`].filter(Boolean).join(' ');
}

/** The element a finding points at, when it's on the page */
export function findingElement(f: TestFinding, doc: Pick<Document, 'querySelector'> = document): Element | null {
  if (!f.selector) return null;
  try { return doc.querySelector(f.selector); } catch { return null; }
}
