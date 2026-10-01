import http from 'node:http';
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
import { getLocale } from '../i18n/index.js';
import { locateSource, type SourceHit, type LocateQuery } from '../context/locate.js';

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

export interface WsServerOptions {
  port?: number;
  onAnnotation?: (annotation: Annotation) => void;
  onBatch?: (annotations: Annotation[]) => void;
  onStop?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Journal export for Settings → Logs */
  getLogs?: () => { json: unknown; markdown: string };
  /** Plain HTTP requests on the same port (the MCP endpoint). Return true when handled. */
  httpHandler?: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean> | boolean;
  /** Extra fields for the 'connected' payload — e.g. undo state after a page reload */
  connectExtras?: () => Record<string, unknown>;
  tokens?: Array<{ name: string; value: string; type: string }>;
  libraries?: string[];
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
    if (!allowedOrigin) {
      allowedOrigin = origin;
    } else if (origin !== allowedOrigin) {
      ws.close(4003, 'Wrong project');
      return;
    }

    clients.add(ws);

    // Send current stats + port + last sequence + tokens on connect
    // `service` field is validated by ws-client to skip zombie/stale processes
    const connectPayload: Record<string, unknown> = { type: 'connected', service: 'ilse-cli', stats: getStats(), port: activePort, lastSequence: wsEventSequence };
    if (options.tokens?.length) connectPayload.tokens = options.tokens;
    if (options.libraries?.length) connectPayload.libraries = options.libraries;
    connectPayload.locale = getLocale();
    // What this server knows about each annotation — the toolbar reconciles
    // anything it still shows as "sent" (reloaded page, restarted CLI).
    connectPayload.known = knownAnnotations();
    Object.assign(connectPayload, options.connectExtras?.());
    ws.send(JSON.stringify(connectPayload));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleMessage(ws, msg, options);
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  return wss;
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

function parseTextEdit(v: unknown): Annotation['textEdit'] {
  const t = v as { from?: unknown; to?: unknown } | null;
  return t && typeof t.from === 'string' && typeof t.to === 'string' && t.from !== t.to ? { from: t.from, to: t.to } : undefined;
}

function parseScope(v: unknown): Annotation['scope'] {
  const s = v as { component?: unknown; count?: unknown; choice?: unknown } | undefined;
  if (!s || typeof s.component !== 'string' || typeof s.count !== 'number' || (s.choice !== 'one' && s.choice !== 'all')) return undefined;
  return { component: s.component.slice(0, 80), count: s.count, choice: s.choice };
}

function knownAnnotations(): Array<{ id: string; status: string }> {
  return listAnnotations().map(a => ({ id: a.id, status: a.status }));
}

function handleMessage(ws: WebSocket, msg: Record<string, unknown>, options: WsServerOptions) {
  switch (msg.type) {
    case 'annotate': {
      const annotation = createAnnotation({
        note: (msg.note as string) ?? '',
        designerNote: typeof msg.designerNote === 'string' ? msg.designerNote : undefined,
        scope: parseScope(msg.scope),
        remove: msg.remove === true ? true : undefined,
        textEdit: parseTextEdit(msg.textEdit),
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
        ...(() => {
          const t0 = performance.now();
          const source = locateForMessage(msg);
          return {
            source,
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
      ws.send(JSON.stringify({ type: 'sync', known: knownAnnotations(), seq: nextWsSeq() }));
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
      options.onUndo?.();
      break;
    }

    case 'logs': {
      const logs = options.getLogs?.();
      ws.send(JSON.stringify({ type: 'logs', json: logs?.json ?? null, markdown: logs?.markdown ?? '' }));
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
