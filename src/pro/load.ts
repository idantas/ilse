/**
 * Finds Ilse Pro on this machine, if it's there. Pro lives outside the project
 * and outside npm, in ~/.ilse/pro/current/ (ILSE_PRO overrides the path, for
 * development). Anything off — missing, broken, another plugin API — and Ilse
 * runs as the free version, quietly.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGIN_API, type ProPlugin } from './types.js';

export function proEntry(env = process.env, home = homedir()): string {
  if (env.ILSE_PRO) return resolve(env.ILSE_PRO);
  return join(home, '.ilse', 'pro', 'current', 'index.js');
}

let cached: Promise<ProPlugin | null> | null = null;

export function loadPro(): Promise<ProPlugin | null> {
  cached ??= (async () => {
    const entry = proEntry();
    if (!existsSync(entry)) return null;
    try {
      const mod = await import(pathToFileURL(entry).href) as { default?: ProPlugin };
      const plugin = mod.default;
      if (!plugin || plugin.pluginApi !== PLUGIN_API) {
        if (process.env.ILSE_DEBUG) console.error(`[ilse] Pro at ${entry} speaks plugin API ${plugin?.pluginApi}, this Ilse speaks ${PLUGIN_API}`);
        return null;
      }
      return plugin;
    } catch (err) {
      if (process.env.ILSE_DEBUG) console.error('[ilse] could not load Pro:', err);
      return null;
    }
  })();
  return cached;
}
