import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordChange, recordUndone, pendingChanges, readLedger, formatPending, ledgerFile } from '../ledger.js';
import { addCommitContext, hasCommitContext, commitContextChoice, saveCommitContextChoice, COMMIT_MARKER } from '../commit-context.js';

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ilse-ledger-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  writeFileSync(join(dir, 'Card.tsx'), 'a\n');
  git('add', '.'); git('commit', '-qm', 'init');
  return dir;
}

const cs = (id: string, path = 'Card.tsx') => ({ id, annotationIds: ['a1'], label: 'gap maior', createdAt: Date.now(), files: [{ path, before: 'a\n', after: 'b\n' }] });

describe('ledger', () => {
  it('lives in .git, lists what is still uncommitted, forgets undone and committed work', () => {
    const dir = repo();
    expect(ledgerFile(dir)).toBe(join(execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: dir, encoding: 'utf8' }).trim(), 'ilse', 'changes.jsonl'));
    writeFileSync(join(dir, 'Card.tsx'), 'b\n');
    recordChange(dir, cs('c1'), { path: 'agent', model: 'haiku', annotations: [{ id: 'a1', intent: 'fix', note: 'gap maior', element: 'Card · div', style: ['gap: 12px → 16px'] }] });
    expect(pendingChanges(dir).map(e => e.id)).toEqual(['c1']);
    const md = formatPending(pendingChanges(dir));
    expect(md).toContain('"gap maior"');
    expect(md).toContain('painel: gap: 12px → 16px');
    expect(md).toContain('Card.tsx (+1 −1)');

    recordChange(dir, cs('c2'), { path: 'swap', annotations: [] });
    recordUndone(dir, 'c2');
    expect(readLedger(dir).map(e => e.id)).toEqual(['c1']);

    execFileSync('git', ['commit', '-qam', 'ship'], { cwd: dir });
    expect(pendingChanges(dir)).toEqual([]);
  });

  it('does nothing outside git', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ilse-nogit-'));
    recordChange(dir, cs('x'), { path: 'agent', annotations: [] });
    expect(pendingChanges(dir)).toEqual([]);
  });
});

describe('commit context', () => {
  it('appends once to AGENTS.md/CLAUDE.md and remembers the answer', () => {
    const dir = repo();
    writeFileSync(join(dir, 'CLAUDE.md'), '# Projeto\n');
    expect(hasCommitContext(dir)).toBe(false);
    expect(addCommitContext(dir)).toBe(join(dir, 'CLAUDE.md'));
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toMatch(/^# Projeto\n[\s\S]*ilse changes/);
    expect(hasCommitContext(dir)).toBe(true);
    expect(commitContextChoice(dir)).toBeUndefined();
    saveCommitContextChoice(dir, false);
    expect(commitContextChoice(dir)).toBe(false);
    // Remembered outside the project's files
    expect(existsSync(join(dir, '.ilserc.json'))).toBe(false);
    expect(existsSync(join(dir, '.git', 'ilse', 'state.json'))).toBe(true);
    expect(COMMIT_MARKER).toContain('ilse');
  });
});

import { historyFor, formatHistory } from '../ledger.js';

describe('history for the next edit', () => {
  it('last changes to the same file, newest first, undone ones left out', () => {
    const dir = repo();
    const rec = (id: string, note: string, path = 'Card.tsx') =>
      recordChange(dir, { ...cs(id, path) }, { path: 'agent', annotations: [{ id, intent: 'fix', note, summary: `feito ${id}` }] });
    rec('h1', 'gap maior'); rec('h2', 'outro arquivo', 'Other.tsx'); rec('h3', 'cor primária'); rec('h4', 'desfeito');
    recordUndone(dir, 'h4');
    const h = historyFor(dir, 'Card.tsx');
    expect(h.map(e => e.id)).toEqual(['h3', 'h1']);
    const text = formatHistory('Card.tsx', h)!;
    expect(text).toContain('do not revert unless asked');
    expect(text.split('\n')[1]).toContain('"cor primária" → feito h3');
    expect(formatHistory('Card.tsx', [])).toBeUndefined();
  });
});

import { ledgerSummary } from '../ledger.js';

describe('ledgerSummary', () => {
  it('newest first, with the designer\'s note and what is still uncommitted', () => {
    const dir = repo();
    recordChange(dir, cs('c1'), { path: 'swap', annotations: [{ id: 'a1', summary: 'gap-3 → gap-4' }] });
    execFileSync('git', ['commit', '-qam', 'ship', '--allow-empty'], { cwd: dir });
    writeFileSync(join(dir, 'Card.tsx'), 'b\n');
    recordChange(dir, cs('c2'), { path: 'agent', annotations: [{ id: 'a2', note: 'título maior' }] });
    const s = ledgerSummary(dir);
    expect(s.total).toBe(2);
    expect(s.pending).toBe(2);
    expect(s.recent.map(r => [r.id, r.text, r.path])).toEqual([['c2', 'título maior', 'agent'], ['c1', 'gap-3 → gap-4', 'swap']]);
    expect(s.recent[0].files).toEqual(['Card.tsx']);
  });
  it('is empty outside git', () => {
    expect(ledgerSummary(mkdtempSync(join(tmpdir(), 'ilse-nogit-')))).toEqual({ total: 0, pending: 0, recent: [] });
  });
});
