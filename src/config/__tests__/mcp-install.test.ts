import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withJsonEntry, withTomlEntry, settingsFile, applyMcp, MCP_ARGS } from '../mcp-install.js';

describe('withJsonEntry', () => {
  it('adds Ilse next to the servers already there, and removes only Ilse', () => {
    const before = JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } });
    const added = JSON.parse(withJsonEntry(before, true));
    expect(added.theme).toBe('dark');
    expect(added.mcpServers.other).toEqual({ command: 'x' });
    expect(added.mcpServers.ilse).toEqual({ command: 'npx', args: MCP_ARGS });
    const removed = JSON.parse(withJsonEntry(JSON.stringify(added), false));
    expect(removed.mcpServers).toEqual({ other: { command: 'x' } });
  });
  it('starts a missing or empty file', () => {
    expect(JSON.parse(withJsonEntry(null, true)).mcpServers.ilse.command).toBe('npx');
    expect(JSON.parse(withJsonEntry('  ', true)).mcpServers.ilse.command).toBe('npx');
  });
  it('refuses a file that does not parse', () => {
    expect(() => withJsonEntry('{ nope', true)).toThrow();
  });
});

describe('withTomlEntry', () => {
  const other = 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n';
  it('appends its own table and replaces it on reinstall', () => {
    const once = withTomlEntry(other, true);
    expect(once).toContain('[mcp_servers.other]');
    expect(once).toMatch(/\[mcp_servers\.ilse\]\ncommand = "npx"\nargs = \["-y", "-p", "ilse-design@latest", "ilse-mcp"\]\n$/);
    expect(withTomlEntry(once, true)).toBe(once);
  });
  it('removes only its table, nested ones included', () => {
    const withEnv = withTomlEntry(other, true) + '\n[mcp_servers.ilse.env]\nX = "1"\n\n[profiles.fast]\nmodel = "mini"\n';
    const out = withTomlEntry(withEnv, false);
    expect(out).not.toContain('ilse');
    expect(out).toContain('[mcp_servers.other]');
    expect(out).toContain('[profiles.fast]');
  });
});

describe('settingsFile', () => {
  it('knows where each agent keeps its servers', () => {
    expect(settingsFile('claude-desktop', { home: '/h', platform: 'darwin' })).toBe('/h/Library/Application Support/Claude/claude_desktop_config.json');
    expect(settingsFile('claude-desktop', { home: '/h', platform: 'linux' })).toBe('/h/.config/Claude/claude_desktop_config.json');
    expect(settingsFile('cursor', { home: '/h', platform: 'darwin' })).toBe('/h/.cursor/mcp.json');
    expect(settingsFile('codex', { home: '/h', platform: 'darwin' })).toBe('/h/.codex/config.toml');
    expect(settingsFile('gemini', { home: '/h', platform: 'darwin' })).toBe('/h/.gemini/settings.json');
  });
});

describe('applyMcp', () => {
  it('writes the file, --print changes nothing, a broken file is left alone', () => {
    const home = mkdtempSync(join(tmpdir(), 'ilse-mcp-'));
    const env = { home, platform: 'darwin' as const };
    const dry = applyMcp('cursor', true, true, env);
    expect(dry.preview).toContain('ilse-mcp');
    expect(() => readFileSync(join(home, '.cursor', 'mcp.json'))).toThrow();
    expect(applyMcp('cursor', true, false, env).ok).toBe(true);
    expect(JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8')).mcpServers.ilse).toBeTruthy();
    mkdirSync(join(home, '.gemini'));
    writeFileSync(join(home, '.gemini', 'settings.json'), '{ broken');
    const bad = applyMcp('gemini', true, false, env);
    expect(bad.ok).toBe(false);
    expect(readFileSync(join(home, '.gemini', 'settings.json'), 'utf8')).toBe('{ broken');
  });
});
