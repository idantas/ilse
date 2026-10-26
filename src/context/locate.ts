/**
 * Source locator — turns what the browser saw into a `file:line` in the repo.
 *
 * This is the single biggest token saver in the whole pipeline. Without it the
 * agent gets a CSS selector and a grep hint, then spends several round-trips
 * searching and reading whole files before it edits one line — and every
 * round-trip re-sends the growing context. With it, the agent starts at the
 * right JSX node, with the code already in the prompt.
 *
 * Runs in the CLI (Node), not the browser: zero setup, no bundler plugin, works
 * with any React build that keeps component names in dev (all of them).
 *
 * Deliberately heuristic and cheap. It never claims certainty — every hit
 * carries the reasons it matched, so the agent can distrust a weak one.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import type { Node } from '@babel/types';
import { parseCode } from '../design-context/ast.js';

export interface SourceHit {
  file: string;          // relative to cwd
  line: number;          // 1-based, start of the JSX element
  endLine: number;
  owner?: string;        // component whose body contains the element
  kind: 'element' | 'usage';
  score: number;
  reasons: string[];
  snippet: string;       // numbered source lines, capped
  /** Another element in a different file scored the same: the match is a guess, not a location */
  ambiguous?: boolean;
}

export interface LocateQuery {
  element?: string;          // CSS selector from the browser (tag.class.class:nth-child)
  component?: string;
  componentStack?: string[];
  grepPattern?: string;
  text?: string;             // the element's own visible text
  /** React 19 dev stacks from the browser: the element's JSX site and its component's usage site */
  frames?: { element?: { fn: string; url: string }; owner?: { fn: string; url: string } };
  /**
   * Components rendered on the page the element is on. Without React's frames (a copy
   * Ilse put on the page, a preview), classes alone match look-alikes from other screens:
   * an element written in a component that isn't on this page can't be this one.
   */
  pageComponents?: string[];
}

export interface LocateOptions {
  cwd: string;
  maxResults?: number;
  maxSnippetLines?: number;
}

const SOURCE_GLOB = '**/*.{tsx,jsx}';
const IGNORE = [
  '**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/out/**',
  '**/coverage/**', '**/storybook-static/**', '**/.turbo/**', '**/.vercel/**',
  '**/*.test.*', '**/*.spec.*', '**/*.stories.*',
];
const MAX_FILES = 4000;
const MIN_SCORE = 5;

// ── Query parsing ───────────────────────────────────────────────────────────

function unescapeCss(s: string): string {
  return s
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1');
}

interface ParsedSelector { tag?: string; id?: string; classes: string[] }

