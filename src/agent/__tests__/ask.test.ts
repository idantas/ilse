import { describe, it, expect } from 'vitest';
import { askArgs, readAnswer, AskError } from '../ask.js';

describe('askAgent', () => {
  it('runs without tools or MCP, with the schema and model when given', () => {
    const args = askArgs('hi', 'sonnet', '{"type":"object"}');
    expect(args).toEqual(expect.arrayContaining(['--tools', '', '--strict-mcp-config', '--json-schema', '{"type":"object"}', '--model', 'sonnet']));
    expect(askArgs('hi', undefined)).not.toContain('--model');
  });
  it('reads the structured answer as JSON text, or the plain result', () => {
    expect(readAnswer(JSON.stringify({ structured_output: { do: 'done' }, result: '' }), true)).toBe('{"do":"done"}');
    expect(readAnswer(JSON.stringify({ result: 'ok' }), false)).toBe('ok');
  });
  it('an error or a missing answer throws', () => {
    expect(() => readAnswer(JSON.stringify({ is_error: true, result: 'limit' }), false)).toThrow(AskError);
    expect(() => readAnswer(JSON.stringify({ result: 'x' }), true)).toThrow('no structured answer');
    expect(() => readAnswer('not json', false)).toThrow('unreadable');
  });
});
