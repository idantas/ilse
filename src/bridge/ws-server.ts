import http from 'node:http';
import { resolveFrameUrl } from '../context/chunk-source.js';
import { parsePropEdit } from '../context/prop-swap.js';
import { parseInsert } from '../context/insert-component.js';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createAnnotation,
  listAnnotations,
  markSent,
  resolveAnnotation,
  getAnnotation,
  getStats,
  createSession,
  closeSession,
  getSession,
  nextSequence,
} from './store.js';
import type { Annotation } from '../types.js';
import type { LiveFindings, Decision, TestAction, JourneyAction, TestRunOptions, TestGroup, ScreenSize } from '../pro/types.js';
import { getLocale } from '../i18n/index.js';
import { locateSource, type SourceHit, type LocateQuery } from '../context/locate.js';
import { sharedScope } from './augment.js';

// Global WS event sequence — monotonic, independent of annotation sequence
let wsEventSequence = 0;
function nextWsSeq(): number {
  wsEventSequence += 1;
  return wsEventSequence;
}

const BASE_PORT = 4747;
const MAX_PORT = 4757; // scan up to 10 ports

// Only accept connections whose Origin is the browser's own loopback page.
// A missing/spoofed Origin (non-browser client) or a remote site's Origin is rejected outright.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

let wss: WebSocketServer | null = null;
let httpServerRef: http.Server | null = null;
let activePort: number | null = null;
let allowedOrigin: string | null = null; // first connecting origin "claims" this server
const clients = new Set<WebSocket>();
const originOf = new Map<WebSocket, string>();
/**
 * The ports this project's app is served on (the proxy, the dev server). Known
 * once the proxy is up: from then on only those origins may use this server,
 * and one of them takes it back from another project's tab that got here
 * first — a tab scanning ports for its own server while this one was starting.
 */
const ownPorts = new Set<number>();
export function setOwnPorts(ports: number[]): void {
  for (const p of ports) if (Number.isFinite(p)) ownPorts.add(p);
}
const portOf = (origin: string) => { try { const u = new URL(origin); return Number(u.port || (u.protocol === 'https:' ? 443 : 80)); } catch { return NaN; } };

export interface WsServerOptions {
  port?: number;
  onAnnotation?: (annotation: Annotation) => void;
  onBatch?: (annotations: Annotation[]) => void;
  onStop?: () => void;
  /** With a change id: only when that change is the one an undo takes back now */
  onUndo?: (changeSetId?: string) => void;
  /** Undo a run that landed off the page and run its notes again, pointed at this page */
  onRedoHere?: (changeSetId: string) => void;
  onRedo?: () => void;
  /** Journal export for Settings → Logs */
  getLogs?: () => { json: unknown; markdown: string };
  /** The latest `ilse test` run, minus what the dev already decided */
  getFindings?: () => LiveFindings;
  decideFinding?: (id: string, decision: Decision) => boolean;
  /** The memory screen: the design history, and test mode's memory when Pro is there */
  getMemory?: () => Record<string, unknown>;
  /** "Voltar a avisar" on a finding the dev ignored */
  undoDecision?: (id: string) => boolean;
  forgetTestMemory?: () => void;
  /** Toolbar's test mode, on the app at this origin (the page's own, loopback only) */
  testControl?: (action: TestAction, origin: string, options?: TestRunOptions) => void;
  /** Toolbar's Journeys panel (Pro), on the app at this origin */
  journeys?: (action: JourneyAction, origin: string) => void;
  /** Plain HTTP requests on the same port (the MCP endpoint). Return true when handled. */
  httpHandler?: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean> | boolean;
  /** Extra fields for the 'connected' payload — e.g. undo state after a page reload */
  connectExtras?: () => Record<string, unknown>;
  /** The owner's switch: Pro off (view as Free) or back on. Ignored without an owner license */
  onViewAsFree?: (free: boolean) => void;
  /**
   * Notes already applied in earlier sessions (the project's ledger). A toolbar
   * that missed the "resolved" — reloaded mid-run, closed, CLI restarted — still
   * shows them as sent; without this a fresh CLI wouldn't know them and they'd
   * come back as pending.
   */
  appliedIds?: () => string[];
  tokens?: Array<{ name: string; value: string; type: string }>;
  libraries?: string[];
  /** The design panel's catalog: the product's components, read from the code, and the copies seen on pages */
  getCatalog?: () => { entries: unknown[]; snapshots: Record<string, unknown[]> };
  /** Copies of catalog components the toolbar took on a page */
  saveSnapshots?: (items: unknown[]) => void;
  /** `.ilse/catalog.md` created (or found) for the team to edit — on the user's click */
  catalogFile?: () => { path: string; created: boolean } | null;
}

