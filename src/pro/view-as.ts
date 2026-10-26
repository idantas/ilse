/**
 * The owner's "view as Free": with an owner license, Pro can be switched off for
 * the toolbar and the server without uninstalling it — to test what a Free user
 * gets on the same machine. Kept in ~/.ilse/view-as.json so it survives restarts
 * (the settings badge always says which one is on).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const file = (home: string) => join(home, '.ilse', 'view-as.json');

/** Only the owner's plan can view as Free: for anyone else Pro is what they bought */
export function canViewAsFree(plan: string | undefined): boolean {
  return plan === 'owner';
}

export function readViewAsFree(home = homedir()): boolean {
  try {
    return existsSync(file(home)) && (JSON.parse(readFileSync(file(home), 'utf8')) as { free?: unknown }).free === true;
  } catch {
    return false;
  }
}

export function writeViewAsFree(free: boolean, home = homedir()): void {
  try {
    mkdirSync(join(home, '.ilse'), { recursive: true });
    writeFileSync(file(home), JSON.stringify({ free }) + '\n', 'utf8');
  } catch { /* unwritable home: the switch still holds for this session */ }
}
