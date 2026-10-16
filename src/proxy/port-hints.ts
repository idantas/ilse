/**
 * When the app's port is taken: who holds it, and which ports the project's
 * code expects — so Ilse suggests one the login still works on.
 *
 * Only files without secrets are read: `.env.example`-style templates (they
 * are committed), the framework configs, the auth/middleware files and the dev
 * script. Never the real `.env*` files. Of what is read, only `host:port` and
 * the variable name are kept.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, normalize } from 'node:path';
import { execFile } from 'node:child_process';

export interface CodePort {
  port: number;
  /** Where it was found: `NEXTAUTH_URL (.env.example)`, `auth.ts`, `package.json "dev"` */
  sources: string[];
  /** Named by a login setting (callback, redirect, auth URL…): another port may break sign-in */
  auth: boolean;
}

/** Committed templates of the env files — the real ones may hold secrets and are never opened */
const ENV_TEMPLATES = [
  '.env.example', '.env.sample', '.env.template', '.env.dist',
  '.env.local.example', '.env.development.example', '.env.development.local.example',
];
const CONFIGS = [
  'next.config.js', 'next.config.mjs', 'next.config.ts',
  'vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs',
];
/** Where login code usually lives (NextAuth/Auth.js, middleware, a lib) */
const AUTH_FILES = [
  'auth.ts', 'auth.js', 'auth.config.ts', 'auth.config.js', 'middleware.ts', 'middleware.js',
  'src/auth.ts', 'src/auth.js', 'src/auth.config.ts', 'src/middleware.ts', 'src/middleware.js',
  'lib/auth.ts', 'lib/auth.js', 'src/lib/auth.ts', 'src/lib/auth.js',
];

const AUTH_NAME = /AUTH|CALLBACK|REDIRECT|OAUTH|SSO|SITE_URL|APP_URL|BASE_URL|ORIGIN|LOGIN/i;
const LOCAL_PORT = /(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})(?!\d)/g;

function localPorts(text: string): number[] {
  return [...text.matchAll(LOCAL_PORT)].map(m => Number(m[1])).filter(p => p > 0 && p < 65536);
}

function read(path: string): string | null {
  try { return existsSync(path) ? readFileSync(path, 'utf8') : null; } catch { return null; }
}

/** Ports the project's code names, login ones first */
export function codePorts(dir: string): CodePort[] {
  const found = new Map<number, CodePort>();
  const add = (port: number, source: string, auth: boolean) => {
    const entry = found.get(port) ?? { port, sources: [], auth: false };
    if (!entry.sources.includes(source)) entry.sources.push(source);
    entry.auth ||= auth;
    found.set(port, entry);
  };

  for (const file of ENV_TEMPLATES) {
    const text = read(join(dir, file));
    if (!text) continue;
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      for (const port of localPorts(m[2])) add(port, `${m[1]} (${file})`, AUTH_NAME.test(m[1]));
    }
  }
  for (const file of CONFIGS) {
    const text = read(join(dir, file));
    if (text) for (const port of localPorts(text)) add(port, file, false);
  }
  for (const file of AUTH_FILES) {
    const text = read(join(dir, file));
    if (text) for (const port of localPorts(text)) add(port, file, true);
  }
  const pkg = read(join(dir, 'package.json'));
  if (pkg) {
    try {
      const scripts = (JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts ?? {};
      for (const name of ['dev', 'start']) {
        const m = scripts[name]?.match(/(?:--port|-p)[\s=]+(\d{2,5})\b/);
        if (m) add(Number(m[1]), `package.json "${name}"`, false);
      }
    } catch { /* unreadable package.json */ }
  }
  return [...found.values()].sort((a, b) => Number(b.auth) - Number(a.auth));
}

