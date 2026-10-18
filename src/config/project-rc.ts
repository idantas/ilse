/**
 * Per-project settings, from two places:
 *
 * - `.ilserc.json` — written by the user, never by Ilse (agent, models). It may
 *   be committed so the team shares it.
 * - Ilse's own memory of answers it asked once (commit note, toolbar) — kept
 *   out of the project: `.git/ilse/state.json`, which git never tracks, or
 *   `~/.ilse/projects/<project>/` outside a repo. Rule 4: nothing in the project
 *   uninvited, not even a config file.
 *
 * Missing or unreadable reads as empty. Answers saved in an `.ilserc.json` by
 * older versions still count.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir } from './project-dir.js';

function readJson(path: string): Record<string, unknown> {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { return {}; }
}

/** Where Ilse keeps its answers for this project */
export function projectStateFile(cwd: string, home?: string): string {
  let gitDir: string | null = null;
  try {
    gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { /* not a repo */ }
  return gitDir ? join(gitDir, 'ilse', 'state.json') : join(projectDir(cwd, home), 'state.json');
}

export function readProjectRc(cwd: string): Record<string, unknown> {
  return { ...readJson(join(cwd, '.ilserc.json')), ...readJson(projectStateFile(cwd)) };
}

export function updateProjectRc(cwd: string, patch: Record<string, unknown>): void {
  const file = projectStateFile(cwd);
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...readJson(file), ...patch }, null, 2) + '\n', 'utf8');
  } catch { /* can't write: just not remembered */ }
}

/**
 * The user chose <Ilse /> in the layout (`--inject`, or kept it when asked).
 * Without this mark, an <Ilse /> in the layout came from an older Ilse, which
 * always wrote it there.
 */
export function choseInjectedToolbar(cwd: string): boolean {
  return readProjectRc(cwd).toolbar === 'inject';
}

export function saveInjectedToolbarChoice(cwd: string): void {
  updateProjectRc(cwd, { toolbar: 'inject' });
}