/** Splits `button.bg-\[\#fff\].px-4:nth-child(2)` into tag, id and classes. */
export function parseSelector(selector: string | undefined): ParsedSelector {
  if (!selector) return { classes: [] };
  const clean = selector.replace(/:nth-child\(\d+\)$/, '');
  // Split on dots/hashes that are not escaped
  const parts = clean.split(/(?<!\\)(?=[.#])/);
  const out: ParsedSelector = { classes: [] };
  for (const part of parts) {
    if (part.startsWith('#')) out.id = unescapeCss(part.slice(1));
    else if (part.startsWith('.')) out.classes.push(unescapeCss(part.slice(1)));
    else if (part) out.tag = part.toLowerCase();
  }
  return out;
}

interface ParsedGrep { component?: string; attr?: string; value?: string; testId?: string }

function parseGrepPattern(pattern: string | undefined): ParsedGrep {
  if (!pattern) return {};
  const testId = pattern.match(/^data-testid="([^"]+)"$/);
  if (testId) return { testId: testId[1] };
  const comp = pattern.match(/^<([A-Z][\w.]*)(?:\s+([\w-]+)="([^"]*)")?/);
  if (comp) return { component: comp[1], attr: comp[2], value: comp[3] };
  return {};
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// ── Per-file JSX index (cached by mtime) ────────────────────────────────────

interface JsxInfo {
  name: string;
  line: number;
  endLine: number;
  owner?: string;
  classTokens: Set<string>;
  attrs: Map<string, string>;
  text: string;
  /** className takes the component's own `className` prop (cn(…, className)) */
  forwardsClassName?: boolean;
}

interface ComponentDef { name: string; line: number }

const cache = new Map<string, { mtimeMs: number; nodes: JsxInfo[]; lines: string[]; defs: ComponentDef[] }>();

/** Does this attribute value read an identifier `className` (or props.className)? */
function readsClassName(n: Node | null | undefined): boolean {
  if (!n || typeof n !== 'object') return false;
  if (n.type === 'Identifier') return n.name === 'className';
  if (n.type === 'MemberExpression') return n.property.type === 'Identifier' && n.property.name === 'className';
  for (const key of Object.keys(n) as Array<keyof typeof n>) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments') continue;
    const v = n[key] as unknown;
    if (Array.isArray(v)) { if (v.some(c => c && typeof c === 'object' && readsClassName(c as Node))) return true; }
    else if (v && typeof v === 'object' && 'type' in (v as object) && readsClassName(v as Node)) return true;
  }
  return false;
}

function jsxName(n: Node | null | undefined): string {
  if (!n) return '';
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return `${jsxName(n.object)}.${n.property.name}`;
  if (n.type === 'JSXNamespacedName') return `${n.namespace.name}:${n.name.name}`;
  return '';
}

/** Every string literal inside an expression — covers cn(), clsx(), cva(), templates. */
function collectStrings(n: Node | null | undefined, out: string[]): void {
  if (!n || typeof n !== 'object') return;
  if (n.type === 'StringLiteral') { out.push(n.value); return; }
  if (n.type === 'TemplateElement') { out.push(n.value.cooked ?? n.value.raw); return; }
  for (const key of Object.keys(n) as Array<keyof typeof n>) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments') continue;
    const v = n[key] as unknown;
    if (Array.isArray(v)) for (const c of v) collectStrings(c as Node, out);
    else if (v && typeof v === 'object' && 'type' in (v as object)) collectStrings(v as Node, out);
  }
}

/** Name of a function-ish node that likely is a component, if any. */
function ownerName(n: Node, parent: Node | undefined): string | undefined {
  if (n.type === 'FunctionDeclaration' && n.id) return n.id.name;
  if ((n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression') && parent) {
    if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  }
  // const X = forwardRef(() => ...) / memo(function () {...})
  if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init?.type === 'CallExpression') {
    return n.id.name;
  }
  return undefined;
}

function indexFile(absPath: string): { nodes: JsxInfo[]; lines: string[]; defs: ComponentDef[] } | null {
  let mtimeMs: number;
  try { mtimeMs = statSync(absPath).mtimeMs; } catch { return null; }
  const cached = cache.get(absPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached;

  const code = readFileSync(absPath, 'utf8');
  const parsed = parseCode(code, absPath);
  if (!parsed.ok) return null;

  const nodes: JsxInfo[] = [];
  const defs: ComponentDef[] = [];
  const walk = (n: Node, parent: Node | undefined, owner: string | undefined): void => {
    const named = ownerName(n, parent);
    const currentOwner = named && /^[A-Z]/.test(named) ? named : owner;
    if (named && named !== owner && /^[A-Z]/.test(named) && n.loc && !defs.some(d => d.name === named)) {
      defs.push({ name: named, line: n.loc.start.line });
    }

    if (n.type === 'JSXElement' && n.loc) {
      const opening = n.openingElement;
      const classTokens = new Set<string>();
      const attrs = new Map<string, string>();
      let forwardsClassName = false;
      for (const attr of opening.attributes) {
        // <div {...props}> passes className along with everything else
        if (attr.type === 'JSXSpreadAttribute') { forwardsClassName = true; continue; }
        if (attr.type !== 'JSXAttribute') continue;
        const key = jsxName(attr.name);
        const strings: string[] = [];
        collectStrings(attr.value, strings);
        if (key === 'className' || key === 'class') {
          for (const s of strings) for (const tok of s.split(/\s+/)) if (tok) classTokens.add(tok);
          if (readsClassName(attr.value)) forwardsClassName = true;
        } else if (strings.length > 0) {
          attrs.set(key, strings.join(' '));
        }
      }
      const text = n.children
        .map(c => c.type === 'JSXText' ? c.value
          : c.type === 'JSXExpressionContainer' && c.expression.type === 'StringLiteral' ? c.expression.value
          : '')
        .join(' ');
      nodes.push({
        name: jsxName(opening.name),
        line: n.loc.start.line,
        endLine: n.loc.end.line,
        owner: currentOwner,
        classTokens,
        attrs,
        text: normalizeText(text),
        forwardsClassName,
      });
    }

    for (const key of Object.keys(n) as Array<keyof typeof n>) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
      const v = n[key] as unknown;
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c === 'object' && 'type' in c) walk(c as Node, n, currentOwner);
      } else if (v && typeof v === 'object' && 'type' in (v as object)) {
        walk(v as Node, n, currentOwner);
      }
    }
  };
  walk(parsed.value.program, undefined, undefined);

  const entry = { mtimeMs, nodes, lines: code.split('\n'), defs };
  cache.set(absPath, entry);
  return entry;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

