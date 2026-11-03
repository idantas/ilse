import { describe, expect, it, vi } from 'vitest';

// The control only orchestrates: login/logout and the files are mocked here
const session = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(async () => true),
}));
const store = vi.hoisted(() => ({ email: null as string | null }));
vi.mock('../session.js', () => session);
vi.mock('../store.js', () => ({ loadAccount: () => (store.email ? { email: store.email, token: 't', connectedAt: '' } : null) }));

const { createAccountControl } = await import('../control.js');

function make(over: Partial<Parameters<typeof createAccountControl>[0]> = {}) {
  const states: unknown[] = [];
  const opened: string[] = [];
  const control = createAccountControl({
    locale: () => 'pt',
    broadcast: (s) => states.push(s),
    openBrowser: (u) => opened.push(u),
    proActive: false,
    proInstalled: true,
    ...over,
  });
  return { control, states, opened };
}

describe('account control (toolbar sign-in)', () => {
  it('shows the code, opens the page, then the email — never the token', async () => {
    store.email = null;
    let finish!: (v: unknown) => void;
    session.login.mockImplementation(({ onCode }) => {
      onCode({ deviceCode: 'secret-device-code', userCode: 'ABCD-EFGH', verificationUri: 'https://site/conta/conectar?code=ABCD-EFGH', interval: 5, expiresIn: 600 });
      return new Promise((r) => { finish = r; });
    });
    const { control, states, opened } = make();
    control.login();
    expect(opened).toEqual(['https://site/conta/conectar?code=ABCD-EFGH']);
    expect(control.state().pending).toEqual({ userCode: 'ABCD-EFGH', uri: 'https://site/conta/conectar?code=ABCD-EFGH' });
    expect(JSON.stringify(states)).not.toContain('secret-device-code');

    store.email = 'a@b.co';
    finish({ status: 'ok', email: 'a@b.co' });
    await new Promise((r) => setTimeout(r, 0));
    expect(control.state()).toEqual({ email: 'a@b.co', pending: null, last: 'ok', restartNeeded: true });
  });

  it('asks for a restart only when Pro is installed and not running yet', () => {
    store.email = 'a@b.co';
    expect(make({ proActive: true }).control.state().restartNeeded).toBe(false);
    expect(make({ proInstalled: false }).control.state().restartNeeded).toBe(false);
    expect(make().control.state().restartNeeded).toBe(true);
  });

  it('runs one sign-in at a time', () => {
    store.email = null;
    session.login.mockReset();
    session.login.mockImplementation(() => new Promise(() => {}));
    const { control } = make();
    control.login();
    control.login();
    expect(session.login).toHaveBeenCalledTimes(1);
  });
});