/**
 * Try to bind to `port`: one HTTP server, WebSocket upgrades for the toolbar,
 * plain requests for the MCP endpoint. Resolves with the WS server or null.
 */
function tryBind(port: number, options: WsServerOptions): Promise<WebSocketServer | null> {
  return new Promise((resolve) => {
    const httpServer = http.createServer(async (req, res) => {
      try {
        if (await options.httpHandler?.(req, res)) return;
      } catch { /* fall through */ }
      if (!res.headersSent) {
        res.writeHead(426, { 'content-type': 'text/plain' });
        res.end('Ilse: WebSocket or /mcp only');
      }
    });
    httpServer.once('error', () => resolve(null));
    httpServer.listen(port, '127.0.0.1', () => {
      httpServerRef = httpServer;
      resolve(new WebSocketServer({ server: httpServer }));
    });
  });
}

/** Find first available port in [BASE_PORT, MAX_PORT] and start the server. */
export async function startServer(options: WsServerOptions = {}): Promise<WebSocketServer | null> {
  if (wss) return wss;

  const startPort = options.port ?? BASE_PORT;
  const endPort = options.port ? startPort : MAX_PORT;

  for (let port = startPort; port <= endPort; port++) {
    const server = await tryBind(port, options);
    if (!server) continue;

    wss = server;
    activePort = port;
    break;
  }

  if (!wss) return null; // all ports occupied

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin ?? '';

    // Reject anything that isn't a loopback browser origin — closes off both
    // remote/cross-site WebSocket connections and non-browser clients that omit Origin.
    if (!LOCAL_ORIGIN.test(origin)) {
      ws.close(4001, 'Origin not allowed');
      return;
    }

    // First localhost connection claims this server — subsequent connections from
    // a DIFFERENT origin get rejected with code 4003 so the toolbar retries
    // the next port and finds its own project's server.
    if (ownPorts.size > 0) {
      if (!ownPorts.has(portOf(origin))) { ws.close(4003, 'Wrong project'); return; }
      if (allowedOrigin && !ownPorts.has(portOf(allowedOrigin))) {
        // Taken by another project's tab: it goes back to scanning
        for (const c of clients) if (!ownPorts.has(portOf(originOf.get(c) ?? ''))) c.close(4003, 'Wrong project');
        allowedOrigin = null;
      }
    }
    if (!allowedOrigin) {
      allowedOrigin = origin;
    } else if (origin !== allowedOrigin) {
      ws.close(4003, 'Wrong project');
      return;
    }

    clients.add(ws);
    originOf.set(ws, origin);

    // Send current stats + port + last sequence + tokens on connect
    // `service` field is validated by ws-client to skip zombie/stale processes
    const connectPayload: Record<string, unknown> = { type: 'connected', service: 'ilse-cli', stats: getStats(), port: activePort, lastSequence: wsEventSequence };
    if (options.tokens?.length) connectPayload.tokens = options.tokens;
    if (options.libraries?.length) connectPayload.libraries = options.libraries;
    connectPayload.locale = getLocale();
    // What this server knows about each annotation — the toolbar reconciles
    // anything it still shows as "sent" (reloaded page, restarted CLI).
    connectPayload.known = knownAnnotations(safeApplied(options));
    Object.assign(connectPayload, options.connectExtras?.());
    ws.send(JSON.stringify(connectPayload));

    // In order: a note whose frames need a source map read first must not be passed by the "run" after it
    let queue: Promise<void> = Promise.resolve();
    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }
      queue = queue
        .then(() => (msg.type === 'annotate' ? resolveFrames(msg) : undefined))
        .then(() => handleMessage(ws, msg, options))
        .catch(() => { ws.send(JSON.stringify({ type: 'error', message: 'Message failed' })); });
    });

    ws.on('close', () => {
      clients.delete(ws);
      originOf.delete(ws);
    });
  });

  return wss;
}

