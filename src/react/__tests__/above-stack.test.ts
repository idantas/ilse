import { describe, it, expect } from 'vitest';
import { liftOver } from '../above-stack.js';

const r = (top: number, bottom: number) => ({ top, bottom, height: bottom - top });

describe('reasoning lines over the bubbles above the toolbar', () => {
  it('nothing above the toolbar: its own gap', () => {
    expect(liftOver(600, [], 24)).toBe(24);
  });
  it('a bubble above the toolbar: the lines go over it', () => {
    expect(liftOver(600, [r(520, 588)], 24)).toBe(88);
  });
  it('several: over the highest one', () => {
    expect(liftOver(600, [r(520, 588), r(300, 590)], 24)).toBe(308);
  });
  it('a panel elsewhere (below the toolbar, or closed) does not count', () => {
    expect(liftOver(600, [r(620, 700), { top: 0, bottom: 0, height: 0 }], 24)).toBe(24);
  });
  it('a small bubble close to the toolbar never pulls the lines down', () => {
    expect(liftOver(600, [r(590, 598)], 24)).toBe(24);
  });
});
