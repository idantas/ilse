import chalk from 'chalk';
import * as p from '@clack/prompts';
import { loadUserConfig, saveUserConfig, isFirstRun, isProjectSetup, type IlseMode } from '../config/user-config.js';
import { detectAgent, executeAnnotation, executeBatch, buildBatchPrompt, killAllActiveProcesses, type AgentDetection } from '../agent/executor.js';
import { startServer, broadcast, getPort } from '../bridge/ws-server.js';
import { resolveAnnotation, markSent, getAnnotation } from '../bridge/store.js';
import { createMcpHttpHandler, MCP_PATH } from '../mcp/http.js';
import { getLocalToken, writeServerInfo } from '../config/local-token.js';
import { createRequire } from 'node:module';
import { Journal } from '../telemetry/journal.js';
import { detectFramework, type Framework } from '../setup/framework-detect.js';
import { injectIlseComponent } from '../setup/inject-component.js';
import { detectTokens } from '../setup/token-detect.js';
import { t, detectLocale, setLocale } from '../i18n/index.js';
import type { Annotation } from '../types.js';
import { checkForUpdate } from './update-check.js';
import { startProxy } from '../proxy/server.js';
import { serveToolbar } from '../proxy/toolbar.js';
import { serveBookmarklet } from '../proxy/bookmarklet.js';
import { findDevServer, waitForDevServer, pageHasToolbar } from '../proxy/find-dev-server.js';
import { planSamePort, readPlanInput, portIsFree, startHiddenDevServer } from '../proxy/same-port.js';
import { spawn } from 'node:child_process';
import { planTokenSwap, planTextSwap, applyTokenSwap, describeSwap, type SwapPlan } from '../context/token-swap.js';
import {
  takeSnapshot, diffSnapshot, discardChangeSet, reapplyChangeSet, pushUndo, popUndo, pushRedo, popRedo, undoState, summarizeChangeSet, type ChangeSet,
} from '../agent/changeset.js';
import { isLimitError, limitResetsAt } from '../agent/executor.js';
import { listClaudeAccounts, describeAccount, savedAccount, type ClaudeAccount } from '../agent/claude-accounts.js';
import { setClaudeConfigDir } from '../agent/agent-profile.js';
import { pickTier, escalateTier, resolveModel, modelTiers, expectsEdit, type Tier } from '../agent/agent-profile.js';
import { historyCount, swapMatchesScope } from '../bridge/augment.js';
import { quickBlocker, buildQuickPrompt, runQuick } from '../agent/quick-edit.js';
import { recordChange, recordUndone, describeAnnotation, ledgerFile, type LedgerPath } from '../git/ledger.js';
import { syntaxBreaks, describeBreaks, repairPrompt, type SyntaxBreak } from '../agent/verify.js';
import { planClassEdit } from '../context/token-swap.js';
import { hasCommitContext, addCommitContext, commitContextChoice, saveCommitContextChoice, instructionsFile } from '../git/commit-context.js';

const FRAMEWORK_LABELS: Record<Framework, string> = {
  'next-app': 'Next.js (App Router)',
  'next-pages': 'Next.js (Pages Router)',
  'vite-react': 'Vite + React',
  'cra': 'Create React App',
  'remix': 'Remix',
  'astro': 'Astro',
  'unknown': '',
};

// ── Global first-run setup (mode + agent preference) ─────────────────────────

async function firstRunSetup(agent: AgentDetection): Promise<IlseMode> {
  p.intro(chalk.bold('ilse'));

  const hasAgent = agent.kind !== 'none';
  let mode: IlseMode;

  if (!hasAgent) {
    p.log.warn(t('cli.noAgent'));
    p.log.info(t('cli.clipboardFallback'));
    mode = 'clipboard';
  } else {
    const modeChoice = await p.select({
      message: t('cli.modeQuestion'),
      options: [
        {
          value: 'automatic',
          label: t('cli.modeAutomatic'),
          hint: t('cli.modeAutomaticHint', { agent: agent.kind }),
        },
        {
          value: 'mcp',
          label: t('cli.modeMcp'),
          hint: t('cli.modeMcpHint'),
        },
        {
          value: 'clipboard',
          label: t('cli.modeCopyPaste'),
          hint: t('cli.modeCopyPasteHint'),
        },
      ],
    });
    if (p.isCancel(modeChoice)) {
      p.cancel(t('cli.cancelled'));
      process.exit(0);
    }
    mode = modeChoice as IlseMode;
  }

  const addressChoice = await p.select({
    message: t('cli.addressQuestion'),
    options: [
      { value: 'same', label: t('cli.addressSame'), hint: t('cli.addressSameHint') },
      { value: 'separate', label: t('cli.addressSeparate'), hint: t('cli.addressSeparateHint') },
    ],
  });
  if (p.isCancel(addressChoice)) {
    p.cancel(t('cli.cancelled'));
    process.exit(0);
  }

  saveUserConfig({ mode, agent: agent.kind, setupDone: true, address: addressChoice as 'same' | 'separate' });
  return mode;
}

// ── Per-project setup (inject toolbar) ───────────────────────────────────────
// Runs whenever .ilserc.json doesn't exist in cwd — independent of global setup.