/** Frames that point into a bundled chunk (Turbopack) → the file, read from its source map, in place */
async function resolveFrames(msg: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const jobs: Array<Promise<void>> = [];
  const fix = (o: unknown, key: string) => {
    const rec = o as Record<string, unknown> | null | undefined;
    const url = rec?.[key];
    if (typeof url === 'string' && url.includes('#L')) jobs.push(resolveFrameUrl(url, cwd).then(u => { rec![key] = u; }));
  };
  const frames = msg.frames as Record<string, unknown> | undefined;
  fix(frames?.element, 'url');
  fix(frames?.owner, 'url');
  fix(msg.propEdit, 'frameUrl');
  fix((msg.insert as Record<string, unknown> | undefined)?.at, 'frameUrl');
  await Promise.all(jobs);
}

/**
 * Resolve the clicked element to file:line before anything reaches an agent.
 * Best-effort: a locator failure must never block an annotation.
 */
function locateForMessage(msg: Record<string, unknown>): SourceHit[] | undefined {
  if (process.env.ILSE_LOCATE === '0' || msg.intent === 'chat' || !msg.element) return undefined;
  try {
    const hits = locateSource({
      element: msg.element as string,
      component: msg.component as string | undefined,
      componentStack: msg.componentStack as string[] | undefined,
      grepPattern: msg.grepPattern as string | undefined,
      text: typeof msg.text === 'string' ? msg.text : undefined,
      frames: parseFrames(msg.frames),
      pageComponents: parseNames(msg.pageComponents),
    }, { cwd: process.cwd() });
    return hits.length > 0 ? hits : undefined;
  } catch {
    return undefined;
  }
}

function parseFrames(v: unknown): LocateQuery['frames'] {
  const f = v as { element?: unknown; owner?: unknown } | undefined;
  const one = (x: unknown) => {
    const o = x as { fn?: unknown; url?: unknown } | undefined;
    return o && typeof o.fn === 'string' && typeof o.url === 'string' ? { fn: o.fn.slice(0, 80), url: o.url.slice(0, 400) } : undefined;
  };
  if (!f) return undefined;
  const out = { element: one(f.element), owner: one(f.owner) };
  return out.element || out.owner ? out : undefined;
}

function parseNames(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const names = v.filter((n): n is string => typeof n === 'string' && /^[A-Z][\w$]{0,79}$/.test(n)).slice(0, 600);
  return names.length > 0 ? names : undefined;
}

function parseTextEdit(v: unknown): Annotation['textEdit'] {
  const t = v as { from?: unknown; to?: unknown } | null;
  return t && typeof t.from === 'string' && typeof t.to === 'string' && t.from !== t.to ? { from: t.from, to: t.to } : undefined;
}

function parseCopyOf(v: unknown): Annotation['copyOf'] {
  const c = v as { kind?: unknown; component?: unknown } | undefined;
  if (!c || (c.kind !== 'draft' && c.kind !== 'variant')) return undefined;
  const component = typeof c.component === 'string' && /^[A-Z][\w$.]{0,79}$/.test(c.component) ? c.component : undefined;
  return { kind: c.kind, ...(component ? { component } : {}) };
}

function parseScope(v: unknown): Annotation['scope'] {
  const s = v as { component?: unknown; count?: unknown; choice?: unknown } | undefined;
  if (!s || typeof s.component !== 'string' || typeof s.count !== 'number' || (s.choice !== 'one' && s.choice !== 'all')) return undefined;
  const uses = (s as { uses?: unknown }).uses;
  return { component: s.component.slice(0, 80), count: s.count, choice: s.choice, ...(typeof uses === 'number' ? { uses } : {}) };
}

