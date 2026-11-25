import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProxy, injectToolbar, TOOLBAR_PATH, type RunningProxy } from '../server.js';
import { candidatePorts, findDevServer } from '../find-dev-server.js';

describe('injectToolbar', () => {
  it('goes right before </body>', () => {
    expect(injectToolbar('<html><body><p>x</p></body></html>'))
      .toBe(`<html><body><p>x</p><script src="${TOOLBAR_PATH}" defer></script></body></html>`);
  });

  it('appends when there is no </body>, and never twice', () => {
    const once = injectToolbar('<p>x</p>');
    expect(once.endsWith('</script>')).toBe(true);
    expect(injectToolbar(once)).toBe(once);
  });

  it('puts the React hook first in <head>, before the app\'s scripts', () => {
    const html = injectToolbar('<html><head lang="x"><script src="/app.js"></script></head><body></body></html>');
    expect(html.indexOf('data-ilse-hook')).toBeGreaterThan(html.indexOf('<head lang="x">'));
    expect(html.indexOf('data-ilse-hook')).toBeLessThan(html.indexOf('/app.js'));
    expect(html.match(/data-ilse-hook/g)).toHaveLength(1);
  });
});

describe('startProxy', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let proxy: RunningProxy;
  const echoSockets = new Set<net.Socket>();

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "script-src 'none'", 'x-frame-options': 'DENY' });
        res.end('<html><body>app</body></html>');
      } else if (req.url === '/app.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end('console.log("</body>")');
      } else if (req.url === '/go') {
        res.writeHead(302, { location: `http://localhost:${upstreamPort}/` });
        res.end();
      } else {
        res.writeHead(404); res.end();
      }
    });
    // Minimal upgrade echo: answers the handshake, then echoes bytes
    upstream.on('upgrade', (_req, socket) => {
      echoSockets.add(socket as net.Socket);
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      socket.on('data', d => socket.write(d));
    });
    await new Promise<void>(r => upstream.listen(0, '127.0.0.1', () => r()));
    upstreamPort = (upstream.address() as net.AddressInfo).port;

    const dir = mkdtempSync(join(tmpdir(), 'ilse-proxy-'));
    const toolbarFile = join(dir, 'toolbar.js');
    writeFileSync(toolbarFile, 'window.__toolbar = 1');
    proxy = await startProxy({ target: { host: '127.0.0.1', port: upstreamPort }, port: 4790, maxPort: 4799, toolbarFile });
  });

  afterAll(async () => {
    await proxy.close();
    for (const s of echoSockets) s.destroy();
    upstream.closeAllConnections();
    await new Promise(r => upstream.close(r));
  });

  const get = (path: string) => fetch(`http://127.0.0.1:${proxy.port}${path}`, { redirect: 'manual' });

  it('lets the page into the Screens iframe, and only there', async () => {
    const top = await get('/');
    expect(top.headers.get('x-frame-options')).toBe('DENY');
    const framed = await fetch(`http://127.0.0.1:${proxy.port}/`, { headers: { 'sec-fetch-dest': 'iframe' } });
    expect(framed.headers.get('x-frame-options')).toBeNull();
    expect(framed.headers.get('content-security-policy')).toBeNull();
  });

  it('injects the toolbar into HTML and drops a blocking CSP', async () => {
    const res = await get('/');
    const body = await res.text();
    expect(body).toContain(`<script src="${TOOLBAR_PATH}" defer></script></body>`);
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(Number(res.headers.get('content-length'))).toBe(Buffer.byteLength(body));
  });

  it('passes non-HTML through untouched', async () => {
    expect(await (await get('/app.js')).text()).toBe('console.log("</body>")');
  });

  it('serves the toolbar bundle', async () => {
    expect(await (await get(TOOLBAR_PATH)).text()).toBe('window.__toolbar = 1');
  });

  it('rewrites redirects back to the proxy', async () => {
    const res = await get('/go');
    expect(res.headers.get('location')).toBe(`http://localhost:${proxy.port}/`);
  });

  it('pipes WebSocket upgrades (HMR)', async () => {
    const echoed = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(proxy.port, '127.0.0.1', () => {
        sock.write('GET /hmr HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      });
      let buf = '';
      sock.on('data', (d) => {
        buf += d.toString();
        if (buf.includes('101') && !buf.includes('ping')) sock.write('ping');
        if (buf.includes('ping')) { sock.destroy(); resolve(buf); }
      });
      sock.on('error', reject);
    });
    expect(echoed).toContain('101 Switching Protocols');
    expect(echoed).toContain('ping');
  });

  it('finds the dev server by probing ports', async () => {
    expect(await findDevServer('/nonexistent', [1, upstreamPort])).toEqual({ host: '127.0.0.1', port: upstreamPort });
  });
});

describe('startProxy: many cookies, a dev server that stopped', () => {
  let upstream: http.Server;
  let proxy: RunningProxy;

  beforeAll(async () => {
    // Node's default 16 KB, like a dev server Ilse didn't start
    upstream = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); });
    await new Promise<void>(r => upstream.listen(0, '127.0.0.1', () => r()));
    const port = (upstream.address() as net.AddressInfo).port;
    proxy = await startProxy({ target: { host: '127.0.0.1', port }, port: 4800, maxPort: 4809 });
  });

  afterAll(async () => {
    await proxy.close();
    upstream.closeAllConnections();
    await new Promise(r => upstream.close(r));
  });

  const cookie = (kb: number) => ({ cookie: `a=${'x'.repeat(kb * 1024)}` });

  it('takes cookies past 16 KB, and explains a 431 from the dev server', async () => {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/`, { headers: cookie(20) });
    expect(res.status).toBe(431);
    const body = await res.text();
    expect(body).toMatch(/localhost/);
    expect(body).toContain(`127.0.0.1:${proxy.port}`);
  });

  it('explains headers past its own limit too', async () => {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/`, { headers: cookie(80) });
    expect(res.status).toBe(431);
    expect(await res.text()).toContain(`127.0.0.1:${proxy.port}`);
  });

  it('says the app\'s server stopped, and follows a new target', async () => {
    const dead = net.createServer();
    await new Promise<void>(r => dead.listen(0, '127.0.0.1', () => r()));
    const deadPort = (dead.address() as net.AddressInfo).port;
    await new Promise(r => dead.close(r));
    proxy.setTarget({ host: '127.0.0.1', port: deadPort });
    const down = await fetch(`http://127.0.0.1:${proxy.port}/`);
    expect(down.status).toBe(502);
    expect(await down.text()).toContain(String(deadPort));
    proxy.setTarget({ host: '127.0.0.1', port: (upstream.address() as net.AddressInfo).port });
    expect(await (await fetch(`http://127.0.0.1:${proxy.port}/`)).text()).toBe('ok');
  });
});

describe('candidatePorts', () => {
  it('puts the dev script port and framework default first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ilse-ports-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite --port 5199' },
      devDependencies: { vite: '^7' },
    }));
    expect(candidatePorts(dir).slice(0, 2)).toEqual([5199, 5173]);
  });
});
