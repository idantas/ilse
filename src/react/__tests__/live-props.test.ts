import { describe, it, expect, beforeEach } from 'vitest';
import { currentOf, endLiveProps, propValue, setLiveProps, UNSET, canLiveProps } from '../live-props.js';

type Fiber = { tag?: number; type?: unknown; return?: Fiber | null; child?: Fiber | null; alternate?: Fiber | null; stateNode?: unknown; memoizedProps?: Record<string, unknown> };

/** A tiny tree: root → Combobox → <div>, and a renderer whose overrides land like React's */
function setup(props: Record<string, unknown>) {
  const rootFiber: Fiber = { tag: 3 };
  rootFiber.stateNode = { current: rootFiber };
  function Combobox() { return null; }
  const comp: Fiber = { tag: 0, type: Combobox, return: rootFiber, memoizedProps: { ...props } };
  const marks: Record<string, string> = {};
  const host = { nodeType: 1, hasAttribute: (a: string) => a in marks, setAttribute: (a: string, v: string) => { marks[a] = v; } };
  const div: Fiber = { tag: 5, type: 'div', return: comp, stateNode: host };
  comp.child = div;
  const el = { __reactFiber$abc: div };
  const calls: Array<[string, unknown]> = [];
  const hookObj = {
    renderers: new Map([[1, {
      overrideProps: (f: Fiber, path: string[], v: unknown) => { calls.push([path[0], v]); f.memoizedProps = { ...f.memoizedProps, [path[0]]: v }; hookObj.onCommitFiberRoot(); },
      overridePropsDeletePath: (f: Fiber, path: string[]) => { calls.push([path[0], UNSET]); const p = { ...f.memoizedProps }; delete p[path[0]]; f.memoizedProps = p; hookObj.onCommitFiberRoot(); },
    }]]),
    onCommitFiberRoot: () => {},
  };
  (globalThis as unknown as { window: unknown }).window = { __REACT_DEVTOOLS_GLOBAL_HOOK__: hookObj };
  return { comp, el, calls, marks, hookObj };
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe('live props', () => {
  beforeEach(() => { endLiveProps('a', false); });

  it('reads the panel value the way the code wrote the prop', () => {
    expect(propValue('true', undefined)).toBe(true);
    expect(propValue('false', true)).toBe(false);
    expect(propValue('3', 2)).toBe(3);
    expect(propValue('3', '2')).toBe('3');
    expect(propValue('', 'x')).toBe(UNSET);
  });

  it('no renderer that can override: the caller falls back to the copy', () => {
    (globalThis as unknown as { window: unknown }).window = {};
    expect(canLiveProps()).toBe(false);
    expect(setLiveProps('a', {} as Element, 'Combobox', [{ prop: 'size', to: 'lg' }])).toBe(false);
  });

  it('overrides the real component, keeps it while the parent renders again, and puts it back on cancel', async () => {
    const { comp, el, calls } = setup({ size: 'sm' });
    expect(setLiveProps('a', el as unknown as Element, 'Combobox', [{ prop: 'size', to: 'lg' }])).toBe(true);
    expect(comp.memoizedProps!.size).toBe('lg');
    // The parent renders its JSX again
    comp.memoizedProps = { size: 'sm' };
    (globalThis as any).window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot();
    await tick();
    expect(comp.memoizedProps.size).toBe('lg');
    endLiveProps('a');
    expect(comp.memoizedProps.size).toBe('sm');
    expect(calls.map(c => c[1])).toEqual(['lg', 'lg', 'sm']);
  });

  it('a prop set back to its default is deleted, and applying stops without undoing', () => {
    const { comp, el } = setup({ disabled: true });
    setLiveProps('a', el as unknown as Element, 'Combobox', [{ prop: 'disabled', to: '' }]);
    expect('disabled' in comp.memoizedProps!).toBe(false);
    endLiveProps('a', false);
    expect('disabled' in comp.memoizedProps!).toBe(false);
  });

  it('the element the change re-creates gets the selection marker back', () => {
    const { el, marks } = setup({ size: 'sm' });
    setLiveProps('a', el as unknown as Element, 'Combobox', [{ prop: 'size', to: 'lg' }], { attr: 'data-ilse-pixel-target', value: 'a' });
    expect(marks['data-ilse-pixel-target']).toBe('a');
  });

  it('of a fiber and its alternate, the one on screen', () => {
    const root: Fiber = { tag: 3 }; root.stateNode = { current: root };
    const stale: Fiber = { tag: 3 }; stale.stateNode = root.stateNode;
    const live: Fiber = { return: root }; const old: Fiber = { return: stale, alternate: live }; live.alternate = old;
    expect(currentOf(old)).toBe(live);
    expect(currentOf({ return: stale })).toBe(null);
  });
});