/** The project loads the toolbar itself only through the Vite plugin */
export function projectUsesPlugin(dir: string): boolean {
  return CONFIGS.filter(f => f.startsWith('vite.'))
    .some(f => /['"]ilse-design\/vite['"]/.test(read(join(dir, f)) ?? ''));
}

export interface PortHolder {
  pid: number;
  /** Its working folder, when the system tells */
  dir?: string;
  /** Another `ilse` (any version) */
  ilse: boolean;
  /** Short name of the program: `next`, `vite`, `node`… */
  program: string;
}

/** An argument that is the ilse CLI: the bin (`ilse`, `ilse-design`) or its built entry */
export function isIlseCommand(command: string): boolean {
  return command.split(/\s+/).some(arg =>
    /(?:^|\/)ilse(?:-design)?$/.test(arg) || /(?:^|\/)ilse[^/\s]*\/dist\/cli\/index\.js$/.test(arg));
}

/** `next`, `vite`… out of `node /x/node_modules/.bin/../next/dist/bin/next dev`; the program itself otherwise */
export function programName(command: string): string {
  const [program = '', script] = command.trim().split(/\s+/);
  if (!script || !/^(?:node|bun|deno)$/.test(basename(program))) return basename(program);
  const pkg = normalize(script).split('/node_modules/')[1]?.split('/');
  if (pkg?.[0] === '.bin') return pkg[1];
  if (pkg) return pkg[0].startsWith('@') ? `${pkg[0]}/${pkg[1]}` : pkg[0];
  return basename(script);
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 1500 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/**
 * Who listens on `port` (macOS and Linux, through lsof). Best effort: null when
 * the system can't tell — the message then stays generic.
 */
export async function portHolder(port: number): Promise<PortHolder | null> {
  if (process.platform === 'win32') return null;
  const pid = Number((await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])).split('\n')[0]);
  if (!pid || pid === process.pid) return null;
  const command = (await run('ps', ['-o', 'command=', '-p', String(pid)])).trim();
  const cwd = (await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])).split('\n').find(l => l.startsWith('n'));
  return { pid, dir: cwd?.slice(1) || undefined, ilse: isIlseCommand(command), program: programName(command) || 'node' };
}

/**
 * Stops another `ilse`: two Ctrl+C, the way its own terminal would (the first
 * stops its agent, the second exits and takes its dev server down), then waits
 * for the port to free up.
 */
export async function stopIlse(holder: PortHolder, isFree: () => Promise<boolean>): Promise<boolean> {
  try {
    process.kill(holder.pid, 'SIGINT');
    await new Promise(r => setTimeout(r, 300));
    process.kill(holder.pid, 'SIGINT');
  } catch { /* already gone */ }
  for (let i = 0; i < 40; i++) {
    if (await isFree()) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

export type BusyOption =
  | { kind: 'code'; port: number; source: string }
  | { kind: 'stop'; port: number }
  | { kind: 'free'; port: number; authPort?: number; authSource?: string }
  | { kind: 'other' };

/**
 * What to offer when the app's port is taken, best first:
 * a free port the code names; stopping the other Ilse when the login is tied to
 * the taken port; the next free port (with a warning when that breaks login);
 * any port the user types.
 */
export function busyOptions(input: {
  busyPort: number;
  /** codePorts() of the app */
  ports: CodePort[];
  /** Which of those ports are free */
  free: number[];
  nextFree: number | null;
  /** The taken port holds another Ilse: stopping it is offered */
  holderIsIlse: boolean;
  /** The designer said the login depends on the taken port (when the code doesn't say) */
  loginTied?: boolean;
}): BusyOption[] {
  const { busyPort, ports, free, nextFree, holderIsIlse, loginTied } = input;
  const options: BusyOption[] = [];
  const authOnBusy = ports.find(p => p.port === busyPort && p.auth);
  const tied = !!authOnBusy || !!loginTied;
  const codeFree = ports.filter(p => p.port !== busyPort && free.includes(p.port));
  // The login is tied to the taken port and another Ilse holds it: freeing it is the fix
  if (tied && holderIsIlse) options.push({ kind: 'stop', port: busyPort });
  for (const p of codeFree) options.push({ kind: 'code', port: p.port, source: p.sources[0] });
  if (!tied && holderIsIlse) options.push({ kind: 'stop', port: busyPort });
  if (nextFree !== null && !codeFree.some(p => p.port === nextFree)) {
    options.push(tied
      ? { kind: 'free', port: nextFree, authPort: busyPort, authSource: authOnBusy?.sources[0] }
      : { kind: 'free', port: nextFree });
  }
  options.push({ kind: 'other' });
  return options;
}
