/**
 * `ilse upgrade`: downloads Ilse Pro from the Ilse site with this machine's
 * token, checks it was signed by Ilse, and installs it in
 * ~/.ilse/pro/<version>/ with ~/.ilse/pro/current pointing at it (load.ts).
 *
 * The download (ilse-pro's `npm run pack:release`) holds three files:
 *
 *   manifest.json  name, version, builtAt, pluginApi, sha256 and size of package.tgz
 *   manifest.sig   Ed25519 signature of manifest.json's exact bytes (base64)
 *   package.tgz    package/: index.js, dist/, build.json, node_modules/
 *
 * Nothing is unpacked into ~/.ilse/pro/ until the signature checks out with the
 * public key below and package.tgz matches the signed hash: the package is code
 * that runs on this machine, so a tampered file in the bucket must not install.
 */

import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ACCOUNT_URL } from '../account/client.js';
import { loadAccount, readLicense } from '../account/store.js';
import { PLUGIN_API } from './types.js';

/** Pair of the private key that signs Pro releases (kept outside every repo by the maintainer). */
export const PRO_PUBLIC_KEY = createPublicKey({
  key: Buffer.from('MCowBQYDK2VwAyEATFXupyKKUN0JBsyTFJkbGhUW2fSSMVYnoF2+5Dx02z4=', 'base64'),
  format: 'der',
  type: 'spki',
});

/** Bigger than any real Pro (≈4 MB): a runaway download stops here. */
const MAX_BYTES = 100 * 1024 * 1024;
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

export interface ProManifest {
  format: 1;
  name: 'ilse-pro';
  version: string;
  builtAt: string;
  pluginApi: number;
  sha256: string;
  size: number;
}

export type VerifyResult = { ok: true; manifest: ProManifest } | { ok: false; reason: 'bad-signature' | 'bad-package' };

/** The signature, then the package against the signed hash. Pure: the files' bytes in, a verdict out. */
export function verifyRelease(manifestBytes: Buffer, signature: string, pkg: Buffer, key: KeyObject = PRO_PUBLIC_KEY): VerifyResult {
  let valid = false;
  try {
    valid = verify(null, manifestBytes, key, Buffer.from(signature.trim(), 'base64'));
  } catch { /* malformed key or signature */ }
  if (!valid) return { ok: false, reason: 'bad-signature' };

  let m: ProManifest;
  try {
    m = JSON.parse(manifestBytes.toString('utf8')) as ProManifest;
  } catch {
    return { ok: false, reason: 'bad-package' };
  }
  // Signed, so these are ours; still checked, because the version becomes a folder name
  if (m.format !== 1 || m.name !== 'ilse-pro' || typeof m.version !== 'string' || !VERSION_RE.test(m.version)) return { ok: false, reason: 'bad-package' };
  if (pkg.length !== m.size || createHash('sha256').update(pkg).digest('hex') !== m.sha256) return { ok: false, reason: 'bad-signature' };
  return { ok: true, manifest: m };
}

/**
 * The license's `updatesUntil` (AAAA-MM-DD), read without checking its
 * signature: that check is Pro's (license.ts in ilse-pro). Here it only spares
 * installing a build the license won't turn on.
 */
export function licenseUpdatesUntil(license: string | null): string | null {
  const payload = license?.split('.')[1];
  if (!payload) return null;
  try {
    const u = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { updatesUntil?: unknown }).updatesUntil;
    return typeof u === 'string' ? u : null;
  } catch {
    return null;
  }
}

/** A build made after the license's updates end doesn't turn on (Pro refuses it too). */
export function coveredByLicense(builtAt: string, updatesUntil: string | null): boolean {
  return !updatesUntil || builtAt.slice(0, 10) <= updatesUntil;
}

export type UpgradeResult =
  | { status: 'installed'; version: string; previous: string | null }
  | { status: 'up-to-date'; version: string }
  | { status: 'updates-ended'; version: string; updatesUntil: string }
  | { status: 'not-signed-in' | 'no-license' | 'not-available' | 'unreachable' | 'bad-signature' | 'bad-package' | 'other-api' | 'failed' };

type Fetch = typeof fetch;

