import { describe, it, expect } from 'vitest';
import { Journal } from '../journal.js';
import type { Annotation } from '../../types.js';

const SECRET = 'confidential note: checkout button';

function ann(id: string, extra: Partial<Annotation> = {}): Annotation {
  return {
    id, note: SECRET, element: 'button.cta', styles: {}, status: 'pending', timestamp: '', intent: 'fix',
    source: [{ file: 'src/private/Checkout.tsx', line: 10, endLine: 10, kind: 'element', score: 14, reasons: [], snippet: 'const apiKey = 1' }],
    meta: { locateMs: 12, composeMs: 4200, captureMode: 'element' },
    ...extra,
  };
}

describe('Journal', () => {
  it('records a full agent run: steps, tools, tokens, outcome', () => {
    const j = new Journal({ ilseVersion: 't', mode: 'automatic', agent: 'claude' }, { persist: false });
    j.received(ann('a1'));
    j.batchStart('b1', ['a1'], 'agent', 'claude', false);
    j.agentEvent('b1', { type: 'system', subtype: 'init' });
    j.agentEvent('b1', { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } });
    j.agentEvent('b1', { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: {} }] } });
    j.agentEvent('b1', {
      type: 'result', num_turns: 3, duration_api_ms: 5000, total_cost_usd: 0.012,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9000, cache_creation_input_tokens: 400 },
    });
    j.batchChanges('b1', { files: 1, added: 2, removed: 1 });
    j.resolved('a1');
    j.batchEnd('b1', { ok: true });
    j.undone(['a1']);

    const { runs, batches, summary } = j.toJSON();
    expect(runs[0]).toMatchObject({
      path: 'agent',
      input: { noteChars: SECRET.length, composeMs: 4200, captureMode: 'element' },
      locate: { found: true, kind: 'element', score: 14, ms: 12 },
      outcome: { resolved: true, undone: true },
    });
    expect(Object.keys(runs[0].timeline)).toEqual(expect.arrayContaining(['queued', 'agentStart', 'firstEvent', 'firstTool', 'firstEdit', 'resolved', 'end']));
    expect(batches[0]).toMatchObject({ turns: 3, apiMs: 5000, tools: { Read: 1, Edit: 1 }, changes: { files: 1 } });
    expect(summary).toMatchObject({ annotations: 1, undone: 1, locateHitRate: 1, costPerAgentAnnotationUsd: 0.012, tokensPerAgentAnnotation: 9500 });
  });

  it('marks token swaps and why a swap fell back', () => {
    const j = new Journal({ ilseVersion: 't' }, { persist: false });
    j.received(ann('s1', { intent: 'style', styleData: { selector: 'x', changes: [{ property: 'gap', from: '8px', to: '16px' }] } }));
    j.received(ann('s2', { intent: 'style' }));
    j.swap('s1', true);
    j.swap('s2', false, 'className dinâmico ou ausente');
    j.resolved('s1');
    const { runs, summary } = j.toJSON();
    expect(runs[0]).toMatchObject({ path: 'swap', input: { styleProps: ['gap'] }, swap: { applied: true } });
    expect(runs[1].swap).toEqual({ applied: false, reason: 'className dinâmico ou ausente' });
    expect(summary.swapRate).toBe(0.5);
  });

  it('never exports note text, code or file paths', () => {
    const j = new Journal({ ilseVersion: 't' }, { persist: false });
    j.received(ann('p1'));
    const everything = JSON.stringify(j.toJSON()) + j.toMarkdown();
    expect(everything).not.toContain('segredo');
    expect(everything).not.toContain('Checkout.tsx');
    expect(everything).not.toContain('apiKey');
    expect(j.toMarkdown()).toContain('| p1 | fix |');
  });
});

describe('Journal — handovers are not failures', () => {
  it('an annotation the quick path hands to the agent ends ok when the agent resolves it', () => {
    const j = new Journal({ ilseVersion: 't', mode: 'automatic', agent: 'claude' }, { persist: false });
    j.received(ann('h1'));
    j.batchStart('q1', ['h1'], 'quick', 'claude', false);
    j.batchEnd('q1', { ok: false, error: '→ agente: precisa do agente' });
    j.batchStart('b2', ['h1'], 'agent', 'claude', false);
    j.batchEnd('b2', { ok: true });
    j.resolved('h1');
    const run = j.toJSON().runs[0];
    expect(run.outcome.error).toBeUndefined();
    expect(j.toJSON().summary.errors).toBe(0);
  });
});

describe('Journal — resumed sessions', () => {
  it('charges each batch its own cost, not the session total so far', () => {
    const j = new Journal({ ilseVersion: 't', mode: 'automatic', agent: 'claude' }, { persist: false });
    const run = (id: string, total: number, session = 's1') => {
      j.received(ann(`a-${id}`));
      j.batchStart(id, [`a-${id}`], 'agent', 'claude', id !== 'b1');
      j.agentEvent(id, { type: 'result', session_id: session, total_cost_usd: total, usage: { input_tokens: 1, output_tokens: 1 } });
      j.batchEnd(id, { ok: true });
    };
    run('b1', 0.36); run('b2', 0.53); run('b3', 0.60); // one session, resumed twice
    run('b4', 0.28, 's2');                              // a fresh one
    const batches = j.toJSON().batches;
    expect(batches.map(b => b.tokens?.costUsd)).toEqual([0.36, 0.17, 0.07, 0.28]);
    expect(j.toJSON().summary.tokens.costUsd).toBeCloseTo(0.88, 5);
  });
});

describe('modelUsage', () => {
  it('counts agent and quick runs, not swaps or MCP, and keeps the last model', () => {
    const j = new Journal({ ilseVersion: 't' }, { persist: false });
    let told = 0;
    j.onModelRun = () => { told++; };
    j.batchStart('s1', [], 'swap');
    j.batchStart('q1', [], 'quick', 'claude', false, { model: 'haiku' });
    j.batchStart('b1', [], 'agent', 'claude', false, { model: 'sonnet' });
    j.batchStart('m1', [], 'mcp', 'mcp');
    expect(j.modelUsage()).toEqual({ calls: 2, model: 'sonnet' });
    expect(told).toBe(2);
  });
});
