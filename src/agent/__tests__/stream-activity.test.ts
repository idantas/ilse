import { describe, it, expect } from 'vitest';
import { handleStreamEvent, type AgentActivity } from '../executor.js';

const said = (content: Array<Record<string, unknown>>) => {
  const out: Array<[string, AgentActivity]> = [];
  handleStreamEvent({ type: 'assistant', message: { content } }, [], new Map(), () => {}, () => {}, (text, activity) => out.push([text, activity]));
  return out;
};

describe('agent activity, for the mascot', () => {
  it('an edit is "edit": she types', () => {
    expect(said([{ type: 'tool_use', name: 'Edit', input: { file_path: '/a/Card.tsx' } }])).toEqual([['Editando Card.tsx', 'edit']]);
    expect(said([{ type: 'tool_use', name: 'Write', input: { file_path: '/a/New.tsx' } }])[0][1]).toBe('edit');
  });
  it('reading, searching and reasoning are "think": she rests', () => {
    expect(said([{ type: 'tool_use', name: 'Read', input: { file_path: '/a/Card.tsx' } }])[0][1]).toBe('think');
    expect(said([{ type: 'tool_use', name: 'Grep', input: { pattern: 'padding' } }])[0][1]).toBe('think');
    expect(said([{ type: 'text', text: 'The card needs more room.' }])).toEqual([['The card needs more room.', 'think']]);
  });
});
