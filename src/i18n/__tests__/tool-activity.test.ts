import { describe, it, expect, afterEach } from 'vitest';
import { setLocale, toolActivity } from '../index.js';

describe('toolActivity', () => {
  afterEach(() => setLocale('pt'));
  it('says the agent\'s tool calls in English when the toolbar is in English', () => {
    setLocale('en');
    expect(toolActivity('Editando Price.jsx')).toBe('Editing Price.jsx');
    expect(toolActivity('Procurando "text-muted"')).toBe('Searching "text-muted"');
    expect(toolActivity('Editando a.tsx (múltiplas)')).toBe('Editing a.tsx (several)');
    expect(toolActivity('Done. Take a look')).toBe('Done. Take a look');
  });
  it('keeps them in Portuguese', () => {
    setLocale('pt');
    expect(toolActivity('Lendo Price.jsx')).toBe('Lendo Price.jsx');
  });
});
