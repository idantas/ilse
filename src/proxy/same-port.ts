/**
 * Same port — the toolbar on the app's usual address, with nothing in the project.
 *
 * Ilse starts the project's dev script itself, on a hidden port, and puts its
 * proxy on the port the app normally uses. The browser keeps the same origin
 * (localhost:3000), so what is tied to it keeps working: the login saved in
 * localStorage and cookies, OAuth and SSO callbacks, links in emails.
 *
 *   localhost:3000   → Ilse (proxy + toolbar) → localhost:13000 (the dev server)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { findDevServer } from './find-dev-server.js';
import type { DevTarget } from './server.js';

export type DevFramework = 'next' | 'vite' | 'other';

export interface SamePortPlan {
  /** npm script that starts the dev server */
  script: string;
  framework: DevFramework;
  /** The port the app is used on — Ilse's proxy takes it */
  appPort: number;
  /** Folder the script runs in: the project, or one app of a monorepo */
  dir: string;
  /** In a monorepo: the app's package name */
  app?: string;
}

const DEFAULT_PORT: Record<DevFramework, number> = { next: 3000, vite: 5173, other: 3000 };

/** A `--port 3000` / `-p 3000` / `--port=3000` in a command line */
function portFlag(command: string): number | undefined {
  const m = command.match(/(?:--port|-p)[\s=]+(\d{2,5})\b/);
  return m ? Number(m[1]) : undefined;
}

/** `server: { port: 3000 }` in a Vite config — a plain read, good enough for a default */
function vitePort(configText: string): number | undefined {
  const server = configText.match(/server\s*:\s*\{[\s\S]*?\}/);
  const m = server?.[0].match(/\bport\s*:\s*(\d{2,5})\b/);
  return m ? Number(m[1]) : undefined;
}

export interface PlanInput {
  pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  /** Text of vite.config.* when there is one */
  viteConfig?: string;
}

/** Which script to run and which port the app lives on. Null when there is no dev script. */
export function planSamePort({ pkg, viteConfig }: PlanInput, dir = '.'): SamePortPlan | null {
  const script = pkg.scripts?.dev ? 'dev' : pkg.scripts?.start ? 'start' : null;
  if (!script) return null;
  const command = pkg.scripts![script];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const framework: DevFramework = deps.next || /\bnext\b/.test(command) ? 'next'
    : deps.vite || /\bvite\b/.test(command) ? 'vite' : 'other';
  const appPort = portFlag(command)
    ?? (framework === 'vite' && viteConfig ? vitePort(viteConfig) : undefined)
    ?? DEFAULT_PORT[framework];
  return { script, framework, appPort, dir };
}

/** Workspace folders from package.json `workspaces` or pnpm-workspace.yaml — `dir/*` and plain paths */
export function workspaceDirs(root: string): string[] {
  const patterns: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
    if (Array.isArray(ws)) patterns.push(...ws);
  } catch { /* no package.json */ }
  const pnpm = join(root, 'pnpm-workspace.yaml');
  if (existsSync(pnpm)) {
    for (const m of readFileSync(pnpm, 'utf8').matchAll(/^\s*-\s*['"]?([^'"#\n]+?)['"]?\s*$/gm)) patterns.push(m[1]);
  }
  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith('!') || pattern.includes('**')) continue;
    if (pattern.endsWith('/*')) {
      const base = join(root, pattern.slice(0, -2));
      if (!existsSync(base)) continue;
      for (const name of readdirSync(base)) {
        const d = join(base, name);
        if (statSync(d).isDirectory() && existsSync(join(d, 'package.json'))) dirs.push(d);
      }
    } else if (existsSync(join(root, pattern, 'package.json'))) {
      dirs.push(join(root, pattern));
    }
  }
  return [...new Set(dirs)];
}

/**
 * What Ilse can start in this folder. A Vite or Next project: itself. A monorepo
 * whose root script is a task runner (turbo, nx…): each Vite or Next app in the
 * workspace, run straight from its own folder — the runner wouldn't pass the
 * hidden port on. Anything else: the root script, as is.
 */
export function planProject(root: string): SamePortPlan[] {
  const input = readPlanInput(root);
  const plan = input ? planSamePort(input, root) : null;
  if (plan && plan.framework !== 'other') return [plan];
  const apps: SamePortPlan[] = [];
  for (const dir of workspaceDirs(root)) {
    const appInput = readPlanInput(dir);
    const appPlan = appInput ? planSamePort(appInput, dir) : null;
    if (appPlan && appPlan.framework !== 'other') {
      apps.push({ ...appPlan, app: (appInput!.pkg as { name?: string }).name ?? relative(root, dir) });
    }
  }
  if (apps.length > 0) return apps;
  return plan ? [plan] : [];
}

