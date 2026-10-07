import { createRequire } from 'node:module';
import { loadUserConfig, saveUserConfig } from '../config/user-config.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const SEMVER_RE = /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[0-9A-Za-z.-]+)?$/;
const DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/ilse-design/dist-tags';

export interface UpdateResult {
  current: string;
  latest: string;
  hasUpdate: boolean;
  /** The command that installs `latest` globally */
  install: string;
}

/**
 * Semver order, prereleases included: 0.5.0-beta.1 < 0.5.0-beta.2 < 0.5.0.
 * Negative when a < b, positive when a > b, 0 when equal.
 */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = a.split(/-(.*)/s);
  const [coreB, preB] = b.split(/-(.*)/s);
  const na = coreA.split('.').map(Number), nb = coreB.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((na[i] ?? 0) !== (nb[i] ?? 0)) return (na[i] ?? 0) - (nb[i] ?? 0);
  if (!preA || !preB) return preA ? -1 : preB ? 1 : 0; // a release outranks its prereleases
  const ia = preA.split('.'), ib = preB.split('.');
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    if (ia[i] === undefined) return -1;
    if (ib[i] === undefined) return 1;
    const x = Number(ia[i]), y = Number(ib[i]);
    const numeric = !Number.isNaN(x) && !Number.isNaN(y);
    if (numeric ? x !== y : ia[i] !== ib[i]) return numeric ? x - y : ia[i] < ib[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Which published version to offer. On a prerelease (installed from `next`)
 * the newest of `next` and `latest`; on a release, `latest` only — a stable
 * install is never pushed onto a beta.
 */
export function pickUpdate(current: string, tags: { latest?: string; next?: string }): { version: string; tag: 'latest' | 'next' } | null {
  const valid = (v?: string) => !!v && SEMVER_RE.test(v);
  const candidates: Array<{ version: string; tag: 'latest' | 'next' }> = [];
  if (valid(tags.latest)) candidates.push({ version: tags.latest!, tag: 'latest' });
  if (current.includes('-') && valid(tags.next)) candidates.push({ version: tags.next!, tag: 'next' });
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0] ?? null;
}

const installCommand = (tag: 'latest' | 'next') => `npm install -g ilse-design@${tag}`;

export async function checkForUpdate(): Promise<UpdateResult | null> {
  try {
    const config = loadUserConfig();
    const current = pkg.version;

    // Use cache if fresh and valid
    if (
      config.lastUpdateCheck &&
      config.latestKnownVersion &&
      SEMVER_RE.test(config.latestKnownVersion) &&
      Date.now() - config.lastUpdateCheck < CHECK_INTERVAL_MS
    ) {
      const cached = config.latestKnownVersion;
      return {
        current,
        latest: cached,
        hasUpdate: compareVersions(cached, current) > 0,
        install: installCommand(cached.includes('-') ? 'next' : 'latest'),
      };
    }

    // Fetch latest version from npm registry
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    let pick: { version: string; tag: 'latest' | 'next' } | null;
    try {
      const res = await fetch(DIST_TAGS_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeout);

      if (!res.ok) return null;
      pick = pickUpdate(current, (await res.json()) as { latest?: string; next?: string });
      if (!pick) return null;
    } catch {
      clearTimeout(timeout);
      return null;
    }

    // Cache result
    saveUserConfig({ lastUpdateCheck: Date.now(), latestKnownVersion: pick.version });

    return { current, latest: pick.version, hasUpdate: compareVersions(pick.version, current) > 0, install: installCommand(pick.tag) };
  } catch {
    return null;
  }
}