async function projectSetup(): Promise<void> {
  p.intro(chalk.bold(t('cli.newProject')));

  const framework = detectFramework();
  if (framework.layoutPath && !framework.alreadyInstalled) {
    const label = FRAMEWORK_LABELS[framework.framework] || t('cli.frameworkUnknown');
    p.log.info(t('cli.detected', { framework: chalk.cyan(label) }));
    const shouldInject = await p.confirm({
      message: t('cli.injectQuestion', { component: chalk.cyan('<Ilse />') }),
      initialValue: true,
    });
    if (p.isCancel(shouldInject)) {
      p.cancel(t('cli.cancelled'));
      process.exit(0);
    }
    if (shouldInject) {
      const result = injectIlseComponent(framework.layoutPath, framework.framework);
      if (result.ok) {
        p.log.success(t('cli.injected', { path: chalk.dim(framework.layoutPath) }));
        if (result.diff && result.diff !== '(já instalado)') {
          console.log(chalk.green(result.diff.split('\n').map(l => '  ' + l).join('\n')));
        }
      } else {
        p.log.error(result.error ?? t('cli.injectError'));
        p.log.info(t('cli.addManually'));
        console.log(chalk.dim('  import { Ilse } from "ilse-design/react";'));
        console.log(chalk.dim('  <Ilse />'));
      }
    } else {
      p.log.info(t('cli.addManuallyLater'));
      console.log(chalk.dim('  import { Ilse } from "ilse-design/react";'));
      console.log(chalk.dim('  <Ilse />'));
    }
  } else if (framework.alreadyInstalled) {
    p.log.info(`${chalk.green('✓')} ${t('cli.alreadyInstalled')}`);
  } else if (framework.framework === 'unknown') {
    p.log.warn(t('cli.unknownFramework'));
    console.log(chalk.dim('  import { Ilse } from "ilse-design/react";'));
    console.log(chalk.dim('  <Ilse />'));
  }

  p.outro(chalk.bold(t('cli.ready')));
}

// ── Formatted annotation display ─────────────────────────────────────────────

function printAnnotationHeader(a: Annotation, index: number): void {
  console.log('');
  console.log(chalk.dim('  ─── anotação #' + (index + 1) + ' ─────────────────────────'));
  console.log(chalk.white('  ' + a.element) + (a.component ? chalk.dim(' · ' + a.component) : ''));
  if (a.intent) console.log(chalk.dim('  intent: ') + chalk.magenta(a.intent));
  if (a.note) console.log(chalk.yellow('  "' + a.note + '"'));
  if (a.rearrangeData) {
    const { selector, originalRect: o, currentRect: c } = a.rearrangeData;
    console.log(chalk.dim('  move: ') + chalk.cyan(`${selector}`) + chalk.dim(` from (${o.x},${o.y}) → (${c.x},${c.y}) Δx:${c.x - o.x} Δy:${c.y - o.y}`));
  }
  if (a.grepPattern) console.log(chalk.dim('  grep: ') + chalk.dim(a.grepPattern));
}

// ── Main default command ────────────────────────────────────────────────────

function changeTotals(cs: ChangeSet): { files: number; added: number; removed: number } {
  const files = summarizeChangeSet(cs);
  return { files: files.length, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) };
}

export interface DefaultOptions {
  target?: number;    // dev server port; auto-detected when absent
  proxyPort?: number;
  inject?: boolean;   // old flow: write <Ilse /> into the layout
  mode?: IlseMode;    // override the saved mode for this run
  open?: boolean;
  /** Ask again which Claude account to use (--account) */
  chooseAccount?: boolean;
  /** Start the dev server behind Ilse, on the app's own port (--same-port) */
  samePort?: boolean;
  /** Use the separate address (:4700) for this run (--separate) */
  separate?: boolean;
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => { /* no browser opener — the URL is printed anyway */ });
    child.unref();
  } catch { /* same */ }
}

/**
 * Same port: Ilse starts the dev script on a hidden port and takes the app's
 * own port with its proxy, so the app keeps its address (login, SSO, OAuth).
 * 'failed' leaves the caller to fall back to the separate address.
 */
async function startSamePort(options: DefaultOptions, bridgePort: number): Promise<'same-port' | 'plugin' | 'busy' | 'failed'> {
  const input = readPlanInput(process.cwd());
  const plan = input ? planSamePort(input) : null;
  if (!plan) {
    console.log(chalk.yellow(`  ${t('samePort.noScript')}`));
    return 'failed';
  }
  if (options.target) plan.appPort = options.target;
  if (!(await portIsFree(plan.appPort))) {
    // Already serving the toolbar itself (Vite plugin): nothing to start, work right there
    const running = await findDevServer(process.cwd(), [plan.appPort]);
    if (running && await pageHasToolbar(running)) {
      const url = `http://localhost:${plan.appPort}`;
      console.log('');
      console.log(chalk.dim(`  ${t('proxy.direct')} `) + chalk.bold.cyan(url));
      console.log('');
      if (options.open !== false) openBrowser(url);
      return 'plugin';
    }
    // Whatever holds the port may not even be this project — never put the toolbar over it
    console.log('');
    console.log(chalk.yellow(`  ${t('samePort.busy', { port: plan.appPort })}`));
    console.log(chalk.dim(`  ${t('samePort.busyHint')}`));
    console.log('');
    return 'busy';
  }
  console.log(chalk.dim(`  ${t('samePort.starting', { script: `npm run ${plan.script}` })}`));
  let dev;
  try {
    dev = await startHiddenDevServer(process.cwd(), plan, (line) => console.log(chalk.dim('  │ ') + line));
  } catch (err) {
    console.log(chalk.red(`  ✗ ${t('samePort.failed')}: ${(err as Error).message}`));
    return 'failed';
  }
  try {
    const target = (await findDevServer(process.cwd(), [dev.hiddenPort])) ?? { host: '127.0.0.1', port: dev.hiddenPort };
    await startProxy({ target, port: plan.appPort, maxPort: plan.appPort, bridgePort, dualStack: true });
  } catch (err) {
    dev.stop();
    console.log(chalk.red(`  ✗ ${t('proxy.failed')}: ${(err as Error).message}`));
    return 'failed';
  }
  const url = `http://localhost:${plan.appPort}`;
  console.log('');
  console.log(chalk.dim(`  ${t('samePort.open')} `) + chalk.bold.cyan(url));
  console.log('');
  if (options.open !== false) openBrowser(url);
  return 'same-port';
}

/**
 * Default activation: a local proxy injects the toolbar, so the project's
 * files stay untouched. Runs in the background — the WS server is already up
 * and the dev server may start after `ilse`. When the dev server already loads
 * the toolbar itself (Vite plugin), there is no proxy: the app keeps its URL.
 */
