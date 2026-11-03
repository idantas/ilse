/**
 * A prop picked in the panel, seen on the real component before it's applied.
 *
 * React's dev builds hand DevTools a renderer through
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__`; its `overrideProps` re-renders one fiber
 * with a prop changed — the same thing DevTools' props editor does. So the
 * draft is the app's own component (it opens, filters, reacts), not a copy of
 * another instance. The hook is there in dev whenever React Refresh is (Vite,
 * Next, CRA) or when the proxy's `HOOK_STUB` ran before React; without a renderer that can
 * override, callers fall back to the copy.
 *
 * A parent that renders again passes the props from its JSX: after every
 * commit the override is put back while the draft lives.
 */

import { componentTypeName } from './annotator.js';
import { sourceNames } from './catalog-snapshot.js';

type F = { tag?: number; type?: unknown; return?: F | null; child?: F | null; sibling?: F | null; alternate?: F | null; stateNode?: unknown; memoizedProps?: Record<string, unknown> };
type Path = Array<string | number>;
interface Renderer {
  overrideProps?: (fiber: F, path: Path, value: unknown) => void;
  overridePropsDeletePath?: (fiber: F, path: Path) => void;
}
interface Hook { renderers?: Map<number, Renderer>; onCommitFiberRoot?: (...args: unknown[]) => unknown; __ilseLive?: boolean }

const HOST_ROOT = 3;
/** A prop back to its default: deleted from the props, not set to undefined */
export const UNSET = Symbol('unset');
type Value = unknown | typeof UNSET;

function hook(): Hook | undefined {
  return (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
}

function renderer(): Renderer | undefined {
  for (const r of hook()?.renderers?.values() ?? []) if (typeof r.overrideProps === 'function') return r;
  return undefined;
}

/** Can a prop be shown live on this page (dev React with a hook that came first)? */
export function canLiveProps(): boolean {
  return !!renderer();
}

function fiberOf(el: Element): F | null {
  const k = Object.keys(el).find(key => key.startsWith('__reactFiber$'));
  return k ? (el as unknown as Record<string, F>)[k] : null;
}

/** The outermost fiber above `el` of the named component — the one `componentAt` reads its props from */
export function componentFiber(el: Element, name: string): F | null {
  let found: F | null = null;
  for (let x = fiberOf(el)?.return ?? null, d = 0; x && typeof x.type !== 'string' && d < 40; x = x.return ?? null, d++) {
    const typeName = componentTypeName(x.type);
    if (typeName && sourceNames(typeName).includes(name)) found = x;
  }
  return found;
}

/** Of a fiber and its alternate, the one in the tree on screen — null once unmounted */
export function currentOf(f: F): F | null {
  for (const cand of [f, f.alternate]) {
    if (!cand) continue;
    let x: F | null | undefined = cand;
    while (x?.return) x = x.return;
    if (x?.tag === HOST_ROOT && (x.stateNode as { current?: F } | undefined)?.current === x) return cand;
  }
  return null;
}

/** The first element a fiber renders: where the selection marker lives */
export function firstHost(f: F): HTMLElement | null {
  const stack: F[] = f.child ? [f.child] : [];
  while (stack.length) {
    const x = stack.shift()!;
    if (typeof x.type === 'string' && (x.stateNode as Node | undefined)?.nodeType === 1) return x.stateNode as HTMLElement;
    if (x.sibling) stack.unshift(x.sibling);
    if (x.child) stack.unshift(x.child);
  }
  return null;
}

interface Live {
  fiber: F;
  /** prop → value shown */
  values: Map<string, Value>;
  /** prop → value before the first override, to put back */
  originals: Map<string, Value>;
  /** The element that carries the selection: kept marked if the change re-creates it */
  marker?: { attr: string; value: string };
  /** Re-applies in a row: a component that never takes the prop must not loop */
  burst: number;
}

const lives = new Map<string, Live>();
let resetTimer: ReturnType<typeof setTimeout> | null = null;

function same(a: Value, b: Value): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

function write(r: Renderer, f: F, prop: string, v: Value): void {
  if (v === UNSET) {
    if (r.overridePropsDeletePath) r.overridePropsDeletePath(f, [prop]);
    else r.overrideProps!(f, [prop], undefined);
  } else r.overrideProps!(f, [prop], v);
}

function sync(live: Live): void {
  const r = renderer();
  const f = currentOf(live.fiber);
  if (!r || !f) return;
  const props = f.memoizedProps ?? {};
  for (const [prop, v] of live.values) {
    const now = prop in props ? props[prop] : UNSET;
    if (!same(now, v)) write(r, f, prop, v);
  }
  if (live.marker) {
    const host = firstHost(f);
    if (host && !host.hasAttribute(live.marker.attr)) host.setAttribute(live.marker.attr, live.marker.value);
  }
}

function onCommit(): void {
  if (!lives.size) return;
  // After React finishes this commit: overriding inside it would nest renders
  queueMicrotask(() => {
    for (const live of lives.values()) {
      if (++live.burst > 20) continue;
      sync(live);
    }
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { for (const live of lives.values()) live.burst = 0; }, 500);
  });
}

