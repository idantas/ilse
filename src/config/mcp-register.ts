import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Result } from '../types.js';

const CLAUDE_CONFIG_DIR = join(homedir(), '.claude');
const CLAUDE_MCP_FILE = join(CLAUDE_CONFIG_DIR, 'mcp_servers.json');

const ILSE_MCP_ENTRY = {
  command: 'npx',
  args: ['-y', '-p', 'ilse-design@latest', 'ilse-mcp'],
  env: {},
};

export function isClaudeInstalled(): boolean {
  return existsSync(CLAUDE_CONFIG_DIR);
}

export function isAlreadyRegistered(): boolean {
  if (!existsSync(CLAUDE_MCP_FILE)) return false;

  try {
    const data = JSON.parse(readFileSync(CLAUDE_MCP_FILE, 'utf-8'));
    return data?.mcpServers?.ilse !== undefined;
  } catch {
    return false;
  }
}

export function registerInClaude(): Result<'registered' | 'already_exists'> {
  if (!isClaudeInstalled()) {
    return { ok: false, error: 'Claude Code não encontrado' };
  }

  if (isAlreadyRegistered()) {
    return { ok: true, value: 'already_exists' };
  }

  try {
    let data: Record<string, unknown> = { mcpServers: {} };

    if (existsSync(CLAUDE_MCP_FILE)) {
      data = JSON.parse(readFileSync(CLAUDE_MCP_FILE, 'utf-8'));
      if (!data.mcpServers) data.mcpServers = {};
    }

    (data.mcpServers as Record<string, unknown>).ilse = ILSE_MCP_ENTRY;

    if (!existsSync(CLAUDE_CONFIG_DIR)) {
      mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true });
    }

    writeFileSync(CLAUDE_MCP_FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8');

    return { ok: true, value: 'registered' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
