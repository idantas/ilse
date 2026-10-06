/**
 * Bookmarklet — the toolbar on any local page, with no proxy and nothing in
 * the project. Served by the running `ilse` on its WebSocket port.
 *
 * A plain <script src="http://localhost:4747/…"> isn't enough: a page's
 * service worker (MSW, PWAs) sees that request and can drop it. So the
 * bookmarklet frames a loader page on Ilse's own origin — out of the page's
 * service worker scope — which fetches the bundle and hands its text back
 * over postMessage. The page then runs it as an inline script: no request.
 */

import type http from 'node:http';
import { TOOLBAR_PATH } from './toolbar.js';
import { t } from '../i18n/index.js';

export const LOADER_PATH = '/__ilse/loader.html';
export const BOOKMARKLET_PATH = '/__ilse/bookmarklet';

// Same rule as the WebSocket: only loopback pages get the toolbar handed over
const LOCAL_ORIGIN_SRC = String.raw`^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$`;

export function loaderHtml(): string {
  return `<!doctype html><meta charset="utf-8"><title>Ilse</title><script>
addEventListener('message', async (e) => {
  if (e.data !== 'ilse:load' || !e.source || !new RegExp(${JSON.stringify(LOCAL_ORIGIN_SRC)}).test(e.origin)) return;
  const res = await fetch(${JSON.stringify(TOOLBAR_PATH)}, { cache: 'no-store' });
  if (res.ok) e.source.postMessage({ type: 'ilse:toolbar', code: await res.text() }, e.origin);
});
</script>`;
}

/**
 * The `javascript:` URL. `notRunning` is shown when no `ilse` answers on
 * `port` within a few seconds.
 */
export function bookmarkletCode(port: number, notRunning: string): string {
  const origin = `http://localhost:${port}`;
  const body = `(()=>{
if(window.__ilseToolbar)return;
const o=${JSON.stringify(origin)},f=document.createElement('iframe');
f.style.display='none';f.src=o+${JSON.stringify(LOADER_PATH)};
const done=e=>{if(e.origin!==o||!e.data||e.data.type!=='ilse:toolbar')return;
removeEventListener('message',done);clearTimeout(w);f.remove();
const s=document.createElement('script');s.textContent=e.data.code;(document.head||document.documentElement).appendChild(s);s.remove()};
addEventListener('message',done);
f.onload=()=>f.contentWindow.postMessage('ilse:load',o);
const w=setTimeout(()=>{removeEventListener('message',done);f.remove();alert(${JSON.stringify(notRunning)})},5000);
document.body.appendChild(f)})()`;
  return 'javascript:' + body.replace(/\n/g, '');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A page with the bookmarklet as a link to drag to the bookmarks bar. */
export function bookmarkletPage(port: number): string {
  const href = bookmarkletCode(port, t('bookmarklet.notRunning', { port }));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ilse — bookmarklet</title>
<style>
:root{color-scheme:light dark;--fg:#0a0a0a;--muted:#6b6b6b;--bg:#fff;--btn:#0a0a0a;--btn-fg:#fff}
@media (prefers-color-scheme:dark){:root{--fg:#ededed;--muted:#a0a0a0;--bg:#0a0a0a;--btn:#ededed;--btn-fg:#0a0a0a}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:560px;margin:64px auto;padding:0 16px}
h1{font-size:22px;margin:0 0 16px}
p{margin:0 0 16px;color:var(--muted)}
a.b{display:inline-block;margin:8px 0 24px;padding:10px 18px;border-radius:8px;background:var(--btn);color:var(--btn-fg);font-weight:600;text-decoration:none;cursor:grab}
</style></head><body><main>
<h1>${escapeHtml(t('bookmarklet.pageTitle'))}</h1>
<p>${escapeHtml(t('bookmarklet.pageDrag'))}</p>
<a class="b" href="${escapeHtml(href)}">Ilse</a>
<p>${escapeHtml(t('bookmarklet.pageUse'))}</p>
</main></body></html>`;
}

/** Answers the loader and the bookmarklet page. Returns false for every other request. */
export function serveBookmarklet(req: http.IncomingMessage, res: http.ServerResponse, port: number): boolean {
  if (req.method !== 'GET') return false;
  const path = req.url?.split('?')[0];
  if (path !== LOADER_PATH && path !== BOOKMARKLET_PATH) return false;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(path === LOADER_PATH ? loaderHtml() : bookmarkletPage(port));
  return true;
}
