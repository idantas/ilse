import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codePorts, projectUsesPlugin, isIlseCommand, programName, busyOptions, type CodePort } from '../port-hints.js';
import { servedByIlse } from '../find-dev-server.js';
import { PROXY_HEADER } from '../toolbar.js';

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ilse-ports-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe('codePorts', () => {
  it('reads login ports from env templates, configs, auth files and the dev script', () => {
    const dir = project({
      '.env.example': 'NEXTAUTH_URL=http://localhost:3000\nAPI_URL=http://localhost:8080/api\n# COMMENT=localhost:1234\n',
      'next.config.ts': "export default { images: { domains: ['localhost:3000'] } }",
      'src/middleware.ts': "const allowed = 'http://127.0.0.1:3002'",
      'package.json': JSON.stringify({ scripts: { dev: 'next dev -p 3000' } }),
    });
    const ports = codePorts(dir);
    expect(ports.find(p => p.port === 3000)).toEqual({
      port: 3000, auth: true, sources: ['NEXTAUTH_URL (.env.example)', 'next.config.ts', 'package.json "dev"'],
    });
    expect(ports.find(p => p.port === 3002)).toEqual({ port: 3002, auth: true, sources: ['src/middleware.ts'] });
    expect(ports.find(p => p.port === 8080)).toEqual({ port: 8080, auth: false, sources: ['API_URL (.env.example)'] });
    expect(ports.some(p => p.port === 1234)).toBe(false);
    // Login ports first
    expect(ports.at(-1)!.auth).toBe(false);
  });

  it('never opens the real env files, and keeps no values', () => {
    const dir = project({
      '.env': 'NEXTAUTH_URL=http://localhost:4000\nNEXTAUTH_SECRET=s3cret',
      '.env.local': 'AUTH_URL=http://localhost:4001',
      '.env.example': 'NEXTAUTH_SECRET=s3cret-example\nAUTH_URL=http://localhost:3000',
    });
    const ports = codePorts(dir);
    expect(ports.map(p => p.port)).toEqual([3000]);
    expect(JSON.stringify(ports)).not.toContain('s3cret');
  });

  it('is empty for a project that names no port', () => {
    expect(codePorts(project({ 'package.json': JSON.stringify({ scripts: { dev: 'next dev' } }) }))).toEqual([]);
  });
});

describe('projectUsesPlugin', () => {
  it('only when the Vite config imports the plugin', () => {
    expect(projectUsesPlugin(project({ 'vite.config.ts': "import ilse from 'ilse-design/vite'\nexport default { plugins: [ilse()] }" }))).toBe(true);
    expect(projectUsesPlugin(project({ 'vite.config.ts': 'export default {}' }))).toBe(false);
    expect(projectUsesPlugin(project({ 'next.config.ts': 'export default {}' }))).toBe(false);
  });
});

describe('isIlseCommand / programName', () => {
  it('recognises the ilse CLI however it was started', () => {
    expect(isIlseCommand('node /Users/a/.local/bin/ilse')).toBe(true);
    expect(isIlseCommand('node /opt/homebrew/bin/ilse-design --target 5199')).toBe(true);
    expect(isIlseCommand('node /Users/a/Projects/ilse-dev/dist/cli/index.js')).toBe(true);
    expect(isIlseCommand('node /x/node_modules/.bin/next dev -p 3000')).toBe(false);
    expect(isIlseCommand('node /Users/a/ilse-site/node_modules/.bin/vite')).toBe(false);
  });

  it('names the program behind node', () => {
    expect(programName('node /x/sac/node_modules/.bin/../next/dist/bin/next dev -p 3000')).toBe('next');
    expect(programName('node /x/node_modules/@scope/cli/bin/run.js')).toBe('@scope/cli');
    expect(programName('node /x/demo/node_modules/.bin/vite --port 5199')).toBe('vite');
    expect(programName('node /Users/a/.local/bin/ilse')).toBe('ilse');
    expect(programName('/usr/bin/python3 -m http.server 3000')).toBe('python3');
  });
});

