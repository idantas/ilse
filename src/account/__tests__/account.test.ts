import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearAccount, getInstallId, loadAccount, readLicense, saveAccount } from '../store.js';
import { checkAccount, waitForLogin } from '../client.js';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('account store', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ilse-account-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('makes the install id once and keeps it', () => {
    const id = getInstallId(dir);
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(getInstallId(dir)).toBe(id);
  });

  it('saves access and license only this user can read, and clears both on sign-out', () => {
    const id = getInstallId(dir);
    saveAccount({ email: 'a@b.co', token: 't0k', connectedAt: '2026-10-22T00:00:00Z' }, 'ILSE1.x.y', dir);
    expect(loadAccount(dir)?.email).toBe('a@b.co');
    expect(readLicense(dir)).toBe('ILSE1.x.y');
    if (process.platform !== 'win32') expect(statSync(join(dir, 'account.json')).mode & 0o777).toBe(0o600);
    clearAccount(dir);
    expect(loadAccount(dir)).toBeNull();
    expect(readLicense(dir)).toBeNull();
    expect(getInstallId(dir)).toBe(id); // the installation is still the same one
  });
});

describe('waitForLogin', () => {
  const start = { deviceCode: 'dc', interval: 5, expiresIn: 600 };
  const sleep = () => Promise.resolve();

  it('polls until the person confirms', async () => {
    const answers = [{ status: 'pending' }, { status: 'pending' }, { status: 'ok', token: 'tk', license: 'L', email: 'a@b.co' }];
    const fetchFn = vi.fn(() => json(200, answers.shift()));
    const r = await waitForLogin(start, { fetchFn: fetchFn as unknown as typeof fetch, sleep });
    expect(r).toEqual({ status: 'ok', token: 'tk', license: 'L', email: 'a@b.co' });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('stops on "Wasn\'t me"', async () => {
    const fetchFn = vi.fn(() => json(200, { status: 'denied' }));
    expect(await waitForLogin(start, { fetchFn: fetchFn as unknown as typeof fetch, sleep })).toEqual({ status: 'denied' });
  });

  it('keeps waiting through a dropped request', async () => {
    let n = 0;
    const fetchFn = vi.fn(() => (n++ === 0 ? Promise.reject(new Error('offline')) : json(200, { status: 'expired' })));
    expect(await waitForLogin(start, { fetchFn: fetchFn as unknown as typeof fetch, sleep })).toEqual({ status: 'expired' });
  });

  it('can be cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    const fetchFn = vi.fn();
    expect(await waitForLogin(start, { fetchFn: fetchFn as unknown as typeof fetch, sleep, signal: abort.signal })).toEqual({ status: 'cancelled' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('checkAccount', () => {
  const versions = { ilseVersion: '0.8.0', proVersion: '0.1.0' };

  it('sends only the versions, with the token', async () => {
    const fetchFn = vi.fn((_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual(versions);
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer tk');
      return json(200, { license: 'L2', latest: { ilse: '0.8.1', pro: '0.1.0' } });
    });
    expect(await checkAccount('tk', versions, fetchFn as unknown as typeof fetch)).toEqual({ status: 'ok', license: 'L2', latest: { ilse: '0.8.1', pro: '0.1.0' } });
  });

  it('tells "signed in elsewhere" from "disconnected"', async () => {
    expect(await checkAccount('tk', versions, (() => json(401, { error: 'replaced' })) as unknown as typeof fetch)).toEqual({ status: 'replaced' });
    expect(await checkAccount('tk', versions, (() => json(401, { error: 'revoked' })) as unknown as typeof fetch)).toEqual({ status: 'revoked' });
  });

  it('offline is not a sign-out', async () => {
    expect(await checkAccount('tk', versions, (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).toEqual({ status: 'unreachable' });
    expect(await checkAccount('tk', versions, (() => json(502, {})) as unknown as typeof fetch)).toEqual({ status: 'unreachable' });
  });
});
