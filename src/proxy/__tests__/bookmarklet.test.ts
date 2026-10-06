import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import { bookmarkletCode, loaderHtml, serveBookmarklet, LOADER_PATH, BOOKMARKLET_PATH } from '../bookmarklet.js';
import { TOOLBAR_PATH } from '../toolbar.js';
import { setLocale } from '../../i18n/index.js';

describe('bookmarkletCode', () => {
  const url = bookmarkletCode(4748, 'Ilse "isn\'t" running');
  const body = url.slice('javascript:'.length);

  it('is one line of valid JavaScript behind javascript:', () => {
    expect(url.startsWith('javascript:')).toBe(true);
    expect(url).not.toContain('\n');
    expect(() => new Function(body)).not.toThrow();
  });

  it("frames the loader on that port's origin and only trusts messages from it", () => {
    expect(body).toContain('"http://localhost:4748"');
    expect(body).toContain(JSON.stringify(LOADER_PATH));
    expect(body).toContain('e.origin!==o');
  });

  it('runs the toolbar inline — no request for a service worker to drop', () => {
    expect(body).toContain('s.textContent=e.data.code');
    expect(body).not.toContain(TOOLBAR_PATH);
  });

  it('keeps the not-running message intact, quotes included', () => {
    expect(body).toContain(JSON.stringify('Ilse "isn\'t" running'));
    // javascript: URLs are percent-decoded by the browser
    expect(url).not.toContain('%');
  });
});

describe('loaderHtml', () => {
  it('fetches the toolbar on its own origin and answers loopback pages only', () => {
    const html = loaderHtml();
    expect(html).toContain(`fetch(${JSON.stringify(TOOLBAR_PATH)}`);
    expect(html).toContain("e.data !== 'ilse:load'");
    expect(html).toContain('localhost|127');
    expect(html).toContain('e.source.postMessage');
  });
});

describe('serveBookmarklet', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (serveBookmarklet(req, res, 4749)) return;
      res.writeHead(404);
      res.end('not mine');
    });
    port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)));
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  afterEach(() => setLocale('en'));

  const get = async (path: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
  };

  it('serves the loader page', async () => {
    const res = await get(LOADER_PATH);
    expect(res.type).toContain('text/html');
    expect(res.body).toBe(loaderHtml());
  });

  it('serves a page with the bookmarklet to drag, escaped into the link', async () => {
    const res = await get(BOOKMARKLET_PATH);
    expect(res.body).toContain('Drag the button below to your bookmarks bar.');
    const href = res.body.match(/<a class="b" href="([^"]+)"/)?.[1];
    expect(href?.startsWith('javascript:')).toBe(true);
    expect(href).toContain('&quot;http://localhost:4749&quot;');
  });

  it('speaks the user language', async () => {
    setLocale('pt');
    expect((await get(BOOKMARKLET_PATH)).body).toContain('Arraste o botão abaixo para a barra de favoritos.');
  });

  it('leaves other paths to the caller', async () => {
    expect((await get('/mcp')).body).toBe('not mine');
  });
});
