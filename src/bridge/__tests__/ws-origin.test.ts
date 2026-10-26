import { describe, it, expect, afterAll } from 'vitest';
import WebSocket from 'ws';
import { startServer, stopServer, getPort, setOwnPorts } from '../ws-server.js';

/** Connect with this origin: 'connected' (the handshake came) or the close code */
function attempt(origin: string): Promise<{ ws: WebSocket; result: Promise<string | number> }> {
  const ws = new WebSocket(`ws://localhost:${getPort()}`, { headers: { origin } });
  const result = new Promise<string | number>(res => {
    ws.on('message', raw => { if (JSON.parse(String(raw)).type === 'connected') res('connected'); });
    ws.on('close', code => res(code));
  });
  return Promise.resolve({ ws, result });
}

describe('which tab a server belongs to', () => {
  afterAll(async () => { await stopServer(); });

  it("another project's tab that got here first gives the server back to this project's app", async () => {
    await startServer({});
    // A tab of another project scanning ports, before this one's proxy is up
    const stranger = await attempt('http://localhost:5555');
    expect(await stranger.result).toBe('connected');
    const strangerClosed = new Promise<number>(res => stranger.ws.on('close', code => res(code)));

    setOwnPorts([3000, 13000]);
    const own = await attempt('http://localhost:3000');
    expect(await own.result).toBe('connected');
    expect(await strangerClosed).toBe(4003);

    // From then on, only this project's origins
    const again = await attempt('http://localhost:5555');
    expect(await again.result).toBe(4003);
    own.ws.close();
  });
});
