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

export type TestAction = 'run' | 'run-anon' | 'login' | 'login-done' | 'login-cancel';

/** The latest test run, minus what the dev already decided */
export interface LiveFindings {
  at: string | null;
  findings: unknown[];
}

/** A finding the agent was handed, as much as a retest needs */
export interface RetestTarget { id: string; page: string; category?: string; selector?: string }

export interface ProContext {
  cwd: string;
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
}

export interface ProServer {
  getFindings?: () => LiveFindings;
  /** The memory screen. Optional: an older Pro just has no test section there */
  getMemory?: () => TestMemorySummary;
  /** "Voltar a avisar": forget the dev's call on one finding */
  undoDecision?: (id: string) => boolean;
  /** Forget everything test mode remembers of this project */
  forgetMemory?: () => void;
  decideFinding?: (id: string, decision: Decision) => boolean;
  testControl?: (action: TestAction, origin: string) => void;
  /** After the agent worked on findings from a test: check them again */
  retest?: (targets: RetestTarget[], origin: string) => void;
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
}

export interface ProPlugin {
  pluginApi: number;
  version: string;
  /** Extra CLI commands (e.g. `ilse test`) */
  registerCli?: (program: Command, core?: ProCore) => void;
  /** Hooks for the running `ilse` (bridge + toolbar) */
  server?: (ctx: ProContext) => ProServer;
}
