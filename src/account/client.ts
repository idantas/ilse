/**
 * Talks to the Ilse site for `ilse login` (device code, like `gh auth login`)
 * and the daily account check. The site's side lives in ilse-site,
 * app/api/device/*.
 *
 * What leaves the machine, and only when signed in: the installed Ilse and
 * Pro versions, with the machine's token. Signing out stops it. The owner's
 * machine (license plan "owner") also sends its activity per day and the
 * project count, for its own account page (usage.ts).
 */

import { arch, platform, release } from 'node:os';
import type { Usage } from './usage.js';

export const ACCOUNT_URL = (process.env.ILSE_ACCOUNT_URL || 'https://ilse.design').replace(/\/$/, '');

export interface LoginStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds between polls */
  interval: number;
  /** Seconds the code lives */
  expiresIn: number;
}

export type PollResult =
  | { status: 'pending' | 'slow_down' }
  | { status: 'denied' | 'expired' }
  | { status: 'ok'; token: string; license: string; email: string };

export type CheckResult =
  | { status: 'ok'; license: string; latest: { ilse: string | null; pro: string | null } }
  | { status: 'replaced' | 'revoked' }
  /** Offline or the site is down: keep what we have */
  | { status: 'unreachable' };

type Fetch = typeof fetch;

async function post(path: string, body: unknown, { token, fetchFn = fetch, timeoutMs = 8000 }: { token?: string; fetchFn?: Fetch; timeoutMs?: number } = {}) {
  const res = await fetchFn(`${ACCOUNT_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export async function startLogin(installId: string, locale: 'pt' | 'en', fetchFn?: Fetch): Promise<LoginStart> {
  // platform/arch/release only make the site's label ("Mac · macOS 26 · Apple Silicon"); nothing is asked of the person
  const { status, data } = await post('/api/device/start', { installId, platform: platform(), arch: arch(), release: release(), locale }, { fetchFn });
  if (status !== 200 || typeof data.deviceCode !== 'string') throw new Error(`login start failed (${status})`);
  return data as unknown as LoginStart;
}

export async function pollLogin(deviceCode: string, fetchFn?: Fetch): Promise<PollResult> {
  const { status, data } = await post('/api/device/poll', { deviceCode }, { fetchFn });
  if (status === 429) return { status: 'slow_down' };
  if (data.status === 'ok' && typeof data.token === 'string' && typeof data.license === 'string' && typeof data.email === 'string') {
    return { status: 'ok', token: data.token, license: data.license, email: data.email };
  }
  if (data.status === 'denied' || data.status === 'expired') return { status: data.status };
  return { status: 'pending' };
}

/**
 * Waits for the person to confirm in the browser. Resolves with the final
 * result; `signal` cancels (Ctrl+C in the terminal, Cancel in the toolbar).
 */
export async function waitForLogin(
  start: Pick<LoginStart, 'deviceCode' | 'interval' | 'expiresIn'>,
  { signal, fetchFn, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) }: { signal?: AbortSignal; fetchFn?: Fetch; sleep?: (ms: number) => Promise<unknown> } = {},
): Promise<Exclude<PollResult, { status: 'pending' | 'slow_down' }> | { status: 'cancelled' }> {
  let interval = Math.max(1, start.interval) * 1000;
  const deadline = Date.now() + start.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    if (signal?.aborted) return { status: 'cancelled' };
    let r: PollResult;
    try {
      r = await pollLogin(start.deviceCode, fetchFn);
    } catch {
      continue; // a dropped request isn't an answer; try again on the next tick
    }
    if (r.status === 'slow_down') interval += 5000;
    else if (r.status === 'ok' || r.status === 'denied' || r.status === 'expired') return r;
  }
  return { status: 'expired' };
}

export async function checkAccount(token: string, versions: { ilseVersion: string; proVersion: string | null }, fetchFn?: Fetch, usage?: Usage): Promise<CheckResult> {
  try {
    // usage: the owner's machine only (usage.ts)
    const { status, data } = await post('/api/device/heartbeat', usage ? { ...versions, usage } : versions, { token, fetchFn });
    if (status === 401) return { status: data.error === 'replaced' ? 'replaced' : 'revoked' };
    if (status === 200 && typeof data.license === 'string') {
      const latest = (data.latest ?? {}) as { ilse?: string | null; pro?: string | null };
      return { status: 'ok', license: data.license, latest: { ilse: latest.ilse ?? null, pro: latest.pro ?? null } };
    }
    return { status: 'unreachable' };
  } catch {
    return { status: 'unreachable' };
  }
}

export async function logoutDevice(token: string, fetchFn?: Fetch): Promise<void> {
  try {
    await post('/api/device/logout', {}, { token, fetchFn });
  } catch { /* offline: the site drops it after 30 days without contact anyway */ }
}