function listen(): void {
  const h = hook();
  if (!h || h.__ilseLive) return;
  h.__ilseLive = true;
  const prev = h.onCommitFiberRoot;
  h.onCommitFiberRoot = function (this: unknown, ...args: unknown[]) {
    const out = prev?.apply(this, args);
    try { onCommit(); } catch { /* never break the app's commit */ }
    return out;
  };
}

/** `"true"` → true, `"3"` → 3 when the prop was a number, `""` → back to its default */
export function propValue(to: string, original: unknown): Value {
  if (to === '') return UNSET;
  if (to === 'true') return true;
  if (to === 'false') return false;
  if (typeof original === 'number' && to.trim() !== '' && !Number.isNaN(Number(to))) return Number(to);
  return to;
}

/**
 * Shows `changes` on the component instance `el` belongs to. Props left out of
 * `changes` go back to what the code passes. False when this page can't do it
 * (no dev renderer, no fiber): the caller shows the copy instead.
 */
export function setLiveProps(
  id: string,
  el: Element,
  component: string,
  changes: Array<{ prop: string; to: string }>,
  marker?: { attr: string; value: string },
): boolean {
  const r = renderer();
  if (!r) return false;
  let live = lives.get(id);
  if (!live) {
    const fiber = componentFiber(el, component);
    if (!fiber) return false;
    live = { fiber, values: new Map(), originals: new Map(), marker, burst: 0 };
    lives.set(id, live);
    listen();
  }
  const f = currentOf(live.fiber);
  if (!f) { lives.delete(id); return false; }
  const props = f.memoizedProps ?? {};
  const wanted = new Map<string, Value>();
  for (const c of changes) {
    if (!live.originals.has(c.prop)) live.originals.set(c.prop, c.prop in props ? props[c.prop] : UNSET);
    wanted.set(c.prop, propValue(c.to, live.originals.get(c.prop)));
  }
  // A prop dropped from the changes: back to the code's value
  for (const [prop, orig] of live.originals) if (!wanted.has(prop)) wanted.set(prop, orig);
  live.values = wanted;
  live.burst = 0;
  try { sync(live); } catch { lives.delete(id); return false; }
  return true;
}

/**
 * The draft ends. `restore` puts the code's props back (cancelled); without it
 * the override just stops being re-applied — the change was applied and the
 * next render from the edited file brings the same value.
 */
export function endLiveProps(id: string, restore = true): void {
  const live = lives.get(id);
  if (!live) return;
  lives.delete(id);
  if (!restore) return;
  const r = renderer();
  const f = currentOf(live.fiber);
  if (!r || !f) return;
  const props = f.memoizedProps ?? {};
  try {
    for (const [prop, orig] of live.originals) {
      const now = prop in props ? props[prop] : UNSET;
      if (!same(now, orig)) write(r, f, prop, orig);
    }
  } catch { /* unmounted meanwhile */ }
}

export function hasLiveProps(id: string): boolean {
  return lives.has(id);
}