/**
 * How to send the dev server to the hidden port. `PORT` covers Next, CRA,
 * Remix and most Node servers; Vite only reads its own flag, and a flag given
 * after the script's own wins over it.
 */
export function hiddenPortArgs(framework: DevFramework, port: number): { args: string[]; env: Record<string, string> } {
  const env = { PORT: String(port) };
  if (framework === 'vite') return { args: ['--port', String(port), '--strictPort'], env };
  if (framework === 'next') return { args: ['--port', String(port)], env };
  return { args: [], env };
}

/** The dev server's own log names the hidden port — show the address the user actually opens */
export function rewriteLog(line: string, hiddenPort: number, appPort: number): string {
  // Dev servers colour the port (Vite: `localhost:\x1b[1m15173\x1b[22m`) — allow escape codes around it
  const esc = '(?:\\x1b\\[[0-9;]*m)*';
  return line.replace(
    new RegExp(`(localhost|127\\.0\\.0\\.1|\\[::1\\]):(${esc})${hiddenPort}(${esc})(?!\\d)`, 'g'),
    `localhost:$2${appPort}$3`,
  );
}

/**
 * Local ports a dev server's log line names as its address (`localhost:5173`,
 * `http://0.0.0.0:8080`…). How Ilse finds a server that ignored the hidden port.
 */
export function loggedPorts(line: string): number[] {
  const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
  const ports = [...plain.matchAll(/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})(?!\d)/g)].map(m => Number(m[1]));
  return [...new Set(ports)].filter(p => p > 0 && p < 65536);
}

export function readPlanInput(cwd: string): PlanInput | null {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return null;
  let pkg: PlanInput['pkg'];
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { return null; }
  const viteFile = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']
    .map(f => join(cwd, f)).find(existsSync);
  return { pkg, viteConfig: viteFile ? readFileSync(viteFile, 'utf8') : undefined };
}

function answers(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * True when nothing listens on `port`. Binding alone isn't proof: a server on
 * every interface (`*:3000`, how Next listens) doesn't stop a bind to
 * 127.0.0.1:3000, and Ilse would then quietly take `localhost:3000` from it.
 * So anything that answers a connection counts as taken.
 */
export async function portIsFree(port: number): Promise<boolean> {
  for (const host of ['127.0.0.1', '::1']) if (await answers(host, port)) return false;
  for (const host of ['127.0.0.1', '::1']) {
    const free = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'EADDRNOTAVAIL')); // no IPv6 here: fine
      s.listen(port, host, () => s.close(() => resolve(true)));
    });
    if (!free) return false;
  }
  return true;
}

/** The first free port after `port`: what to suggest when the app's port is taken */
export async function nextFreePort(port: number): Promise<number> {
  for (let p = port + 1; p < Math.min(port + 100, 65536); p++) if (await portIsFree(p)) return p;
  throw new Error('no free port');
}

/** A free port for the hidden dev server: app port + 10000 when possible */
export async function pickHiddenPort(appPort: number): Promise<number> {
  const start = appPort + 10000 <= 65000 ? appPort + 10000 : 20000;
  for (let p = start; p < start + 50; p++) if (await portIsFree(p)) return p;
  throw new Error('no free port for the dev server');
}

export interface RunningDevServer {
  child: ChildProcess;
  hiddenPort: number;
  /** Where the dev server answers: the hidden port, or its own when it ignored it */
  target: DevTarget;
  /** Set when the script fixes its own port and ignored the hidden one */
  ownPort?: number;
  stop: () => void;
  /** Called once if the dev server stops on its own */
  onExit: (cb: (info: DevExit) => void) => void;
}

/**
 * Starts `npm run <script>` on the hidden port and resolves once it answers.
 * Its output goes to `log` line by line, hidden port rewritten to the app's.
 *
 * Not every server takes a port from outside (`serve -l 5173`, a port fixed in
 * code). Guessing flags never ends, so Ilse watches instead: an address the
 * server's own log names that answers is where it really is.
 */
