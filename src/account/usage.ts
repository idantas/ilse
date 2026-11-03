/**
 * What the owner's machine sends with the daily check — and only the owner's
 * (license plan "owner", the one who makes Ilse). Everyone else sends just the
 * versions (client.ts). Read from what Ilse already keeps on this machine:
 *
 *   days      annotations per day from the session logs (~/.ilse/logs); a
 *             session with none still counts 1, so a day Ilse ran shows up
 *   projects  how many projects Ilse ran in (paths in ~/.ilse/config.json),
 *             temp folders left out — only the count leaves, never a path
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accountDir, readLicense } from './store.js';

export interface Usage {
  /** YYYY-MM-DD (local) → activity that day, last DAYS days */
  days: Record<string, number>;
  projects: number;
}

const DAYS = 371; // 53 weeks, a GitHub-style year

/** The plan inside the license on disk (not verified: the site decides what it keeps) */
export function licensePlan(dir = accountDir()): string | null {
  const payload = readLicense(dir)?.split('.')[1];
  if (!payload) return null;
  try {
    const plan = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { plan?: unknown }).plan;
    return typeof plan === 'string' ? plan : null;
  } catch {
    return null;
  }
}

const day = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const TEMP = /^(\/private)?\/(tmp|var\/folders)\//;

export function readUsage(dir = accountDir(), now = Date.now()): Usage {
  const since = now - DAYS * 864e5;
  const days: Record<string, number> = {};
  const add = (iso: string, n: number) => {
    const t = Date.parse(iso);
    const k = day(iso);
    if (!k || !(t >= since)) return;
    days[k] = (days[k] ?? 0) + n;
  };

  let files: string[] = [];
  try { files = readdirSync(join(dir, 'logs')).filter(f => f.startsWith('session-') && f.endsWith('.json')); } catch { /* no logs yet */ }
  for (const f of files) {
    try {
      const log = JSON.parse(readFileSync(join(dir, 'logs', f), 'utf8')) as { session?: { startedAt?: string }; runs?: Array<{ receivedAt?: string }> };
      const runs = (log.runs ?? []).filter(r => typeof r.receivedAt === 'string');
      if (runs.length) for (const r of runs) add(r.receivedAt!, 1);
      else if (log.session?.startedAt) add(log.session.startedAt, 1);
    } catch { /* a log being written or broken: skip it */ }
  }

  const paths = new Set<string>();
  try {
    const cfg = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as Record<string, unknown>;
    for (const key of ['claudeAccounts', 'appPorts', 'loginTied']) {
      const v = cfg[key];
      if (v && typeof v === 'object') for (const p of Object.keys(v)) if (p.startsWith('/') && !TEMP.test(p)) paths.add(p);
    }
  } catch { /* no config */ }

  return { days, projects: paths.size };
}

/** Usage to send with the daily check: the owner's only, otherwise nothing */
export function ownerUsage(dir = accountDir(), now = Date.now()): Usage | undefined {
  return licensePlan(dir) === 'owner' ? readUsage(dir, now) : undefined;
}
