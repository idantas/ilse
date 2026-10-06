import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Behavior = (port: number, s: FakeSocket) => void;

/** Stands in for the browser WebSocket; `behavior` decides what each port does */
class FakeSocket {
  static readonly OPEN = 1;
  static created: number[] = [];
  static behavior: Behavior = () => {};
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;

  constructor(url: string) {
    const port = Number(new URL(url).port);
    FakeSocket.created.push(port);
    setTimeout(() => FakeSocket.behavior(port, this), 0);
  }
  open() { this.readyState = 1; this.onopen?.(); }
  fail() { this.onerror?.(); this.readyState = 3; this.onclose?.({ code: 1006 }); }
  hello() { this.onmessage?.({ data: JSON.stringify({ type: 'connected', service: 'ilse-cli' }) }); }
  close() { this.readyState = 3; }
  send() {}
}

const count = (port: number) => FakeSocket.created.filter((p) => p === port).length;

describe('ws-client port scan', () => {
  let client: typeof import('../ws-client.js');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.created = [];
    vi.resetModules();
    client = await import('../ws-client.js');
  });

  afterEach(() => {
    client.disconnect();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('tries each port once when connections open and then fail (proxies)', async () => {
    // What the failing browser did: every closed port fired open → error → close
    FakeSocket.behavior = (_port, s) => { s.open(); s.fail(); };
    client.connect();
    // Long enough for every handshake timer, short of the 2s reconnect
    await vi.advanceTimersByTimeAsync(1900);
    expect(FakeSocket.created).toEqual([4747, 4748, 4749, 4750, 4751, 4752, 4753, 4754, 4755, 4756, 4757]);
  });

  it("moves on once from a server that isn't this project's (4003)", async () => {
    FakeSocket.behavior = (port, s) => {
      if (port === 4747) { s.open(); s.readyState = 3; s.onclose?.({ code: 4003 }); }
      else s.fail();
    };
    client.connect();
    await vi.advanceTimersByTimeAsync(1900);
    expect(count(4748)).toBe(1);
    expect(count(4757)).toBe(1);
  });

  it('stops at the first ilse that answers the handshake', async () => {
    FakeSocket.behavior = (port, s) => (port === 4749 ? (s.open(), s.hello()) : s.fail());
    client.connect();
    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeSocket.created).toEqual([4747, 4748, 4749]);
  });

  it('starts at the port the serving ilse named', async () => {
    vi.stubGlobal('window', { __ilseBridgePort: 4750 });
    FakeSocket.behavior = (port, s) => (port === 4750 ? (s.open(), s.hello()) : s.fail());
    client.connect();
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeSocket.created).toEqual([4750]);
  });

  it('reconnects to the same port when a live connection drops', async () => {
    let live: FakeSocket | null = null;
    FakeSocket.behavior = (port, s) => {
      if (port === 4747 && !live) { live = s; s.open(); s.hello(); }
      else if (port === 4747) { s.open(); s.hello(); }
      else s.fail();
    };
    client.connect();
    await vi.advanceTimersByTimeAsync(100);
    live!.fail();
    await vi.advanceTimersByTimeAsync(2100);
    expect(FakeSocket.created).toEqual([4747, 4747]);
  });
});
