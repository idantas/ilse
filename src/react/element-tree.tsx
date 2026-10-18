import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { color, radius, font } from './tokens.js';
import { fiberOf, selectableParent, type Fiber } from './live-layout.js';
import { componentTypeName } from './annotator.js';
import { t } from '../i18n/index.js';

// ── Where the selected element sits ─────────────────────────────────────────
//
// The card's tree: a couple of ancestors, the selected element among its
// siblings, and its children. Each row is a DOM element named by the component
// that rendered it (dev builds), so the designer reads `Select` and the agent
// gets the name it can find in the code. Without React, rows fall back to HTML.

/** Ancestors shown before the rest fold into "⋯" */
const ANCESTORS = 2;
/** Siblings shown around the selected element */
const SIBLINGS = 7;
const CHILDREN = 8;

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'BR']);

/**
 * The components this DOM node is the root of, outermost first: the fibers
 * between it and the DOM element above. `<Field>` rendering `<FieldRoot>`
 * rendering `<div>` gives ['Field', 'FieldRoot'].
 */
export function rootComponents(host: Fiber | null): string[] {
  const names: string[] = [];
  for (let f = host?.return ?? null; f && typeof f.type !== 'string'; f = f.return) {
    const name = componentTypeName(f.type);
    if (name && !names.includes(name)) names.unshift(name);
  }
  return names;
}

/** What the row says in HTML terms: the tag and the one attribute that tells it apart */
export function htmlLabel(el: Pick<Element, 'tagName' | 'id' | 'getAttribute'>): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const slot = el.getAttribute('data-slot');
  if (slot) return `${tag}[${slot}]`;
  const role = el.getAttribute('role');
  return role ? `${tag}[role=${role}]` : tag;
}

/**
 * The words that tell this row apart: its own text, or the first line it shows
 * (four `KpiCard div` siblings read "Revenue", "Orders"…). Ancestors only take
 * their own text — the first line of a whole section names a child, not it.
 */
