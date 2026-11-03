/**
 * The signed-in account on this machine, in ~/.ilse/ (files only this user
 * can read). `ilse login` writes them; Pro reads `license` and `install-id`
 * to turn itself on. Nothing here is sent anywhere except the token, to the
 * Ilse site, by the daily account check (account/client.ts).
 *
 *   install-id    random id of this installation, made once; not tied to the
 *                 person or the hardware. The license is bound to it.
 *   account.json  { email, token, connectedAt } — the machine's access
 *   license       the signed license (ILSE1.<payload>.<signature>)
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface Account {
  email: string;
  token: string;
  connectedAt: string;
}

export const accountDir = (home = homedir()) => join(home, '.ilse');

function writePrivate(file: string, text: string): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort on non-POSIX */ }
}

const INSTALL_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function getInstallId(dir = accountDir()): string {
  const file = join(dir, 'install-id');
  if (existsSync(file)) {
    const saved = readFileSync(file, 'utf8').trim();
    if (INSTALL_ID_RE.test(saved)) return saved;
  }
  const id = randomBytes(24).toString('base64url');
  writePrivate(file, id + '\n');
  return id;
}

export function loadAccount(dir = accountDir()): Account | null {
  try {
    const a = JSON.parse(readFileSync(join(dir, 'account.json'), 'utf8')) as Partial<Account>;
    return typeof a.email === 'string' && typeof a.token === 'string' && typeof a.connectedAt === 'string'
      ? { email: a.email, token: a.token, connectedAt: a.connectedAt }
      : null;
  } catch {
    return null;
  }
}

export function saveAccount(account: Account, license: string, dir = accountDir()): void {
  writePrivate(join(dir, 'account.json'), JSON.stringify(account, null, 2) + '\n');
  saveLicense(license, dir);
}

export function saveLicense(license: string, dir = accountDir()): void {
  writePrivate(join(dir, 'license'), license.trim() + '\n');
}

export function readLicense(dir = accountDir()): string | null {
  try {
    return readFileSync(join(dir, 'license'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Signed out (or disconnected from elsewhere): access and license go; the install id stays. */
export function clearAccount(dir = accountDir()): void {
  rmSync(join(dir, 'account.json'), { force: true });
  rmSync(join(dir, 'license'), { force: true });
}