function scoreNode(
  node: JsxInfo,
  sel: ParsedSelector,
  grep: ParsedGrep,
  stack: string[],
  text: string,
): { score: number; reasons: string[]; kind: SourceHit['kind'] } {
  let score = 0;
  const reasons: string[] = [];

  // Usage site of the component the grep pattern points at
  if (grep.component && node.name === grep.component) {
    score += 4; reasons.push(`<${grep.component}>`);
    if (grep.attr && node.attrs.get(grep.attr) === grep.value) {
      score += 3; reasons.push(`${grep.attr}="${grep.value}"`);
    }
    return { score, reasons, kind: 'usage' };
  }

  if (grep.testId && node.attrs.get('data-testid') === grep.testId) {
    score += 10; reasons.push(`data-testid="${grep.testId}"`);
  }
  if (sel.id && node.attrs.get('id') === sel.id) {
    score += 8; reasons.push(`id="${sel.id}"`);
  }

  const isHost = /^[a-z]/.test(node.name);
  if (sel.tag && isHost && node.name === sel.tag) {
    score += 1; reasons.push(`<${sel.tag}>`);
  }

  if (sel.classes.length > 0 && node.classTokens.size > 0) {
    const matched = sel.classes.filter(c => node.classTokens.has(c));
    if (matched.length > 0) {
      score += matched.length * 3;
      if (matched.length === sel.classes.length) score += 2;
      reasons.push(`class ${matched.join(' ')}`);
    }
  }

  if (text && node.text && (node.text === text || node.text.includes(text) || (text.includes(node.text) && node.text.length >= 3))) {
    score += 6; reasons.push(`text "${text.slice(0, 30)}"`);
  }

  // Owner signal only reinforces — never locates on its own
  if (score > 0 && node.owner) {
    const idx = stack.indexOf(node.owner);
    if (idx >= 0) { score += Math.max(1, 4 - idx); reasons.push(`inside ${node.owner}`); }
  }

  return { score, reasons, kind: 'element' };
}

function buildSnippet(lines: string[], start: number, end: number, max: number): string {
  const last = Math.min(end, start + max - 1);
  const width = String(last).length;
  const out: string[] = [];
  for (let i = start; i <= last; i++) {
    out.push(`${String(i).padStart(width)} | ${lines[i - 1] ?? ''}`);
  }
  if (last < end) out.push(`${' '.repeat(width)} | … (${end - last} more lines, element ends at ${end})`);
  return out.join('\n');
}

// ── Public API ──────────────────────────────────────────────────────────────

let fileListCache: { cwd: string; at: number; files: string[] } | null = null;

function listSourceFiles(cwd: string): string[] {
  // New files appear while the designer works — a short TTL is enough
  if (fileListCache && fileListCache.cwd === cwd && Date.now() - fileListCache.at < 5000) {
    return fileListCache.files;
  }
  const files = globSync(SOURCE_GLOB, { cwd, ignore: IGNORE, nodir: true }).slice(0, MAX_FILES);
  fileListCache = { cwd, at: Date.now(), files };
  return files;
}

// ── Component card: where a component lives, what it accepts, who uses it ───

export interface ComponentCard {
  name: string;
  def?: { file: string; line: number };
  /** Its JSX passes a `className` prop through — an instance can be styled from outside */
  acceptsClassName?: boolean;
  usages: Array<{ file: string; line: number }>;
}

/**
 * The answers an agent would otherwise spend turns grepping for, from the same
 * AST index the locator keeps. Only files that mention the name are parsed.
 */
export function componentCard(name: string, opts: LocateOptions): ComponentCard | null {
  if (!/^[A-Z][\w.]*$/.test(name)) return null;
  const card: ComponentCard = { name, usages: [] };
  for (const rel of listSourceFiles(opts.cwd)) {
    const abs = join(opts.cwd, rel);
    let raw: string;
    try { raw = readFileSync(abs, 'utf8'); } catch { continue; }
    if (!raw.includes(name)) continue;
    const idx = indexFile(abs);
    if (!idx) continue;
    const def = idx.defs.find(d => d.name === name);
    if (def && !card.def) {
      card.def = { file: rel, line: def.line };
      card.acceptsClassName = idx.nodes.some(n => n.owner === name && n.forwardsClassName);
    }
    for (const n of idx.nodes) if (n.name === name) card.usages.push({ file: rel, line: n.line });
  }
  return card.def || card.usages.length ? card : null;
}

/**
 * A stack frame's URL → a project file, when the bundler leaves the path in it:
 *   webpack-internal:///(app-pages-browser)/./components/card.tsx → components/card.tsx
 *   http://localhost:5173/src/Card.tsx?t=123                      → src/Card.tsx
 * Turbopack chunk URLs don't carry it (they'd need the source map): null.
 */
