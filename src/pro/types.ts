/**
 * The seam between Ilse and Ilse Pro. The core knows these shapes and nothing
 * else of Pro: no test runner, no memory, no browser. Without Pro installed
 * every hook here is absent and the toolbar shows test mode asleep.
 *
 * Bump PLUGIN_API when a shape changes in a way an older Pro can't handle.
 */

import type { Command } from 'commander';

export const PLUGIN_API = 1;

export type Decision = 'approved' | 'discarded';

export type TestAction = 'run' | 'run-anon' | 'login' | 'login-done' | 'login-cancel' | 'setup';

/** What a test run checks, picked in the toolbar before it starts */
export type TestGroup = 'journeys' | 'accessibility' | 'errors' | 'layout' | 'consistency';
export type ScreenSize = 'desktop' | 'tablet' | 'mobile';
export interface TestRunOptions { groups?: TestGroup[]; sizes?: ScreenSize[] }

/** Something the code repeats or does many ways (the core's src/design-context), for test mode's Consistency group */
export interface ConsistencyItem {
  /** Stable across runs: the structure, not the file */
  key: string;
  kind: 'repeated' | 'family' | 'tokens';
  title: { pt: string; en: string };
  detail: { pt: string; en: string };
  severity: 'medium' | 'low';
  occurrences: number;
  files: { file: string; line: number }[];
  /** repeated: each way it is written (the className), to find it on the pages */
  variants?: string[];
  /** A component the project already has that does this (packages/, components/ui) */
  existing?: string;
}

/** The latest test run, minus what the dev already decided */
export interface LiveFindings {
  at: string | null;
  findings: unknown[];
}

/** The toolbar's Journeys panel → Pro. Answers come back as journey_* messages */
export type JourneyAction =
  | { action: 'list' }
  | { action: 'add'; goal: string; start?: string }
  | { action: 'run'; id?: string }
  | { action: 'remove'; id: string }
  /** 3 to 5 journeys suggested from the code by the user's agent (journey_suggestions) */
  | { action: 'suggest' }
  /** Save to the project (.ilse/journeys.md) or take it out */
  | { action: 'share'; id: string; on: boolean }
  /** A destructive click the goal didn't ask for: may the journey go on? */
  | { action: 'confirm'; ok: boolean };

/** A finding the agent was handed, as much as a retest needs */
export interface RetestTarget { id: string; page: string; category?: string; selector?: string }

/** One question to the user's agent, no tools (see the core's src/agent/ask.ts). Rejects when there is no agent that can answer */
export type AskAgent = (prompt: string, opts?: { tier?: 'fast' | 'strong'; schema?: string; timeoutMs?: number }) => Promise<string>;

export interface ProContext {
  cwd: string;
  /** The user's language. Optional: an older core doesn't say */
  locale?: 'pt' | 'en';
  /** The code's repeated structures and loose values. Optional: an older core has none */
  consistency?: () => Promise<ConsistencyItem[]>;
  /** Optional: an older core has none, and journeys only replay */
  askAgent?: AskAgent;
  /** To every toolbar connected */
  send: (msg: Record<string, unknown>) => void;
  /** A line in the terminal. Known codes ('no-browser', 'login-saved', 'retest:F:S', 'summary:C:P:report') are translated by the core */
  log: (line: string, tone?: 'dim' | 'warn') => void;
}

/** What test mode remembers of the project, for the toolbar's memory screen */
export interface TestMemorySummary {
  runs: number;
  lastRunAt: string | null;
  /** Findings seen and not fixed yet, fixed ones, and fixed ones that came back */
  open: number;
  fixed: number;
  returned: { id: string; title: string; page: string }[];
  approved: number;
  /** What the dev asked to ignore: never shown again until they take it back */
  ignored: { id: string; title: string; page?: string; at: string }[];
  /** Per category: how often the dev agreed with the checks (category ids, the core names them) */
  byCategory: { category: string; approved: number; discarded: number }[];
  /** The journeys' last results. Optional: an older Pro has none */
  journeys?: { total: number; passed: number; stuck: number; flaky: number; never: number };
}

/**
 * The catalog in design mode is Pro: the list of the product's components,
 * their copies and dropping them on the page. Pro keeps the copies; the core
 * reads the code (the Component section stays free) and runs the insert engine
 * only when Pro is here.
 */
export interface ProCatalog {
  /** Copies of components seen on pages, by catalog id (HTML with styles inline) */
  snapshots: () => Record<string, unknown[]>;
  /** New copies the toolbar took on a page */
  saveSnapshots: (items: unknown[]) => void;
}

export interface ProServer {
  /** The license's plan ('owner', 'founder', …): the owner can view the toolbar as Free to test it */
  plan?: string;
  getFindings?: () => LiveFindings;
  /** The memory screen. Optional: an older Pro just has no test section there */
  getMemory?: () => TestMemorySummary;
  /** "Voltar a avisar": forget the dev's call on one finding */
  undoDecision?: (id: string) => boolean;
  /** Forget everything test mode remembers of this project */
  forgetMemory?: () => void;
  decideFinding?: (id: string, decision: Decision) => boolean;
  testControl?: (action: TestAction, origin: string, options?: TestRunOptions) => void;
  /** After the agent worked on findings from a test: check them again */
  retest?: (targets: RetestTarget[], origin: string) => void;
  /** Journeys from the toolbar. Optional: an older Pro has no Journeys panel */
  journeys?: (action: JourneyAction, origin: string) => void;
  /** The catalog. Optional: an older Pro has none, and the catalog shows locked */
  catalog?: ProCatalog;
}

/**
 * What the core lends Pro's CLI commands. Optional on purpose: a Pro written
 * before it existed still loads (same PLUGIN_API).
 */
export interface ProCore {
  /** The user's language, for Pro's own strings */
  locale: 'pt' | 'en';
  /** The core's strings, in the user's language (keys like `test.summary`) */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** The app's local address: given (URL or port), the port saved for this project, or a dev server found running */
  appUrl: (cwd: string, given?: string) => Promise<string | null>;
  /** The user's agent, run in `cwd`. Optional: an older core has none */
  askAgent?: (cwd: string, ...args: Parameters<AskAgent>) => Promise<string>;
  /** The code's repeated structures and loose values (test --only consistency). Optional: an older core has none */
  consistency?: (cwd: string) => Promise<ConsistencyItem[]>;
}

export interface ProPlugin {
  pluginApi: number;
  version: string;
  /** Extra CLI commands (e.g. `ilse test`) */
  registerCli?: (program: Command, core?: ProCore) => void;
  /** Hooks for the running `ilse` (bridge + toolbar) */
  server?: (ctx: ProContext) => ProServer;
}
