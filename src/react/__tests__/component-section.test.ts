import { describe, it, expect } from 'vitest';
import { fitsSegments } from '../component-section.js';

describe('component section', () => {
  it('a few short choices sit side by side; longer lists stay a select', () => {
    expect(fitsSegments(['—', 'sm', 'md', 'lg'])).toBe(true);
    expect(fitsSegments(['true', 'false'])).toBe(true);
    expect(fitsSegments(['contained', 'outlined', 'text'])).toBe(true);
    expect(fitsSegments(['primary', 'secondary', 'success', 'error'])).toBe(false);
    expect(fitsSegments(['a', 'b', 'c', 'd', 'e'])).toBe(false);
    expect(fitsSegments(['only'])).toBe(false);
  });
});
