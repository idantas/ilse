/**
 * Token swap — property-panel edits applied without an LLM.
 *
 * When the designer picks a value in the panel, the decision is already made:
 * "gap 12px → gap 16px". Sending that to an agent costs a full agent run to do
 * what is a class rename. Here the CLI does it directly: find the JSX node (the
 * locator already did), find the Tailwind class for that property, swap it.
 *
 * Deliberately conservative. Anything ambiguous — no Tailwind, className built
 * from expressions, two candidate classes, a colour with no token — returns a
 * reason instead of a plan, and the annotation goes to the agent as before.
 * All changes of one annotation apply together or not at all.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Node, JSXElement } from '@babel/types';
import type { Annotation, StyleChange } from '../types.js';
import { parseCode } from '../design-context/ast.js';

export interface SwapEdit { property: string; removed: string[]; added: string }
export interface SwapPlan { file: string; line: number; before: string; after: string; edits: SwapEdit[] }
export type SwapResult = { ok: true; plan: SwapPlan } | { ok: false; reason: string };

// ── Property → Tailwind utility ─────────────────────────────────────────────

interface Family {
  prefix: string;
  /** Existing classes this property replaces (unprefixed by variants) */
  matches: (cls: string) => boolean;
  /** Class for a value without a named token, or null when there's no safe one */
  fromValue: (value: string) => string | null;
}