describe('busyOptions', () => {
  const login3000: CodePort = { port: 3000, sources: ['NEXTAUTH_URL (.env.example)'], auth: true };

  it('login tied to the taken port, held by another Ilse: stopping it comes first, the next free port warns', () => {
    expect(busyOptions({ busyPort: 3000, ports: [login3000], free: [], nextFree: 3001, holderIsIlse: true })).toEqual([
      { kind: 'stop', port: 3000 },
      { kind: 'free', port: 3001, authPort: 3000, authSource: 'NEXTAUTH_URL (.env.example)' },
      { kind: 'other' },
    ]);
  });

  it('a free port the code names comes before the blind next one', () => {
    const ports: CodePort[] = [{ port: 3002, sources: ['src/middleware.ts'], auth: true }];
    expect(busyOptions({ busyPort: 3000, ports, free: [3002], nextFree: 3001, holderIsIlse: false })).toEqual([
      { kind: 'code', port: 3002, source: 'src/middleware.ts' },
      { kind: 'free', port: 3001 },
      { kind: 'other' },
    ]);
  });

  it('never offers a code port that is taken, nor the same port twice', () => {
    const ports: CodePort[] = [{ port: 3001, sources: ['next.config.ts'], auth: false }];
    expect(busyOptions({ busyPort: 3000, ports, free: [3001], nextFree: 3001, holderIsIlse: false })).toEqual([
      { kind: 'code', port: 3001, source: 'next.config.ts' },
      { kind: 'other' },
    ]);
    expect(busyOptions({ busyPort: 3000, ports, free: [], nextFree: 3002, holderIsIlse: false })[0]).toEqual({ kind: 'free', port: 3002 });
  });

  it('the designer said the login depends on the port: warns without a source', () => {
    expect(busyOptions({ busyPort: 3000, ports: [], free: [], nextFree: 3001, holderIsIlse: false, loginTied: true })).toEqual([
      { kind: 'free', port: 3001, authPort: 3000, authSource: undefined },
      { kind: 'other' },
    ]);
  });

  it('no login tie: another Ilse can still be stopped, after the code ports', () => {
    const ports: CodePort[] = [{ port: 3005, sources: ['vite.config.ts'], auth: false }];
    expect(busyOptions({ busyPort: 3000, ports, free: [3005], nextFree: 3001, holderIsIlse: true }).map(o => o.kind))
      .toEqual(['code', 'stop', 'free', 'other']);
  });
});

describe('servedByIlse', () => {
  it('is true only for pages carrying the proxy header', async () => {
    const listen = (s: http.Server) => new Promise<number>(r => s.listen(0, '127.0.0.1', () => r((s.address() as { port: number }).port)));
    const ilse = http.createServer((_q, res) => { res.writeHead(307, { location: '/login', [PROXY_HEADER]: '1' }); res.end(); });
    const app = http.createServer((_q, res) => { res.writeHead(200); res.end('app'); });
    const [a, b] = [await listen(ilse), await listen(app)];
    try {
      expect(await servedByIlse(a)).toBe(true);
      expect(await servedByIlse(b)).toBe(false);
    } finally {
      await Promise.all([ilse, app].map(s => new Promise<void>(r => s.close(() => r()))));
    }
  });
});

describe('findDevServer', () => {
  it("skips a port another Ilse's proxy serves", async () => {
    const { findDevServer } = await import('../find-dev-server.js');
    const listen = (s: http.Server) => new Promise<number>(r => s.listen(0, '127.0.0.1', () => r((s.address() as { port: number }).port)));
    const ilse = http.createServer((_q, res) => { res.writeHead(200, { [PROXY_HEADER]: '1' }); res.end(); });
    const app = http.createServer((_q, res) => { res.writeHead(200); res.end('app'); });
    const [a, b] = [await listen(ilse), await listen(app)];
    try {
      expect(await findDevServer('.', [a, b])).toEqual({ host: '127.0.0.1', port: b });
      expect(await findDevServer('.', [a])).toBeNull();
    } finally {
      await Promise.all([ilse, app].map(s => new Promise<void>(r => s.close(() => r()))));
    }
  });
});
