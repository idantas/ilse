/**
 * Value dropdown for the property panel.
 *
 * A native <select> lists every step of a scale — 21 spacing values, 70 colour
 * tokens — in one long column, and can't be taught "show fewer". This one:
 *   - "Outro valor…" first, so a value off the list is one click, not a scroll
 *   - at most 6 options, the ones around the current value
 *   - "Ver mais" / "Ver menos" to open the whole scale and fold it back
 */

import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { radius, color, shadow, font } from './tokens.js';
import { t } from '../i18n/index.js';

export interface ValueOption { label: string; value: string; hint?: string }

export const VISIBLE_OPTIONS = 6;

/** The window of options shown folded: the ones around the current value. */
export function visibleWindow<T>(options: T[], currentIndex: number, size = VISIBLE_OPTIONS): T[] {
  if (options.length <= size) return options;
  if (currentIndex < 0) return options.slice(0, size);
  const start = Math.min(Math.max(currentIndex - Math.floor(size / 2), 0), options.length - size);
  return options.slice(start, start + size);
}

export function ValueSelect({ options, current, display, offToken, prefix, groupLabel, onPick, onCustom, compact }: {
  options: ValueOption[];
  /** Value of the option currently in effect, when one is */
  current?: string;
  /** What the closed control shows */
  display: string;
  offToken?: boolean;
  /** Short marker before the value (side of a padding, etc.) */
  prefix?: React.ReactNode;
  groupLabel?: string;
  onPick: (value: string) => void;
  onCustom?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (open && triggerRef.current) setAnchor(triggerRef.current.getBoundingClientRect());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const currentIndex = options.findIndex(o => o.value === current);
  const shown = expanded ? options : visibleWindow(options, currentIndex);
  const folded = options.length > VISIBLE_OPTIONS;

  const close = () => { setOpen(false); setExpanded(false); };

  // Below the trigger, or above when there's no room
  const listHeight = Math.min((shown.length + 3) * 24 + 12, 320);
  const below = anchor ? window.innerHeight - anchor.bottom > listHeight + 8 : true;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(v => !v)}
        title={offToken ? t('select.offScale') : display}
        style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 11, fontFamily: font.sans, textAlign: 'left', cursor: 'pointer',
          padding: compact ? '3px 4px' : '3px 4px 3px 6px', borderRadius: radius.sm,
          border: `1px solid ${open ? color.ring : offToken ? '#E8A33D' : color.border}`,
          backgroundColor: color.background, color: color.foreground,
        }}
      >
        {prefix && <span style={{ color: color.mutedForeground, flexShrink: 0, display: 'flex' }}>{prefix}</span>}
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {display}
        </span>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: color.mutedForeground }}>
          <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && anchor && typeof document !== 'undefined' && createPortal(
        <div
          ref={listRef}
          data-ilse-toolbar
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', zIndex: 100000,
            left: anchor.left, minWidth: Math.max(anchor.width, 150),
            ...(below ? { top: anchor.bottom + 4 } : { bottom: window.innerHeight - anchor.top + 4 }),
            maxHeight: 320, overflowY: 'auto',
            padding: 4, borderRadius: radius.md,
            backgroundColor: color.popover, border: `1px solid ${color.border}`, boxShadow: shadow.lg,
            fontFamily: font.sans, fontSize: 11, color: color.foreground,
          }}
        >
          {onCustom && (
            <>
              <Item onClick={() => { close(); onCustom(); }}>
                <span style={{ width: 12, flexShrink: 0, color: color.mutedForeground }}>+</span>
                {t('select.other')}
              </Item>
              <div style={{ height: 1, backgroundColor: color.border, margin: '3px 2px' }} />
            </>
          )}
          {groupLabel && (
            <div style={{ padding: '4px 8px 2px', fontSize: 9, color: color.mutedForeground, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {groupLabel}
            </div>
          )}
          {shown.map(o => (
            <Item key={`${o.label}-${o.value}`} onClick={() => { close(); onPick(o.value); }} active={o.value === current}>
              <span style={{ width: 12, flexShrink: 0 }}>{o.value === current ? '✓' : ''}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
              {o.hint && !o.label.includes(o.hint) && (
                <span style={{ color: color.mutedForeground, flexShrink: 0, fontFamily: font.mono }}>{o.hint}</span>
              )}
            </Item>
          ))}
          {folded && (
            <Item onClick={() => setExpanded(v => !v)} muted>
              <span style={{ width: 12, flexShrink: 0 }} />
              {expanded ? t('select.less') : t('select.more', { n: options.length - shown.length })}
            </Item>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function Item({ children, onClick, active, muted }: { children: React.ReactNode; onClick: () => void; active?: boolean; muted?: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: 24,
        padding: '0 8px', border: 'none', borderRadius: radius.sm - 2, cursor: 'pointer',
        textAlign: 'left', fontSize: 11, fontFamily: font.sans,
        fontWeight: active ? 500 : 400,
        backgroundColor: hover ? color.muted : 'transparent',
        color: muted ? color.mutedForeground : color.foreground,
      }}
    >
      {children}
    </button>
  );
}
