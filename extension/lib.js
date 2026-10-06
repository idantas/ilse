// Pure logic of the extension, kept apart from the chrome.* calls so it can
// be tested in Node (src/extension/__tests__/lib.test.ts).

/** Where a running `ilse` listens: 4747, or the next free port up to 4757 */
export const BRIDGE_PORTS = Array.from({ length: 11 }, (_, i) => 4747 + i);

const LOCAL_PAGE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;

/** Ilse only works on the dev server running on this machine */
export function isLocalPage(url) {
  return typeof url === 'string' && LOCAL_PAGE.test(url);
}

export function originOf(url) {
  return new URL(url).origin;
}

/** Turns the toolbar on or off for one origin; the rest of the list stays */
export function toggleOrigin(origins, origin) {
  return origins.includes(origin) ? origins.filter((o) => o !== origin) : [...origins, origin];
}

/**
 * The toolbar bundle from the first `ilse` that answers. Fetched here, in the
 * extension, so the page's service worker (MSW, PWAs) never sees the request.
 * The bundle names the port it came from; when that `ilse` belongs to another
 * project, the toolbar moves on to the next port by itself.
 */
export async function fetchToolbar(fetchImpl, ports = BRIDGE_PORTS) {
  for (const port of ports) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/__ilse/toolbar.js`, { cache: 'no-store' });
      if (res.ok) return await res.text();
    } catch {
      // nothing on this port
    }
  }
  return null;
}
