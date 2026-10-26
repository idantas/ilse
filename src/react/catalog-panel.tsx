/**
 * The panel's Catalog tab: the product's components, from the code.
 *
 * Search first (by name, and by what it's for: "botão" finds Button). With no
 * search: Base (library, kit, shared patterns) by what it's for, then Product
 * by feature — or every component by folder, the code's own layout. The ones
 * on this page carry a small label and their groups start open. Dragging puts one on the page; a click shows
 * where it is on the page. The list is names only; hovering shows a card with a
 * big copy, where it's used, its props and the names of its variants.
 */
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { color, font, ilse, radius, shadow } from './tokens.js';
import { t } from '../i18n/index.js';
import type { CatalogItem, CatalogSnapshot } from './catalog-snapshot.js';
import { searchCatalog } from '../design-context/catalog-search.js';
import { KIND_ORDER, type CatalogKind } from '../design-context/catalog-kinds.js';
import { keptPosition, rememberPanelPosition } from './property-panel.js';

const THUMB_W = 56;
const THUMB_H = 36;

/** A copy shrunk to fit the thumbnail box */
export function Thumb({ snap, w = THUMB_W, h = THUMB_H, empty }: { snap?: CatalogSnapshot; w?: number; h?: number; /** Said in the box when there's no copy yet */ empty?: string }) {
  const box: React.CSSProperties = {
    width: w, height: h, flexShrink: 0, borderRadius: radius.sm, overflow: 'hidden', position: 'relative',
    background: '#f5f5f5', border: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  // A see-through piece (white text on a bar) is shown on the backdrop it was seen on
  const backdrop = /data-ilse-backdrop="([^"]+)"/.exec(snap?.html ?? '')?.[1];
  if (backdrop) box.background = backdrop;
  if (!snap) return <div style={{ ...box, borderStyle: 'dashed', background: 'transparent', fontSize: empty ? 11 : 8, color: color.mutedForeground, textAlign: 'center', lineHeight: empty ? 1.4 : 1.1, padding: empty ? '0 16px' : 0, boxSizing: 'border-box' }}>{empty ?? t('catalog.noCopy')}</div>;
  // Fits when it can; a wide piece (a bar, a table) shows its top-left corner big enough to read
  const fit = Math.min((w - 6) / snap.w, (h - 6) / snap.h, 1);
  const crop = fit < 0.2;
  const scale = crop ? Math.min(0.35, (h - 6) / snap.h * 3) : fit;
  return (
    <div style={{ ...box, ...(crop ? { alignItems: 'flex-start', justifyContent: 'flex-start' } : {}) }} aria-hidden>
      <div
        style={{ width: snap.w, height: snap.h, transform: `scale(${scale})`, transformOrigin: crop ? 'top left' : 'center', flexShrink: 0, pointerEvents: 'none' }}
        dangerouslySetInnerHTML={{ __html: snap.html }}
      />
    </div>
  );
}

/** The copy to show for an entry: its plain look (no variant props) if seen, else the first one */
export function bestSnapshot(list: CatalogSnapshot[] | undefined): CatalogSnapshot | undefined {
  return list?.find(s => s.variant === '') ?? list?.[0];
}

