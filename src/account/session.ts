/**
 * Sign in, sign out and the daily check — one implementation for the
 * terminal (`ilse login`) and the toolbar (Settings → Sign in to Ilse Pro).
 * The token never reaches the page: it stays in this process and ~/.ilse/.
 */

import { loadUserConfig, saveUserConfig } from '../config/user-config.js';
import { checkAccount, logoutDevice, startLogin, waitForLogin, type LoginStart } from './client.js';
import { ownerUsage } from './usage.js';
import { clearAccount, getInstallId, loadAccount, saveAccount, saveLicense } from './store.js';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type LoginOutcome = { status: 'ok'; email: string } | { status: 'denied' | 'expired' | 'cancelled' | 'failed' };

export async function login({
  locale,
  onCode,
  signal,
}: {
  locale: 'pt' | 'en';
  /** Show the code and open the page (terminal prints; toolbar shows it) */
  onCode: (start: LoginStart) => void;
  signal?: AbortSignal;
}): Promise<LoginOutcome> {
  let start: LoginStart;
  try {
    start = await startLogin(getInstallId(), locale);
  } catch {
    return { status: 'failed' };
  }
  onCode(start);
  const r = await waitForLogin(start, { signal });
  if (r.status !== 'ok') return r;
  saveAccount({ email: r.email, token: r.token, connectedAt: new Date().toISOString() }, r.license);
  // The next start checks in right away (versions, fresh license)
  saveUserConfig({ lastAccountCheck: 0 });
  return { status: 'ok', email: r.email };
}

export async function logout(): Promise<boolean> {
  const account = loadAccount();
  if (!account) return false;
  await logoutDevice(account.token);
  clearAccount();
  return true;
}

export type DailyCheck = 'skipped' | 'ok' | 'replaced' | 'revoked' | 'unreachable';

/**
 * Once a day, signed in only: send the installed versions, get the license
 * renewed (it lapses after 30 days without this). Disconnected from the site
 * or by signing in on another machine → access and license go.
 */
export async function dailyCheck(versions: { ilseVersion: string; proVersion: string | null }, now = Date.now()): Promise<DailyCheck> {
  const account = loadAccount();
  if (!account) return 'skipped';
  const last = loadUserConfig().lastAccountCheck ?? 0;
  if (now - last < CHECK_INTERVAL_MS) return 'skipped';

  const r = await checkAccount(account.token, versions, undefined, ownerUsage());
  if (r.status === 'unreachable') return 'unreachable';
  saveUserConfig({ lastAccountCheck: now });
  if (r.status === 'ok') {
    saveLicense(r.license);
    return 'ok';
  }
  clearAccount();
  return r.status;
}