function safeApplied(options: WsServerOptions): string[] {
  try { return options.appliedIds?.() ?? []; } catch { return []; }
}

export function knownAnnotations(applied: string[] = []): Array<{ id: string; status: string }> {
  const live = listAnnotations().map(a => ({ id: a.id, status: a.status }));
  const seen = new Set(live.map(a => a.id));
  return [...live, ...applied.filter(id => !seen.has(id)).map(id => ({ id, status: 'resolved' }))];
}

function handleMessage(ws: WebSocket, msg: Record<string, unknown>, options: WsServerOptions) {
  switch (msg.type) {
    case 'annotate': {
      const annotation = createAnnotation({
        note: (msg.note as string) ?? '',
        designerNote: typeof msg.designerNote === 'string' ? msg.designerNote : undefined,
        remove: msg.remove === true ? true : undefined,
        textEdit: parseTextEdit(msg.textEdit),
        propEdit: parsePropEdit(msg.propEdit),
        insert: parseInsert(msg.insert),
        element: (msg.element as string) ?? '',
        component: msg.component as string | undefined,
        styles: (msg.styles as Record<string, string>) ?? {},
        parent: msg.parent as string | undefined,
        imageRef: msg.imageRef as string | undefined,
        imageRefs: msg.imageRefs as string[] | undefined,
        imageFilenames: msg.imageFilenames as string[] | undefined,
        grepPattern: msg.grepPattern as string | undefined,
        componentStack: msg.componentStack as string[] | undefined,
        domPath: msg.domPath as string | undefined,
        nearbyElements: msg.nearbyElements as string[] | undefined,
        text: typeof msg.text === 'string' ? msg.text.slice(0, 80) : undefined,
        testFinding: parseTestFinding(msg.testFinding),
        pageComponents: parseNames(msg.pageComponents),
        ...(() => {
          const t0 = performance.now();
          const copyOf = parseCopyOf(msg.copyOf);
          const located = locateForMessage(msg);
          // A copy has no React frames: whatever classes matched, its place in the code is a guess
          const source = copyOf ? located?.map(h => (h.kind === 'element' ? { ...h, ambiguous: true } : h)) : located;
          const scope = parseScope(msg.scope) ?? (msg.insert || msg.intent === 'create' ? undefined : sharedScope(source, process.cwd()));
          return {
            source,
            ...(copyOf ? { copyOf } : {}),
            ...(scope ? { scope } : {}),
            meta: {
              locateMs: Math.round(performance.now() - t0),
              composeMs: typeof msg.composeMs === 'number' ? Math.round(msg.composeMs) : undefined,
              captureMode: typeof msg.captureMode === 'string' ? msg.captureMode.slice(0, 20) : undefined,
            },
          };
        })(),
        position: msg.position as { top: number; left: number; width: number; height: number } | undefined,
        environment: msg.environment as Annotation['environment'] | undefined,
        // Schema rico
        intent: msg.intent as Annotation['intent'] | undefined,
        severity: msg.severity as Annotation['severity'] | undefined,
        session: msg.session as string | undefined,
        placementData: msg.placementData as Annotation['placementData'] | undefined,
        rearrangeData: msg.rearrangeData as Annotation['rearrangeData'] | undefined,
        styleData: msg.styleData as Annotation['styleData'] | undefined,
      });
      // Echo the toolbar's own id so it can pair the answer with the right draft
      // (element selectors repeat: table rows, list items).
      ws.send(JSON.stringify({ type: 'annotated', annotation, clientId: msg.clientId, seq: nextWsSeq() }));
      options.onAnnotation?.(annotation);
      break;
    }

    case 'sync': {
      ws.send(JSON.stringify({ type: 'sync', known: knownAnnotations(safeApplied(options)), seq: nextWsSeq() }));
      break;
    }

    case 'session_create': {
      const session = createSession();
      ws.send(JSON.stringify({ type: 'session_created', session, seq: nextWsSeq() }));
      break;
    }

    case 'session_close': {
      const closed = closeSession(msg.id as string);
      if (closed) {
        broadcast({ type: 'session_closed', id: msg.id, seq: nextWsSeq() });
      } else {
        ws.send(JSON.stringify({ type: 'error', message: `Session ${msg.id} not found or already closed` }));
      }
      break;
    }

    case 'session_get': {
      const session = getSession(msg.id as string);
      ws.send(JSON.stringify({ type: 'session', session: session ?? null }));
      break;
    }

    case 'send': {
      // Send individual annotation
      const id = msg.id as string;
      const a = getAnnotation(id);
      if (a) {
        markSent([id]);
        broadcast({ type: 'status', id, status: 'sent', seq: nextWsSeq() });
        options.onAnnotation?.(a);
      } else {
        ws.send(JSON.stringify({ type: 'error', message: `Annotation ${id} not found` }));
      }
      break;
    }

    case 'send_batch': {
      // Send all pending annotations
      const pending = listAnnotations({ status: 'pending' });
      const ids = pending.map(a => a.id);
      markSent(ids);
      for (const id of ids) {
        broadcast({ type: 'status', id, status: 'sent', seq: nextWsSeq() });
      }
      options.onBatch?.(pending);
      break;
    }

    case 'list': {
      const status = msg.status as string | undefined;
      const filter = status ? { status: status as Annotation['status'] } : undefined;
      const annotations = listAnnotations(filter);
      ws.send(JSON.stringify({ type: 'annotations', annotations }));
      break;
    }

    case 'resolve': {
      const resolved = resolveAnnotation(msg.id as string, (msg.summary as string) ?? '');
      if (resolved) {
        broadcast({ type: 'resolved', annotation: resolved, seq: nextWsSeq() });
      }
      break;
    }

    case 'stop': {
      options.onStop?.();
      break;
    }

    case 'redo': {
      options.onRedo?.();
      break;
    }
    case 'undo': {
      options.onUndo?.(typeof msg.changeSetId === 'string' ? msg.changeSetId : undefined);
      break;
    }
    case 'redo-here': {
      if (typeof msg.changeSetId === 'string') options.onRedoHere?.(msg.changeSetId);
      break;
    }

    case 'logs': {
      const logs = options.getLogs?.();
      ws.send(JSON.stringify({ type: 'logs', json: logs?.json ?? null, markdown: logs?.markdown ?? '' }));
      break;
    }

    case 'findings': {
      const live = options.getFindings?.() ?? { at: null, findings: [] };
      ws.send(JSON.stringify({ type: 'findings', ...live }));
      break;
    }

    case 'test': {
      // The origin this server was claimed by — the app the toolbar is on, never one the message names
      const actions: TestAction[] = ['run', 'run-anon', 'login', 'login-done', 'login-cancel', 'setup'];
      if (allowedOrigin && actions.includes(msg.action as TestAction)) options.testControl?.(msg.action as TestAction, allowedOrigin, parseTestOptions(msg.options));
      break;
    }

    case 'journey': {
      const a = parseJourneyAction(msg);
      if (allowedOrigin && a) options.journeys?.(a, allowedOrigin);
      break;
    }

    case 'finding_decide': {
      const decision = msg.decision === 'approved' || msg.decision === 'discarded' ? msg.decision : null;
      if (typeof msg.id === 'string' && decision) options.decideFinding?.(msg.id, decision);
      break;
    }

    case 'view_as_free': {
      if (typeof msg.free === 'boolean') options.onViewAsFree?.(msg.free);
      ws.send(JSON.stringify({ type: 'view_as_free', free: msg.free === true }));
      break;
    }

    case 'memory':
    case 'memory_undo_decision':
    case 'memory_forget_test': {
      if (msg.type === 'memory_undo_decision' && typeof msg.id === 'string') options.undoDecision?.(msg.id);
      if (msg.type === 'memory_forget_test') options.forgetTestMemory?.();
      ws.send(JSON.stringify({ type: 'memory', ...(options.getMemory?.() ?? {}) }));
      break;
    }

    case 'catalog': {
      let data: { entries: unknown[]; snapshots: Record<string, unknown[]> } = { entries: [], snapshots: {} };
      try { data = options.getCatalog?.() ?? data; } catch { /* a scan error leaves the list empty */ }
      // `lite`: just the list (copying starts on connect; the copies go when the catalog is shown)
      ws.send(JSON.stringify(msg.lite ? { type: 'catalog', entries: data.entries, snapshots: {}, lite: true } : { type: 'catalog', ...data }));
      break;
    }

    case 'catalog_file': {
      let res: { path: string; created: boolean } | null = null;
      try { res = options.catalogFile?.() ?? null; } catch { /* unwritable: nothing to say */ }
      ws.send(JSON.stringify({ type: 'catalog_file', ...(res ?? { failed: true }) }));
      break;
    }

    case 'catalog_snapshot': {
      if (Array.isArray(msg.items)) options.saveSnapshots?.(msg.items);
      break;
    }

    case 'stats': {
      ws.send(JSON.stringify({ type: 'stats', stats: getStats() }));
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${msg.type}` }));
  }
}

/** Only the shapes Pro knows, with plain short strings */
export function parseJourneyAction(msg: Record<string, unknown>): JourneyAction | null {
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  switch (msg.action) {
    case 'list': return { action: 'list' };
    case 'add': { const goal = str(msg.goal, 300); return goal ? { action: 'add', goal, start: str(msg.start, 300) } : null; }
    case 'run': return { action: 'run', id: str(msg.id, 40) };
    case 'remove': { const id = str(msg.id, 40); return id ? { action: 'remove', id } : null; }
    case 'confirm': return { action: 'confirm', ok: msg.ok === true };
    case 'suggest': return { action: 'suggest' };
    case 'share': { const id = str(msg.id, 40); return id ? { action: 'share', id, on: msg.on === true } : null; }
    default: return null;
  }
}

const GROUPS: TestGroup[] = ['journeys', 'accessibility', 'errors', 'layout', 'consistency'];
const SIZES: ScreenSize[] = ['desktop', 'tablet', 'mobile'];

/** The dev's pick before a run: known groups and sizes only. Absent → Pro uses the last one */
export function parseTestOptions(v: unknown): TestRunOptions | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const pick = <T extends string>(x: unknown, known: T[]) => Array.isArray(x) ? [...new Set(x.filter((y): y is T => known.includes(y as T)))] : undefined;
  const groups = pick(o.groups, GROUPS);
  const sizes = pick(o.sizes, SIZES);
  return { ...(groups ? { groups } : {}), ...(sizes ? { sizes } : {}) };
}

/** Only the fields a retest needs, as plain short strings */
function parseTestFinding(v: unknown): Annotation['testFinding'] {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.page !== 'string' || !o.page.startsWith('/')) return undefined;
  const str = (x: unknown, max: number) => typeof x === 'string' ? x.slice(0, max) : undefined;
  return { id: o.id.slice(0, 40), page: o.page.slice(0, 300), category: str(o.category, 30), selector: str(o.selector, 300) };
}

/** The app this server serves (the first page that connected), null before one does */
export function getAllowedOrigin(): string | null {
  return allowedOrigin;
}

export function broadcast(data: Record<string, unknown>) {
  const msg = JSON.stringify(data);
  if (process.env.ILSE_DEBUG && data.type === 'thinking') {
    console.log(`  [ws] broadcast thinking to ${clients.size} clients: ${String(data.text).slice(0, 60)}`);
  }
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!wss) { resolve(); return; }
    for (const client of clients) client.close();
    clients.clear();
    wss.close(() => {
      httpServerRef?.closeAllConnections?.();
      httpServerRef?.close();
      httpServerRef = null;
      wss = null;
      activePort = null;
      allowedOrigin = null;
      resolve();
    });
  });
}

export function getPort(): number {
  return activePort ?? BASE_PORT;
}