/** The hover card: a big copy, where it's used, its props and variant names */
function HoverCard({ item, snap, at, onEnter, onLeave }: { item: CatalogItem; snap?: CatalogSnapshot; at: DOMRect; onEnter: () => void; onLeave: () => void }) {
  const choosable = item.props.filter(p => (p.kind === 'enum' || p.kind === 'boolean') && p.values.length > 0).slice(0, 6);
  const others = item.props.filter(p => !choosable.includes(p) && p.kind !== 'other').slice(0, 6);
  const width = 260;
  // Beside the panel, on the side with room
  const left = at.left - width - 12 > 8 ? at.left - width - 12 : at.right + 12;
  const height = 120 + 70 + (choosable.length + (others.length ? 1 : 0)) * 17;
  return createPortal(
    <div data-ilse-toolbar onMouseEnter={onEnter} onMouseLeave={onLeave} style={{
      position: 'fixed', left, top: Math.max(8, Math.min(at.top - 40, window.innerHeight - height - 8)), width, zIndex: 100002,
      background: color.popover, border: `1px solid ${color.border}`, borderRadius: radius.lg, boxShadow: shadow.lg,
      padding: 10, fontFamily: font.sans, fontSize: 11, color: color.foreground, boxSizing: 'border-box', userSelect: 'text',
    }}>
      <Thumb snap={snap} w={width - 20} h={120} empty={item.example ? t('catalog.noCopyWhere', { file: item.example.file.split('/').pop()! }) : t('catalog.noCopyHint')} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</span>
        <span style={{ color: color.mutedForeground, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>◇ {item.folder}</span>
      </div>
      {item.ds && <div style={{ color: color.mutedForeground, marginTop: 2 }}>{t('catalog.fromDs', { ds: item.ds })}</div>}
      <div style={{ color: color.mutedForeground, marginTop: 2, marginBottom: choosable.length || others.length ? 6 : 0 }}>
        {item.uses === 1 ? t('catalog.usedOnce') : item.uses === 0 ? t('catalog.unused') : t('catalog.used', { n: item.uses })}
      </div>
      {choosable.map(p => (
        <div key={p.name} style={{ color: color.mutedForeground, lineHeight: 1.5 }}>
          <span style={{ color: color.foreground }}>{p.name}</span>: {p.kind === 'boolean' ? 'true / false' : p.values.join(', ')}
        </div>
      ))}
      {others.length > 0 && (
        <div style={{ color: color.mutedForeground, lineHeight: 1.5 }}>{others.map(p => p.name + (p.required ? '*' : '')).join(', ')}</div>
      )}
    </div>,
    document.body,
  );
}

function Row({ item, selected, here, onHover, onPick, onDragStart, onSpot }: {
  item: CatalogItem;
  /** Rendered on this page: a small label says so */
  here?: boolean;
  /** A click (no drag): show where it is on the page */
  onSpot?: (item: CatalogItem) => void;
  /** The component selected on the page: marked, and scrolled to */
  selected?: boolean;
  onHover: (item: CatalogItem | null, at?: DOMRect) => void;
  onPick?: (item: CatalogItem) => void;
  onDragStart?: (item: CatalogItem, x: number, y: number) => void;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  // A press that moves is a drag onto the page; a press that doesn't does nothing
  const press = (e: React.MouseEvent) => {
    if (!onDragStart || onPick || e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    const move = (m: MouseEvent) => {
      if (Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) < 5) return;
      stop();
      onHover(null);
      onDragStart(item, m.clientX, m.clientY);
    };
    const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
  };
  return (
    <div
      ref={ref}
      data-catalog-id={item.id}
      aria-current={selected || undefined}
      onMouseDown={press}
      onClick={onPick ? () => { onHover(null); onPick(item); } : onSpot ? () => onSpot(item) : undefined}
      onMouseEnter={(e) => onHover(item, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => onHover(null)}
      className="ilse-catalog-row"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: radius.sm,
        cursor: onPick ? 'pointer' : 'grab',
        background: selected ? ilse.orangePale : undefined,
        boxShadow: selected ? `inset 2px 0 0 ${ilse.brand}` : undefined,
      }}
    >
      <span style={{ flex: 1, fontSize: 11, fontWeight: selected ? 600 : 400, color: color.foreground, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
      {here && (
        <span title={t('catalog.onPage')} style={{
          fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: radius.full, flexShrink: 0,
          background: ilse.orangePale, color: '#8A4B12',
        }}>{t('catalog.hereBadge')}</span>
      )}
      <span style={{ fontSize: 10, color: color.mutedForeground, flexShrink: 0, minWidth: 10, textAlign: 'right' }}>{item.uses || ''}</span>
    </div>
  );
}

const sectionButton: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '4px 2px', border: 'none', background: 'none',
  cursor: 'pointer', fontFamily: font.sans, textAlign: 'left',
};
const sectionLabel: React.CSSProperties = { fontSize: 9, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: color.mutedForeground };

/** `data-sources` → Data sources */
function featureLabel(f: string): string {
  const s = f.replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** ⋯ next to the search: the catalog's less frequent actions */
function MoreOptions({ items }: { items: Array<{ label: string; hint?: string; onClick: () => void }> }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={t('catalog.more')}
        aria-expanded={open}
        title={t('catalog.more')}
        style={{
          width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer',
          borderRadius: radius.sm, border: `1px solid ${open ? color.border : 'transparent'}`, background: open ? color.muted : 'transparent', color: color.mutedForeground,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', right: 0, top: 30, minWidth: 180, zIndex: 2, padding: 4,
          background: color.popover, border: `1px solid ${color.border}`, borderRadius: radius.md, boxShadow: shadow.lg,
        }}>
          {items.map(i => (
            <button
              key={i.label}
              role="menuitem"
              title={i.hint}
              onClick={() => { setOpen(false); i.onClick(); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = color.muted; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer',
                fontSize: 11, fontFamily: font.sans, color: color.foreground, padding: '6px 8px', borderRadius: radius.sm,
              }}
            >{i.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

type Show = 'all' | 'page' | 'base';

/** Which components: all, only the ones on this page, only Base (the kit / design system / libraries) */
function ShowFilter({ value, onChange, counts }: { value: Show; onChange: (v: Show) => void; counts: Record<Show, number> }) {
  const label: Record<Show, string> = { all: t('catalog.all'), page: t('catalog.onPage'), base: t('catalog.base') };
  return (
    <div role="group" aria-label={t('catalog.show')} style={{ display: 'flex', gap: 2, padding: 2, borderRadius: radius.md, background: color.muted, margin: '2px 0 6px' }}>
      {(['all', 'page', 'base'] as const).map(v => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          style={{
            flex: 1, border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: font.sans, padding: '4px 4px', borderRadius: radius.sm,
            background: value === v ? color.popover : 'transparent', color: value === v ? color.foreground : color.mutedForeground,
            boxShadow: value === v ? shadow.sm : 'none', whiteSpace: 'nowrap',
          }}
        >{label[v]} <span style={{ color: color.mutedForeground, fontSize: 9 }}>{counts[v]}</span></button>
      ))}
    </div>
  );
}

/** Per project (the app's address) and per way of grouping: the folders the person left open */
const openKey = (by: string) => `ilse-catalog-open:${location.host}:${by}`;
function keptOpen(by: string): Set<string> {
  try { const v = JSON.parse(localStorage.getItem(openKey(by)) ?? '[]'); return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []); } catch { return new Set(); }
}

/** By type (Base by purpose, Product by feature) or by folder, as the code is laid out */
function GroupBy({ value, onChange }: { value: 'type' | 'folder'; onChange: (v: 'type' | 'folder') => void }) {
  const option = (v: 'type' | 'folder') => (
    <button
      onClick={() => onChange(v)}
      aria-pressed={value === v}
      style={{
        border: 'none', background: value === v ? color.muted : 'transparent', color: value === v ? color.foreground : color.mutedForeground,
        fontSize: 10, fontFamily: font.sans, padding: '2px 6px', borderRadius: radius.sm, cursor: 'pointer',
      }}
    >{t(v === 'type' ? 'catalog.byType' : 'catalog.byFolder')}</button>
  );
  return <div role="group" aria-label={t('catalog.groupBy')} style={{ display: 'flex', gap: 2 }}>{option('type')}{option('folder')}</div>;
}

export function CatalogPanel({ items, snapshots, onPage, loading, onPick, onDragStart, selected, onSpot, onEditFile }: {
  /** "Edit organization": creates `.ilse/catalog.md` for the team to rename and move things */
  onEditFile?: () => void;
  /** A click on a component: show its instances on the page */
  onSpot?: (item: CatalogItem) => void;
  /** Dragging a component out of the list, onto the page */
  onDragStart?: (item: CatalogItem, x: number, y: number) => void;
  /** Picking mode (the card's "Component…"): a click chooses the component */
  onPick?: (item: CatalogItem) => void;
  /** null while the CLI reads the code */
  items: CatalogItem[] | null;
  snapshots: Record<string, CatalogSnapshot[]>;
  /** Component names rendered on this page */
  onPage: Set<string>;
  loading?: boolean;
  /** Catalog id of the component selected on the page */
  selected?: string;
}) {
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>(() => { try { const v = localStorage.getItem('ilse-catalog-show'); return v === 'page' || v === 'base' ? v : 'all'; } catch { return 'all'; } });
  const pickShow = (v: Show) => { setShow(v); try { localStorage.setItem('ilse-catalog-show', v); } catch { /* not kept */ } };
  const [hover, setHover] = useState<{ item: CatalogItem; at: DOMRect } | null>(null);
  // Leaving a row waits a moment: the pointer may be on its way into the card, which then stays
  const closing = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = () => { if (closing.current) { clearTimeout(closing.current); closing.current = null; } };
  const onHover = (item: CatalogItem | null, at?: DOMRect) => {
    keep();
    if (item && at) setHover({ item, at });
    else closing.current = setTimeout(() => setHover(null), 180);
  };
  React.useEffect(() => keep, []);

  const [by, setBy] = useState<'type' | 'folder'>(() => { try { return localStorage.getItem('ilse-catalog-group') === 'folder' ? 'folder' : 'type'; } catch { return 'type'; } });
  const pickBy = (v: 'type' | 'folder') => { setBy(v); setOpen(keptOpen(v)); try { localStorage.setItem('ilse-catalog-group', v); } catch { /* not kept */ } };
  // Every folder starts closed — the list is long — except the ones the person left open in this project
  const [open, setOpen] = useState<Set<string>>(() => keptOpen(by));
  const isBase = (i: CatalogItem) => i.library || i.layer === 'base';
  const shown = useMemo(() => (items ?? []).filter(i => show === 'all' || (show === 'page' ? onPage.has(i.name) : isBase(i))), [items, show, onPage]);
  const counts = useMemo(() => ({ all: items?.length ?? 0, page: (items ?? []).filter(i => onPage.has(i.name)).length, base: (items ?? []).filter(isBase).length }), [items, onPage]);
  /** Each item's group key and label, by the current way of grouping */
  const groupOf = React.useCallback((i: CatalogItem): { key: string; label: string; section?: 'base' | 'product' } => {
    if (by === 'folder' || !i.layer) return { key: `f:${i.folder}`, label: i.folder };
    // The design system's own group (a story title's) wins over Ilse's kinds
    if (i.layer === 'base' && i.dsGroup) return { key: `b:ds:${i.dsGroup}`, label: i.dsGroup, section: 'base' };
    if (i.layer === 'base') return { key: `b:${i.kind ?? 'other'}`, label: t(`catalog.kind.${(i.kind ?? 'other') as CatalogKind}`), section: 'base' };
    return { key: `p:${i.feature ?? ''}`, label: i.featureLabel ?? (i.feature ? featureLabel(i.feature) : t('catalog.featureNone')), section: 'product' };
  }, [by]);
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; section?: 'base' | 'product'; list: CatalogItem[] }>();
    for (const i of shown) {
      const g = groupOf(i);
      const cur = m.get(g.key) ?? { label: g.label, section: g.section, list: [] };
      cur.list.push(i);
      m.set(g.key, cur);
    }
    // The design system's groups first (A→Z), then the kinds in their order
    const kindRank = (k: string) => { if (k.startsWith('b:ds:')) return -1; const r = KIND_ORDER.indexOf(k.slice(2) as never); return r < 0 ? 99 : r; };
    return [...m.entries()].sort(([ka, a], [kb, b]) => {
      if (by === 'folder') return Number(a.list[0].library) - Number(b.list[0].library) || a.label.localeCompare(b.label);
      // Base before Product; Base in the kinds' order; features A→Z, the unplaced last
      if (a.section !== b.section) return a.section === 'base' ? -1 : 1;
      if (a.section === 'base') return kindRank(ka) - kindRank(kb) || a.label.localeCompare(b.label);
      return Number(ka === 'p:') - Number(kb === 'p:') || a.label.localeCompare(b.label);
    });
  }, [shown, groupOf, by]);
  const found = useMemo(() => (query.trim() ? searchCatalog(shown, query) : null), [shown, query]);

  const toggle = (f: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(f)) next.delete(f); else next.add(f);
    try { localStorage.setItem(openKey(by), JSON.stringify([...next])); } catch { /* not kept */ }
    return next;
  });
  const row = (i: CatalogItem) => <Row key={i.id} item={i} selected={i.id === selected} here={onPage.has(i.name)} onHover={onHover} onPick={onPick} onDragStart={onDragStart} onSpot={onSpot} />;

  return (
    <div style={{ fontFamily: font.sans }}>
      {/* Search stays at the top while the list scrolls */}
      <div style={{ position: 'sticky', top: -10, zIndex: 1, background: color.popover, padding: '0 0 6px', margin: '-10px 0 0', paddingTop: 10, display: 'flex', gap: 4, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color.mutedForeground} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('catalog.search')}
            aria-label={t('catalog.search')}
            style={{
              width: '100%', boxSizing: 'border-box', fontSize: 11, fontFamily: font.sans, padding: '6px 8px 6px 27px',
              borderRadius: radius.sm, border: `1px solid ${color.border}`, background: color.background, color: color.foreground, outline: 'none',
            }}
          />
        </div>
        {onEditFile && <MoreOptions items={[{ label: t('catalog.editFile'), hint: t('catalog.editFileHint'), onClick: onEditFile }]} />}
      </div>
      {items && <ShowFilter value={show} onChange={pickShow} counts={counts} />}

      {!items && <div style={{ fontSize: 11, color: color.mutedForeground, padding: '12px 0' }}>{loading === false ? t('catalog.empty') : t('catalog.loading')}</div>}

      {items && found && (
        found.length
          ? <div style={{ marginTop: 2 }}>{found.map(row)}</div>
          : <div style={{ fontSize: 11, color: color.mutedForeground, padding: '12px 0' }}>{t('catalog.empty')}</div>
      )}

      {items && !found && show === 'page' && (
        // The page's own components are few: a flat list, A→Z
        shown.length
          ? <div style={{ marginTop: 2 }}>{[...shown].sort((a, b) => a.name.localeCompare(b.name)).map(row)}</div>
          : <div style={{ fontSize: 11, color: color.mutedForeground, padding: '12px 0' }}>{t('catalog.noneOnPage')}</div>
      )}

      {items && !found && show !== 'page' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0 2px 16px' }}>
            <span style={{ flex: 1 }} />
            <GroupBy value={by} onChange={pickBy} />
          </div>
          {groups.map(([key, g], n) => (
            <div key={key}>
              {by === 'type' && g.section && g.section !== groups[n - 1]?.[1].section && (
                <div style={{ ...sectionLabel, margin: n ? '10px 0 2px 16px' : '2px 0 2px 16px' }}>{t(g.section === 'base' ? 'catalog.base' : 'catalog.product')}</div>
              )}
              <button onClick={() => toggle(key)} aria-expanded={open.has(key)} style={{ ...sectionButton, fontSize: 11, color: color.foreground }}>
                <span style={{ width: 8, fontSize: 9, color: color.mutedForeground }}>{open.has(key) ? '▾' : '▸'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: g.list.some(i => i.id === selected) ? 600 : 400 }}>{g.label}</span>
                <span style={{ color: color.mutedForeground, fontSize: 10 }}>{g.list.length}</span>
              </button>
              {open.has(key) && <div style={{ paddingLeft: 10 }}>{g.list.map(row)}</div>}
            </div>
          ))}
        </>
      )}

      {hover && <HoverCard item={hover.item} snap={bestSnapshot(snapshots[hover.item.id])} at={hover.at} onEnter={keep} onLeave={() => onHover(null)} />}
    </div>
  );
}

