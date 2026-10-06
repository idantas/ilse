/**
 * Vite plugin — the toolbar on the dev server's own port, no proxy.
 *
 *   // vite.config.ts
 *   import { ilse } from 'ilse-design/vite';
 *   export default defineConfig({ plugins: [react(), ilse()] });
 *
 * The app keeps its own origin, so what is tied to it keeps working: the
 * login session in localStorage, OAuth callbacks, links in emails.
 *
 * Only in `vite dev` (apply: 'serve') — a build never sees it. The page gets
 * <script src="/__ilse/toolbar.js">, and the middleware fetches that file from
 * the running `ilse`, so the toolbar always matches the CLI version.
 */

import http from 'node:http';
import { resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import { TOOLBAR_PATH } from '../proxy/toolbar.js';
import { readServerInfo, type ServerInfo } from '../config/local-token.js';
import { loadUserConfig } from '../config/user-config.js';
import { t, setLocale, detectLocale } from '../i18n/index.js';

const BRIDGE_PORT = 4747;

export interface IlseViteOptions {
  /** Port of the running `ilse`. Default: the one it announced for this project, then 4747. */
  port?: number;
}

/** `a` and `b` are the same folder, or one contains the other (ilse run from a monorepo root) */
function samePlace(a: string, b: string): boolean {
  const x = resolve(a), y = resolve(b);
  return x === y || x.startsWith(y + sep) || y.startsWith(x + sep);
}

/** Where to ask for the toolbar, in order. */
export function bridgePorts(root: string, opts: IlseViteOptions = {}, info: ServerInfo | null = readServerInfo()): number[] {
  const ports: number[] = [];
  if (opts.port) ports.push(opts.port);
  // ~/.ilse/server.json names the last `ilse` started — only trust it for this project
  if (info && samePlace(info.cwd, root)) ports.push(info.port);
  ports.push(BRIDGE_PORT);
  return [...new Set(ports)];
}

function fetchToolbar(port: number, timeoutMs = 1500): Promise<Buffer | null> {
  return new Promise((done) => {
    const req = http.get({ host: '127.0.0.1', port, path: TOOLBAR_PATH, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); done(null); return; }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(Buffer.concat(chunks)));
      res.on('error', () => done(null));
    });
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
  });
}

/**
 * Serves /__ilse/toolbar.js from the first `ilse` that answers. When none
 * does, an empty script keeps the page clean, and a reload after starting
 * `ilse` brings the toolbar.
 */
export function toolbarMiddleware(ports: () => number[], onMissing: () => void = () => {}) {
  return (req: http.IncomingMessage, res: http.ServerResponse, next: () => void): void => {
    if (req.url?.split('?')[0] !== TOOLBAR_PATH) { next(); return; }
    void (async () => {
      let js: Buffer | null = null;
      for (const port of ports()) {
        js = await fetchToolbar(port);
        if (js) break;
      }
      if (!js) onMissing();
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      res.end(js ?? '/* Ilse is not running */\n');
    })();
  };
}

export function ilse(opts: IlseViteOptions = {}): Plugin {
  return {
    name: 'ilse',
    apply: 'serve',
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { src: TOOLBAR_PATH, defer: true }, injectTo: 'body' }];
    },
    configureServer(server) {
      setLocale(loadUserConfig().locale ?? detectLocale());
      let warned = false;
      server.middlewares.use(toolbarMiddleware(
        () => bridgePorts(server.config.root, opts),
        () => { if (!warned) { warned = true; server.config.logger.info(t('vite.notRunning')); } },
      ));
    },
  };
}

export default ilse;
