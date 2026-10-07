#!/usr/bin/env node

/**
 * ilse-mcp — stdio bridge to the running `ilse`.
 *
 * Some MCP clients (Claude Desktop) prefer local stdio servers. This process
 * owns no state: it forwards every message to the HTTP MCP endpoint of the
 * `ilse` running in the project (port and token from ~/.ilse/), so the agent
 * sees exactly the annotations the designer sent — one store, one undo stack.
 *
 * Before 0.5 this file ran its own WebSocket server and store, separate from
 * the CLI; annotations sent to one were invisible to the other.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { getLocalToken, readServerInfo } from '../config/local-token.js';
import { MCP_PATH } from './http.js';

const NOT_RUNNING = 'Ilse is not running. In your project folder, run `npx ilse-design@latest` (or `ilse`) and try again.';

async function main(): Promise<void> {
  const stdio = new StdioServerTransport();
  let upstream: StreamableHTTPClientTransport | null = null;

  const connectUpstream = async (): Promise<StreamableHTTPClientTransport | null> => {
    if (upstream) return upstream;
    const info = readServerInfo();
    if (!info) return null;
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${info.port}${MCP_PATH}`), {
      requestInit: { headers: { Authorization: `Bearer ${getLocalToken()}` } },
    });
    transport.onmessage = (msg) => { void stdio.send(msg); };
    transport.onerror = () => { upstream = null; };
    transport.onclose = () => { upstream = null; };
    try {
      await transport.start();
      upstream = transport;
      return upstream;
    } catch {
      return null;
    }
  };

  const fail = async (msg: JSONRPCMessage, reason: string) => {
    if ('id' in msg && msg.id !== undefined && 'method' in msg) {
      await stdio.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: reason } });
    }
  };

  stdio.onmessage = async (msg) => {
    const up = await connectUpstream();
    if (!up) { await fail(msg, NOT_RUNNING); return; }
    try {
      await up.send(msg);
    } catch {
      upstream = null;
      await fail(msg, NOT_RUNNING);
    }
  };

  await stdio.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