/**
 * The catalog with nothing selected: the same panel spot, only the Catalog.
 * Selecting an element turns it into the property panel's Catalog tab.
 */
export function CatalogWindow({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(() => keptPosition());
  const drag = React.useRef<{ x: number; y: number; top: number; left: number } | null>(null);
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return;
      const p = { top: drag.current.top + e.clientY - drag.current.y, left: drag.current.left + e.clientX - drag.current.x };
      rememberPanelPosition(p);
      setPos(p);
    };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  return createPortal(
    <div
      ref={ref}
      data-ilse-toolbar
      data-ilse-panel
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', width: 248, ...(pos ? { top: pos.top, left: pos.left } : { top: 16, right: 16 }),
        maxHeight: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column',
        backgroundColor: color.popover, border: `1px solid ${color.border}`, borderRadius: radius.xl,
        boxShadow: shadow.xl, fontFamily: font.sans, zIndex: 99998, overflow: 'hidden',
      }}
    >
      <div
        onMouseDown={(e) => {
          const box = ref.current?.getBoundingClientRect();
          if (!box) return;
          e.preventDefault();
          drag.current = { x: e.clientX, y: e.clientY, top: box.top, left: box.left };
        }}
        style={{ padding: '10px 12px', borderBottom: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', cursor: 'move', userSelect: 'none' }}
      >
        <span style={{ flex: 1, fontSize: 11, fontWeight: 500, color: color.foreground }}>{t('catalog.title')}</span>
        <button
          onClick={onClose}
          aria-label={t('toolbar.close')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: color.mutedForeground, fontSize: 14, lineHeight: 1 }}
        >
          ×
        </button>
      </div>
      <div style={{ padding: '10px 12px 12px', overflowY: 'auto', fontSize: 11 }}>{children}</div>
    </div>,
    document.body,
  );
}

/** The catalog without Ilse Pro: what it is, and where to get it — like test mode asleep */
export function CatalogLocked() {
  return (
    <div style={{ fontFamily: font.sans, padding: '6px 2px 4px', textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: color.foreground }}>{t('catalog.title')}</span>
        <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: radius.full, background: ilse.testPale, color: ilse.test }}>Pro</span>
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.45, color: color.mutedForeground }}>{t('catalog.locked')}</div>
      <a
        href="https://ilse.design/#pro"
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-block', marginTop: 10, fontSize: 11, fontWeight: 600, color: ilse.test, textDecoration: 'none' }}
      >
        {t('catalog.lockedLink')} →
      </a>
    </div>
  );
}
