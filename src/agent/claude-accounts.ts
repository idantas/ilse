/**
 * Which Claude account the agent runs on.
 *
 * Claude Code keeps one login per configuration directory (CLAUDE_CONFIG_DIR:
 * `~/.claude` by default, `~/.claude-work`… for others), so one machine can hold
 * a personal Pro and a work Team account side by side. Ilse spawns `claude` with
 * whatever the launching terminal had — a session once ran on a personal Pro
 * account and hit its limit while the Team account (the one the Desktop app
 * used) sat at 9%. Here the accounts are found, the designer picks one per
 * project, and that choice is what every run uses.
 */

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ClaudeAccount {
  /** null = the default directory (CLAUDE_CONFIG_DIR unset) */
  configDir: string | null;
  email?: string;
  plan?: string;
  org?: string;
}

// "Claude Pro", not "Pro": next to Ilse Pro, a bare "Pro" read as Ilse's own license
const PLAN: Record<string, string> = { pro: 'Claude Pro', max: 'Claude Max', team: 'Claude Team', enterprise: 'Claude Enterprise', free: 'Claude Free' };

/** "Claude Pro", "Claude Team (Acme)" — the plan the agent runs on */
export function planLabel(a: ClaudeAccount): string | undefined {
  const plan = a.plan ? PLAN[a.plan] ?? a.plan : undefined;
  const org = a.org && a.email && !a.org.includes(a.email) ? a.org : undefined;
  return plan && `${plan}${org ? ` (${org})` : ''}`;
}

export function describeAccount(a: ClaudeAccount): string {
  const plan = a.plan ? PLAN[a.plan] ?? a.plan : undefined;
  // Personal orgs are named after the email ("x@y's Organization") — not worth repeating
  const org = a.org && a.email && !a.org.includes(a.email) ? a.org : undefined;
  return [a.email ?? 'conta sem e-mail', plan && `${plan}${org ? ` (${org})` : ''}`].filter(Boolean).join(' · ');
}

const expand = (p: string, home: string) => p.replace(/^~(?=\/|$)/, home).replace(/\$\{?HOME\}?/g, home).replace(/^["']|["']$/g, '');

/**
 * Directories that may hold a login: the default, the one the terminal has set,
 * `~/.claude-*` folders, and any CLAUDE_CONFIG_DIR the shell profiles assign.
 */
export function candidateConfigDirs(home = homedir(), env: NodeJS.ProcessEnv = process.env): Array<string | null> {
  const dirs = new Set<string>();
  const add = (p?: string) => {
    if (!p) return;
    const abs = expand(p.trim(), home);
    try { if (statSync(abs).isDirectory()) dirs.add(realpathSync(abs)); } catch { /* not there */ }
  };
  add(env.CLAUDE_CONFIG_DIR);
  try {
    for (const name of readdirSync(home)) if (/^\.claude-[\w.-]+$/.test(name)) add(join(home, name));
  } catch { /* unreadable home */ }
  for (const rc of ['.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile']) {
    const file = join(home, rc);
    if (!existsSync(file)) continue;
    try {
      for (const m of readFileSync(file, 'utf8').matchAll(/CLAUDE_CONFIG_DIR=("[^"]+"|'[^']+'|[^\s;\\]+)/g)) add(m[1]);
    } catch { /* skip */ }
  }
  const defaultDir = (() => { try { return realpathSync(join(home, '.claude')); } catch { return join(home, '.claude'); } })();
  dirs.delete(defaultDir); // that one is "default", listed first
  return [null, ...dirs];
}

function readAccount(configDir: string | null, command: string): Promise<ClaudeAccount | null> {
  const env = { ...process.env };
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir; else delete env.CLAUDE_CONFIG_DIR;
  return new Promise(resolve => {
    execFile(command, ['auth', 'status', '--json'], { env, timeout: 15_000 }, (_err, stdout) => {
      try {
        const d = JSON.parse(stdout) as { loggedIn?: boolean; email?: string; subscriptionType?: string; orgName?: string };
        resolve(d.loggedIn ? { configDir, email: d.email, plan: d.subscriptionType, org: d.orgName } : null);
      } catch { resolve(null); }
    });
  });
}

/** Logged-in accounts on this machine, one per account (two dirs on one login count once) */
export async function listClaudeAccounts(command = 'claude'): Promise<ClaudeAccount[]> {
  const found = await Promise.all(candidateConfigDirs().map(d => readAccount(d, command)));
  const seen = new Set<string>();
  return found.filter((a): a is ClaudeAccount => {
    if (!a) return false;
    const key = `${a.email}|${a.org}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The saved choice, if it is still one of the accounts here */
export function savedAccount(accounts: ClaudeAccount[], saved: string | undefined): ClaudeAccount | undefined {
  if (saved === undefined) return undefined;
  return accounts.find(a => (a.configDir ?? '') === saved);
}
