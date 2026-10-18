/**
 * What the core lends Pro's CLI commands (see ProCore in types.ts): its strings
 * and how it finds the app the dev is running.
 */

import { t } from '../i18n/index.js';
import { loadUserConfig } from '../config/user-config.js';
import { findDevServer } from '../proxy/find-dev-server.js';
import type { MessageKey } from '../i18n/messages.js';
import type { ProCore } from './types.js';

/** The app's address: given (URL or port), the port saved for this project, or a dev server found running */
async function appUrl(cwd: string, given?: string): Promise<string | null> {
  if (given) return /^https?:\/\//.test(given) ? given : `http://localhost:${given.replace(/^:/, '')}`;
  const saved = loadUserConfig().appPorts?.[cwd];
  const found = await findDevServer(cwd, saved ? [saved] : undefined);
  return found ? `http://localhost:${found.port}` : null;
}

export const proCore: ProCore = {
  // Unknown keys come back as the key itself, like the core's own t()
  t: (key, params) => t(key as MessageKey, params),
  appUrl,
};