export async function startHiddenDevServer(
  plan: SamePortPlan, log: (line: string) => void, timeoutMs = 120_000,
): Promise<RunningDevServer> {
  const cwd = plan.dir;
  const hiddenPort = await pickHiddenPort(plan.appPort);
  const { args, env } = hiddenPortArgs(plan.framework, hiddenPort);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npm, ['run', plan.script, ...(args.length ? ['--', ...args] : [])], {
    cwd,
    env: { ...process.env, ...env, FORCE_COLOR: process.env.FORCE_COLOR ?? '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group: Ctrl+C on Ilse stops the dev server and whatever it spawned
    detached: process.platform !== 'win32',
  });

  // npm exiting doesn't mean the group is gone: the dev server can outlive it as an
  // orphan, so the whole group is stopped whatever npm's state
  let stopped = false;
  const stop = () => {
    if (stopped || child.pid === undefined) return;
    stopped = true;
    if (process.platform === 'win32') { child.kill(); return; }
    stopGroup(child.pid);
  };
  process.on('exit', stop);

  const holder = new LockHolderWatch();
  const named = new Set<number>();
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) {
        holder.feed(l);
        // The other server's address isn't where this one is
        if (!holder.seen) for (const p of loggedPorts(l)) if (p !== hiddenPort) named.add(p);
        log(rewriteLog(l, hiddenPort, plan.appPort));
      }
    });
  }

  const exitListeners: Array<(info: DevExit) => void> = [];
  let exitInfo: DevExit | undefined;
  const exited = new Promise<never>((_, reject) => {
    child.once('exit', (code) => {
      exitInfo = { code, lockHolder: holder.result() };
      for (const cb of exitListeners) cb(exitInfo);
      reject(exitInfo.lockHolder ? new DevServerLockedError(exitInfo.lockHolder) : new Error(`the dev server exited (code ${code})`));
    });
    child.once('error', reject);
  });
  exited.catch(() => { /* surfaced by the race below or by onExit */ });
  const ready = (async (): Promise<{ target: DevTarget; ownPort?: number }> => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (holder.seen) break;
      const hidden = await findDevServer(cwd, [hiddenPort]);
      if (hidden) return { target: hidden };
      const own = named.size > 0 ? await findDevServer(cwd, [...named]) : null;
      if (own) return { target: own, ownPort: own.port };
      await new Promise(r => setTimeout(r, 400));
    }
    // Next 16 says "Ready" and answers for a moment before it sees another server holds the folder's lock
    if (holder.seen) return new Promise<never>(() => {});
    throw new Error(`the dev server didn't answer on :${hiddenPort}`);
  })();

  try {
    const found = await Promise.race([ready, exited]);
    // Next 16 can answer for a moment and only then hit the lock: give it the time to say so
    await Promise.race([new Promise(r => setTimeout(r, 600)), exited]);
    const onExit = (cb: (info: DevExit) => void) => { if (exitInfo) cb(exitInfo); else exitListeners.push(cb); };
    return { child, hiddenPort, stop, onExit, ...found };
  } catch (err) {
    stop();
    throw err;
  }
}

export interface DevExit {
  code: number | null;
  lockHolder?: LockHolder;
}

/** Another `next dev` of this project, named by Next when it refuses to start a second one */
export interface LockHolder {
  pid?: number;
  port?: number;
}

export class DevServerLockedError extends Error {
  constructor(readonly holder: LockHolder) {
    super(`another dev server of this project is running${holder.pid ? ` (PID ${holder.pid})` : ''}`);
    this.name = 'DevServerLockedError';
  }
}

/**
 * Reads Next's "Another next dev server is already running" block, line by line:
 *
 *   ⨯ Another next dev server is already running.
 *   - Local:        http://localhost:13000
 *   - PID:          89648
 */
export class LockHolderWatch {
  seen = false;
  private pid?: number;
  private port?: number;

  feed(line: string): void {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
    if (/another next dev server is already running/i.test(plain)) { this.seen = true; return; }
    if (!this.seen) return;
    const pid = plain.match(/\bPID:\s*(\d+)/);
    if (pid && this.pid === undefined) this.pid = Number(pid[1]);
    const local = plain.match(/\bLocal:\s*\S*?:(\d{2,5})\b/);
    if (local && this.port === undefined) this.port = Number(local[1]);
  }

  result(): LockHolder | undefined {
    return this.seen ? { pid: this.pid, port: this.port } : undefined;
  }
}

/**
 * Stops a process group: SIGTERM, then SIGKILL if it's still there. Synchronous so
 * it also works from `process.on('exit')`, where nothing async runs — a hung dev
 * server ignores SIGTERM and would stay behind holding the project's lock.
 */
export function stopGroup(pid: number, graceMs = 2000): void {
  const alive = () => { try { process.kill(-pid, 0); return true; } catch { return false; } };
  try { process.kill(-pid, 'SIGTERM'); } catch { return; }
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (let waited = 0; waited < graceMs && alive(); waited += 50) Atomics.wait(nap, 0, 0, 50);
  if (alive()) try { process.kill(-pid, 'SIGKILL'); } catch { /* gone meanwhile */ }
}
