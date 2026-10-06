import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveToolbar, toolbarScript, TOOLBAR_PATH } from '../toolbar.js';
import { pageHasToolbar } from '../find-dev-server.js';

const dir = mkdtempSync(join(tmpdir(), 'ilse-toolbar-'));
const bundle = join(dir, 'toolbar.js');
writeFileSync(bundle, 'console.log("toolbar")');

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
}

async function get(port: number, path: string, method = 'GET'): Promise<{ status: number; type: string; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
}

describe('toolbarScript', () => {
  it('names the bridge port in the first line, so the toolbar connects there first', () => {
    expect(toolbarScript(bundle, 4749).toString()).toBe('self.__ilseBridgePort=4749;\nconsole.log("toolbar")');
  });

  it('is the bare bundle without a port', () => {
    expect(toolbarScript(bundle).toString()).toBe('console.log("toolbar")');
  });
});

describe('serveToolbar', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const file = req.headers['x-missing'] ? join(dir, 'nope.js') : bundle;
      if (serveToolbar(req, res, { file, bridgePort: 4748 })) return;
      res.writeHead(404);
      res.end('not mine');
    });
    port = await listen(server);
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('serves the bundle as JavaScript with the bridge port', async () => {
    const res = await get(port, TOOLBAR_PATH);
    expect(res.status).toBe(200);
    expect(res.type).toContain('text/javascript');
    expect(res.body).toBe('self.__ilseBridgePort=4748;\nconsole.log("toolbar")');
  });

  it('ignores a cache-busting query string', async () => {
    expect((await get(port, `${TOOLBAR_PATH}?t=123`)).status).toBe(200);
  });

  it('leaves other paths and methods to the caller', async () => {
    expect((await get(port, '/mcp')).body).toBe('not mine');
    expect((await get(port, TOOLBAR_PATH, 'POST')).body).toBe('not mine');
  });

  it('says how to fix a missing bundle', async () => {
    const res = await fetch(`http://127.0.0.1:${port}${TOOLBAR_PATH}`, { headers: { 'x-missing': '1' } });
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('npm run build');
  });
});

describe('pageHasToolbar', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/') {
        // What the Vite plugin produces
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html><body><div id="root"></div><script src="${TOOLBAR_PATH}" defer></script></body></html>`);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    port = await listen(server);
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('is true when the dev server HTML already loads the toolbar', async () => {
    expect(await pageHasToolbar({ host: '127.0.0.1', port })).toBe(true);
  });

  it('is false for a plain page, a redirect or nothing listening', async () => {
    const plain = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>app</body></html>'); });
    const redirect = http.createServer((_req, res) => { res.writeHead(302, { location: '/login' }); res.end(); });
    const plainPort = await listen(plain);
    const redirectPort = await listen(redirect);
    try {
      expect(await pageHasToolbar({ host: '127.0.0.1', port: plainPort })).toBe(false);
      expect(await pageHasToolbar({ host: '127.0.0.1', port: redirectPort })).toBe(false);
    } finally {
      await Promise.all([plain, redirect].map((s) => new Promise<void>((r) => s.close(() => r()))));
    }
    // Port 1 is never a dev server
    expect(await pageHasToolbar({ host: '127.0.0.1', port: 1 }, 300)).toBe(false);
  });
});
