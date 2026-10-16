/**
 * Local access token + running-server info, in ~/.ilse/.
 *
 * The WebSocket only accepts loopback browser origins, but an HTTP MCP endpoint
 * is called by non-browser clients that send no Origin at all. The token is
 * what keeps other local programs out: "whoever holds the token is the agent".
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const DIR = join(homedir(), '.ilse');
const TOKEN_FILE = join(DIR, 'token');
const SERVER_FILE = join(DIR, 'server.json');

function ensureDir(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

export function getLocalToken(): string {
  ensureDir();
  if (existsSync(TOKEN_FILE)) {
    const saved = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (saved) return saved;
  }
  const token = `ilse_${randomBytes(24).toString('hex')}`;
  writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 });
  try { chmodSync(TOKEN_FILE, 0o600); } catch { /* best effort on non-POSIX */ }
  return token;
}

export function checkBearer(header: string | undefined, token: string): boolean {
  const got = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ServerInfo { port: number; pid: number; cwd: string; startedAt: string }

const SERVERS_DIR = join(DIR, 'servers');

/**
 * Register this `ilse`: ~/.ilse/server.json names the last one started, and
 * ~/.ilse/servers/<pid>.json lists every one running, so a bridge started in a
 * project finds that project's Ilse when several run side by side.
 */
export function writeServerInfo(port: number): void {
  ensureDir();
  const info: ServerInfo = { port, pid: process.pid, cwd: process.cwd(), startedAt: new Date().toISOString() };
  writeFileSync(SERVER_FILE, JSON.stringify(info, null, 2) + '\n');
  try {
    mkdirSync(SERVERS_DIR, { recursive: true });
    const mine = join(SERVERS_DIR, `${process.pid}.json`);
    writeFileSync(mine, JSON.stringify(info) + '\n');
    process.on('exit', () => { try { unlinkSync(mine); } catch { /* gone */ } });
  } catch { /* the registry is a convenience */ }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** `a` and `b` are the same folder, or one contains the other (ilse run from a monorepo root) */
export function samePlace(a: string, b: string): boolean {
  const x = resolve(a), y = resolve(b);
  return x === y || x.startsWith(y + sep) || y.startsWith(x + sep);
}

/** Every `ilse` running now, newest first */
export function runningServers(): ServerInfo[] {
  let files: string[] = [];
  try { files = readdirSync(SERVERS_DIR).filter(f => f.endsWith('.json')); } catch { /* none yet */ }
  const list: ServerInfo[] = [];
  for (const f of files) {
    try {
      const info = JSON.parse(readFileSync(join(SERVERS_DIR, f), 'utf8')) as ServerInfo;
      if (alive(info.pid)) list.push(info);
      else unlinkSync(join(SERVERS_DIR, f));
    } catch { /* unreadable: skip */ }
  }
  return list.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * The `ilse` to talk to. With `cwd`: the one running in that project, if any;
 * otherwise (and without `cwd`) the last one started.
 */
export function readServerInfo(cwd?: string): ServerInfo | null {
  if (cwd) {
    const here = runningServers().find(s => samePlace(s.cwd, cwd));
    if (here) return here;
  }
  try { return JSON.parse(readFileSync(SERVER_FILE, 'utf8')) as ServerInfo; } catch { return null; }
}
