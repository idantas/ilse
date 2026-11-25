import { describe, expect, it } from 'vitest';
import { shouldPlay } from '../sound.js';

const never = { done: -Infinity, attention: -Infinity };

describe('shouldPlay', () => {
  it('plays each sound the first time', () => {
    expect(shouldPlay('done', 1000, never)).toBe(true);
    expect(shouldPlay('attention', 1000, never)).toBe(true);
  });

  it('chimes once for a batch whose notes resolve one after another', () => {
    expect(shouldPlay('done', 1400, { ...never, done: 1000 })).toBe(false);
    expect(shouldPlay('done', 2600, { ...never, done: 1000 })).toBe(true);
  });

  it('lets a warning through right after a chime, and holds the chime after a warning', () => {
    expect(shouldPlay('attention', 1100, { ...never, done: 1000 })).toBe(true);
    expect(shouldPlay('done', 1100, { ...never, attention: 1000 })).toBe(false);
  });
});
