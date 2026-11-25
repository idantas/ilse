import { describe, it, expect } from 'vitest';
import { pickToken, roleRank, tokenForVar, varName, cascadeValue, specificity } from '../color-tokens.js';

const tok = (name: string, cssVar?: string) => ({ name, value: '#FAFAFA', type: 'color' as const, ...(cssVar ? { cssVar } : {}) });

describe('which token a colour is, when several share it', () => {
  // Dark theme: the text's colour and two AI gradient stops are all #FAFAFA
  const equal = [tok('color.ai-to', '--ai-to'), tok('color.foreground', '--foreground'), tok('color.ai-from', '--ai-from')];

  it('the token the code names wins (the CSS rule\'s var(), or a class)', () => {
    expect(pickToken(equal, 'color', 'color.ai-to').token?.name).toBe('color.ai-to');
    expect(pickToken(equal, 'color', tokenForVar(varName('var(--color-foreground)'), equal)).token?.name).toBe('color.foreground');
  });

  it('else the role that fits the property: foreground for text, not the shortest name', () => {
    expect(pickToken(equal, 'color').token?.name).toBe('color.foreground');
    expect(roleRank('color.card', 'backgroundColor')).toBeLessThan(roleRank('color.ai-to', 'backgroundColor'));
  });

  it('still tied across families: says "several" instead of guessing', () => {
    const r = pickToken([tok('color.ai-to'), tok('color.chart-1')], 'color');
    expect(r).toEqual({ ambiguous: true });
  });

  it('one family\'s steps (surface-2…8) are one answer: the first step', () => {
    expect(pickToken([tok('color.surface-3'), tok('color.surface-2')], 'backgroundColor').token?.name).toBe('color.surface-2');
  });
});

describe('the value the CSS writes', () => {
  it('reads var() names and maps Tailwind\'s --color-x alias to the token', () => {
    expect(varName('var(--foreground, #000)')).toBe('--foreground');
    expect(varName('#fff')).toBeUndefined();
    expect(tokenForVar('--color-mention-fg', [tok('color.mention-fg', '--mention-fg')])).toBe('color.mention-fg');
  });

  it('takes the heaviest matching rule, the later on a tie, inline over all', () => {
    const rules = [
      { selector: 'body', value: 'var(--foreground)' },
      { selector: '.mention', value: 'var(--mention-fg)' },
      { selector: 'span', value: 'red' },
    ];
    const isMention = (sel: string) => ['body', '.mention', 'span'].includes(sel);
    expect(cascadeValue(rules, isMention)).toBe('var(--mention-fg)');
    expect(cascadeValue(rules, sel => sel === 'body')).toBe('var(--foreground)');
    expect(cascadeValue(rules, isMention, 'blue')).toBe('blue');
    expect(specificity('.a .b:hover > span')).toEqual([0, 3, 1]);
    expect(specificity(':where(.a) p')).toEqual([0, 0, 1]);
  });
});
