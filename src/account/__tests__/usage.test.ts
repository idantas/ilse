import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { licensePlan, ownerUsage, readUsage } from '../usage.js';

const license = (plan: string) => `ILSE1.${Buffer.from(JSON.stringify({ v: 2, plan })).toString('base64url')}.sig`;

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'ilse-usage-'));
  mkdirSync(join(dir, 'logs'));
  return dir;
}
const log = (dir: string, name: string, startedAt: string, runs: string[]) =>
  writeFileSync(join(dir, 'logs', `session-${name}.json`), JSON.stringify({ session: { startedAt }, runs: runs.map(receivedAt => ({ receivedAt })) }));

describe('owner usage', () => {
  it('counts annotations per day; a session without any still counts once', () => {
    const dir = home();
    log(dir, 'a', '2026-10-20T12:00:00', ['2026-10-20T12:01:00', '2026-10-20T13:00:00']);
    log(dir, 'b', '2026-10-21T12:00:00', []);
    log(dir, 'c', '2020-01-01T12:00:00', []); // older than a year
    writeFileSync(join(dir, 'logs', 'session-broken.json'), '{');
    const u = readUsage(dir, Date.parse('2026-10-23T12:00:00'));
    expect(u.days).toEqual({ '2026-10-20': 2, '2026-10-21': 1 });
  });

  it('counts projects from the config, temp folders left out, each once', () => {
    const dir = home();
    writeFileSync(join(dir, 'config.json'), JSON.stringify({
      appPorts: { '/work/a': 3000, '/private/tmp/x/app': 5173 },
      loginTied: { '/work/a': true, '/work/b': false },
      claudeAccounts: { '/var/folders/zz/app': '~/.claude' },
    }));
    expect(readUsage(dir).projects).toBe(2);
  });

  it('only the owner license sends anything', () => {
    const dir = home();
    expect(ownerUsage(dir)).toBeUndefined();
    writeFileSync(join(dir, 'license'), license('founder'));
    expect(licensePlan(dir)).toBe('founder');
    expect(ownerUsage(dir)).toBeUndefined();
    writeFileSync(join(dir, 'license'), license('owner'));
    expect(ownerUsage(dir)).toEqual({ days: {}, projects: 0 });
  });
});