async function startToolbarProxy(options: DefaultOptions, bridgePort: number): Promise<'proxy' | 'plugin' | 'failed'> {
  const target = options.target
    // Probe both stacks: Vite on recent Node binds `localhost` to ::1 only
    ? (await findDevServer(process.cwd(), [options.target])) ?? { host: '127.0.0.1', port: options.target }
    : await waitForDevServer(process.cwd(), {
        onWaiting: () => console.log(chalk.dim(`  ${t('proxy.waiting')}`)),
      });
  if (await pageHasToolbar(target)) {
    const url = `http://localhost:${target.port}`;
    console.log('');
    console.log(chalk.dim(`  ${t('proxy.direct')} `) + chalk.bold.cyan(url));
    console.log('');
    if (options.open !== false) openBrowser(url);
    return 'plugin';
  }
  try {
    const proxy = await startProxy({ target, port: options.proxyPort, bridgePort });
    const url = `http://localhost:${proxy.port}`;
    console.log('');
    console.log(chalk.dim(`  ${t('proxy.open')} `) + chalk.bold.cyan(url) + chalk.dim(`  (${t('proxy.target')} :${target.port})`));
    console.log('');
    if (options.open !== false) openBrowser(url);
    return 'proxy';
  } catch (err) {
    console.log(chalk.red(`  ✗ ${t('proxy.failed')}: ${(err as Error).message}`));
    return 'failed';
  }
}

