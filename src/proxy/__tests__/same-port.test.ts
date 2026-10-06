import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { planSamePort, hiddenPortArgs, rewriteLog, portIsFree } from '../same-port.js';

describe('planSamePort', () => {
  it('Next: the dev script, default port 3000', () => {
    expect(planSamePort({ pkg: { scripts: { dev: 'next dev' }, dependencies: { next: '15' } } }))
      .toEqual({ script: 'dev', framework: 'next', appPort: 3000 });
  });
  it('a port in the script wins', () => {
    expect(planSamePort({ pkg: { scripts: { dev: 'next dev -p 3100' }, dependencies: { next: '15' } } })?.appPort).toBe(3100);
    expect(planSamePort({ pkg: { scripts: { dev: 'vite --port=4000' }, devDependencies: { vite: '7' } } })?.appPort).toBe(4000);
  });
  it('Vite: server.port in the config, else 5173', () => {
    const pkg = { scripts: { dev: 'vite' }, devDependencies: { vite: '7' } };
    expect(planSamePort({ pkg, viteConfig: 'export default { server: { port: 3001, strictPort: true } }' })?.appPort).toBe(3001);
    expect(planSamePort({ pkg })?.appPort).toBe(5173);
  });
  it('falls back to start, and to null without a script', () => {
    expect(planSamePort({ pkg: { scripts: { start: 'node server.js' } } })).toEqual({ script: 'start', framework: 'other', appPort: 3000 });
    expect(planSamePort({ pkg: {} })).toBeNull();
  });
});

describe('hiddenPortArgs', () => {
  it('Vite needs its flag; everyone gets PORT', () => {
    expect(hiddenPortArgs('vite', 15173)).toEqual({ args: ['--port', '15173', '--strictPort'], env: { PORT: '15173' } });
    expect(hiddenPortArgs('other', 13000)).toEqual({ args: [], env: { PORT: '13000' } });
  });
});

describe('rewriteLog', () => {
  it("shows the app's address instead of the hidden one", () => {
    expect(rewriteLog('  ➜  Local:   http://localhost:15173/', 15173, 5173)).toBe('  ➜  Local:   http://localhost:5173/');
    expect(rewriteLog('- Local: http://127.0.0.1:13000', 13000, 3000)).toBe('- Local: http://localhost:3000');
    expect(rewriteLog('ready on :130001', 13000, 3000)).toBe('ready on :130001');
    expect(rewriteLog('Local: http://localhost:\x1b[1m15173\x1b[22m/', 15173, 5173)).toBe('Local: http://localhost:\x1b[1m5173\x1b[22m/');
  });
});

describe('portIsFree', () => {
  it('a server on every interface makes the port taken, not just one on loopback', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '::', () => r()));
    const port = (server.address() as net.AddressInfo).port;
    expect(await portIsFree(port)).toBe(false);
    await new Promise<void>((r) => server.close(() => r()));
    expect(await portIsFree(port)).toBe(true);
  });
});
