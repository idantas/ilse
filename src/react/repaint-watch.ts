/**
 * Did the page show the change? After a change lands in the code, the dev server
 * usually repaints the page (HMR / Fast Refresh). Some parts don't: a server-rendered
 * component, a page outside the bundler's reach, a module that can't hot-swap and
 * stays stale until a reload. The toolbar can't ask the framework, so it watches the
 * page: any change to the app's own DOM after the code changed counts as a repaint.
 * Ilse's own nodes (toolbar, drafts, previews, markers) and its own attributes don't.
 */

/** What counts of a MutationRecord, as plain data (testable without a DOM) */
export interface MutationLike {
  type: 'childList' | 'attributes' | 'characterData';
  /** Inside Ilse's own UI or one of its copies */
  targetIsIlse: boolean;
  attributeName?: string | null;
  /** childList: whether every added/removed node is one of Ilse's */
  nodesAllIlse?: boolean;
}

export function countsAsRepaint(m: MutationLike): boolean {
  if (m.targetIsIlse) return false;
  if (m.type === 'childList') return !m.nodesAllIlse;
  if (m.type === 'attributes') return m.attributeName === 'class';
  return true;
}

/** How long a repaint may take: Fast Refresh is ~100 ms, a server component's refetch a few seconds */
export const REPAINT_WAIT_MS = 6000;

const ILSE_NODE = '[data-ilse-toolbar],[data-ilse-draft],[data-ilse-variant-for],[data-ilse-placeholder],[data-ilse-marker]';

function isIlse(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return !!el?.closest(ILSE_NODE);
}

/**
 * Did the region repaint since `since`? Only changes inside it count: a page that
 * changes on its own elsewhere (scrambled text, a carousel, live data) must not pass
 * for the change showing. A region that left the page was replaced by a re-render.
 */
export function regionRepainted<N>(regions: Array<{ contains: (n: N) => boolean; isConnected: boolean }>, seen: Array<{ at: number; target: N }>, since: number): boolean {
  if (regions.some(r => !r.isConnected)) return true;
  return seen.some(m => m.at > since && regions.some(r => r.contains(m.target)));
}

/**
 * Starts watching the page. `last()`: when the app's DOM last changed (0: not since start);
 * `repaintedIn(regions, since)`: whether it changed inside those regions since then.
 */
export function watchRepaints(): { last: () => number; repaintedIn: (regions: Element[], since: number) => boolean; stop: () => void } {
  let at = 0;
  // The app's recent changes, newest last — enough for the few seconds a check waits
  const seen: Array<{ at: number; target: Node }> = [];
  const observer = new MutationObserver(records => {
    for (const r of records) {
      const nodes = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
      const like: MutationLike = {
        type: r.type,
        targetIsIlse: isIlse(r.target),
        attributeName: r.attributeName,
        nodesAllIlse: nodes.length > 0 && nodes.every(n => n instanceof Element ? n.matches(ILSE_NODE) || isIlse(n) : false),
      };
      if (!countsAsRepaint(like)) continue;
      at = Date.now();
      seen.push({ at, target: r.target });
    }
    if (seen.length > 400) seen.splice(0, seen.length - 400);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  return { last: () => at, repaintedIn: (regions, since) => regionRepainted(regions, seen, since), stop: () => observer.disconnect() };
}

/** Whitespace-insensitive: the browser's line breaks and the JSX's indentation differ */
export function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

/**
 * Asks the framework to re-render the page without a reload, keeping its state. Next's App
 * Router exposes its router on `window.next` (dev and prod); a server component that didn't
 * pick up the change usually shows it after this. False when there's no such router.
 */
export function softRefresh(): boolean {
  const router = (window as unknown as { next?: { router?: { refresh?: () => void } } }).next?.router;
  if (typeof router?.refresh !== 'function') return false;
  try { router.refresh(); return true; } catch { return false; }
}
