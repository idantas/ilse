/**
 * Dev proxy — puts the toolbar on the page without touching the project.
 *
 *   browser → localhost:4700 (Ilse) → localhost:3000 (the user's dev server)
 *
 * Everything is forwarded untouched except HTML documents, which get one
 * <script> before </body>. WebSocket upgrades (Next/Vite HMR) are piped raw.
 * The Host header is kept, so the app sees a single origin and HMR clients
 * that connect to `location.host` come back through the proxy.
 */

import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { t } from '../i18n/index.js';

export const TOOLBAR_PATH = '/__ilse/toolbar.js';
const TOOLBAR_TAG = `<script src="${TOOLBAR_PATH}" defer></script>`;

export interface DevTarget { host: string; port: number }

export interface ProxyOptions {
  target: DevTarget;
  port?: number;          // first port to try
  maxPort?: number;
  /** Override the bundle location (tests) */
  toolbarFile?: string;
}

export interface RunningProxy { port: number; close: () => Promise<void> }

function defaultToolbarFile(): string {
  // dist/proxy/server.js → dist/standalone/toolbar.js
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'standalone', 'toolbar.js');
}

/** Inserts the toolbar script before </body>, or at the end if there is none. */
export function injectToolbar(html: string): string {
  if (html.includes(TOOLBAR_PATH)) return html;
  const idx = html.lastIndexOf('</body>');
  return idx === -1 ? html + TOOLBAR_TAG : html.slice(0, idx) + TOOLBAR_TAG + html.slice(idx);
}

/** Absolute redirects to the dev server must come back through the proxy. */
function rewriteLocation(location: string, target: DevTarget, proxyPort: number): string {
  return location.replace(
    new RegExp(`^(https?://)(localhost|127\\.0\\.0\\.1|\\[::1\\]):${target.port}(?=/|$)`),
    `$1localhost:${proxyPort}`,
  );
}

export async function startProxy(opts: ProxyOptions): Promise<RunningProxy> {
  const toolbarFile = opts.toolbarFile ?? defaultToolbarFile();
  const target = opts.target;
  let proxyPort = 0;

  const server = http.createServer((req, res) => {
    if (req.url === TOOLBAR_PATH) {
      try {
        // Read per request: rebuilding the bundle needs no proxy restart
        const js = readFileSync(toolbarFile);
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        res.end(js);
      } catch {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(`Ilse toolbar bundle not found at ${toolbarFile}. Run "npm run build".`);
      }
      return;
    }

    const headers = { ...req.headers };
    // Compressed HTML can't be edited — ask the dev server for plain bytes
    if (req.headers.accept?.includes('text/html')) headers['accept-encoding'] = 'identity';

    const upstream = http.request(
      { host: target.host, port: target.port, method: req.method, path: req.url, headers },
      (up) => {
        const outHeaders = { ...up.headers };
        if (typeof outHeaders.location === 'string') {
          outHeaders.location = rewriteLocation(outHeaders.location, target, proxyPort);
        }

        const type = String(up.headers['content-type'] ?? '');
        const encoded = up.headers['content-encoding'] && up.headers['content-encoding'] !== 'identity';
        if (!type.includes('text/html') || encoded) {
          res.writeHead(up.statusCode ?? 502, outHeaders);
          up.pipe(res);
          return;
        }

        // HTML: buffer, inject, send. Streaming (RSC/Suspense) pages are held
        // until the document ends — acceptable in dev, and it keeps </body> intact.
        const chunks: Buffer[] = [];
        up.on('data', (c: Buffer) => chunks.push(c));
        up.on('end', () => {
          const body = Buffer.from(injectToolbar(Buffer.concat(chunks).toString('utf8')), 'utf8');
          delete outHeaders['content-length'];
          delete outHeaders['transfer-encoding'];
          // A CSP from the dev server would block the injected script
          delete outHeaders['content-security-policy'];
          outHeaders['content-length'] = String(body.length);
          res.writeHead(up.statusCode ?? 200, outHeaders);
          res.end(body);
        });
        up.on('error', () => res.destroy());
      },
    );

    upstream.on('error', (err) => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(t('proxy.unreachable', { host: target.host, port: target.port, error: err.message }));
    });
    req.pipe(upstream);
  });

  // Upgraded sockets leave the HTTP server's bookkeeping — track them for close()
  const tunnels = new Set<net.Socket>();

  // HMR and any other WebSocket: replay the upgrade request, then pipe raw bytes
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(target.port, target.host, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    for (const s of [upstream, socket as net.Socket]) {
      tunnels.add(s);
      s.on('close', () => tunnels.delete(s));
    }
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  });

  const first = opts.port ?? 4700;
  const last = opts.maxPort ?? first + 10;
  for (let port = first; port <= last; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      // Loopback only, like the WS server: the proxy exposes the dev server
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (ok) { proxyPort = port; break; }
  }
  if (!proxyPort) throw new Error(`Nenhuma porta livre entre ${first} e ${last}`);

  return {
    port: proxyPort,
    close: () => new Promise<void>((resolve) => {
      for (const s of tunnels) s.destroy();
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
