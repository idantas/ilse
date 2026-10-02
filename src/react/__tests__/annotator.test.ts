import { describe, it, expect } from 'vitest';
import { appOwnerName } from '../annotator.js';

// A React 19 dev stack as the browser formats it: the first frame is where the JSX was written
const stack = (...frames: string[]) => ({ stack: ['Error: react-stack-top-frame', ...frames.map(f => `    at ${f}`)].join('\n') });

describe('appOwnerName', () => {
  it('names the app component that rendered a library, not the library internals', () => {
    // <path> → Recharts' Provider (both created inside node_modules) → <AreaChart> written in RevenueChart.jsx
    const areaChart = { _debugStack: stack('RevenueChart (http://localhost:5199/src/components/RevenueChart.jsx:8:7)') };
    const provider = { _debugStack: stack('AreaChart (http://localhost:5199/node_modules/.vite/deps/recharts.js?v=1:4120:3)'), return: areaChart };
    const path = { _debugStack: stack('Curve (http://localhost:5199/node_modules/.vite/deps/recharts.js?v=1:880:9)'), return: provider };
    expect(appOwnerName(path)).toBe('RevenueChart');
  });

  it('names the component that wrote an ordinary element', () => {
    const div = { _debugStack: stack('KpiCard (http://localhost:5199/src/components/KpiCard.jsx:3:5)') };
    expect(appOwnerName(div)).toBe('KpiCard');
  });

  it('is undefined without a dev stack (React 18), so the caller falls back', () => {
    expect(appOwnerName({ return: { return: null } })).toBeUndefined();
    expect(appOwnerName(undefined)).toBeUndefined();
  });
});
