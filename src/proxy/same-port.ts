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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { findDevServer } from './find-dev-server.js';

export type DevFramework = 'next' | 'vite' | 'other';

export interface SamePortPlan {
  /** npm script that starts the dev server */
  script: string;
  framework: DevFramework;
  /** The port the app is used on — Ilse's proxy takes it */
  appPort: number;
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
export function planSamePort({ pkg, viteConfig }: PlanInput): SamePortPlan | null {
  const script = pkg.scripts?.dev ? 'dev' : pkg.scripts?.start ? 'start' : null;
  if (!script) return null;
  const command = pkg.scripts![script];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const framework: DevFramework = deps.next || /\bnext\b/.test(command) ? 'next'
    : deps.vite || /\bvite\b/.test(command) ? 'vite' : 'other';
  const appPort = portFlag(command)
    ?? (framework === 'vite' && viteConfig ? vitePort(viteConfig) : undefined)
    ?? DEFAULT_PORT[framework];
  return { script, framework, appPort };
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

/** A free port for the hidden dev server: app port + 10000 when possible */
export async function pickHiddenPort(appPort: number): Promise<number> {
  const start = appPort + 10000 <= 65000 ? appPort + 10000 : 20000;
  for (let p = start; p < start + 50; p++) if (await portIsFree(p)) return p;
  throw new Error('no free port for the dev server');
}

export interface RunningDevServer {
  child: ChildProcess;
  hiddenPort: number;
  stop: () => void;
}

/**
 * Starts `npm run <script>` on the hidden port and resolves once it answers.
 * Its output goes to `log` line by line, hidden port rewritten to the app's.
 */
export async function startHiddenDevServer(
  cwd: string, plan: SamePortPlan, log: (line: string) => void, timeoutMs = 120_000,
): Promise<RunningDevServer> {
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

  const stop = () => {
    if (child.exitCode !== null || child.pid === undefined) return;
    try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  };
  process.on('exit', stop);

  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) log(rewriteLog(l, hiddenPort, plan.appPort));
    });
  }

  const exited = new Promise<never>((_, reject) => {
    child.once('exit', (code) => reject(new Error(`the dev server exited (code ${code})`)));
    child.once('error', reject);
  });
  const ready = (async () => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await findDevServer(cwd, [hiddenPort])) return;
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error(`the dev server didn't answer on :${hiddenPort}`);
  })();

  try {
    await Promise.race([ready, exited]);
  } catch (err) {
    stop();
    throw err;
  }
  return { child, hiddenPort, stop };
}
