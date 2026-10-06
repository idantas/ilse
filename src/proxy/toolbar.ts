/**
 * The toolbar bundle and the tag that loads it — shared by every way the
 * toolbar reaches a page: the proxy, the bridge port (Vite plugin, bookmarklet,
 * browser extension) and the Vite plugin's middleware.
 */

import type http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const TOOLBAR_PATH = '/__ilse/toolbar.js';
const TOOLBAR_TAG = `<script src="${TOOLBAR_PATH}" defer></script>`;

export function defaultToolbarFile(): string {
  // dist/proxy/toolbar.js → dist/standalone/toolbar.js
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'standalone', 'toolbar.js');
}

/** Inserts the toolbar script before </body>, or at the end if there is none. */
export function injectToolbar(html: string): string {
  if (html.includes(TOOLBAR_PATH)) return html;
  const idx = html.lastIndexOf('</body>');
  return idx === -1 ? html + TOOLBAR_TAG : html.slice(0, idx) + TOOLBAR_TAG + html.slice(idx);
}

/**
 * The bundle, prefixed with the port of the `ilse` serving it. The toolbar
 * connects there first instead of scanning up from 4747, where another
 * project's `ilse` may be listening.
 */
export function toolbarScript(file: string = defaultToolbarFile(), bridgePort?: number): Buffer {
  const js = readFileSync(file);
  return bridgePort ? Buffer.concat([Buffer.from(`self.__ilseBridgePort=${bridgePort};\n`), js]) : js;
}

export interface ServeToolbarOptions {
  /** Override the bundle location (tests) */
  file?: string;
  bridgePort?: number;
}

/**
 * Answers GET /__ilse/toolbar.js (any query string — a bookmarklet may add a
 * cache-buster). Returns false for every other request.
 */
export function serveToolbar(req: http.IncomingMessage, res: http.ServerResponse, opts: ServeToolbarOptions = {}): boolean {
  if (req.method !== 'GET' || req.url?.split('?')[0] !== TOOLBAR_PATH) return false;
  const file = opts.file ?? defaultToolbarFile();
  try {
    // Read per request: rebuilding the bundle needs no restart
    const js = toolbarScript(file, opts.bridgePort);
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    res.end(js);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`Ilse toolbar bundle not found at ${file}. Run "npm run build".`);
  }
  return true;
}
