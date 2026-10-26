/**
 * One question to the user's agent, no tools — what Pro's journeys use to pick
 * the next step on a page. The page goes in as text (its accessibility tree),
 * the answer comes back as text or, with a schema, as JSON.
 *
 * The AI is the user's (rule 1): it runs their agent CLI, on their account,
 * isolated like every other run. Claude only for now (it has --json-schema);
 * with another agent the call fails and the caller treats it as "no agent".
 */

import { execFile } from 'node:child_process';
import { detectAgent } from './executor.js';
import { isolatedEnv, modelTiers, resolveModel, type Tier } from './agent-profile.js';

export interface AskOptions {
  tier?: Exclude<Tier, 'default'>;
  /** JSON Schema of the answer; the reply is then that JSON, as a string */
  schema?: string;
  timeoutMs?: number;
}

export class AskError extends Error {}

export function askArgs(prompt: string, model: string | undefined, schema?: string): string[] {
  return [
    '-p', prompt,
    '--tools', '',
    '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config',
    ...(schema ? ['--json-schema', schema] : []),
    '--output-format', 'json',
    ...(model ? ['--model', model] : []),
  ];
}

/** The answer in Claude Code's `--output-format json` envelope */
export function readAnswer(stdout: string, schema: boolean): string {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(stdout) as Record<string, unknown>; } catch { throw new AskError('unreadable answer'); }
  if (raw.is_error) throw new AskError(typeof raw.result === 'string' ? raw.result.slice(0, 300) : 'agent error');
  if (schema) {
    if (raw.structured_output === undefined) throw new AskError('no structured answer');
    return JSON.stringify(raw.structured_output);
  }
  return typeof raw.result === 'string' ? raw.result : '';
}

export function askAgent(cwd: string, prompt: string, opts: AskOptions = {}): Promise<string> {
  const agent = detectAgent();
  if (agent.kind !== 'claude' || !agent.command) return Promise.reject(new AskError(`agent not supported: ${agent.kind}`));
  const model = resolveModel(opts.tier ?? 'strong', modelTiers(cwd, 'claude'));
  return new Promise((resolve, reject) => {
    execFile(agent.command!, askArgs(prompt, model, opts.schema), { cwd, env: isolatedEnv(), timeout: opts.timeoutMs ?? 90_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      try { resolve(readAnswer(stdout, !!opts.schema)); } catch (e) {
        reject(err && !stdout ? new AskError(err.message.split('\n')[0]) : e);
      }
    });
  });
}
