import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveAccount } from '../../account/store.js';
import { PLUGIN_API } from '../types.js';
import { coveredByLicense, licenseUpdatesUntil, upgradePro, verifyRelease } from '../upgrade.js';

// A throwaway key pair: the real private key only lives with the maintainer
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const license = (updatesUntil: string) =>
  `ILSE1.${Buffer.from(JSON.stringify({ v: 2, updatesUntil })).toString('base64url')}.sig`;

/** What ilse-pro's `npm run pack:release` makes, built in a temp folder. */
function release(work: string, { version = '0.1.0', builtAt = '2026-10-28T12:00:00Z', key = privateKey, tamper = false, pluginApi = PLUGIN_API } = {}): Buffer {
  const src = join(work, `src-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(src, 'package'), { recursive: true });
  writeFileSync(join(src, 'package', 'index.js'), `export default { pluginApi: ${pluginApi}, version: '${version}' };\n`);
  execFileSync('tar', ['-czf', join(src, 'package.tgz'), '-C', src, 'package']);
  const pkg = readFileSync(join(src, 'package.tgz'));
  const manifest = Buffer.from(JSON.stringify({
    format: 1, name: 'ilse-pro', version, builtAt, pluginApi,
    sha256: createHash('sha256').update(pkg).digest('hex'), size: pkg.length,
  }));
  writeFileSync(join(src, 'manifest.json'), manifest);
  writeFileSync(join(src, 'manifest.sig'), sign(null, manifest, key).toString('base64'));
  if (tamper) writeFileSync(join(src, 'package.tgz'), Buffer.concat([pkg.subarray(0, -1), Buffer.from([pkg[pkg.length - 1] ^ 1])]));
  execFileSync('tar', ['-czf', join(src, 'out.tgz'), '-C', src, 'manifest.json', 'manifest.sig', 'package.tgz']);
  return readFileSync(join(src, 'out.tgz'));
}

const serve = (body: Buffer) => (async () =>
  new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': 'application/gzip' } })) as unknown as typeof fetch;

describe('verifyRelease', () => {
  const manifest = (pkg: Buffer, extra = {}) => Buffer.from(JSON.stringify({
    format: 1, name: 'ilse-pro', version: '0.1.0', builtAt: '2026-10-28T00:00:00Z', pluginApi: 1,
    sha256: createHash('sha256').update(pkg).digest('hex'), size: pkg.length, ...extra,
  }));
  const pkg = Buffer.from('package bytes');

  it('accepts a package signed with the release key', () => {
    const m = manifest(pkg);
    const r = verifyRelease(m, sign(null, m, privateKey).toString('base64'), pkg, publicKey);
    expect(r.ok && r.manifest.version).toBe('0.1.0');
  });

  it('rejects a signature from another key', () => {
    const m = manifest(pkg);
    const other = generateKeyPairSync('ed25519').privateKey;
    expect(verifyRelease(m, sign(null, m, other).toString('base64'), pkg, publicKey)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects an edited manifest and a swapped package', () => {
    const m = manifest(pkg);
    const sig = sign(null, m, privateKey).toString('base64');
    expect(verifyRelease(manifest(pkg, { version: '9.9.9' }), sig, pkg, publicKey).ok).toBe(false);
    expect(verifyRelease(m, sig, Buffer.from('other bytes!!'), publicKey)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a version that is not a plain folder name, even signed', () => {
    const m = manifest(pkg, { version: '../../evil' });
    expect(verifyRelease(m, sign(null, m, privateKey).toString('base64'), pkg, publicKey)).toEqual({ ok: false, reason: 'bad-package' });
  });

  it('rejects garbage', () => {
    expect(verifyRelease(Buffer.from('{}'), 'not base64 at all', pkg, publicKey)).toEqual({ ok: false, reason: 'bad-signature' });
  });
});

describe('updates window', () => {
  it('reads updatesUntil from the license', () => {
    expect(licenseUpdatesUntil(license('2027-11-30'))).toBe('2027-11-30');
    expect(licenseUpdatesUntil(null)).toBeNull();
    expect(licenseUpdatesUntil('garbage')).toBeNull();
  });

  it('covers builds up to the last day, not after', () => {
    expect(coveredByLicense('2027-11-30T23:59:00Z', '2027-11-30')).toBe(true);
    expect(coveredByLicense('2027-12-01T00:00:00Z', '2027-11-30')).toBe(false);
  });
});

describe('upgradePro', () => {
  let home: string;
  let work: string;
  const signIn = (until = '2027-11-30') =>
    saveAccount({ email: 'a@b.co', token: 'tk', connectedAt: '2026-10-28T00:00:00Z' }, license(until), join(home, '.ilse'));
  const run = (body: Buffer, key: KeyObject = publicKey) => upgradePro({ home, fetchFn: serve(body), key });
  const proDir = () => join(home, '.ilse', 'pro');

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ilse-upgrade-home-'));
    work = mkdtempSync(join(tmpdir(), 'ilse-upgrade-work-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });

  it('needs ilse login first', async () => {
    expect(await run(release(work))).toEqual({ status: 'not-signed-in' });
  });

  it('installs a signed package in ~/.ilse/pro/<version> and points current at it', async () => {
    signIn();
    expect(await run(release(work))).toEqual({ status: 'installed', version: '0.1.0', previous: null });
    expect(readFileSync(join(proDir(), 'current', 'index.js'), 'utf8')).toContain("version: '0.1.0'");
    expect(readlinkSync(join(proDir(), 'current'))).toBe(join(proDir(), '0.1.0'));
    expect(readdirSync(proDir()).filter(f => f.startsWith('.'))).toEqual([]); // no download left behind
  });

  it('says up to date on the same version, and moves current on a new one', async () => {
    signIn();
    await run(release(work));
    expect(await run(release(work))).toEqual({ status: 'up-to-date', version: '0.1.0' });
    expect(await run(release(work, { version: '0.2.0' }))).toEqual({ status: 'installed', version: '0.2.0', previous: '0.1.0' });
    expect(readlinkSync(join(proDir(), 'current'))).toBe(join(proDir(), '0.2.0'));
    expect(existsSync(join(proDir(), '0.1.0', 'index.js'))).toBe(true); // the older one stays, to go back to
  });

  it('installs nothing when the signature fails', async () => {
    signIn();
    expect(await run(release(work, { key: generateKeyPairSync('ed25519').privateKey }))).toEqual({ status: 'bad-signature' });
    expect(await run(release(work, { tamper: true }))).toEqual({ status: 'bad-signature' });
    expect(readdirSync(proDir())).toEqual([]);
  });

  it('keeps the installed Pro when the new build is past the license updates', async () => {
    signIn('2026-12-31');
    await run(release(work));
    expect(await run(release(work, { version: '0.3.0', builtAt: '2027-01-02T00:00:00Z' })))
      .toEqual({ status: 'updates-ended', version: '0.3.0', updatesUntil: '2026-12-31' });
    expect(readlinkSync(join(proDir(), 'current'))).toBe(join(proDir(), '0.1.0'));
    expect(existsSync(join(proDir(), '0.3.0'))).toBe(false);
  });

  it('refuses a Pro that speaks another plugin API', async () => {
    signIn();
    expect(await run(release(work, { pluginApi: PLUGIN_API + 1 }))).toEqual({ status: 'other-api' });
  });

  it('tells no license (403), nothing uploaded yet (the site redirects to a page) and offline apart', async () => {
    signIn();
    const reply = (status: number, type = 'text/plain') => (async () => new Response('x', { status, headers: { 'content-type': type } })) as unknown as typeof fetch;
    expect(await upgradePro({ home, fetchFn: reply(403) })).toEqual({ status: 'no-license' });
    expect(await upgradePro({ home, fetchFn: reply(200, 'text/html; charset=utf-8') })).toEqual({ status: 'not-available' });
    expect(await upgradePro({ home, fetchFn: (async () => { throw new Error('offline'); }) as unknown as typeof fetch })).toEqual({ status: 'unreachable' });
  });
});
