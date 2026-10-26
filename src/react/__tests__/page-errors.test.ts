import { describe, it, expect } from 'vitest';
import { formatConsoleArgs, isNoise, newErrors } from '../page-errors.js';

describe('formatConsoleArgs — React logs printf-style', () => {
  it('fills %s from the arguments', () => {
    expect(formatConsoleArgs(['Encountered two children with the same key, `%s`. Keys should be unique', 'Replit']))
      .toBe('Encountered two children with the same key, `Replit`. Keys should be unique');
  });
  it('drops %c styles, keeps extra arguments and errors', () => {
    expect(formatConsoleArgs(['%cWarning', 'color:red', new Error('boom')])).toBe('Warning boom');
  });
});

describe('isNoise', () => {
  it("dev tooling and Ilse's own logs aren't the app breaking", () => {
    expect(isNoise('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isNoise('[ilse] ws closed')).toBe(true);
    expect(isNoise('Encountered two children with the same key')).toBe(false);
  });
});

describe('newErrors — only what the change brought', () => {
  const seen = [
    { at: 10, message: 'old warning' },
    { at: 30, message: 'old warning' },
    { at: 31, message: 'same key `Replit`' },
    { at: 32, message: 'same key `Replit`' },
  ];
  it('skips errors the page already had, one entry per message', () => {
    expect(newErrors(seen, 20)).toEqual(['same key `Replit`']);
  });
  it('nothing new, nothing to say', () => {
    expect(newErrors(seen, 40)).toEqual([]);
  });
});