export async function defaultCommand(options: DefaultOptions = {}): Promise<void> {
  // Initialize locale from config or system
  const config0 = loadUserConfig();
  const locale = config0.locale ?? detectLocale();
  setLocale(locale);
  if (!config0.locale) saveUserConfig({ locale });

  // Fire update check in parallel — never blocks startup
  const updatePromise = checkForUpdate();

  const agent = detectAgent();
  let config = loadUserConfig();

  // Global first run — choose mode/agent preference once
  if (isFirstRun()) {
    const mode = await firstRunSetup(agent);
    config = { ...config, mode, setupDone: true };
  }

  if (options.mode) config = { ...config, mode: options.mode };

  // Toolbar: proxy by default (nothing written to the project). The old
  // flow — writing <Ilse /> into the layout — is opt-in with --inject.
  const framework = detectFramework();
  if (options.inject && !isProjectSetup()) {
    await projectSetup();
  }
  const useProxy = !options.inject && !framework.alreadyInstalled;

  // Claude account: one machine can hold several logins (CLAUDE_CONFIG_DIR). With
  // more than one, the designer picks per project — once — and every run uses it.
  let agentAccount: ClaudeAccount | undefined;
  if (agent.kind === 'claude' && config.mode === 'automatic') {
    const accounts = await listClaudeAccounts(agent.command);
    const saved = savedAccount(accounts, loadUserConfig().claudeAccounts?.[process.cwd()]);
    if (accounts.length === 1) agentAccount = accounts[0];
    else if (accounts.length > 1) {
      agentAccount = !options.chooseAccount ? saved : undefined;
      if (!agentAccount && process.stdin.isTTY) {
        const pick = await p.select({
          message: t('cli.accountQuestion'),
          options: accounts.map((a, i) => ({ value: i, label: describeAccount(a), hint: a.configDir ?? '~/.claude' })),
          initialValue: Math.max(0, accounts.indexOf(saved ?? accounts[0])),
        });
        if (!p.isCancel(pick)) agentAccount = accounts[pick as number];
      }
      agentAccount ??= accounts.find(a => (a.configDir ?? null) === (process.env.CLAUDE_CONFIG_DIR ?? null)) ?? accounts[0];
      const all = loadUserConfig().claudeAccounts ?? {};
      saveUserConfig({ claudeAccounts: { ...all, [process.cwd()]: agentAccount.configDir ?? '' } });
    }
    if (agentAccount) setClaudeConfigDir(agentAccount.configDir);
  }

  // Commits: the project's agent should know Ilse's edits are meant to go in (asked once)
  if (process.stdin.isTTY && ledgerFile(process.cwd()) && !hasCommitContext(process.cwd()) && commitContextChoice(process.cwd()) === undefined) {
    const target = instructionsFile(process.cwd());
    const ok = await p.confirm({
      message: t('cli.commitContextQuestion', { file: chalk.cyan(target.path.split('/').pop()!) }),
      initialValue: true,
    });
    if (!p.isCancel(ok)) {
      if (ok) p.log.success(t('cli.commitContextAdded', { path: chalk.dim(addCommitContext(process.cwd())) }));
      saveCommitContextChoice(process.cwd(), !!ok);
    }
  }

  // Detect DS tokens
  const tokenResult = detectTokens();
  const detectedTokens = tokenResult.tokens;

  // Header
  console.log('');
  console.log(chalk.bold('  ilse'));
  console.log('');
  console.log(chalk.dim(`  ${t('cli.listening')}`));
  console.log(chalk.dim(`  ${t('cli.annotateHint')}`));
  console.log('');

  if (config.mode === 'mcp') {
    console.log(chalk.dim('  Modo: ') + chalk.green(t('cli.modeMcpLabel')));
  } else if (config.mode === 'automatic' && agent.kind !== 'none') {
    console.log(chalk.dim('  Modo: ') + chalk.green(t('cli.modeAutoLabel')) + chalk.dim(' · Agente: ') + chalk.cyan(agent.kind)
      + (agentAccount ? chalk.dim(' · ') + chalk.cyan(describeAccount(agentAccount)) : ''));
    if (agentAccount) console.log(chalk.dim(`  ${t('cli.accountHint')}`));
  } else {
    console.log(chalk.dim('  Modo: ') + chalk.yellow(t('cli.modeClipboardLabel')));
  }

  if (detectedTokens.length > 0) {
    console.log(chalk.dim('  DS: ') + chalk.magenta(`${detectedTokens.length} tokens`) + chalk.dim(` (${tokenResult.source})`));
    if (tokenResult.libraries.length > 0) {
      console.log(chalk.dim('  Libs: ') + chalk.dim(tokenResult.libraries.join(', ')));
    }
  }
  // Update notification (non-blocking — result may already be ready)
  const update = await updatePromise;
  if (update?.hasUpdate) {
    console.log(chalk.yellow(`  ↑ ${t('cli.updateAvailable', { version: update.latest })}`) + chalk.dim(` · ${update.install}`));
  }

  // Port printed after startServer() — placeholder updated below
  console.log('');

  let annotationCount = 0;

  // Session resume: track Claude session id across invocations for persistent context
  let claudeSessionId: string | undefined;
  // Fresh session per batch by default. Resuming re-sends the whole earlier
  // conversation (every read, grep, reply) on every turn — the journal showed
  // resumed batches costing more with half the turns. Continuity comes from the
  // compact Ilse history in the prompt instead. ILSE_RESUME=1 to compare.
  const resumeSessions = process.env.ILSE_RESUME === '1';

  // Stop flag: set when designer clicks Stop, cleared after batch handles it
  let userStopped = false;

  // Debounce: buffer annotations arriving within BATCH_WINDOW ms, then process together
  const BATCH_WINDOW = 800;
  let pendingBuffer: Annotation[] = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  const flushBuffer = async () => {
    if (pendingBuffer.length === 0) return;
    const toProcess = pendingBuffer;
    pendingBuffer = [];
    batchTimer = null;

    if (toProcess.length === 1) {
      await handleAnnotation(toProcess[0]);
    } else {
      await handleBatchInternal(toProcess);
    }
  };

  const scheduleBatch = (annotation: Annotation) => {
    journal.received(annotation);
    // Chat, analyze and panel edits are immediate — panel edits usually become
    // a class swap without an agent, and the journal showed the 800ms batch
    // window was nearly all of their latency
    if (annotation.intent === 'chat' || annotation.intent === 'analyze' || annotation.intent === 'style') {
      void handleBatchInternal([annotation]);
      return;
    }
    pendingBuffer.push(annotation);
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(() => { void flushBuffer(); }, BATCH_WINDOW);
  };

  const handleAnnotation = async (annotation: Annotation) => {
    // Single annotation → use batch (same code path) to benefit from session resume + stream-json
    await handleBatchInternal([annotation]);
  };

  const cwdRoot = process.cwd();

  // Journal: timings, tokens and outcomes per annotation (Settings → Logs)
  const journal = new Journal({
    ilseVersion: (createRequire(import.meta.url)('../../package.json') as { version: string }).version,
    framework: framework.framework,
    mode: config.mode,
    agent: agent.kind,
    toolbar: useProxy ? 'proxy' : 'component',
  });
  const resolveAndLog = (id: string, summary: string) => {
    const resolved = resolveAnnotation(id, summary);
    if (resolved) journal.resolved(id);
    return resolved;
  };
  let batchSeq = 0;
  // Each annotation's header prints once, even when the quick path hands it to the agent
  const announced = new Set<string>();
  const announce = (ann: Annotation) => {
    if (announced.has(ann.id)) return;
    announced.add(ann.id);
    annotationCount++;
    printAnnotationHeader(ann, annotationCount - 1);
  };

  // The agent's account hit its usage limit: every run until it resets would fail
  // the same way. Stop spawning, say so once with the time, send annotations back
  // to pending so the designer can resend them later.
  let agentLimit: { message: string; until: Date } | null = null;
  const limitActive = () => {
    if (agentLimit && Date.now() >= agentLimit.until.getTime()) agentLimit = null;
    return agentLimit !== null;
  };
  const limitNotice = () => t('cli.agentLimit', {
    time: agentLimit!.until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    account: agentAccount ? describeAccount(agentAccount) : agent.kind,
  });
  // Annotations held while the limit lasts — sent again on their own when it resets
  let waiting: Annotation[] = [];
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleResume = () => {
    if (resumeTimer || !agentLimit) return;
    // A little past the reset, so the first run doesn't race it
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      agentLimit = null;
      const again = waiting;
      waiting = [];
      if (again.length === 0) return;
      console.log(chalk.dim('  ') + chalk.cyan('▶') + chalk.dim(` ${t('cli.agentResume', { count: again.length })}`));
      for (const a of again) broadcast({ type: 'status', id: a.id, status: 'sent' });
      void handleBatchInternal(again);
    }, Math.max(0, agentLimit.until.getTime() - Date.now()) + 30_000);
  };
  const tripLimit = (message: string) => {
    if (limitActive()) return;
    agentLimit = { message, until: limitResetsAt(message) ?? new Date(Date.now() + 10 * 60_000) };
    console.log(chalk.dim('  ') + chalk.yellow('⏸') + ' ' + chalk.yellow(limitNotice()) + chalk.dim(` (${message})`));
  };
  const deferForLimit = (annotations: Annotation[]) => {
    for (const ann of annotations) {
      if (waiting.some(w => w.id === ann.id)) continue;
      waiting.push(ann);
      broadcast({ type: 'deferred', id: ann.id, message: limitNotice() });
    }
    console.log(chalk.dim('  ') + chalk.yellow('⏸') + chalk.dim(` ${t('cli.agentLimitDeferred', { count: annotations.length })}`));
    scheduleResume();
  };
  let currentBatchId: string | undefined;

  // Every batch that touched files can be undone from the toolbar (button or ⌘Z)
  let lastModel: string | undefined;
  const recordUndo = (cs: ChangeSet, path: LedgerPath) => {
    pushUndo(cs);
    broadcast({ type: 'undo-state', ...undoState() });
    // For whoever commits next: what changed, and the designer's reason (.git/ilse/changes.jsonl)
    recordChange(cwdRoot, cs, {
      path,
      batch: path === 'swap' ? undefined : currentBatchId,
      agent: path === 'agent' ? agent.kind : undefined,
      model: path === 'agent' ? lastModel ?? 'default' : undefined,
      annotations: cs.annotationIds.map(id => describeAnnotation(getAnnotation(id), id)),
    });
  };

  // Property-panel edits that map cleanly to a Tailwind class: no agent at all
  const applySwaps = (annotations: Annotation[]): Annotation[] => {
    const rest: Annotation[] = [];
    for (const ann of annotations) {
      // Text only (no panel styles, nothing written): straight into the JSX when it's literal there
      if (ann.textEdit) {
        const simple = !ann.designerNote && !ann.styleData?.changes.length && !ann.remove && !ann.rearrangeData
          && (!ann.scope || swapMatchesScope(ann));
        const res = simple ? planTextSwap(ann, cwdRoot) : { ok: false as const, reason: 'texto com outros pedidos' };
        if (!res.ok) { journal.swap(ann.id, false, res.reason); rest.push(ann); continue; }
        commitSwap(ann, res.plan);
        continue;
      }
      if (ann.intent !== 'style' || !ann.styleData?.changes.length) { rest.push(ann); continue; }
      // The designer also wrote something ("aplique em todos os cards") — that needs
      // an agent to read it; a class swap would apply the panel values and drop the words
      if (ann.designerNote) { journal.swap(ann.id, false, 'nota do designer'); rest.push(ann); continue; }
      // A class swap edits the JSX where the element is written. That is "all of them"
      // when it's inside the component, "just this one" when it's at the usage. Any
      // other combination needs the agent (an override at the usage, or the definition).
      if (ann.scope && !swapMatchesScope(ann)) { journal.swap(ann.id, false, `escopo: ${ann.scope.choice}`); rest.push(ann); continue; }
      const res = planTokenSwap(ann, cwdRoot);
      if (!res.ok) {
        journal.swap(ann.id, false, res.reason);
        if (process.env.ILSE_DEBUG) console.log(chalk.dim(`  [swap] ${ann.id}: ${res.reason} → agente`));
        rest.push(ann);
        continue;
      }
      commitSwap(ann, res.plan);
    }
    return rest;
  };
  const commitSwap = (ann: Annotation, plan: SwapPlan) => {
    announce(ann);
    applyTokenSwap(plan, cwdRoot);
    journal.swap(ann.id, true);
    const summary = describeSwap(plan);
    console.log(chalk.dim('  ') + chalk.green('✓') + ' ' + chalk.dim(`#${ann.id}`) + ' ' + summary);
    const resolved = resolveAndLog(ann.id, summary);
    if (resolved) broadcast({ type: 'resolved', annotation: resolved });
    recordUndo({
      id: `sw-${ann.id}`,
      annotationIds: [ann.id],
      label: summary,
      files: [{ path: plan.file, before: plan.before, after: plan.after }],
      createdAt: Date.now(),
    }, 'swap');
  };

  // Quick path: the fast model answers "which classes" as JSON, Ilse applies it.
  // One call instead of an agent loop; anything bigger falls through to the agent.
  const applyQuick = async (annotations: Annotation[]): Promise<Annotation[]> => {
    if (config.mode !== 'automatic' || agent.kind !== 'claude' || !agent.command) return annotations;
    const rest: Annotation[] = [];
    const tokenNames = detectedTokens.map(tk => tk.name.replace(/^(color|spacing|typography)\./, '')).filter(n => n.length < 40);
    const model = resolveModel('fast', modelTiers(cwdRoot, agent.kind));
    const eligible: Annotation[] = [];
    for (const ann of annotations) {
      const blocker = quickBlocker(ann, cwdRoot);
      if (!blocker) { eligible.push(ann); continue; }
      journal.quick(ann.id, false, blocker);
      if (process.env.ILSE_DEBUG) console.log(chalk.dim(`  [quick] ${ann.id}: ${blocker} → agente`));
      rest.push(ann);
    }
    if (eligible.length === 0) return rest;

    // Ask for every decision at once — the batch waits for the slowest, not the
    // sum. Files are written afterwards, one at a time, each plan re-read from disk.
    lastModel = model;
    const attempts = await Promise.all(eligible.map(async (ann) => {
      const batchId = `q${++batchSeq}`;
      announce(ann);
      journal.history(ann.id, historyCount(ann, cwdRoot));
      journal.batchStart(batchId, [ann.id], 'quick', agent.kind, false, { model });
      const res = await runQuick(buildQuickPrompt(ann, cwdRoot, tokenNames), model, agent.command!, cwdRoot);
      if (res.raw) journal.agentEvent(batchId, { ...res.raw, type: 'result' });
      return { ann, batchId, res };
    }));

    const limited = attempts.find(a => isLimitError(a.res.error));
    if (limited) tripLimit(limited.res.error!);

    for (const { ann, batchId, res } of attempts) {
      const d = res.decision;
      const plan = res.ok && d && !d.needsAgent ? planClassEdit(ann, cwdRoot, d.remove, d.add) : null;
      if (!plan?.ok) {
        const why = !res.ok ? res.error : d?.needsAgent ? (d.reason || 'precisa do agente') : plan && !plan.ok ? plan.reason : '—';
        journal.batchEnd(batchId, { ok: false, error: `→ agente: ${why}` });
        journal.quick(ann.id, false, why);
        if (process.env.ILSE_DEBUG) console.log(chalk.dim(`  [quick] ${ann.id}: ${why} → agente`));
        rest.push(ann);
        continue;
      }
      applyTokenSwap(plan.plan, cwdRoot);
      journal.batchEnd(batchId, { ok: true });
      const summary = `${d!.remove.join(' ') || '∅'} → ${d!.add.join(' ') || '∅'} em ${plan.plan.file}:${plan.plan.line}`;
      console.log(chalk.dim('  ') + chalk.green('✓') + ' ' + chalk.dim(`#${ann.id}`) + ' ' + summary + chalk.dim(` (${t('cli.quick')})`));
      const resolved = resolveAndLog(ann.id, d!.reason || summary);
      if (resolved) broadcast({ type: 'resolved', annotation: resolved });
      currentBatchId = batchId;
      recordUndo({
        id: `q-${ann.id}`,
        annotationIds: [ann.id],
        label: d!.reason || summary,
        files: [{ path: plan.plan.file, before: plan.plan.before, after: plan.plan.after }],
        createdAt: Date.now(),
      }, 'quick');
      journal.batchChanges(batchId, { files: 1, added: d!.add.length, removed: d!.remove.length });
    }
    return rest;
  };

  const handleBatchInternal = async (incoming: Annotation[]) => {
    for (const a of incoming) journal.received(a);
    const annotations = await applyQuick(applySwaps(incoming));
    if (annotations.length === 0) return;
    if (limitActive()) { deferForLimit(annotations); return; }

    if (config.mode === 'mcp') {
      // The user's agent pulls these through MCP (ilse_watch) — nothing to run here
      for (const ann of annotations) { announce(ann); }
      console.log(chalk.dim('  ') + chalk.cyan('◌') + chalk.dim(` ${t('cli.mcpWaiting', { count: annotations.length })}`));
      return;
    }
    // Claimed by the spawned agent — an MCP client must not pick them up too
    markSent(annotations.map(a => a.id));

    const willEdit = config.mode === 'automatic' && agent.kind !== 'none';
    const snapshot = willEdit ? takeSnapshot(cwdRoot) : null;
    try {
      await runAgentBatch(annotations, {
        touched: () => !!snapshot && !!diffSnapshot(snapshot, []),
        broken: () => snapshot ? syntaxBreaks(diffSnapshot(snapshot, [])?.files ?? []) : [],
        revert: () => { const cs = snapshot && diffSnapshot(snapshot, []); if (cs) discardChangeSet(cs, cwdRoot); },
      });
    } finally {
      const cs = snapshot ? diffSnapshot(snapshot, annotations.map(a => a.id)) : null;
      if (cs) {
        cs.label = annotations.map(a => a.note?.trim() || a.element).filter(Boolean).join(' · ').slice(0, 80);
        recordUndo(cs, 'agent');
        if (currentBatchId) journal.batchChanges(currentBatchId, changeTotals(cs));
      }
    }
  };

  const handleUndo = () => {
    const cs = popUndo();
    if (!cs) return;
    const { restored, conflicts } = discardChangeSet(cs, cwdRoot);
    console.log(chalk.dim('  ') + chalk.yellow('↺') + chalk.dim(` ${t('undo.done', { count: restored.length })}`)
      + (cs.label ? chalk.dim(` — ${cs.label}`) : '')
      + (conflicts.length ? chalk.yellow(` · ${t('undo.conflicts')}: ${conflicts.join(', ')}`) : ''));
    journal.undone(cs.annotationIds);
    recordUndone(cwdRoot, cs.id);
    // Only a clean undo can be redone — with conflicts the files are in a mixed state
    if (conflicts.length === 0) pushRedo(cs);
    broadcast({ type: 'undone', annotationIds: cs.annotationIds, restored, conflicts });
    broadcast({ type: 'undo-state', ...undoState() });
  };

  const handleRedo = () => {
    const cs = popRedo();
    if (!cs) return;
    const { restored, conflicts } = reapplyChangeSet(cs, cwdRoot);
    console.log(chalk.dim('  ') + chalk.cyan('↻') + chalk.dim(` ${t('redo.done', { count: restored.length })}`)
      + (cs.label ? chalk.dim(` — ${cs.label}`) : '')
      + (conflicts.length ? chalk.yellow(` · ${t('undo.conflicts')}: ${conflicts.join(', ')}`) : ''));
    if (restored.length > 0) {
      pushUndo(cs, true);
      recordChange(cwdRoot, cs, { path: 'agent', annotations: cs.annotationIds.map(id => describeAnnotation(getAnnotation(id), id)) });
    }
    broadcast({ type: 'redone', annotationIds: cs.annotationIds, restored, conflicts });
    broadcast({ type: 'undo-state', ...undoState() });
  };

  const runAgentBatch = async (annotations: Annotation[], opts: {
    touched?: () => boolean;
    /** Files the batch left unparseable (they parsed before it) */
    broken?: () => SyntaxBreak[];
    /** Put every file back as it was before the batch */
    revert?: () => void;
  } = {}) => {
    if (annotations.length === 0) return;

    // Print all headers first
    for (const ann of annotations) {
      announce(ann);
    }

    if (config.mode === 'automatic' && agent.kind !== 'none') {
      console.log('');
      const isEphemeral = annotations.some(a => a.intent === 'chat' || a.intent === 'analyze');
      const resumeId = resumeSessions && !isEphemeral ? claudeSessionId : undefined;
      const sessionNote = resumeId && agent.kind === 'claude' ? chalk.dim(` [${t('cli.sessionResumed')}]`) : '';
      console.log(chalk.dim('  ') + chalk.cyan('●') + chalk.dim(` ${t('cli.invoking', { agent: agent.kind, count: annotations.length })}`) + sessionNote);

      // Debug: log the full prompt sent to the agent
      if (process.env.ILSE_DEBUG) {
        const debugPrompt = buildBatchPrompt(annotations, { isResume: !!resumeId });
        console.log(chalk.dim('\n  ─── PROMPT DEBUG ─────────────────────────'));
        console.log(chalk.dim(debugPrompt.split('\n').map(l => '  ' + l).join('\n')));
        console.log(chalk.dim('  ─── END PROMPT ───────────────────────────\n'));
      }

      const resolvedIds = new Set<string>();
      // For single-annotation batches, defer resolve until process exits
      // so the pixel overlay stays visible throughout the entire edit.
      const isSingle = annotations.length === 1;
      const deferredSummaries = new Map<string, string>();

      // The cheapest tier that does the job (fast/strong/default, mapped per agent in
      // .ilserc.json). A run that changes no file when an edit was asked for is
      // retried once, one tier up — if that tier is a different model.
      for (const a of annotations) journal.history(a.id, historyCount(a, cwdRoot));
      const tiers = modelTiers(cwdRoot, agent.kind);
      let tier: Tier = pickTier(annotations);
      let model = resolveModel(tier, tiers);
      lastModel = model;
      let escalated = false;
      let batchId = `b${++batchSeq}`;
      currentBatchId = batchId;
      journal.batchStart(batchId, annotations.map(a => a.id), 'agent', agent.kind, !!resumeId, { model });
      if (process.env.ILSE_DEBUG) console.log(chalk.dim(`  [model] ${tier} → ${model ?? 'default'}`));
      const run = (sessionId: string | undefined) => executeBatch(annotations, agent, {
        sessionId,
        model,
        onEvent: (event) => journal.agentEvent(batchId, event),
        onProgress: (id, summary) => {
          if (isSingle) {
            // Defer — just log and store summary
            deferredSummaries.set(id, summary);
            console.log(chalk.dim('  ') + chalk.yellow('◐') + ' ' + chalk.dim(`#${id}`) + ' ' + summary);
          } else {
            // Multi-batch: resolve progressively
            resolvedIds.add(id);
            console.log(chalk.dim('  ') + chalk.green('✓') + ' ' + chalk.dim(`#${id}`) + ' ' + summary);
            const resolved = resolveAndLog(id, summary);
            if (resolved) broadcast({ type: 'resolved', annotation: resolved });
          }
        },
        onThinking: (text) => {
          broadcast({ type: 'thinking', text });
        },
      });
      let result = await run(resumeId);

      const upTier = escalateTier(tier);
      const up = upTier ? resolveModel(upTier, tiers) : undefined;
      if (result.ok && !userStopped && upTier && up !== model && expectsEdit(annotations) && opts.touched && !opts.touched()) {
        journal.batchEnd(batchId, { ok: false, error: 'no file changed' });
        console.log(chalk.dim('  ') + chalk.yellow('↑') + chalk.dim(` ${t('cli.escalate', { from: model ?? 'default', to: up ?? 'default' })}`));
        tier = upTier;
        model = up;
        lastModel = model;
        escalated = true;
        batchId = `b${++batchSeq}`;
        currentBatchId = batchId;
        deferredSummaries.clear();
        journal.batchStart(batchId, annotations.map(a => a.id), 'agent', agent.kind, false, { model, escalated });
        result = await run(undefined); // fresh: the failed run's history would only weigh it down
      }

      // The agent can't build the project, so Ilse checks what it wrote parses.
      // Broken: one repair turn in the same session; still broken: undo the batch.
      let reverted: string | undefined;
      let breaks = result.ok && !userStopped && opts.broken ? opts.broken() : [];
      if (breaks.length > 0) {
        journal.batchEnd(batchId, { ok: false, error: 'syntax' });
        console.log(chalk.dim('  ') + chalk.yellow('⚠') + chalk.dim(` ${t('cli.syntaxRepair', { where: describeBreaks(breaks) })}`));
        batchId = `b${++batchSeq}`;
        currentBatchId = batchId;
        deferredSummaries.clear();
        journal.batchStart(batchId, annotations.map(a => a.id), 'agent', agent.kind, !!result.sessionId, { model });
        const repair = await executeBatch(annotations, agent, {
          sessionId: result.sessionId,
          model,
          prompt: repairPrompt(breaks),
          onEvent: (event) => journal.agentEvent(batchId, event),
          onThinking: (text) => broadcast({ type: 'thinking', text }),
        });
        breaks = repair.ok && !userStopped ? opts.broken!() : breaks;
        if (repair.sessionId) result = { ...result, sessionId: repair.sessionId };
        if (breaks.length > 0) {
          opts.revert?.();
          reverted = t('cli.syntaxReverted', { where: describeBreaks(breaks) });
          result = { ...result, ok: false, error: reverted };
        } else {
          console.log(chalk.dim('  ') + chalk.green('✓') + chalk.dim(` ${t('cli.syntaxRepaired')}`));
        }
      }

      journal.batchEnd(batchId, { ok: result.ok, error: reverted ? 'syntax' : result.error, stopped: userStopped });

      // Update session ID for next invocation (only from real annotations, not chat/analyze)
      if (result.sessionId && !isEphemeral) {
        claudeSessionId = result.sessionId;
      }

      if (result.ok) {
        const seconds = (result.durationMs / 1000).toFixed(1);
        // Resolve deferred single-annotation batches now that process exited
        for (const [id, summary] of deferredSummaries) {
          resolvedIds.add(id);
          console.log(chalk.dim('  ') + chalk.green('✓') + ' ' + chalk.dim(`#${id}`) + ' ' + summary);
          const resolved = resolveAndLog(id, summary);
          if (resolved) broadcast({ type: 'resolved', annotation: resolved });
        }
        // Fallback: any annotation not reported progressively, resolve now
        for (const ann of annotations) {
          if (!resolvedIds.has(ann.id)) {
            const summary = result.summaries.get(ann.id) ?? t('toolbar.resolved');
            console.log(chalk.dim('  ') + chalk.green('✓') + ' ' + chalk.dim(`#${ann.id}`) + ' ' + summary);
            const resolved = resolveAndLog(ann.id, summary);
            if (resolved) broadcast({ type: 'resolved', annotation: resolved });
          }
        }
        console.log(chalk.dim('  ') + chalk.green('✓') + chalk.dim(` ${t('cli.done', { seconds })}`));

        // Token usage — only in debug mode
        if (result.tokenUsage && process.env.ILSE_DEBUG) {
          const u = result.tokenUsage;
          const totalInput = u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens;
          const cacheHitRate = totalInput > 0 ? Math.round((u.cacheReadTokens / totalInput) * 100) : 0;
          console.log(chalk.dim('  ') + chalk.dim(`  tokens: ${totalInput} in (${u.cacheReadTokens} cached ${cacheHitRate}%) · ${u.outputTokens} out · $${u.totalCostUsd.toFixed(4)}${u.isResume ? ' [resume]' : ' [fresh]'}`));
        }

        // Farewell — small delay so the last tool-use message has a breath,
        // then show a friendly Ilse closing line in the thinking stack.
        const farewells = [
          t('cli.farewell1'),
          t('cli.farewell2'),
          t('cli.farewell3'),
        ];
        const farewell = farewells[Math.floor(Math.random() * farewells.length)];
        setTimeout(() => {
          broadcast({ type: 'thinking-end', text: farewell });
        }, 900);
      } else if (userStopped) {
        // User clicked Stop — already handled by handleStop, just reset the flag
        userStopped = false;
        // Invalidate session — stopped mid-execution, context is unreliable
        claudeSessionId = undefined;
      } else {
        if (isLimitError(result.error)) {
          // Out of quota mid-batch: these wait for the reset like the ones after them
          tripLimit(result.error!);
          deferForLimit(annotations.filter(a => !resolvedIds.has(a.id)));
        } else {
          console.log(chalk.dim('  ') + chalk.red('✗') + ' ' + (result.error ?? t('cli.batchError')));
          for (const ann of annotations) {
            // Reverted: even what was reported done along the way is gone
            if (reverted || !resolvedIds.has(ann.id)) {
              broadcast({ type: 'error', id: ann.id, message: result.error ?? 'Erro ao executar batch' });
            }
          }
        }
        // Unblock the thinking stack — otherwise the last tool-use message
        // would sit there forever until the 2-min safety timer kicks in.
        setTimeout(() => {
          broadcast({ type: 'thinking-end', text: t('cli.thinkingError') });
        }, 600);
      }
    }
  };

  const handleStop = () => {
    userStopped = true;
    killAllActiveProcesses();
    console.log(chalk.dim('  ') + chalk.yellow('■') + chalk.dim(` ${t('cli.stopped')}`));
    broadcast({ type: 'stopped', seq: 0 });
    broadcast({ type: 'thinking-end', text: t('cli.stopped') });
  };

  // ── MCP: the user's agent pulls annotations (Claude Desktop, Cursor, …) ──
  // Claimed batches get the same undo treatment as spawned ones: snapshot on
  // claim, diff when the agent has resolved all of them (or claims again).
  let mcpClaim: { snapshot: ReturnType<typeof takeSnapshot>; ids: string[]; open: Set<string> } | null = null;
  const closeMcpClaim = () => {
    if (!mcpClaim) return;
    const cs = diffSnapshot(mcpClaim.snapshot, mcpClaim.ids);
    mcpClaim = null;
    if (currentBatchId?.startsWith('m')) {
      if (cs) journal.batchChanges(currentBatchId, changeTotals(cs));
      journal.batchEnd(currentBatchId, { ok: true });
    }
    if (cs) {
      cs.label = cs.annotationIds.map(id => getAnnotation(id)?.resolvedSummary).filter(Boolean).join(' · ').slice(0, 80) || 'MCP';
      recordUndo(cs, 'mcp');
    }
  };
  const version = (createRequire(import.meta.url)('../../package.json') as { version: string }).version;
  const localToken = getLocalToken();
  const mcpHandler = createMcpHttpHandler({
    version,
    token: localToken,
    hooks: {
      onClaim: (anns) => {
        closeMcpClaim();
        for (const a of anns) journal.received(a);
        currentBatchId = `m${++batchSeq}`;
        journal.batchStart(currentBatchId, anns.map(a => a.id), 'mcp', 'mcp');
        mcpClaim = { snapshot: takeSnapshot(cwdRoot), ids: anns.map(a => a.id), open: new Set(anns.map(a => a.id)) };
        console.log(chalk.dim('  ') + chalk.cyan('●') + chalk.dim(` ${t('cli.mcpClaimed', { count: anns.length })}`));
        for (const a of anns) broadcast({ type: 'status', id: a.id, status: 'sent' });
      },
      onResolved: (a) => {
        journal.resolved(a.id);
        console.log(chalk.dim('  ') + chalk.green('✓') + ' ' + chalk.dim(`#${a.id}`) + ' ' + (a.resolvedSummary ?? ''));
        broadcast({ type: 'resolved', annotation: a });
        if (mcpClaim?.open.delete(a.id) && mcpClaim.open.size === 0) closeMcpClaim();
      },
    },
  });

  const server = await startServer({
    // The toolbar for pages that load it from this port rather than the proxy:
    // the Vite plugin's middleware, the bookmarklet, the browser extension
    httpHandler: (req, res) => serveToolbar(req, res, { bridgePort: getPort() ?? undefined })
      || serveBookmarklet(req, res, getPort()!)
      || mcpHandler(req, res),
    onAnnotation: scheduleBatch,
    onBatch: handleBatchInternal,
    onStop: handleStop,
    onUndo: handleUndo,
    onRedo: handleRedo,
    getLogs: () => ({ json: journal.toJSON(), markdown: journal.toMarkdown() }),
    connectExtras: () => ({
      undo: undoState(),
      mcp: { url: `http://localhost:${getPort()}${MCP_PATH}`, token: localToken },
      ...(agentAccount ? { account: describeAccount(agentAccount) } : {}),
    }),
    tokens: detectedTokens,
    libraries: tokenResult.libraries,
  });

  if (!server) {
    console.log(chalk.red(`  ✗ ${t('cli.noPort')}`));
    process.exit(1);
  }

  // The bridge port is plumbing (toolbar ↔ CLI): only worth showing when debugging.
  // The MCP endpoint only matters when the agent pulls annotations over MCP.
  if (process.env.ILSE_DEBUG) console.log(chalk.dim('  ws://localhost:' + getPort()));
  if (config.mode === 'mcp' || process.env.ILSE_DEBUG) {
    console.log(chalk.dim(`  MCP: http://localhost:${getPort()}${MCP_PATH}  (${t('cli.mcpHint')})`));
  }
  writeServerInfo(getPort()!);

  // Same port unless the setup chose the separate address, or a flag says otherwise for this run
  const samePort = options.separate ? false : options.samePort || (loadUserConfig().address ?? 'same') === 'same';
  if (useProxy && samePort) {
    void startSamePort(options, getPort()!).then((how) => {
      if (how === 'same-port' || how === 'plugin') { journal.session.toolbar = how; return; }
      // The port is taken by a server Ilse didn't start: say so and stop, rather than guess whose it is
      if (how === 'busy') process.exit(1);
      // No dev script, or it didn't come up: the separate address still works
      void startToolbarProxy(options, getPort()!).then((h) => { if (h === 'plugin') journal.session.toolbar = 'plugin'; });
    });
  } else if (useProxy) {
    void startToolbarProxy(options, getPort()!).then((how) => {
      if (how === 'plugin') journal.session.toolbar = 'plugin';
    });
  } else if (framework.alreadyInstalled) {
    console.log(chalk.dim(`  ${t('proxy.componentInstalled')}`));
  }

  // Keep process alive (pending promise isn't enough without active I/O handles)
  process.stdin.resume();

  let sigintCount = 0;
  process.on('SIGINT', () => {
    sigintCount++;
    if (sigintCount === 1) {
      console.log('\n' + chalk.yellow(`  ${t('cli.stopping')}`));
      killAllActiveProcesses();
      console.log(chalk.dim(`  ${t('cli.ctrlcAgain')}`));
    } else {
      console.log('\n' + chalk.dim(`  ${t('cli.bye')}`));
      process.exit(0);
    }
  });

  await new Promise(() => {});
}