const SIZE_NAMES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];
const TEXT_ALIGN = /^text-(left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/;
const BG_NON_COLOR = /^bg-(none|fixed|local|scroll|cover|contain|auto|center|top|bottom|left|right|repeat.*|no-repeat|clip-.*|origin-.*|gradient-.*|linear-.*|radial-.*|conic-.*|blend-.*|\[url.*)$/;
const BORDER_NON_COLOR = /^border(-[xytrblse])?(-(\d+|\[\d.*\]))?$|^border-(solid|dashed|dotted|double|hidden|none|collapse|separate|spacing.*)$/;

const FONT_WEIGHTS: Record<string, string> = {
  '100': 'thin', '200': 'extralight', '300': 'light', '400': 'normal', '500': 'medium',
  '600': 'semibold', '700': 'bold', '800': 'extrabold', '900': 'black',
};
const FONT_SIZES_PX: Record<number, string> = {
  12: 'xs', 14: 'sm', 16: 'base', 18: 'lg', 20: 'xl', 24: '2xl', 30: '3xl', 36: '4xl', 48: '5xl', 60: '6xl', 72: '7xl',
};
const RADII_PX: Record<number, string> = { 0: 'rounded-none', 2: 'rounded-xs', 4: 'rounded-sm', 6: 'rounded-md', 8: 'rounded-lg', 12: 'rounded-xl', 16: 'rounded-2xl', 24: 'rounded-3xl' };

const DISPLAY_CLASSES = new Set(['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'hidden', 'contents']);
const JUSTIFY: Record<string, string> = {
  'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end',
  'space-between': 'between', 'space-around': 'around', 'space-evenly': 'evenly', stretch: 'stretch',
};
const ALIGN: Record<string, string> = {
  'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end', stretch: 'stretch', baseline: 'baseline',
};

function px(value: string): number | null {
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|rem)?$/);
  if (!m) return null;
  return m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
}

/** Tailwind's default spacing scale: 4px steps (and halves). */
function spacingStep(value: string): string | null {
  const n = px(value);
  if (n === null || n < 0) return null;
  const step = n / 4;
  return Number.isInteger(step * 2) ? String(step) : null;
}

/** Spacing-scale family for a padding/margin prefix. Margins also take auto and negatives. */
function boxFamily(prefix: string, matches: RegExp, margin = false): Family {
  return {
    prefix,
    matches: c => matches.test(c),
    fromValue: v => {
      const k = v.trim();
      if (margin && k === 'auto') return `${prefix}-auto`;
      const neg = margin && k.startsWith('-');
      const step = spacingStep(neg ? k.slice(1) : k);
      if (step === null) return /^-?\d+(\.\d+)?(px|rem)$/.test(k) && (margin || !k.startsWith('-')) ? `${prefix}-[${k}]` : null;
      return `${neg && step !== '0' ? '-' : ''}${prefix}-${step}`;
    },
  };
}

/** border / border-t…: 1px is the bare class, 0/2/4/8 named, anything else arbitrary */
function strokeFamily(prefix: string, matches: RegExp): Family {
  return {
    prefix,
    matches: c => matches.test(c),
    fromValue: v => {
      const n = px(v);
      if (n === null || n < 0) return null;
      if (n === 1) return prefix;
      return [0, 2, 4, 8].includes(n) ? `${prefix}-${n}` : `${prefix}-[${n}px]`;
    },
  };
}

/** w-/h-: keywords by name, lengths on the spacing scale when they fit, arbitrary otherwise */
function sizeFamily(p: 'w' | 'h'): Family {
  return {
    prefix: p,
    matches: c => new RegExp(`^${p}-`).test(c),
    fromValue: v => {
      const k = v.trim();
      const named: Record<string, string> = { '100%': 'full', 'fit-content': 'fit', auto: 'auto', 'max-content': 'max', 'min-content': 'min' };
      if (named[k]) return `${p}-${named[k]}`;
      const step = /px$/.test(k) ? spacingStep(k) : null;
      if (step !== null) return `${p}-${step}`;
      return /^\d+(\.\d+)?(px|rem|%|vw|vh)$/.test(k) ? `${p}-[${k}]` : null;
    },
  };
}

const FAMILIES: Record<string, Family> = {
  padding: {
    prefix: 'p',
    matches: c => /^p[xytrblse]?-/.test(c),
    fromValue: v => { const s = spacingStep(v); return s === null ? null : `p-${s}`; },
  },
  // Per axis / per side — each owns its prefix and the narrower ones inside it
  paddingInline: boxFamily('px', /^p[xlrse]-/),
  paddingBlock: boxFamily('py', /^p[ytb]-/),
  paddingTop: boxFamily('pt', /^pt-/),
  paddingRight: boxFamily('pr', /^pr-/),
  paddingBottom: boxFamily('pb', /^pb-/),
  paddingLeft: boxFamily('pl', /^pl-/),
  margin: boxFamily('m', /^-?m[xytrblse]?-/, true),
  marginInline: boxFamily('mx', /^-?m[xlrse]-/, true),
  marginBlock: boxFamily('my', /^-?m[ytb]-/, true),
  marginTop: boxFamily('mt', /^-?mt-/, true),
  marginRight: boxFamily('mr', /^-?mr-/, true),
  marginBottom: boxFamily('mb', /^-?mb-/, true),
  marginLeft: boxFamily('ml', /^-?ml-/, true),
  gap: {
    prefix: 'gap',
    matches: c => /^gap(-[xy])?-/.test(c),
    fromValue: v => { const s = spacingStep(v); return s === null ? null : `gap-${s}`; },
  },
  fontSize: {
    prefix: 'text',
    matches: c => SIZE_NAMES.some(s => c === `text-${s}`) || /^text-\[\d.*(px|rem)\]$/.test(c),
    fromValue: v => { const n = px(v); return n !== null && FONT_SIZES_PX[n] ? `text-${FONT_SIZES_PX[n]}` : null; },
  },
  fontWeight: {
    prefix: 'font',
    matches: c => Object.values(FONT_WEIGHTS).some(w => c === `font-${w}`) || /^font-\[\d+\]$/.test(c),
    fromValue: v => FONT_WEIGHTS[v.trim()] ? `font-${FONT_WEIGHTS[v.trim()]}` : null,
  },
  borderRadius: {
    prefix: 'rounded',
    matches: c => c === 'rounded' || /^rounded-(none|xs|sm|md|lg|xl|2xl|3xl|4xl|full|\[.*\])$/.test(c),
    fromValue: v => { const n = px(v); return n === null ? null : n >= 9999 ? 'rounded-full' : RADII_PX[n] ?? null; },
  },
  opacity: {
    prefix: 'opacity',
    matches: c => /^opacity-/.test(c),
    fromValue: v => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? `opacity-${Math.round(n * 100)}` : null; },
  },
  // Layout — keywords, so every value has exactly one class
  display: {
    prefix: 'display',
    matches: c => DISPLAY_CLASSES.has(c),
    fromValue: v => { const k = v.trim(); return k === 'none' ? 'hidden' : DISPLAY_CLASSES.has(k) ? k : null; },
  },
  flexDirection: {
    prefix: 'flex',
    matches: c => /^flex-(row|col)(-reverse)?$/.test(c),
    fromValue: v => ({ row: 'flex-row', 'row-reverse': 'flex-row-reverse', column: 'flex-col', 'column-reverse': 'flex-col-reverse' })[v.trim()] ?? null,
  },
  flexWrap: {
    prefix: 'flex',
    matches: c => /^flex-(wrap|nowrap|wrap-reverse)$/.test(c),
    fromValue: v => ({ wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' })[v.trim()] ?? null,
  },
  justifyContent: {
    prefix: 'justify',
    matches: c => /^justify-(start|end|center|between|around|evenly|stretch|normal|baseline)$/.test(c),
    fromValue: v => { const k = JUSTIFY[v.trim()]; return k ? `justify-${k}` : null; },
  },
  alignItems: {
    prefix: 'items',
    matches: c => /^items-(start|end|center|baseline|stretch)$/.test(c),
    fromValue: v => { const k = ALIGN[v.trim()]; return k ? `items-${k}` : null; },
  },
  // Stroke: border-width on all sides or one, and the line style
  borderWidth: strokeFamily('border', /^border(-[xytrblse])?(-(\d+|\[\d.*\]))?$/),
  borderTopWidth: strokeFamily('border-t', /^border-t(-(\d+|\[\d.*\]))?$/),
  borderRightWidth: strokeFamily('border-r', /^border-r(-(\d+|\[\d.*\]))?$/),
  borderBottomWidth: strokeFamily('border-b', /^border-b(-(\d+|\[\d.*\]))?$/),
  borderLeftWidth: strokeFamily('border-l', /^border-l(-(\d+|\[\d.*\]))?$/),
  borderStyle: {
    prefix: 'border',
    matches: c => /^border-(solid|dashed|dotted|double|hidden|none)$/.test(c),
    fromValue: v => /^(solid|dashed|dotted|double|hidden|none)$/.test(v.trim()) ? `border-${v.trim()}` : null,
  },
  width: sizeFamily('w'),
  height: sizeFamily('h'),
  flexGrow: {
    prefix: 'flex',
    matches: c => /^(flex-1|flex-auto|flex-none|flex-initial|(flex-)?grow(-0)?)$/.test(c),
    fromValue: v => v.trim() === '1' ? 'flex-1' : v.trim() === '0' ? 'grow-0' : null,
  },
  // Colours only move with a named token — a raw colour would be a hardcoded value
  color: {
    prefix: 'text',
    matches: c => /^text-/.test(c) && !TEXT_ALIGN.test(c) && !FAMILIES.fontSize.matches(c),
    fromValue: () => null,
  },
  backgroundColor: {
    prefix: 'bg',
    matches: c => /^bg-/.test(c) && !BG_NON_COLOR.test(c),
    fromValue: () => null,
  },
  borderColor: {
    prefix: 'border',
    matches: c => /^border-/.test(c) && !BORDER_NON_COLOR.test(c),
    fromValue: () => null,
  },
};

/**
 * Token name → utility suffix. Token names come from token-detect:
 * `color.primary` (--primary), `color.color-ouro` (--color-ouro),
 * `spacing.radius-lg` (--radius-lg), `spacing.text-lg` (--text-lg).
 */
export function tokenSuffix(token: string, property: string): string | null {
  const bare = token.replace(/^(color|spacing|typography)\./, '');
  const strip: Record<string, RegExp> = {
    color: /^color-/, backgroundColor: /^color-/, borderColor: /^color-/,
    padding: /^spacing-/, gap: /^spacing-/, borderRadius: /^radius-/,
    ...Object.fromEntries(['paddingInline', 'paddingBlock', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'margin', 'marginInline', 'marginBlock', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'].map(k => [k, /^spacing-/])),
    fontSize: /^text-/, fontWeight: /^font-weight-/,
  };
  const re = strip[property];
  if (!re) return null;
  // A spacing token only maps to padding/gap when it is a spacing var, etc.
  const scoped = ['padding', 'gap', 'borderRadius', 'fontSize', 'fontWeight'].includes(property) || /^(padding|margin)/.test(property);
  if (scoped && !re.test(bare)) return null;
  const suffix = bare.replace(re, '');
  return /^[\w-]+$/.test(suffix) ? suffix : null;
}

export function classFor(change: StyleChange): string | null {
  const family = FAMILIES[change.property];
  if (!family) return null;
  if (change.token) {
    const suffix = tokenSuffix(change.token, change.property);
    if (suffix) return `${family.prefix}-${suffix}`;
    if (['color', 'backgroundColor', 'borderColor'].includes(change.property)) return null;
  }
  if (change.offToken) return null; // hand-typed value where tokens exist — the agent should question it
  return family.fromValue(change.to);
}

// ── Finding the className literal ───────────────────────────────────────────

/** A static piece of className — or, when the element has none, the spot to add one */
interface Literal { start: number; end: number; value: string; synthetic?: boolean }

/**
 * The JSX element that starts on `line`. Several can (`<ul><li>…</li></ul>`):
 * then the one whose tag the browser saw wins, so the edit lands on what was clicked.
 */
function jsxAt(ast: Node, line: number, tag?: string): JSXElement | null {
  const found: JSXElement[] = [];
  const walk = (n: Node): void => {
    if (n.type === 'JSXElement' && n.loc?.start.line === line) found.push(n);
    for (const key of Object.keys(n) as Array<keyof typeof n>) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const v = n[key] as unknown;
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c === 'object' && 'type' in c) walk(c as Node); }
      else if (v && typeof v === 'object' && 'type' in (v as object)) walk(v as Node);
    }
  };
  walk(ast);
  const named = (e: JSXElement) => e.openingElement.name.type === 'JSXIdentifier' ? e.openingElement.name.name : '';
  return (tag && found.find(e => named(e) === tag)) || found[0] || null;
}

/** Plain string pieces of className: "…", {"…"}, `…` (no ${}), cn("…", …) args. */
function classLiterals(el: JSXElement): Literal[] | null {
  const attr = el.openingElement.attributes.find(a => a.type === 'JSXAttribute' && a.name.name === 'className');
  if (!attr || attr.type !== 'JSXAttribute' || !attr.value) return null;
  const out: Literal[] = [];
  const take = (n: Node | null | undefined): void => {
    if (!n) return;
    if (n.type === 'StringLiteral' && n.start != null && n.end != null) {
      out.push({ start: n.start + 1, end: n.end - 1, value: n.value });
    } else if (n.type === 'TemplateLiteral') {
      for (const q of n.quasis) if (q.start != null && q.end != null) out.push({ start: q.start, end: q.end, value: q.value.raw });
    } else if (n.type === 'JSXExpressionContainer') {
      take(n.expression as Node);
    } else if (n.type === 'CallExpression') {
      for (const a of n.arguments) take(a as Node);
    }
  };
  take(attr.value as Node);
  return out.length > 0 ? out : null;
}

function usesTailwind(cwd: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Object.keys(deps).some(d => d === 'tailwindcss' || d.startsWith('@tailwindcss/'));
  } catch { return false; }
}

// ── Plan + apply ────────────────────────────────────────────────────────────

/** The located element's className, as editable string pieces — or why not */
export type ClassSite =
  | { ok: true; hit: NonNullable<Annotation['source']>[number]; code: string; literals: Literal[] }
  | { ok: false; reason: string };

export function locateClassName(annotation: Annotation, cwd: string): ClassSite {
  if (!usesTailwind(cwd)) return { ok: false, reason: 'projeto sem Tailwind' };
  const hit = annotation.source?.[0];
  if (!hit || hit.kind !== 'element') return { ok: false, reason: 'elemento não localizado' };
  const second = annotation.source?.[1];
  if (second && second.kind === 'element' && second.score >= hit.score) return { ok: false, reason: 'localização ambígua' };

  const abs = join(cwd, hit.file);
  if (!existsSync(abs)) return { ok: false, reason: 'arquivo não encontrado' };
  const code = readFileSync(abs, 'utf8');
  const parsed = parseCode(code, abs);
  if (!parsed.ok) return { ok: false, reason: 'arquivo não parseou' };
  // The tag the browser saw (li from "li.item:nth-child(2)"), to pick among elements sharing the line
  const tag = /^([a-z][\w-]*)/.exec(annotation.element ?? '')?.[1];
  const el = jsxAt(parsed.value, hit.line, tag);
  if (!el) return { ok: false, reason: 'nó JSX não encontrado' };
  const hasAttr = el.openingElement.attributes.some(a => a.type === 'JSXAttribute' && a.name.name === 'className');
  // No className at all: classes can still be added — as a new attribute after the tag name
  const nameEnd = el.openingElement.name.end;
  const literals = hasAttr ? classLiterals(el)
    : nameEnd != null ? [{ start: nameEnd, end: nameEnd, value: '', synthetic: true }] : null;
  if (!literals) return { ok: false, reason: 'className dinâmico' };
  return { ok: true, hit, code, literals };
}

/** Rewrite the literals from edited class lists, back to front so offsets stay valid */
function rewrite(code: string, literals: Literal[], lists: string[][]): string {
  let after = code;
  const order = literals.map((l, i) => ({ l, i })).sort((a, b) => b.l.start - a.l.start);
  for (const { l, i } of order) {
    const joined = lists[i].join(' ');
    if (joined === l.value.split(/\s+/).filter(Boolean).join(' ')) continue;
    if (l.synthetic) { after = after.slice(0, l.start) + ` className="${joined}"` + after.slice(l.end); continue; }
    // Keep edge whitespace: in `${x} px-4` the space separates the expression
    const lead = l.value.match(/^\s*/)![0];
    const trail = l.value.match(/\s*$/)![0];
    after = after.slice(0, l.start) + lead + joined + (joined ? trail : '') + after.slice(l.end);
  }
  return after;
}

const CLASS_TOKEN = /^-?[a-z0-9][a-z0-9:_\-\[\]\/.#%(),'"!]*$/i;

/**
 * A class-level edit decided elsewhere (the quick path's model): remove these,
 * add those, on the located element only. Everything to remove must be there,
 * everything added must look like a class — anything else goes to the agent.
 */
export function planClassEdit(annotation: Annotation, cwd: string, remove: string[], add: string[]): SwapResult {
  if (remove.length === 0 && add.length === 0) return { ok: false, reason: 'nada a mudar' };
  if (![...remove, ...add].every(c => CLASS_TOKEN.test(c))) return { ok: false, reason: 'classe inválida' };
  const site = locateClassName(annotation, cwd);
  if (!site.ok) return site;
  const { hit, code, literals } = site;
  const lists = literals.map(l => l.value.split(/\s+/).filter(Boolean));
  for (const c of remove) {
    const at = lists.findIndex(list => list.includes(c));
    if (at < 0) return { ok: false, reason: `classe ${c} não está no elemento` };
    lists[at] = lists[at].filter(x => x !== c);
  }
  // New classes join the first static piece that has any (not a `${x}` gap)
  const into = Math.max(0, lists.findIndex(list => list.length > 0));
  for (const c of add) if (!lists.some(list => list.includes(c))) lists[into].push(c);
  const after = rewrite(code, literals, lists);
  if (after === code) return { ok: false, reason: 'nada a mudar' };
  return { ok: true, plan: { file: hit.file, line: hit.line, before: code, after, edits: [{ property: 'className', removed: remove, added: add.join(' ') }] } };
}

export function planTokenSwap(annotation: Annotation, cwd: string): SwapResult {
  const changes = annotation.styleData?.changes ?? [];
  if (changes.length === 0) return { ok: false, reason: 'sem mudanças do painel' };
  const site = locateClassName(annotation, cwd);
  if (!site.ok) return site;
  const { hit, code, literals } = site;

  // Work on a mutable copy of each literal's class list
  const lists = literals.map(l => l.value.split(/\s+/).filter(Boolean));
  const edits: SwapEdit[] = [];

  for (const change of changes) {
    const family = FAMILIES[change.property];
    const next = classFor(change);
    if (!family || !next) return { ok: false, reason: `sem classe segura pra ${change.property} = ${change.to}` };

    // Only unprefixed classes: md:p-6 or hover:bg-x belong to other states
    const owners = lists.map(list => list.filter(c => !c.includes(':') && family.matches(c)));
    const withMatch = owners.map((o, i) => o.length > 0 ? i : -1).filter(i => i >= 0);
    if (withMatch.length > 1) return { ok: false, reason: `classes de ${change.property} em mais de um trecho` };

    const target = withMatch[0] ?? 0;
    const removed = owners[target] ?? [];
    lists[target] = lists[target].filter(c => !removed.includes(c));
    if (!lists[target].includes(next)) lists[target].push(next);
    edits.push({ property: change.property, removed, added: next });
  }

  const after = rewrite(code, literals, lists);
  if (after === code) return { ok: false, reason: 'nada a mudar' };

  return { ok: true, plan: { file: hit.file, line: hit.line, before: code, after, edits } };
}

export function applyTokenSwap(plan: SwapPlan, cwd: string): void {
  writeFileSync(join(cwd, plan.file), plan.after, 'utf8');
}

export function describeSwap(plan: SwapPlan): string {
  const parts = plan.edits.map(e => `${e.removed.length ? e.removed.join(' ') : '∅'} → ${e.added}`);
  return `${parts.join(', ')} em ${plan.file}:${plan.line} (sem IA)`;
}

// ── Text: the panel's retyped text, written where the JSX has it ────────────

/**
 * Replace the located element's text when it is plain JSX text (`<h2>Plans</h2>`).
 * Anything else — `{t('plans')}`, `{title}`, text mixed with expressions — lives
 * somewhere the agent has to find, so it goes there.
 */
export function planTextSwap(annotation: Annotation, cwd: string): SwapResult {
  const edit = annotation.textEdit;
  if (!edit) return { ok: false, reason: 'sem texto' };
  const hit = annotation.source?.[0];
  if (!hit || hit.kind !== 'element') return { ok: false, reason: 'elemento não localizado' };
  const second = annotation.source?.[1];
  if (second && second.kind === 'element' && second.score >= hit.score) return { ok: false, reason: 'localização ambígua' };
  const abs = join(cwd, hit.file);
  if (!existsSync(abs)) return { ok: false, reason: 'arquivo não encontrado' };
  const code = readFileSync(abs, 'utf8');
  const parsed = parseCode(code, abs);
  if (!parsed.ok) return { ok: false, reason: 'arquivo não parseou' };
  const tag = /^([a-z][\w-]*)/.exec(annotation.element ?? '')?.[1];
  const el = jsxAt(parsed.value, hit.line, tag);
  if (!el) return { ok: false, reason: 'nó JSX não encontrado' };

  const kids = el.children;
  if (kids.length === 0 || !kids.every(k => k.type === 'JSXText')) return { ok: false, reason: 'texto dinâmico' };
  const start = kids[0].start, end = kids[kids.length - 1].end;
  if (start == null || end == null) return { ok: false, reason: 'nó JSX não encontrado' };
  const raw = code.slice(start, end);
  const squash = (x: string) => x.replace(/\s+/g, ' ').trim();
  // What the browser showed must be what the file says — else it's another element's text
  if (squash(raw) !== squash(edit.from)) return { ok: false, reason: 'texto do arquivo difere' };

  // Characters JSX would read as code go in as a string expression
  const next = /[{}<>]/.test(edit.to) || edit.to.includes('\n') ? `{${JSON.stringify(edit.to)}}` : edit.to;
  const lead = raw.match(/^\s*/)![0];
  const trail = raw.match(/\s*$/)![0];
  const after = code.slice(0, start) + lead + next + trail + code.slice(end);
  if (after === code) return { ok: false, reason: 'nada a mudar' };
  return { ok: true, plan: { file: hit.file, line: hit.line, before: code, after, edits: [{ property: 'text', removed: [squash(edit.from)], added: next }] } };
}
