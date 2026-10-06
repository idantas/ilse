#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { listenCommand, annotationsCommand, resolveCommand } from './listen.js';
import { defaultCommand } from './default.js';
import { isClaudeInstalled, isAlreadyRegistered, registerInClaude } from '../config/mcp-register.js';
import { t, detectLocale, setLocale } from '../i18n/index.js';
import { loadUserConfig } from '../config/user-config.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// Initialize locale early so command descriptions are translated
const _cfg = loadUserConfig();
setLocale(_cfg.locale ?? detectLocale());

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
  .action(async (options: { reset?: boolean; target?: string; proxyPort?: string; inject?: boolean; open: boolean; mode?: string; account?: boolean }) => {
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
    });
  });

program
  .command('setup')
  .description(t('cmd.setup'))
  .action(() => {
    if (!isClaudeInstalled()) {
      console.log(`  ${t('setup.noClaude')}`);
      console.log(`  ${t('setup.manualHint')}`);
      console.log('  claude mcp add ilse -- npx -y -p ilse-design@next ilse-mcp');
      return;
    }

    if (isAlreadyRegistered()) {
      console.log(`  ${t('setup.alreadyRegistered')}`);
      return;
    }

    const result = registerInClaude();
    if (result.ok) {
      console.log(`  ${t('setup.registered')}`);
    } else {
      console.log(`  Erro: ${result.error}`);
    }
  });

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
