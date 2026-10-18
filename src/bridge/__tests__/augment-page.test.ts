import { describe, it, expect } from 'vitest';
import { augmentAnnotation, pagePath } from '../augment.js';
import type { Annotation } from '../../types.js';

const env = { viewport: '1440x900', url: 'http://localhost:3000/ai/providers/1d69/edit?tab=keys', userAgent: '', devicePixelRatio: 2, timestamp: '' };
const base: Annotation = { id: 'b2', note: 'a floating action', element: 'div.canvas', styles: {}, status: 'pending', timestamp: '', intent: 'create', environment: env };

describe('pagePath', () => {
  it('keeps the path and query, not the dev server origin', () => {
    expect(pagePath(env.url)).toBe('/ai/providers/1d69/edit?tab=keys');
    expect(pagePath('not a url')).toBeUndefined();
    expect(pagePath(undefined)).toBeUndefined();
  });
});

describe('augmentAnnotation — where the change goes', () => {
  it('tells the agent which page, on every request', () => {
    expect(augmentAnnotation(base).context).toContain('**Page:** `/ai/providers/1d69/edit?tab=keys`');
    expect(augmentAnnotation({ ...base, intent: 'fix' }).context).toContain('**Page:**');
  });

  it('a sketch anchored on its container: create inside it', () => {
    const ann: Annotation = { ...base, parent: 'div.canvas', placementData: { x: 700, y: 820, scrollY: 0, nearestSelector: 'div.canvas' } };
    const ctx = augmentAnnotation(ann).context;
    expect(ctx).toContain('**Create inside:** `div.canvas`');
    expect(ctx).not.toContain('**Create at:**');
  });

  it('a placement without an anchor keeps the coordinates', () => {
    const ann: Annotation = { ...base, element: '[sketch over empty space]', placementData: { x: 10, y: 20, scrollY: 5 } };
    expect(augmentAnnotation(ann).context).toContain('**Create at:** x:10 y:25');
  });
});
