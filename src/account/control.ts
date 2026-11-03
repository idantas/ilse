/**
 * Sign-in from the toolbar (Settings → Sign in to Ilse Pro). Same `login()` as
 * the terminal; the toolbar only sees the state below — the code to confirm,
 * the email once connected — never the token or the license.
 */

import { loadAccount } from './store.js';
import { login, logout, type LoginOutcome } from './session.js';
import type { LoginStart } from './client.js';

export interface AccountState {
  email: string | null;
  /** Waiting for the person to confirm this code on the site */
  pending: { userCode: string; uri: string } | null;
  /** How the last attempt ended, for one line in the toolbar */
  last: LoginOutcome['status'] | null;
  /** Signed in during this run with Pro installed but off: it loads on the next start */
  restartNeeded: boolean;
}

export function createAccountControl({
  locale,
  broadcast,
  openBrowser,
  proActive,
  proInstalled,
}: {
  locale: () => 'pt' | 'en';
  broadcast: (state: AccountState) => void;
  openBrowser: (url: string) => void;
  /** Pro loaded with a valid license in this run */
  proActive: boolean;
  /** Pro's files are on this machine (licensed or not) */
  proInstalled: boolean;
}) {
  let pending: AccountState['pending'] = null;
  let last: AccountState['last'] = null;
  let abort: AbortController | null = null;

  const state = (): AccountState => {
    const email = loadAccount()?.email ?? null;
    return { email, pending, last, restartNeeded: !!email && proInstalled && !proActive };
  };
  const push = () => broadcast(state());

  return {
    state,
    login() {
      if (abort) return; // one sign-in at a time
      abort = new AbortController();
      last = null;
      void login({
        locale: locale(),
        signal: abort.signal,
        onCode: (start: LoginStart) => {
          pending = { userCode: start.userCode, uri: start.verificationUri };
          openBrowser(start.verificationUri);
          push();
        },
      }).then((r) => {
        abort = null;
        pending = null;
        last = r.status;
        push();
      });
      push();
    },
    cancel() {
      abort?.abort();
    },
    async logout() {
      abort?.abort();
      await logout();
      last = null;
      push();
    },
  };
}

export type AccountControl = ReturnType<typeof createAccountControl>;
