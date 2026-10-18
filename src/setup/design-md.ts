/**
 * DESIGN.md — the design contract an agent reads (Google Labs' open format,
 * also what Open Design and getdesign.md use): YAML front matter with the
 * tokens, Markdown prose with how to use them.
 *
 * Ilse reads it two ways: its tokens join the panel (colours, spacing, radius,
 * type sizes the CSS may not declare yet), and the agent is pointed at the
 * file for the rules the tokens can't say.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DetectedToken } from './token-detect.js';

const CANDIDATES = ['DESIGN.md', 'design.md', 'docs/DESIGN.md', '.ilse/DESIGN.md'];

/** Where the project's DESIGN.md is, relative to `cwd`, or null */
export function findDesignMd(cwd: string): string | null {
  return CANDIDATES.find(f => existsSync(join(cwd, f))) ?? null;
}

type Yaml = string | { [key: string]: Yaml };

/**
 * The front matter as nested maps of strings. Enough YAML for DESIGN.md:
 * indented maps, quoted or plain scalars, comments. Lists (`omitted:`) are
 * skipped — Ilse doesn't need them.
 */
export function parseFrontMatter(text: string): Record<string, Yaml> | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/);
  if (!m) return null;
  const root: Record<string, Yaml> = {};
  const stack: Array<{ indent: number; map: Record<string, Yaml> }> = [{ indent: -1, map: root }];
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#') || line.trim().startsWith('- ')) continue;
    const kv = line.match(/^(\s*)("[^"]+"|'[^']+'|[^:]+?)\s*:\s*(.*)$/);
    if (!kv) continue;
    const indent = kv[1].length;
    const key = kv[2].replace(/^["']|["']$/g, '').trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].map;
    const value = kv[3].trim();
    if (value === '' ) {
      const child: Record<string, Yaml> = {};
      parent[key] = child;
      stack.push({ indent, map: child });
    } else {
      parent[key] = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
  return root;
}

/** `{colors.primary}` → its value, following chains; anything else as is */
function resolveRef(value: string, root: Record<string, Yaml>, depth = 0): string {
  const ref = value.match(/^\{([\w.-]+)\}$/);
  if (!ref || depth > 5) return value;
  let node: Yaml | undefined = root;
  for (const part of ref[1].split('.')) node = typeof node === 'object' ? node[part] : undefined;
  return typeof node === 'string' ? resolveRef(node, root, depth + 1) : value;
}

const DIMENSION = /^-?\d+(\.\d+)?(px|rem|em)$/;

/** The front matter's tokens, named the way token-detect names its own */
export function designMdTokens(front: Record<string, Yaml>): DetectedToken[] {
  const tokens: DetectedToken[] = [];
  const entries = (key: string) => {
    const group = front[key];
    return typeof group === 'object' ? Object.entries(group) : [];
  };
  for (const [name, v] of entries('colors')) {
    if (typeof v === 'string') tokens.push({ name: `color.${name}`, value: resolveRef(v, front), type: 'color' });
  }
  for (const [name, v] of entries('spacing')) {
    const value = typeof v === 'string' ? resolveRef(v, front) : '';
    if (DIMENSION.test(value)) tokens.push({ name: `spacing.${name}`, value, type: 'spacing' });
  }
  // The panel tells radius from spacing by name
  for (const [name, v] of entries('rounded')) {
    const value = typeof v === 'string' ? resolveRef(v, front) : '';
    if (DIMENSION.test(value)) tokens.push({ name: `rounded.${name}`, value, type: 'spacing' });
  }
  for (const [name, v] of entries('typography')) {
    const size = typeof v === 'object' && typeof v.fontSize === 'string' ? resolveRef(v.fontSize, front) : '';
    if (DIMENSION.test(size)) tokens.push({ name: `typography.${name}`, value: size, type: 'typography' });
  }
  return tokens;
}

export interface DesignMd { path: string; tokens: DetectedToken[] }

export function readDesignMd(cwd: string): DesignMd | null {
  const path = findDesignMd(cwd);
  if (!path) return null;
  let text = '';
  try { text = readFileSync(join(cwd, path), 'utf8'); } catch { return null; }
  const front = parseFrontMatter(text);
  return { path, tokens: front ? designMdTokens(front) : [] };
}
