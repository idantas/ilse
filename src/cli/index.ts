#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { listenCommand, annotationsCommand, resolveCommand } from './listen.js';
import { defaultCommand } from './default.js';
import { t, detectLocale, setLocale } from '../i18n/index.js';
import { loadUserConfig } from '../config/user-config.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// Initialize locale early so command descriptions are translated
const _cfg = loadUserConfig();
setLocale(_cfg.locale ?? detectLocale());

import { loadPro } from '../pro/load.js';
import { proCore } from '../pro/core.js';

const program = new Command();

program
  .name('ilse')
  .version(pkg.version)
  .description('Visual feedback for code agents')
  .option('--reset', t('cmd.reset'))
  .option('--target <port>', t('cmd.target'))
  .option('--proxy-port <port>', t('cmd.proxyPort'))
  .option('--inject', t('cmd.inject'))
  .option('--no-open', t('cmd.noOpen'))
  .option('--mode <mode>', 'automatic | mcp | clipboard')
  .option('--account', t('cmd.account'))
  .option('--same-port', t('cmd.samePort'))
  .option('--separate', t('cmd.separate'))
  .option('--port <port>', t('cmd.port'))
  .action(async (options: { reset?: boolean; target?: string; proxyPort?: string; inject?: boolean; open: boolean; mode?: string; account?: boolean; samePort?: boolean; separate?: boolean; port?: string }) => {
    if (options.reset) {
      const { saveUserConfig } = await import('../config/user-config.js');
      saveUserConfig({ setupDone: false });
      console.log(`  ${t('cli.resetDone')}\n`);
    }
    await defaultCommand({
      target: options.target ? parseInt(options.target, 10) : undefined,
      proxyPort: options.proxyPort ? parseInt(options.proxyPort, 10) : undefined,
      inject: options.inject,
      open: options.open,
      mode: options.mode === 'automatic' || options.mode === 'mcp' || options.mode === 'clipboard' ? options.mode : undefined,
      chooseAccount: options.account,
      samePort: options.samePort,
      separate: options.separate,
      port: options.port ? parseInt(options.port, 10) : undefined,
    });
  });

async function mcpCommand(names: string[], install: boolean, dryRun: boolean): Promise<void> {
  const { MCP_AGENTS, detectMcpAgents, applyMcp } = await import('../config/mcp-install.js');
  const list = MCP_AGENTS.join(', ');
  const unknown = names.find(n => !(MCP_AGENTS as string[]).includes(n));
  if (unknown) { console.log(`  ${t('mcp.unknown', { agent: unknown, agents: list })}`); process.exitCode = 1; return; }
  const detected = detectMcpAgents();
  if (!names.length && detected.length === 0) { console.log(`  ${t('mcp.none', { agents: list })}`); process.exitCode = 1; return; }
  let agents = names as typeof MCP_AGENTS;
  // Nothing named: the user picks — installing in an agent is their call, one by one
  if (!names.length && !dryRun) {
    if (!process.stdin.isTTY) { console.log(`  ${t('mcp.name', { agents: detected.join(', ') })}`); process.exitCode = 1; return; }
    const p = await import('@clack/prompts');
    const picked = await p.multiselect({
      message: t(install ? 'mcp.pickInstall' : 'mcp.pickUninstall'),
      options: detected.map(a => ({ value: a, label: a })),
      required: false,
      initialValues: [],
    });
    if (p.isCancel(picked) || picked.length === 0) { console.log(`  ${t('mcp.nothing')}`); return; }
    agents = picked;
  } else if (!names.length) agents = detected;
  console.log('');
  for (const agent of agents) {
    const r = applyMcp(agent, install, dryRun);
    if (dryRun) {
      console.log(`  ${t('mcp.wouldWrite', { agent, where: r.where })}`);
      if (r.preview && r.preview !== r.where) console.log(r.preview.split('\n').map(l => `    ${l}`).join('\n'));
    } else if (r.ok) console.log(`  ✓ ${t(install ? 'mcp.installed' : 'mcp.removed', { agent })}  ${r.where}`);
    else { console.log(`  ✗ ${t('mcp.failed', { agent, error: r.error ?? '' })}`); process.exitCode = 1; }
  }
  if (install && !dryRun) console.log(`\n  ${t('mcp.after')}`);
  console.log('');
}

const mcp = program.command('mcp').description(t('cmd.mcp'));
mcp
  .command('install [agents...]')
  .description(t('cmd.mcpInstall'))
  .option('--print', t('cmd.mcpPrint'))
  .action((agents: string[], options: { print?: boolean }) => mcpCommand(agents, true, !!options.print));
mcp
  .command('uninstall [agents...]')
  .description(t('cmd.mcpUninstall'))
  .option('--print', t('cmd.mcpPrint'))
  .action((agents: string[], options: { print?: boolean }) => mcpCommand(agents, false, !!options.print));

program
  .command('setup')
  .description(t('cmd.setup'))
  .action(() => mcpCommand([], true, false));

program
  .command('listen')
  .description(t('cmd.listen'))
  .option('--port <port>', 'WebSocket server port', '4747')
  .action(async (options: { port: string }) => {
    await listenCommand({ port: parseInt(options.port, 10) });
  });

program
  .command('annotations')
  .description(t('cmd.annotations'))
  .option('--status <status>', 'Filter by status (pending, sent, resolved)')
  .action((options: { status?: string }) => {
    annotationsCommand(options);
  });

program
  .command('resolve')
  .description(t('cmd.resolve'))
  .argument('<id>', 'Annotation ID')
  .option('-m, --summary <summary>', 'Resolution summary')
  .action((id: string, options: { summary?: string }) => {
    resolveCommand(id, options);
  });

program
  .command('bookmarklet')
  .description(t('cmd.bookmarklet'))
  .option('--port <port>', 'Ilse port (default: the running one, else 4747)')
  .action(async (options: { port?: string }) => {
    const { bookmarkletCode, BOOKMARKLET_PATH } = await import('../proxy/bookmarklet.js');
    const { readServerInfo } = await import('../config/local-token.js');
    const running = readServerInfo();
    const alive = (() => { try { return !!running && process.kill(running.pid, 0); } catch { return false; } })();
    const port = options.port ? parseInt(options.port, 10) : alive ? running!.port : 4747;
    console.log(`\n  ${t('bookmarklet.cliPage')} http://localhost:${port}${BOOKMARKLET_PATH}`);
    console.log(`  ${t('bookmarklet.cliOr')}\n`);
    console.log(bookmarkletCode(port, t('bookmarklet.notRunning', { port })) + '\n');
  });

// `ilse test` and the rest of Pro's commands come from Pro when it's installed
const pro = await loadPro();
if (pro?.registerCli) {
  pro.registerCli(program, proCore);
} else {
  program
    .command('test [url]')
    .description(t('cmd.test'))
    .allowUnknownOption()
    .action(() => {
      console.log(`\n  ${t('pro.testLocked')} https://ilse.design/#pro\n`);
    });
}

program
  .command('changes')
  .description(t('cmd.changes'))
  .option('--json', 'Raw ledger entries')
  .action(async (options: { json?: boolean }) => {
    const { pendingChanges, formatPending } = await import('../git/ledger.js');
    const pending = pendingChanges(process.cwd());
    console.log(options.json ? JSON.stringify(pending, null, 2) : formatPending(pending));
  });

program.parse();
