/**
 * Pencil mode UI: the drawing surface and the colour bar above the toolbar.
 *
 * Strokes are kept in page coordinates (client + scroll) so a sketch stays on
 * the elements it was drawn over when the page scrolls. The surface only
 * captures the pointer while drawing; a sketch waiting in the annotation card
 * is shown but lets the page through.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { color, radius, shadow, font, ilse } from './tokens.js';
import type { Point, Stroke } from './sketch.js';
import { t, type MessageKey } from '../i18n/index.js';
import { withShortcut } from './shortcuts.js';

export const PEN_COLORS = ['#FF6C03', '#EF4444', '#3B82F6', '#22C55E', '#111111'] as const;
const PEN_NAMES: Record<string, MessageKey> = {
  '#FF6C03': 'sketch.pen.orange', '#EF4444': 'sketch.pen.red', '#3B82F6': 'sketch.pen.blue', '#22C55E': 'sketch.pen.green', '#111111': 'sketch.pen.black',
};

function useScroll(): Point {
  const [scroll, setScroll] = useState<Point>(() => ({ x: window.scrollX, y: window.scrollY }));
  useEffect(() => {
    const on = () => setScroll({ x: window.scrollX, y: window.scrollY });
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return scroll;
}

function pathD(points: Point[], scroll: Point): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  if (rest.length === 0) return `M${first.x - scroll.x},${first.y - scroll.y} l0.01,0`;
  return `M${first.x - scroll.x},${first.y - scroll.y}` + rest.map(p => ` L${p.x - scroll.x},${p.y - scroll.y}`).join('');
}

export function SketchLayer({ drawing, penColor, strokes, onStroke }: {
  /** Capture the pointer and draw */
  drawing: boolean;
  penColor: string;
  strokes: Stroke[];
  onStroke: (s: Stroke) => void;
}) {
  const scroll = useScroll();
  const [live, setLive] = useState<Stroke | null>(null);
  const liveRef = useRef<Stroke | null>(null);

  if (typeof document === 'undefined' || (!drawing && strokes.length === 0)) return null;

  const at = (e: React.PointerEvent): Point => ({ x: e.clientX + window.scrollX, y: e.clientY + window.scrollY });

  return createPortal(
    <svg
      data-ilse-toolbar
      width="100%"
      height="100%"
      onPointerDown={drawing ? (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const s = { points: [at(e)], color: penColor };
        liveRef.current = s;
        setLive(s);
      } : undefined}
      onPointerMove={drawing ? (e) => {
        const s = liveRef.current;
        if (!s) return;
        const p = at(e);
        const last = s.points[s.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
        const next = { ...s, points: [...s.points, p] };
        liveRef.current = next;
        setLive(next);
      } : undefined}
      onPointerUp={drawing ? () => {
        const s = liveRef.current;
        liveRef.current = null;
        setLive(null);
        if (s) onStroke(s);
      } : undefined}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', inset: 0, zIndex: 99994,
        pointerEvents: drawing ? 'auto' : 'none',
        cursor: drawing ? penCursor(penColor) : 'default',
        touchAction: 'none',
      }}
    >
      {[...strokes, ...(live ? [live] : [])].map((s, i) => (
        <path
          key={i}
          d={pathD(s.points, scroll)}
          fill="none"
          stroke={s.color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 0 1px rgba(255,255,255,0.9))' }}
        />
      ))}
    </svg>,
    document.body,
  );
}

/** A small dot cursor in the pen's colour. */
function penCursor(c: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><circle cx='8' cy='8' r='4' fill='${c}' stroke='white' stroke-width='1.5'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 8 8, crosshair`;
}

/**
 * Pen control anchored to the toolbar's pencil button: collapsed, a dot in the
 * current colour sitting on the button's top edge; clicked, the full bar
 * (colours, undo, clear, done) opens above it. Picking a colour folds it back.
 */
export function PencilControl(props: {
  penColor: string;
  strokeCount: number;
  onColor: (c: string) => void;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
  onHover?: (over: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        data-ilse-toolbar
        title={t('sketch.penColor')}
        aria-label={t('sketch.penColor')}
        aria-expanded={open}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseEnter={() => props.onHover?.(true)}
        onMouseLeave={() => props.onHover?.(false)}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          // 16×16 in total, rings included, sitting on the button's top-right corner
          position: 'absolute', top: -6, right: -4,
          width: 16, height: 16, boxSizing: 'border-box', padding: 0, borderRadius: '50%', cursor: 'pointer',
          backgroundColor: props.penColor, border: `1.5px solid ${props.penColor}`,
          boxShadow: 'inset 0 0 0 2px #fff, 0 1px 2px rgba(0,0,0,0.15)',
          zIndex: 1,
        }}
      />
      {open && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 16px)', left: '50%', transform: 'translateX(-50%)', zIndex: 2 }}>
          <PencilBar {...props} onColor={(c) => { props.onColor(c); setOpen(false); }} />
        </div>
      )}
    </>
  );
}

export function PencilBar({ penColor, strokeCount, onColor, onUndo, onClear, onDone, onHover }: {
  penColor: string;
  strokeCount: number;
  onColor: (c: string) => void;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
  /** Pointer over the bar — the sketch shouldn't close under a click */
  onHover?: (over: boolean) => void;
}) {
  return (
    <div
      data-ilse-toolbar
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
        backgroundColor: color.popover, border: `1px solid ${color.border}`,
        borderRadius: radius.full, boxShadow: shadow.lg, fontFamily: font.sans, fontSize: 11,
        whiteSpace: 'nowrap',
      }}
    >
      {PEN_COLORS.map(c => (
        <button
          key={c}
          title={t(PEN_NAMES[c])}
          aria-label={t(PEN_NAMES[c])}
          aria-pressed={penColor === c}
          onClick={() => onColor(c)}
          style={{
            width: 20, height: 20, padding: 0, borderRadius: '50%', cursor: 'pointer',
            backgroundColor: c, border: '2px solid #fff',
            boxShadow: penColor === c ? `0 0 0 2px ${c}` : '0 0 0 1px rgba(0,0,0,0.12)',
          }}
        />
      ))}
      <span style={{ width: 1, height: 18, backgroundColor: color.border, margin: '0 2px' }} />
      <button onClick={onUndo} disabled={strokeCount === 0} title={withShortcut(t('sketch.undo'), 'Mod+Z')} style={barButton(strokeCount === 0)}>
        Desfazer
      </button>
      <button onClick={onClear} disabled={strokeCount === 0} title={t('sketch.clear')} style={barButton(strokeCount === 0)}>
        {t('sketch.clearShort')}
      </button>
      <button
        onClick={onDone}
        disabled={strokeCount === 0}
        title={withShortcut(t('sketch.done'), 'Enter')}
        style={{
          ...barButton(strokeCount === 0),
          backgroundColor: strokeCount === 0 ? color.muted : ilse.orange,
          color: strokeCount === 0 ? color.mutedForeground : '#fff', fontWeight: 500,
        }}
      >
        {t('sketch.done')}
      </button>
    </div>
  );
}

const barButton = (disabled: boolean): React.CSSProperties => ({
  padding: '3px 9px', border: 'none', borderRadius: radius.full, fontSize: 11, fontFamily: font.sans,
  cursor: disabled ? 'default' : 'pointer', backgroundColor: 'transparent',
  color: disabled ? color.mutedForeground : color.foreground, opacity: disabled ? 0.6 : 1,
});
