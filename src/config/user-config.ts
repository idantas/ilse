import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { cwd } from 'node:process';

const CONFIG_DIR = join(homedir(), '.ilse');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export type IlseMode = 'automatic' | 'clipboard' | 'mcp';

export interface UserConfig {
  mode: IlseMode;
  agent?: string;
  locale?: 'pt' | 'en';
  setupDone: boolean;
  lastUpdateCheck?: number;
  latestKnownVersion?: string;
  /** Claude account per project: project path → CLAUDE_CONFIG_DIR ('' = the default one) */
  claudeAccounts?: Record<string, string>;
  /**
   * Where the toolbar opens: on the app's usual address (Ilse starts the dev
   * server behind it) or on a separate one (:4700). Unset = 'same'.
   */
  address?: 'same' | 'separate';
}

const DEFAULT_CONFIG: UserConfig = {
  mode: 'automatic',
  setupDone: false,
};

export function loadUserConfig(): UserConfig {
  if (!existsSync(CONFIG_FILE)) return DEFAULT_CONFIG;
  try {
    const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    return { ...DEFAULT_CONFIG, ...data };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveUserConfig(config: Partial<UserConfig>): void {
  const current = loadUserConfig();
  const next = { ...current, ...config };
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf-8');
}

export function isFirstRun(): boolean {
  return !loadUserConfig().setupDone;
}

/** True if the current project has never been set up (no .ilserc.json in cwd) */
export function isProjectSetup(): boolean {
  return existsSync(join(cwd(), '.ilserc.json'));
}
