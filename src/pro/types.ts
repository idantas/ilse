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

export interface ProServer {
  getFindings?: () => LiveFindings;
  decideFinding?: (id: string, decision: Decision) => boolean;
  testControl?: (action: TestAction, origin: string) => void;
  /** After the agent worked on findings from a test: check them again */
  retest?: (targets: RetestTarget[], origin: string) => void;
}

export interface ProPlugin {
  pluginApi: number;
  version: string;
  /** Extra CLI commands (e.g. `ilse test`) */
  registerCli?: (program: Command) => void;
  /** Hooks for the running `ilse` (bridge + toolbar) */
  server?: (ctx: ProContext) => ProServer;
}
