/**
 * Finds the user's running dev server, so `npx ilse` needs no arguments.
 *
 * Candidate ports come from the project first (a `--port`/`-p` in the dev
 * script, then the framework's default) and common defaults after. Each one is
 * probed on IPv4 and IPv6: Vite on recent Node binds `localhost` to ::1 only.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import type { DevTarget } from './server.js';
import { TOOLBAR_PATH } from './toolbar.js';

const COMMON_PORTS = [3000, 5173, 3001, 4321, 8080, 5174, 8000, 4200];

const FRAMEWORK_PORTS: Array<[dep: string, port: number]> = [
  ['next', 3000], ['vite', 5173], ['astro', 4321], ['@remix-run/dev', 3000],
  ['react-scripts', 3000], ['@angular/core', 4200],
];

export function candidatePorts(cwd: string): number[] {
  const ports: number[] = [];
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const dev = pkg.scripts?.dev ?? pkg.scripts?.start ?? '';
      const flag = dev.match(/(?:--port|-p)[\s=]+(\d{2,5})/);
      if (flag) ports.push(Number(flag[1]));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [dep, port] of FRAMEWORK_PORTS) if (deps[dep]) ports.push(port);
    } catch { /* unreadable package.json — fall back to common ports */ }
  }
  return [...new Set([...ports, ...COMMON_PORTS])];
}

function probe(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export async function findDevServer(cwd: string, ports = candidatePorts(cwd), exclude: number[] = []): Promise<DevTarget | null> {
  for (const port of ports) {
    if (exclude.includes(port)) continue;
    for (const host of ['127.0.0.1', '::1']) {
      if (await probe(host, port)) return { host, port };
    }
  }
  return null;
}

/**
 * True when the dev server's own HTML already loads the toolbar (the Vite
 * plugin): then the app keeps its URL and no proxy is needed. Redirects and
 * errors count as "no" — the proxy is the safe default.
 */
export function pageHasToolbar(target: DevTarget, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: target.host, port: target.port, path: '/', headers: { accept: 'text/html' }, timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
        let html = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { html += c; });
        res.on('end', () => resolve(html.includes(TOOLBAR_PATH)));
        res.on('error', () => resolve(false));
      },
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/** Polls until a dev server shows up — the user may start it after `ilse`. */
export async function waitForDevServer(
  cwd: string,
  opts: { exclude?: number[]; intervalMs?: number; onWaiting?: () => void } = {},
): Promise<DevTarget> {
  let warned = false;
  for (;;) {
    const found = await findDevServer(cwd, candidatePorts(cwd), opts.exclude);
    if (found) return found;
    if (!warned) { opts.onWaiting?.(); warned = true; }
    await new Promise(r => setTimeout(r, opts.intervalMs ?? 1500));
  }
}
