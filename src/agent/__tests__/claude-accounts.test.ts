import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { candidateConfigDirs, describeAccount, savedAccount } from '../claude-accounts.js';
import { isolatedEnv, setClaudeConfigDir } from '../agent-profile.js';

describe('Claude accounts', () => {
  afterEach(() => setClaudeConfigDir(undefined));

  it('finds the default, ~/.claude-* folders and dirs set in shell profiles', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'ilse-home-')));
    mkdirSync(join(home, '.claude'));
    mkdirSync(join(home, '.claude-work'));
    mkdirSync(join(home, 'accounts/client'), { recursive: true });
    writeFileSync(join(home, '.zshrc'), 'alias c2="CLAUDE_CONFIG_DIR=~/accounts/client claude"\nexport CLAUDE_CONFIG_DIR="$HOME/.claude"\n');
    const dirs = candidateConfigDirs(home, {});
    expect(dirs[0]).toBeNull(); // the default, first
    expect(dirs).toContain(join(home, '.claude-work'));
    expect(dirs).toContain(join(home, 'accounts/client'));
    expect(dirs.filter(d => d === join(home, '.claude'))).toHaveLength(0); // the default isn't listed twice
  });

  it('describes an account by email, plan and team', () => {
    expect(describeAccount({ configDir: null, email: 'me@example.com', plan: 'pro', org: "me@example.com's Organization" })).toBe('me@example.com · Claude Pro');
    expect(describeAccount({ configDir: '/x', email: 'me@company.com', plan: 'team', org: 'Acme' })).toBe('me@company.com · Claude Team (Acme)');
  });

  it('keeps a saved choice only while that account is still here', () => {
    const accounts = [{ configDir: null }, { configDir: '/h/.claude-work' }];
    expect(savedAccount(accounts, '/h/.claude-work')).toBe(accounts[1]);
    expect(savedAccount(accounts, '')).toBe(accounts[0]);
    expect(savedAccount(accounts, '/gone')).toBeUndefined();
    expect(savedAccount(accounts, undefined)).toBeUndefined();
  });

  it('every run uses the chosen account, whatever the terminal had', () => {
    setClaudeConfigDir('/h/.claude-work');
    expect(isolatedEnv({ CLAUDE_CONFIG_DIR: '/other' }).CLAUDE_CONFIG_DIR).toBe('/h/.claude-work');
    setClaudeConfigDir(null);
    expect(isolatedEnv({ CLAUDE_CONFIG_DIR: '/other' }).CLAUDE_CONFIG_DIR).toBeUndefined();
    setClaudeConfigDir(undefined);
    expect(isolatedEnv({ CLAUDE_CONFIG_DIR: '/other' }).CLAUDE_CONFIG_DIR).toBe('/other');
  });
});
