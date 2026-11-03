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
/** Set on every page an Ilse proxy serves: a toolbar there is that proxy's, not the app's own plugin */
export const PROXY_HEADER = 'x-ilse-proxy';
const TOOLBAR_TAG = `<script src="${TOOLBAR_PATH}" defer></script>`;

/**
 * The smallest React DevTools hook React accepts, for pages where nothing
 * installs one before React loads. With it, the panel shows a picked prop on
 * the real component (`src/react/live-props.ts`). React Refresh and the
 * DevTools extension keep or wrap it; one already there is left alone.
 */
export const HOOK_STUB = `document.currentScript&&document.currentScript.remove();(function(w){if(w.__REACT_DEVTOOLS_GLOBAL_HOOK__)return;var n=0,r=new Map();w.__REACT_DEVTOOLS_GLOBAL_HOOK__={renderers:r,supportsFiber:true,isDisabled:false,inject:function(x){var i=++n;r.set(i,x);return i},onCommitFiberRoot:function(){},onCommitFiberUnmount:function(){},onPostCommitFiberRoot:function(){},onScheduleFiberRoot:function(){},checkDCE:function(){}}})(window);`;
// It takes itself out of <head> once it ran: Next hydrates <head>, and a script React didn't
// render there is a hydration mismatch
const HOOK_TAG = `<script data-ilse-hook>${HOOK_STUB}</script>`;

export function defaultToolbarFile(): string {
  // dist/proxy/toolbar.js → dist/standalone/toolbar.js
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'standalone', 'toolbar.js');
}

/**
 * Inserts the toolbar script before </body>, or at the end if there is none —
 * and the hook first thing in <head>, before any of the app's scripts.
 */
export function injectToolbar(html: string): string {
  if (html.includes(TOOLBAR_PATH)) return html;
  const idx = html.lastIndexOf('</body>');
  const out = idx === -1 ? html + TOOLBAR_TAG : html.slice(0, idx) + TOOLBAR_TAG + html.slice(idx);
  const head = /<head[^>]*>/i.exec(out);
  return head ? out.slice(0, head.index + head[0].length) + HOOK_TAG + out.slice(head.index + head[0].length) : out;
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