function textOf(el: Element, ownOnly: boolean): string {
  let text = Array.from(el.childNodes)
    .filter(n => n.nodeType === Node.TEXT_NODE)
    .map(n => n.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  if (!text && !ownOnly) {
    const shown = el instanceof HTMLElement ? el.innerText : el.textContent ?? '';
    text = shown.split('\n').map(line => line.trim()).find(Boolean) ?? '';
  }
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

function shown(el: Element): boolean {
  return !SKIP_TAGS.has(el.tagName) && !el.closest('[data-ilse-toolbar]') && el.getClientRects().length > 0;
}

const shownChildren = (el: Element) => Array.from(el.children).filter(shown);

type Row =
  | { kind: 'node'; el: Element; depth: number; selected?: boolean; ancestor?: boolean; open?: boolean; count: number }
  | { kind: 'more'; depth: number; count: number }
  | { kind: 'fold'; depth: number; count: number };

function buildRows(sel: Element, allAncestors: boolean): Row[] {
  const ancestors: Element[] = [];
  for (let p = selectableParent(sel); p; p = selectableParent(p)) ancestors.unshift(p);
  const visible = allAncestors ? ancestors : ancestors.slice(-ANCESTORS);
  const rows: Row[] = [];
  const folded = ancestors.length - visible.length;
  if (folded > 0) rows.push({ kind: 'fold', depth: 0, count: folded });
  visible.forEach((el, depth) => rows.push({ kind: 'node', el, depth, ancestor: true, open: true, count: 0 }));

  const depth = visible.length;
  const siblings = sel.parentElement ? shownChildren(sel.parentElement) : [sel];
  if (!siblings.includes(sel)) siblings.push(sel);
  const at = siblings.indexOf(sel);
  const from = Math.max(0, Math.min(at - Math.floor(SIBLINGS / 2), siblings.length - SIBLINGS));
  const near = siblings.slice(from, from + SIBLINGS);
  if (from > 0) rows.push({ kind: 'more', depth, count: from });
  for (const el of near) {
    if (el !== sel) { rows.push({ kind: 'node', el, depth, count: shownChildren(el).length }); continue; }
    const children = shownChildren(sel);
    rows.push({ kind: 'node', el, depth, selected: true, open: children.length > 0, count: children.length });
    for (const child of children.slice(0, CHILDREN)) rows.push({ kind: 'node', el: child, depth: depth + 1, count: shownChildren(child).length });
    if (children.length > CHILDREN) rows.push({ kind: 'more', depth: depth + 1, count: children.length - CHILDREN });
  }
  const after = siblings.length - from - near.length;
  if (after > 0) rows.push({ kind: 'more', depth, count: after });
  return rows;
}

const INDENT = 12;

export function ElementTree({ selected, onSelect }: {
  selected: Element;
  /** Move the selection there; absent while the draft has changes */
  onSelect?: (el: Element) => void;
}) {
  const [allAncestors, setAllAncestors] = useState(false);
  const [hover, setHover] = useState<DOMRect | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => buildRows(selected, allAncestors), [selected, allAncestors]);
  useEffect(() => setHover(null), [selected]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[e.key === 'ArrowDown' ? Math.min(i + 1, buttons.length - 1) : Math.max(i - 1, 0)];
    if (next) { e.preventDefault(); next.focus(); }
  };

  return (
    <div
      ref={listRef}
      role="tree"
      aria-label={t('toolbar.tree.label')}
      onKeyDown={onKeyDown}
      onMouseLeave={() => setHover(null)}
      style={{
        backgroundColor: color.background, border: `1px solid ${color.border}`,
        borderRadius: radius.md, padding: 4, marginBottom: 8,
        fontSize: 12, fontFamily: font.sans, maxHeight: 200, overflowY: 'auto',
      }}
    >
      {rows.map((row, i) => {
        const indent = 6 + row.depth * INDENT;
        if (row.kind === 'more') {
          return (
            <div key={`more-${i}`} style={{ padding: `2px 6px 2px ${indent + 14}px`, fontSize: 11, color: color.mutedForeground }}>
              {t('toolbar.tree.more', { count: row.count })}
            </div>
          );
        }
        if (row.kind === 'fold') {
          return (
            <button key="fold" onClick={() => setAllAncestors(true)} title={t('toolbar.tree.unfold')} style={rowStyle(indent, false)}>
              <span style={{ width: 10 }} />
              <span style={{ color: color.mutedForeground }}>⋯</span>
            </button>
          );
        }
        const { el } = row;
        const names = rootComponents(fiberOf(el));
        const component = names[0];
        const text = textOf(el, !!row.ancestor);
        const expandable = row.open || row.count > 0;
        const locked = !onSelect && !row.selected;
        return (
          <button
            key={i}
            role="treeitem"
            aria-selected={!!row.selected}
            aria-expanded={expandable ? !!row.open : undefined}
            aria-disabled={locked || undefined}
            title={locked ? t('toolbar.tree.locked') : names.length > 1 ? names.join(' › ') : undefined}
            onClick={() => { if (!row.selected && onSelect) onSelect(el); }}
            onMouseEnter={() => setHover(el.getBoundingClientRect())}
            onFocus={() => setHover(el.getBoundingClientRect())}
            style={rowStyle(indent, !!row.selected, locked)}
          >
            <span style={{ width: 10, flexShrink: 0, fontSize: 9, color: color.mutedForeground }}>
              {expandable ? (row.open ? '▾' : '▸') : ''}
            </span>
            {component && <span style={{ fontWeight: 500, flexShrink: 0 }}>{component}</span>}
            <span style={{ color: color.mutedForeground, fontFamily: font.mono, fontSize: 11, flexShrink: component ? 1 : 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {htmlLabel(el)}
            </span>
            {text && <span style={{ color: color.foreground, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>"{text}"</span>}
            {!row.open && row.count > 0 && <span style={{ color: color.mutedForeground, fontSize: 11, flexShrink: 0 }}>({row.count})</span>}
          </button>
        );
      })}
      {hover && (
        <div style={{
          position: 'fixed', top: hover.top, left: hover.left, width: hover.width, height: hover.height,
          border: '2px dashed #6366f1', backgroundColor: 'rgba(99,102,241,0.06)',
          pointerEvents: 'none', borderRadius: 4,
        }} />
      )}
    </div>
  );
}

function rowStyle(indent: number, selected: boolean, locked = false): CSSProperties {
  return {
    width: '100%', display: 'flex', alignItems: 'center', gap: 6,
    padding: `3px 6px 3px ${indent}px`, border: 'none', borderRadius: radius.sm - 2,
    background: selected ? 'rgba(99,102,241,0.10)' : 'none',
    color: color.foreground, fontSize: 12, fontFamily: font.sans, textAlign: 'left',
    whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0,
    cursor: selected || locked ? 'default' : 'pointer',
  };
}
