/**
 * Colour picker popover for the property panel.
 *
 * One screen, two halves with a clear line between them:
 * - **Picker** — saturation/value field, hue and alpha sliders, eyedropper and a
 *   typed value in hex / rgb / hsl / oklch.
 * - **Tokens** — every colour the project defines, painted as the edited element
 *   sees it (current theme included), as a swatch grid. Sorted by colour
 *   (neutrals, then around the hue wheel, so near-duplicates sit together) or
 *   grouped by token family. This is the on-standard path, and what token-swap
 *   can apply without an LLM. An off-standard pick shows its nearest token.
 *
 * Every change is applied live; the popover stays open until dismissed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { color, radius, shadow, font, ilse } from './tokens.js';
import {
  readColor, rgbToHsv, hsvToRgb, formatColor, rgbaToHex, deltaE,
  type ColorFormat, type HSVA, type RGBA,
} from './color.js';
import { familyRows, colorSections, byBaseness, type ColorToken, type Swatch } from './color-tokens.js';
import { t } from '../i18n/index.js';

const WIDTH = 248;
const PAD = 12;
const FORMATS: ColorFormat[] = ['hex', 'rgb', 'hsl', 'oklch'];
const FORMAT_KEY = 'ilse-color-format';
const ORDER_KEY = 'ilse-color-order';
type Order = 'color' | 'group';
const SECTION_LABELS = { neutral: 'color.section.neutral', color: 'color.section.color', translucent: 'color.section.translucent' } as const;

const CHECKER: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%),' +
    'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0, 4px 4px',
  backgroundColor: '#fff',
};

const css = (c: RGBA) => `rgba(${c.r},${c.g},${c.b},${c.a})`;

// Per-viewer niceties only — the picker works the same without them.
function load<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch { return fallback; }
}
function save(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

export function ColorPicker({ value, tokens, tokenName, anchor, anchorEl, onPick, onClose }: {
  value: string;
  tokens: ColorToken[];
  /** Name of the token currently applied, when known — disambiguates equal colours */
  tokenName?: string;
  anchor: DOMRect;
  /** The swatch that opened the picker — clicks on it toggle instead of "outside" */
  anchorEl?: Element | null;
  onPick: (value: string, token?: ColorToken) => void;
  onClose: () => void;
}) {
  const current = readColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  const matched = useMemo(() => {
    const exact = tokens.filter(t => deltaE(t.rgba, current) < 0.05);
    return exact.find(t => t.name === tokenName) ?? exact.sort(byBaseness)[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, tokenName, value]);

  const [format, setFormat] = useState<ColorFormat>(() => load(FORMAT_KEY, FORMATS, 'hex'));
  const [order, setOrder] = useState<Order>(() => load(ORDER_KEY, ['color', 'group'] as const, 'color'));
  const [hovered, setHovered] = useState<Swatch | null>(null);
  const [hsv, setHsv] = useState<HSVA>(() => rgbToHsv(current));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastEmitted = useRef<string | null>(null);

  // A token pick (or an outside edit) moves the colour — follow it, unless it is
  // the value this picker just emitted, which would snap the hue on greys.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    setHsv(rgbToHsv(readColor(value) ?? current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Dismiss: Esc (captured, so the toolbar doesn't also close the selection)
  // and a mousedown anywhere outside the popover and its swatch.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || anchorEl?.contains(t)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [onClose, anchorEl]);

  // Coalesce drag updates to one DOM write per frame.
  const frame = useRef<number | null>(null);
  const pending = useRef<HSVA | null>(null);
  function emitHsv(next: HSVA) {
    setHsv(next);
    pending.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!pending.current) return;
      const out = formatColor(hsvToRgb(pending.current), format);
      lastEmitted.current = out;
      onPick(out);
    });
  }
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  function pickToken(t: ColorToken) {
    lastEmitted.current = null;
    onPick(t.value, t);
  }

  function pickTyped(input: string) {
    const c = readColor(input);
    if (!c) return false;
    const out = formatColor(c, format);
    lastEmitted.current = out;
    setHsv(rgbToHsv(c));
    onPick(out);
    return true;
  }

  const nearest = useMemo(() => {
    if (matched || tokens.length === 0 || current.a === 0) return null;
    let best: { token: ColorToken; d: number } | null = null;
    for (const t of tokens) {
      const d = deltaE(t.rgba, current);
      if (!best || d < best.d) best = { token: t, d };
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, matched, value]);

  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - 560));
  const left = anchor.left - WIDTH - 10 >= 8 ? anchor.left - WIDTH - 10 : Math.min(anchor.right + 10, window.innerWidth - WIDTH - 8);

  // What the token section's caption names: the hovered swatch, else the applied token.
  const caption: Swatch | null = hovered ?? (matched ? { token: matched, all: tokens.filter(t => deltaE(t.rgba, matched.rgba) < 0.05) } : null);

  return createPortal(
    <div
      ref={rootRef}
      data-ilse-toolbar
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', top, left, width: WIDTH, maxHeight: 'calc(100vh - 16px)',
        display: 'flex', flexDirection: 'column',
        backgroundColor: color.popover, color: color.foreground,
        border: `1px solid ${color.border}`, borderRadius: radius.lg,
        boxShadow: shadow.xl, fontFamily: font.sans, fontSize: 11,
        zIndex: 99999, overflow: 'hidden',
      }}
    >
      {/* ── Picker ── */}
      <Picker
        hsv={hsv}
        format={format}
        display={formatColor(hsvToRgb(hsv), format)}
        onHsv={emitHsv}
        onFormat={(f) => { setFormat(f); save(FORMAT_KEY, f); }}
        onTyped={pickTyped}
      />

      {/* ── Tokens ── */}
      <div style={{ borderTop: `1px solid ${color.border}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `10px ${PAD}px 6px` }}>
          <span style={{ fontWeight: 500 }}>Tokens</span>
          <span style={{ color: color.mutedForeground }}>{tokens.length}</span>
          <span style={{ flex: 1 }} />
          {tokens.length > 0 && (
            <Segmented
              value={order}
              options={[{ value: 'color', label: 'Cor' }, { value: 'group', label: 'Grupo' }]}
              onChange={(o) => { setOrder(o); save(ORDER_KEY, o); }}
            />
          )}
        </div>

        {/* Caption: which token is under the cursor / applied, or how far off-standard */}
        <div style={{ height: 16, padding: `0 ${PAD}px 6px`, display: 'flex', alignItems: 'center', gap: 6, color: color.mutedForeground }}>
          {caption ? (
            <>
              <span style={{ color: color.foreground, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{caption.token.label}</span>
              {caption.all.length > 1 && (
                <span title={caption.all.map(t => t.label).join(', ')} style={{ flexShrink: 0 }}>+{caption.all.length - 1}</span>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: font.mono, fontSize: 10, flexShrink: 0 }}>{rgbaToHex(caption.token.rgba)}</span>
            </>
          ) : nearest ? (
            <>
              <span style={{ fontSize: 9, padding: '0 5px', borderRadius: radius.full, backgroundColor: ilse.orangePale, color: '#8A4B12', flexShrink: 0 }}>
                fora do padrão
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ≈ {nearest.token.label}
              </span>
              <span style={{ flex: 1 }} />
              <button onClick={() => pickToken(nearest.token)} style={linkButton}>Usar</button>
            </>
          ) : current.a === 0 ? 'transparent' : null}
        </div>

        {tokens.length === 0 ? (
          <div style={{ padding: `0 ${PAD}px ${PAD}px`, color: color.mutedForeground, lineHeight: 1.5 }}>
            Nenhum token de cor nesta página. Declare as cores como variáveis CSS no <code>:root</code>.
          </div>
        ) : (
          <div
            onMouseLeave={() => setHovered(null)}
            style={{ overflowY: 'auto', maxHeight: 176, padding: `2px ${PAD}px ${PAD}px` }}
          >
            {order === 'color' ? (
              colorSections(tokens).map(sec => (
                <div key={sec.name} style={{ marginBottom: 10 }}>
                  <div style={groupLabel}>{t(SECTION_LABELS[sec.name])}</div>
                  <SwatchGrid
                    swatches={sec.swatches}
                    selected={matched}
                    nearest={nearest?.token}
                    onHover={setHovered}
                    onPick={pickToken}
                  />
                </div>
              ))
            ) : (
              familyRows(tokens).map(row => (
                <div key={row.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <span title={row.name} style={{
                    width: 64, flexShrink: 0, paddingTop: 3, color: color.mutedForeground,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {row.name}
                  </span>
                  <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {row.tokens.map(t => (
                      <ChipButton
                        key={t.name}
                        swatch={{ token: t, all: [t] }}
                        size={20}
                        selected={matched?.name === t.name}
                        near={!matched && nearest?.token.name === t.name}
                        onHover={setHovered}
                        onPick={pickToken}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Token grid ─────────────────────────────────────────────────────────────

const COLS = 8;

function SwatchGrid({ swatches, selected, nearest, onHover, onPick }: {
  swatches: Swatch[];
  selected?: ColorToken;
  nearest?: ColorToken;
  onHover: (s: Swatch | null) => void;
  onPick: (t: ColorToken) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 5 }}>
      {swatches.map(sw => {
        const has = (x?: ColorToken) => !!x && sw.all.some(a => a.name === x.name);
        return (
          <ChipButton
            key={sw.token.name}
            swatch={sw}
            selected={has(selected)}
            near={!selected && has(nearest)}
            // Equal colours share a swatch; keep the applied token if it's one of them
            onPick={(t) => onPick(has(selected) && selected ? selected : t)}
            onHover={onHover}
          />
        );
      })}
    </div>
  );
}

function ChipButton({ swatch, size, selected, near, onHover, onPick }: {
  swatch: Swatch;
  /** Fixed size in px; omitted = fill the grid cell */
  size?: number;
  selected: boolean;
  near: boolean;
  onHover: (s: Swatch | null) => void;
  onPick: (t: ColorToken) => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const t = swatch.token;
  const names = swatch.all.map(a => a.label).join(', ');
  return (
    <button
      ref={ref}
      aria-label={names}
      title={`${names} · ${rgbaToHex(t.rgba)}`}
      onMouseEnter={() => onHover(swatch)}
      onFocus={() => onHover(swatch)}
      onClick={() => onPick(t)}
      style={{
        ...CHECKER, aspectRatio: '1', padding: 0, cursor: 'pointer', flexShrink: 0,
        ...(size ? { width: size, height: size } : { width: '100%' }),
        border: 'none', borderRadius: 5, overflow: 'hidden',
        outline: selected ? `2px solid ${ilse.orange}` : near ? `1.5px dashed ${ilse.orange}` : 'none',
        outlineOffset: 1.5,
      }}
    >
      <span style={{
        display: 'block', width: '100%', height: '100%', backgroundColor: css(t.rgba),
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)', borderRadius: 5,
      }} />
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', padding: 2, gap: 2, borderRadius: radius.sm, backgroundColor: color.muted }}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: '2px 8px', border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: font.sans,
            borderRadius: radius.sm - 3,
            backgroundColor: value === o.value ? color.background : 'transparent',
            color: value === o.value ? color.foreground : color.mutedForeground,
            boxShadow: value === o.value ? shadow.xs : 'none',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Picker ─────────────────────────────────────────────────────────────────

function Picker({ hsv, format, display, onHsv, onFormat, onTyped }: {
  hsv: HSVA;
  format: ColorFormat;
  display: string;
  onHsv: (next: HSVA) => void;
  onFormat: (f: ColorFormat) => void;
  onTyped: (input: string) => boolean;
}) {
  const [draft, setDraft] = useState(display);
  const [invalid, setInvalid] = useState(false);
  const typing = useRef(false);
  useEffect(() => { if (!typing.current) setDraft(display); }, [display]);

  const rgb = hsvToRgb({ ...hsv, a: 1 });
  const solid = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  const hueColor = `hsl(${hsv.h} 100% 50%)`;
  const Dropper = typeof window !== 'undefined'
    ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
    : undefined;

  const commit = () => {
    typing.current = false;
    if (draft.trim() === display) return;
    const ok = onTyped(draft);
    setInvalid(!ok);
    if (!ok) setDraft(display);
  };

  return (
    <div style={{ padding: PAD }}>
      {/* Saturation (x) × value (y) */}
      <DragArea
        onDrag={(x, y) => onHsv({ ...hsv, s: x, v: 1 - y })}
        style={{
          height: 156, borderRadius: radius.sm, marginBottom: 12,
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
        }}
      >
        <Thumb x={hsv.s} y={1 - hsv.v} fill={solid} size={14} />
      </DragArea>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {Dropper && (
          <button
            title={t('color.eyedropper')}
            aria-label={t('color.eyedropper')}
            onClick={async () => {
              try {
                const { sRGBHex } = await new Dropper().open();
                onTyped(sRGBHex);
              } catch { /* cancelled */ }
            }}
            style={{ ...boxed, width: 30, height: 30, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="m2 22 1-1h3l9-9" /><path d="M3 21v-3l9-9" />
              <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
            </svg>
          </button>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <DragArea
            onDrag={(x) => onHsv({ ...hsv, h: Math.min(359.9, x * 360) })}
            style={{
              height: 10, borderRadius: radius.full,
              background: 'linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)',
            }}
          >
            <Thumb x={hsv.h / 360} y={0.5} fill={hueColor} size={14} />
          </DragArea>
          <DragArea
            onDrag={(x) => onHsv({ ...hsv, a: Math.round(x * 100) / 100 })}
            style={{ ...CHECKER, height: 10, borderRadius: radius.full }}
          >
            <span style={{
              position: 'absolute', inset: 0, borderRadius: radius.full,
              background: `linear-gradient(to right, rgba(${rgb.r},${rgb.g},${rgb.b},0), ${solid})`,
            }} />
            <Thumb x={hsv.a} y={0.5} fill={`rgba(${rgb.r},${rgb.g},${rgb.b},${hsv.a})`} size={14} />
          </DragArea>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <select
          value={format}
          onChange={(e) => onFormat(e.target.value as ColorFormat)}
          style={{ ...boxed, width: 64, cursor: 'pointer' }}
        >
          {FORMATS.map(f => <option key={f} value={f}>{f === 'hex' ? 'Hex' : f.toUpperCase()}</option>)}
        </select>
        <div style={{
          ...boxed, flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 0 0 7px',
          borderColor: invalid ? color.destructive : color.border,
        }}>
          <span style={{ ...CHECKER, width: 14, height: 14, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
            <span style={{ display: 'block', width: '100%', height: '100%', backgroundColor: `rgba(${rgb.r},${rgb.g},${rgb.b},${hsv.a})`, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)', borderRadius: '50%' }} />
          </span>
          <input
            value={draft}
            spellCheck={false}
            aria-label={t('color.value')}
            onFocus={() => { typing.current = true; }}
            onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            style={{ ...bare, flex: 1, minWidth: 0, fontFamily: font.mono, fontSize: 10 }}
          />
          <span style={{ alignSelf: 'stretch', width: 1, backgroundColor: color.border }} />
          <input
            value={Math.round(hsv.a * 100)}
            aria-label={t('color.opacity')}
            inputMode="numeric"
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^\d]/g, ''));
              if (!Number.isNaN(n)) onHsv({ ...hsv, a: Math.min(100, n) / 100 });
            }}
            style={{ ...bare, width: 26, textAlign: 'right', fontFamily: font.mono, fontSize: 10 }}
          />
          <span style={{ color: color.mutedForeground, fontSize: 10, paddingRight: 7 }}>%</span>
        </div>
      </div>
    </div>
  );
}

/** A 2D (or 1D) pointer surface reporting 0–1 coordinates while dragged. */
function DragArea({ onDrag, style, children }: {
  onDrag: (x: number, y: number) => void;
  style: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const report = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    onDrag(x, y);
  };
  return (
    <div
      ref={ref}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); report(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) report(e); }}
      style={{ position: 'relative', cursor: 'crosshair', touchAction: 'none', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)', ...style }}
    >
      {children}
    </div>
  );
}

function Thumb({ x, y, fill, size }: { x: number; y: number; fill: string; size: number }) {
  return (
    <span style={{
      position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`,
      width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, borderRadius: '50%',
      border: '2.5px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.15), 0 1px 4px rgba(0,0,0,0.25)',
      backgroundColor: fill, pointerEvents: 'none', boxSizing: 'border-box',
    }} />
  );
}

// ── Shared styles ──────────────────────────────────────────────────────────

const boxed: React.CSSProperties = {
  height: 28, boxSizing: 'border-box', fontSize: 11, fontFamily: font.sans, padding: '0 6px',
  borderRadius: radius.sm - 2, border: `1px solid ${color.border}`,
  backgroundColor: color.background, color: color.foreground, outline: 'none',
};

const bare: React.CSSProperties = {
  border: 'none', outline: 'none', background: 'none', padding: 0, height: '100%',
  color: color.foreground,
};

const linkButton: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
  fontSize: 11, fontFamily: font.sans, color: ilse.orange, fontWeight: 500,
};

const groupLabel: React.CSSProperties = {
  fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: color.mutedForeground, marginBottom: 5,
};
