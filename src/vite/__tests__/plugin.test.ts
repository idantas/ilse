import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, resolveConfig, type ViteDevServer } from 'vite';
import { ilse, bridgePorts, toolbarMiddleware } from '../index.js';
import { TOOLBAR_PATH } from '../../proxy/toolbar.js';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** A stand-in for the running `ilse`: answers only the toolbar path */
async function fakeBridge(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    if (req.url === TOOLBAR_PATH) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end('self.__ilseBridgePort=4750;\n/* toolbar */');
    } else {
      res.writeHead(426);
      res.end();
    }
  });
  return { server, port: await listen(server) };
}

/** A port nothing listens on */
async function deadPort(): Promise<number> {
  const s = http.createServer();
  const port = await listen(s);
  await close(s);
  return port;
}

describe('bridgePorts', () => {
  const info = { port: 4751, pid: 1, cwd: '/work/app', startedAt: '' };

  it('tries the explicit port, then the one ilse announced for this project, then 4747', () => {
    expect(bridgePorts('/work/app', { port: 4760 }, info)).toEqual([4760, 4751, 4747]);
  });

  it('trusts the announced port when ilse runs from the monorepo root or a subfolder', () => {
    expect(bridgePorts('/work/app/apps/web', {}, info)).toEqual([4751, 4747]);
    expect(bridgePorts('/work', {}, info)).toEqual([4751, 4747]);
  });

  it("ignores another project's ilse and never repeats a port", () => {
    expect(bridgePorts('/work/other', {}, info)).toEqual([4747]);
    expect(bridgePorts('/work/app-two', {}, info)).toEqual([4747]);
    expect(bridgePorts('/work/other', { port: 4747 }, null)).toEqual([4747]);
  });
});

describe('toolbarMiddleware', () => {
  let bridge: { server: http.Server; port: number };
  let dead: number;

  beforeAll(async () => {
    bridge = await fakeBridge();
    dead = await deadPort();
  });

  afterAll(() => close(bridge.server));

  async function serve(ports: number[], path = TOOLBAR_PATH) {
    let missing = 0;
    const mw = toolbarMiddleware(() => ports, () => { missing++; });
    const server = http.createServer((req, res) => mw(req, res, () => { res.writeHead(404); res.end('next'); }));
    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text(), missing };
    } finally {
      await close(server);
    }
  }

  it('relays the toolbar from the first ilse that answers', async () => {
    const res = await serve([dead, bridge.port]);
    expect(res.status).toBe(200);
    expect(res.type).toContain('text/javascript');
    expect(res.body).toContain('__ilseBridgePort=4750');
    expect(res.missing).toBe(0);
  });

  it('serves an empty script and reports it when ilse is not running', async () => {
    const res = await serve([dead]);
    expect(res.status).toBe(200);
    expect(res.body).toBe('/* Ilse is not running */\n');
    expect(res.missing).toBe(1);
  });

  it('passes every other request on', async () => {
    expect((await serve([bridge.port], '/src/main.tsx')).body).toBe('next');
  });
});

describe('ilse() in a real Vite dev server', () => {
  let bridge: { server: http.Server; port: number };
  let vite: ViteDevServer;
  let app: http.Server;
  let appPort: number;
  const root = mkdtempSync(join(tmpdir(), 'ilse-vite-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head></head><body><div id="root"></div></body></html>');

  beforeAll(async () => {
    bridge = await fakeBridge();
    vite = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true },
      server: { middlewareMode: true, hmr: false, watch: null },
      plugins: [ilse({ port: bridge.port })],
    });
    app = http.createServer(vite.middlewares);
    appPort = await listen(app);
  });

  afterAll(async () => {
    await close(app);
    await vite.close();
    await close(bridge.server);
  });

  it("loads the toolbar from the app's own origin", async () => {
    const html = await (await fetch(`http://127.0.0.1:${appPort}/`, { headers: { accept: 'text/html' } })).text();
    expect(html).toContain(`<script src="${TOOLBAR_PATH}" defer></script>`);
    const js = await (await fetch(`http://127.0.0.1:${appPort}${TOOLBAR_PATH}`)).text();
    expect(js).toContain('/* toolbar */');
  });

  it('stays out of production builds', async () => {
    const config = await resolveConfig({ root, configFile: false, logLevel: 'silent', plugins: [ilse()] }, 'build');
    expect(config.plugins.map((p) => p.name)).not.toContain('ilse');
  });
});