export function frameFile(url: string, cwd: string): string | null {
  let rel: string | null = null;
  const wp = /webpack-internal:\/\/\/(?:\([^)]*\)\/)?\.\/(.+?)(?:\?.*)?$/.exec(url);
  if (wp) rel = wp[1];
  else {
    try {
      const u = new URL(url);
      if (/\.(tsx|jsx|ts|js)$/.test(u.pathname) && !u.pathname.startsWith('/_next/')) rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    } catch { /* not a URL */ }
  }
  if (!rel || rel.includes('node_modules') || rel.includes('..')) return null;
  return existsSync(join(cwd, rel)) ? rel : null;
}

export function locateSource(query: LocateQuery, opts: LocateOptions): SourceHit[] {
  const sel = parseSelector(query.element);
  // Second signal, independent of classes and text: React's own record of which
  // component (and file) rendered the element, and where that component is used
  const elementFrame = query.frames?.element && { ...query.frames.element, file: frameFile(query.frames.element.url, opts.cwd) };
  const ownerFrame = query.frames?.owner && { ...query.frames.owner, file: frameFile(query.frames.owner.url, opts.cwd) };
  const stackFiles = new Set([elementFrame?.file, ownerFrame?.file].filter((f): f is string => !!f));
  const grep = parseGrepPattern(query.grepPattern);
  const stack = query.componentStack ?? (query.component ? [query.component] : []);
  const text = query.text ? normalizeText(query.text).slice(0, 60) : '';
  const onPage = !elementFrame?.file && query.pageComponents?.length ? new Set(query.pageComponents) : null;

  // Cheap text pre-filter: only parse files that mention something we look for
  const needles = [
    ...sel.classes.filter(c => c.length > 2),
    sel.id, grep.testId, grep.component && `<${grep.component}`,
    text && text.length >= 3 ? text.split(' ').slice(0, 4).join(' ') : undefined,
  ].filter((n): n is string => !!n);
  if (needles.length === 0 && stackFiles.size === 0) return [];

  const hits: SourceHit[] = [];
  for (const rel of listSourceFiles(opts.cwd)) {
    const abs = join(opts.cwd, rel);
    let raw: string;
    try { raw = readFileSync(abs, 'utf8'); } catch { continue; }
    const lower = raw.toLowerCase();
    if (!stackFiles.has(rel) && !needles.some(n => lower.includes(n.toLowerCase()))) continue;

    const indexed = indexFile(abs);
    if (!indexed) continue;

    for (const node of indexed.nodes) {
      const scored = scoreNode(node, sel, grep, stack, text);
      let { score, kind } = scored;
      const reasons = [...scored.reasons];
      // The element's JSX is in this component, in this file — exact, so it can locate
      // on its own for a matching tag (a <span>{label}</span> has no class or text to match)
      if (elementFrame?.file === rel && node.owner === elementFrame.fn && sel.tag && node.name === sel.tag) {
        score += 5; reasons.push(`react stack ${elementFrame.fn}`); kind = 'element';
      }
      // …and this is where that component is used on the page
      if (ownerFrame?.file === rel && elementFrame && node.name === elementFrame.fn && node.owner === ownerFrame.fn) {
        score += 5; reasons.push(`used in ${ownerFrame.fn}`); kind = 'usage';
      }
      if (score < MIN_SCORE) continue;
      if (onPage && kind === 'element' && node.owner && !onPage.has(node.owner)) continue;
      hits.push({
        file: rel,
        line: node.line,
        endLine: node.endLine,
        owner: node.owner,
        kind,
        score,
        reasons,
        snippet: buildSnippet(indexed.lines, node.line, node.endLine, opts.maxSnippetLines ?? 20),
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);

  // Best element hit + best usage hit first, then the rest — both matter:
  // the fix may belong in the component definition or in this one instance.
  const max = opts.maxResults ?? 3;
  const firstElement = hits.find(h => h.kind === 'element');
  const firstUsage = hits.find(h => h.kind === 'usage');
  // A tie with an element in another file: classes alone can't tell them apart
  if (firstElement && hits.some(h => h !== firstElement && h.kind === 'element' && h.score === firstElement.score && h.file !== firstElement.file)) {
    firstElement.ambiguous = true;
  }
  const ordered = [firstElement, firstUsage, ...hits].filter((h): h is SourceHit => !!h);
  return Array.from(new Set(ordered)).slice(0, max);
}

/** Test hook — the cache is process-wide. */
export function clearLocateCache(): void {
  cache.clear();
  fileListCache = null;
}