async function download(token: string, fetchFn: Fetch): Promise<Buffer | Exclude<UpgradeResult['status'], 'installed' | 'up-to-date' | 'updates-ended'>> {
  let res: Response;
  try {
    // The site answers with a one-minute signed link to the private bucket; fetch follows it
    res = await fetchFn(`${ACCOUNT_URL}/api/pro/download`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) });
  } catch {
    return 'unreachable';
  }
  if (res.status === 401 || res.status === 403) return 'no-license';
  if (res.status === 503) return 'not-available';
  if (!res.ok) return 'unreachable';
  // No package uploaded yet: the site sends the person to the account page instead
  if ((res.headers.get('content-type') ?? '').includes('text/html')) return 'not-available';
  const size = Number(res.headers.get('content-length') ?? 0);
  if (size > MAX_BYTES) return 'bad-package';
  const body = Buffer.from(await res.arrayBuffer());
  return body.length > MAX_BYTES ? 'bad-package' : body;
}

/** Which version `current` points at, if it's one of ours (a dev link elsewhere returns null). */
function currentVersion(proDir: string): string | null {
  try {
    const target = resolve(proDir, readlinkSync(join(proDir, 'current')));
    return resolve(target, '..') === resolve(proDir) ? target.slice(resolve(proDir).length + 1) : null;
  } catch {
    return null;
  }
}

/** Swap `current` in one step: a new link beside it, renamed over the old one. */
function pointCurrent(proDir: string, version: string): void {
  const next = join(proDir, `.current-${process.pid}`);
  rmSync(next, { force: true, recursive: true });
  // Absolute: Windows junctions need it ('junction' is ignored elsewhere)
  symlinkSync(join(proDir, version), next, 'junction');
  const current = join(proDir, 'current');
  // A real folder there (copied by hand) can't be renamed over; links can
  if (existsSync(current) && !lstatSync(current).isSymbolicLink()) rmSync(current, { recursive: true, force: true });
  renameSync(next, current);
}

export async function upgradePro({
  home = homedir(),
  fetchFn = fetch,
  key = PRO_PUBLIC_KEY,
}: { home?: string; fetchFn?: Fetch; key?: KeyObject } = {}): Promise<UpgradeResult> {
  const dir = join(home, '.ilse');
  const account = loadAccount(dir);
  if (!account) return { status: 'not-signed-in' };

  const body = await download(account.token, fetchFn);
  if (!Buffer.isBuffer(body)) return { status: body };

  const proDir = join(dir, 'pro');
  mkdirSync(proDir, { recursive: true });
  const work = mkdtempSync(join(proDir, '.download-'));
  try {
    const archive = join(work, 'release.tgz');
    writeFileSync(archive, body);
    try {
      // Only the three names we expect; anything else in the archive stays packed
      execFileSync('tar', ['-xzf', archive, '-C', work, 'manifest.json', 'manifest.sig', 'package.tgz'], { stdio: 'ignore' });
    } catch {
      return { status: 'bad-package' };
    }
    const pkg = readFileSync(join(work, 'package.tgz'));
    const checked = verifyRelease(readFileSync(join(work, 'manifest.json')), readFileSync(join(work, 'manifest.sig'), 'utf8'), pkg, key);
    if (!checked.ok) return { status: checked.reason };
    const { version, builtAt, pluginApi } = checked.manifest;

    if (pluginApi !== PLUGIN_API) return { status: 'other-api' };
    const until = licenseUpdatesUntil(readLicense(dir));
    if (!coveredByLicense(builtAt, until)) return { status: 'updates-ended', version, updatesUntil: until! };

    const previous = currentVersion(proDir);
    const target = join(proDir, version);
    if (previous === version && existsSync(join(target, 'index.js'))) return { status: 'up-to-date', version };

    const unpacked = join(work, 'unpacked');
    mkdirSync(unpacked);
    execFileSync('tar', ['-xzf', join(work, 'package.tgz'), '-C', unpacked], { stdio: 'ignore' });
    if (!existsSync(join(unpacked, 'package', 'index.js'))) return { status: 'bad-package' };
    rmSync(target, { recursive: true, force: true });
    renameSync(join(unpacked, 'package'), target);
    pointCurrent(proDir, version);
    return { status: 'installed', version, previous };
  } catch {
    return { status: 'failed' };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
