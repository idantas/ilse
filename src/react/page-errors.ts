/**
 * Errors the page shows after a change. A change can land, repaint and still break the page:
 * a duplicated list key, a prop of the wrong type, a hook in the wrong place. React and the
 * framework say so in the console, where a designer never looks. The toolbar listens from the
 * start, and after a change offers to undo it or to have the agent fix what it broke.
 * Nothing leaves the page except to the user's own agent, and only when asked.
 */

export interface PageError { at: number; message: string }

/** console.error's arguments as one line: React logs `printf`-style ("key `%s`", name) */
export function formatConsoleArgs(args: unknown[]): string {
  const [first, ...rest] = args;
  const str = (v: unknown): string => {
    if (v instanceof Error) return v.message;
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
  };
  let text = str(first);
  if (typeof first === 'string') {
    text = first.replace(/%[sdifoOc]/g, spec => {
      const v = rest.shift();
      return spec === '%c' ? '' : str(v);
    });
  }
  return [text, ...rest.map(str)].join(' ').replace(/\s+/g, ' ').trim();
}

/** Logged by the browser, the dev tooling or Ilse itself — not the app breaking */
export function isNoise(message: string): boolean {
  return !message
    || /^\[ilse/i.test(message)
    || /ResizeObserver loop/i.test(message)
    || /Download the React DevTools/i.test(message)
    || /\[(HMR|Fast Refresh)\]/i.test(message)
    || /favicon\.ico/i.test(message);
}

/**
 * The errors that appeared since `since` and weren't there before it: a page that already
 * logged the same error before the change wasn't broken by it. One entry per message.
 */
export function newErrors(seen: PageError[], since: number): string[] {
  const before = new Set(seen.filter(e => e.at < since).map(e => e.message));
  const out: string[] = [];
  for (const e of seen) {
    if (e.at < since || before.has(e.message) || out.includes(e.message)) continue;
    out.push(e.message);
  }
  return out;
}

/** Starts listening: console.error, uncaught errors and rejected promises */
export function watchPageErrors(): { seen: () => PageError[]; stop: () => void } {
  const seen: PageError[] = [];
  const add = (message: string) => {
    if (isNoise(message)) return;
    seen.push({ at: Date.now(), message: message.slice(0, 2000) });
    if (seen.length > 200) seen.splice(0, seen.length - 200);
  };
  const original = console.error;
  console.error = function (...args: unknown[]) {
    try { add(formatConsoleArgs(args)); } catch { /* never break the page's own logging */ }
    return original.apply(this, args as []);
  };
  const onError = (e: ErrorEvent) => add(e.error instanceof Error ? e.error.message : e.message);
  const onRejection = (e: PromiseRejectionEvent) => add(formatConsoleArgs([e.reason]));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return {
    seen: () => seen,
    stop: () => {
      if (console.error !== original) console.error = original;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    },
  };
}
