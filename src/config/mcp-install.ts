/**
 * `ilse mcp install` — put Ilse's MCP server in each agent's own settings.
 *
 * Every agent gets the stdio bridge (`ilse-mcp`), never the HTTP address: the
 * port and token change per run and per project, the bridge finds the `ilse`
 * running in the agent's project by itself. Installed once per machine, so a
 * session opened before `ilse` ran in a new project still gets Ilse's
 * instructions (call ilse_changes before a commit).
 *
 * Only Ilse's own entry is touched. A settings file that doesn't parse is left
 * alone and reported, never rewritten.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const MCP_COMMAND = 'npx';
export const MCP_ARGS = ['-y', '-p', 'ilse-design@latest', 'ilse-mcp'];

export type McpAgent = 'claude-code' | 'claude-desktop' | 'cursor' | 'codex' | 'gemini';
export const MCP_AGENTS: McpAgent[] = ['claude-code', 'claude-desktop', 'cursor', 'codex', 'gemini'];

export interface Env { home: string; platform: NodeJS.Platform; appData?: string }

const defaultEnv = (): Env => ({ home: homedir(), platform: process.platform, appData: process.env.APPDATA });

/** The settings file an agent reads its MCP servers from (Claude Code: through its own CLI) */
export function settingsFile(agent: Exclude<McpAgent, 'claude-code'>, env: Env = defaultEnv()): string {
  switch (agent) {
    case 'claude-desktop':
      return env.platform === 'darwin' ? join(env.home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : env.platform === 'win32' ? join(env.appData ?? join(env.home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
        : join(env.home, '.config', 'Claude', 'claude_desktop_config.json');
    case 'cursor': return join(env.home, '.cursor', 'mcp.json');
    case 'codex': return join(env.home, '.codex', 'config.toml');
    case 'gemini': return join(env.home, '.gemini', 'settings.json');
  }
}

function onPath(bin: string): boolean {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Agents that look installed: their CLI on PATH, or their settings folder */
export function detectMcpAgents(env: Env = defaultEnv()): McpAgent[] {
  return MCP_AGENTS.filter(a => a === 'claude-code' ? onPath('claude') : existsSync(dirname(settingsFile(a, env))));
}

// ── JSON settings (Claude Desktop, Cursor, Gemini) ─────────────────────────

export function withJsonEntry(text: string | null, install: boolean): string {
  const data = text?.trim() ? JSON.parse(text) as Record<string, unknown> : {};
  const servers = { ...(data.mcpServers as Record<string, unknown> | undefined) };
  if (install) servers.ilse = { command: MCP_COMMAND, args: MCP_ARGS };
  else delete servers.ilse;
  return JSON.stringify({ ...data, mcpServers: servers }, null, 2) + '\n';
}

// ── TOML settings (Codex) ───────────────────────────────────────────────────

const TOML_HEADER = '[mcp_servers.ilse]';

/** Ilse's table out of a TOML file: from its header to the next table header */
function withoutTomlEntry(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inIlse = false;
  for (const line of lines) {
    const header = /^\s*\[/.test(line);
    if (header) inIlse = line.trim() === TOML_HEADER || line.trim().startsWith('[mcp_servers.ilse.');
    if (!inIlse) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function withTomlEntry(text: string | null, install: boolean): string {
  const rest = withoutTomlEntry(text ?? '').trimEnd();
  if (!install) return rest ? rest + '\n' : '';
  const block = [TOML_HEADER, `command = "${MCP_COMMAND}"`, `args = [${MCP_ARGS.map(a => `"${a}"`).join(', ')}]`].join('\n');
  return (rest ? rest + '\n\n' : '') + block + '\n';
}

// ── Install / uninstall ─────────────────────────────────────────────────────

export interface McpResult { agent: McpAgent; ok: boolean; where: string; error?: string; preview?: string }

const claudeArgs = (install: boolean) => install
  ? ['mcp', 'add', '--scope', 'user', 'ilse', '--', MCP_COMMAND, ...MCP_ARGS]
  : ['mcp', 'remove', '--scope', 'user', 'ilse'];

/** Install (or remove) Ilse in one agent. `dryRun`: say what would change, change nothing. */
export function applyMcp(agent: McpAgent, install: boolean, dryRun = false, env: Env = defaultEnv()): McpResult {
  if (agent === 'claude-code') {
    const args = claudeArgs(install);
    const where = `claude ${args.join(' ')}`;
    if (dryRun) return { agent, ok: true, where, preview: where };
    try {
      // `add` fails when it's already there: replace it, so a reinstall picks up a new command
      if (install) { try { execFileSync('claude', claudeArgs(false), { stdio: 'ignore' }); } catch { /* wasn't there */ } }
      execFileSync('claude', args, { stdio: 'pipe' });
      return { agent, ok: true, where };
    } catch (err) {
      const msg = (err as { stderr?: Buffer }).stderr?.toString().trim() || (err as Error).message;
      return { agent, ok: false, where, error: msg.split('\n')[0] };
    }
  }
  const file = settingsFile(agent, env);
  let before: string | null = null;
  try { before = readFileSync(file, 'utf8'); } catch { /* no file yet */ }
  let after: string;
  try {
    after = agent === 'codex' ? withTomlEntry(before, install) : withJsonEntry(before, install);
  } catch {
    return { agent, ok: false, where: file, error: 'settings file is not valid JSON — left untouched' };
  }
  // Only Ilse's own entry: the rest of the file is the user's business
  const entry = agent === 'codex' ? withTomlEntry('', true).trim() : JSON.stringify({ ilse: { command: MCP_COMMAND, args: MCP_ARGS } }, null, 2);
  if (dryRun) return { agent, ok: true, where: file, preview: install ? entry : `− ilse` };
  if (!install && before === null) return { agent, ok: true, where: file };
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, after, 'utf8');
    return { agent, ok: true, where: file };
  } catch (err) {
    return { agent, ok: false, where: file, error: (err as Error).message };
  }
}
