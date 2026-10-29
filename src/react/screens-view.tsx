/**
 * Screens mode UI — the device menu on the toolbar, the full-screen view with
 * the page in an iframe and rulers, and the embedded side that answers it.
 * The logic (devices, scale, ticks, messages) lives in screens.ts.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconArrowLeft, IconDeviceDesktop, IconDeviceMobile, IconDeviceTablet, IconRotate, IconRuler2 } from '@tabler/icons-react';
import { DEVICES, EMBED_FRAME_NAME, SCREENS_BAR_H, canRotate, clampSize, deviceById, fitScale, frameSize, isEmbedToHost, isHostToEmbed, rulerTicks, type Device, type EmbedState, type EmbedToHost, type FrameRect, type ScreensAction } from './screens.js';
import { color, font, ilse, radius, shadow } from './tokens.js';
import { t } from '../i18n/index.js';

const DEVICE_KEY = 'ilse-screens-device';
const RULERS_KEY = 'ilse-screens-rulers';
const RULER = 20;
const GRIP = 10;
// Ilse's orange marks what is on: the device in use, rulers, select mode
const ON_BG = 'rgba(255,108,3,0.12)';

// Per-viewer conveniences: storage can be missing (private window), never required
function load(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* not kept */ }
}

export function lastDevice(): Device { return deviceById(load(DEVICE_KEY)); }
export function rulersOn(): boolean { return load(RULERS_KEY) !== '0'; }

function DeviceIcon({ device, size = 16 }: { device: Device; size?: number }) {
  const Icon = device.kind === 'phone' ? IconDeviceMobile : device.kind === 'tablet' ? IconDeviceTablet : IconDeviceDesktop;
  return <Icon size={size} stroke={1.75} />;
}

// ── Menu above the toolbar: pick a device, rulers on/off ───────────────────

export function ScreensMenu({ align, onOpen }: { align: 'left' | 'right'; onOpen: (device: Device, rulers: boolean) => void }) {
  const [rulers, setRulers] = useState(rulersOn);
  const current = lastDevice();
  return (
    <div data-ilse-above="" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{
      position: 'absolute', bottom: 'calc(100% + 8px)', [align]: 0,
      backgroundColor: color.popover, border: `1px solid ${color.border}`, borderRadius: 10, padding: 6,
      width: 240, boxShadow: shadow.lg, color: color.foreground, fontSize: 12, fontFamily: font.sans,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: color.mutedForeground, padding: '4px 6px 6px' }}>{t('screens.title')}</div>
      {DEVICES.map(d => {
        const on = d.id === current.id;
        return (
          <button key={d.id} onClick={() => onOpen(d, rulers)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 6px', border: 'none', borderRadius: 6,
              background: on ? ON_BG : 'none', cursor: 'pointer', fontFamily: font.sans, fontSize: 12,
              color: on ? ilse.orange : color.foreground, textAlign: 'left',
            }}>
            <DeviceIcon device={d} />
            <span style={{ flex: 1 }}>{d.label}</span>
            <span style={{ color: on ? ilse.orange : color.mutedForeground, fontFamily: font.mono, fontSize: 11 }}>{d.width} × {d.height}</span>
          </button>
        );
      })}
      <div style={{ height: 1, background: color.border, margin: '6px 0' }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer' }}>
        <input type="checkbox" checked={rulers} style={{ accentColor: ilse.orange }} onChange={(e) => { setRulers(e.target.checked); save(RULERS_KEY, e.target.checked ? '1' : '0'); }} />
        {t('screens.rulers')}
      </label>
    </div>
  );
}

// ── The full-screen view ───────────────────────────────────────────────────

type Edge = 'x' | 'y' | 'xy';

/**
 * The toolbar stays on top of this view and drives the frame: it gets the frame's
 * state through `onState` and sends its actions through `actRef`.
 */
export function ScreensView({ initialDevice, initialRulers, onClose, onState, actRef }: {
  initialDevice: Device; initialRulers: boolean; onClose: () => void;
  onState: (state: EmbedState) => void;
  actRef: React.MutableRefObject<((action: ScreensAction) => void) | null>;
}) {
  const [device, setDevice] = useState(initialDevice);
  const [landscape, setLandscape] = useState(false);
  // Set by the resize handles; a device button goes back to that device's size
  const [custom, setCustom] = useState<{ width: number; height: number } | null>(null);
  const [rulers, setRulers] = useState(initialRulers);
  const [stageWidth, setStageWidth] = useState(0);
  const [selection, setSelection] = useState<FrameRect | null>(null);
  const [blocked, setBlocked] = useState(false);
  // While dragging a handle the scale holds still, so the edge stays under the pointer
  const [dragScale, setDragScale] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Loaded once: switching device resizes the same frame, so scroll and state stay
  const [src] = useState(() => location.href);

  const size = custom ?? frameSize(device, landscape);
  const gutter = rulers ? RULER : 0;
  const fitted = fitScale(size.width, stageWidth - gutter - GRIP - 48);
  const scale = dragScale ?? fitted;

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageWidth(el.clientWidth));
    ro.observe(el);
    setStageWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // The page underneath doesn't scroll behind the view
  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow || e.origin !== location.origin || !isEmbedToHost(e.data)) return;
      const m: EmbedToHost = e.data;
      if (m.ilseScreens === 'state') onState(m.state);
      else if (m.ilseScreens === 'selection') setSelection(m.rect);
      else onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The embedded panel lives in this document: the Ilse in the frame hears this Esc and closes it first
      if (document.querySelector('[data-ilse-panel]')) return;
      e.stopImmediatePropagation(); onClose();
    };
    window.addEventListener('message', onMsg);
    document.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('message', onMsg); document.removeEventListener('keydown', onKey, true); };
  }, [onClose, onState]);

  useEffect(() => {
    actRef.current = (action) => frameRef.current?.contentWindow?.postMessage({ ilseScreens: 'action', action }, location.origin);
    return () => { actRef.current = null; };
  }, [actRef]);

  const pick = (d: Device) => { setDevice(d); setCustom(null); save(DEVICE_KEY, d.id); if (!canRotate(d)) setLandscape(false); };
  const toggleRulers = () => setRulers(r => { save(RULERS_KEY, r ? '0' : '1'); return !r; });

  // A frame the app forbids (X-Frame-Options / frame-ancestors) loads the browser's error page,
  // which is cross-origin: reading its location throws
  const onLoad = () => {
    try { setBlocked(!frameRef.current?.contentWindow?.location.href); } catch { setBlocked(true); }
  };

  const startResize = (edge: Edge) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const s = scale, w0 = size.width, h0 = size.height, x0 = e.clientX, y0 = e.clientY;
    // The frame is centred while it fits: its right edge moves half the width change
    const xFactor = (w0 * s + gutter) < (stageRef.current?.clientWidth ?? 0) - 48 ? 2 : 1;
    setDragScale(s);
    const move = (m: PointerEvent) => {
      const w = edge === 'y' ? w0 : w0 + (m.clientX - x0) * xFactor / s;
      const h = edge === 'x' ? h0 : h0 + (m.clientY - y0) / s;
      setCustom(clampSize(w, h));
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      setDragScale(null);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  };

  const btn = (on = false, disabled = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 30, minWidth: 30, padding: '0 8px',
    border: 'none', borderRadius: 8, position: 'relative', fontFamily: font.sans, fontSize: 12,
    background: on ? ON_BG : 'none', color: disabled ? '#c0c0c0' : on ? ilse.orange : color.foreground,
    cursor: disabled ? 'default' : 'pointer', transition: 'background 0.15s, color 0.15s',
  });
  const group: React.CSSProperties = { display: 'inline-flex', gap: 2, padding: 2, borderRadius: 10, background: '#f2f2f2' };

  return createPortal(
    <div data-ilse-toolbar role="dialog" aria-label={t('screens.title')} style={{
      position: 'fixed', inset: 0, zIndex: 100000, display: 'flex', flexDirection: 'column',
      background: '#ececec', fontFamily: font.sans, color: color.foreground,
    }}>
      {/* Bar */}
      <div style={{
        position: 'relative', height: SCREENS_BAR_H, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px',
        background: color.background, borderBottom: `1px solid ${color.border}`,
      }}>
        <button title={t('screens.exit')} onClick={onClose} style={btn()}>
          <IconArrowLeft size={16} stroke={1.75} />
        </button>

        {/* Centred on the page, like a device picker sits over what it shows */}
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Devices side by side; none lit while the size is free */}
        <div role="radiogroup" aria-label={t('screens.device')} style={group}>
          {DEVICES.map(d => {
            const on = !custom && d.id === device.id;
            return (
              <button key={d.id} role="radio" aria-checked={on} title={`${d.label} · ${d.width} × ${d.height}`} onClick={() => pick(d)}
                style={{ ...btn(on), background: on ? '#ffffff' : 'none', boxShadow: on ? '0 1px 2px rgba(0,0,0,0.12)' : 'none' }}>
                <DeviceIcon device={d} />
              </button>
            );
          })}
        </div>
        <span style={{ fontFamily: font.mono, fontSize: 11, color: custom ? ilse.orange : color.mutedForeground, minWidth: 96 }}>
          {custom ? `${t('screens.free')} · ` : ''}{size.width} × {size.height}{scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}
        </span>
        {canRotate(device) && !custom && (
          <button title={t('screens.rotate')} aria-pressed={landscape} onClick={() => setLandscape(l => !l)} style={btn(landscape)}>
            <IconRotate size={16} stroke={1.75} />
          </button>
        )}
        <button title={t('screens.rulers')} aria-pressed={rulers} onClick={toggleRulers} style={btn(rulers)}>
          <IconRuler2 size={16} stroke={1.75} />
        </button>
        </div>
      </div>

      {/* Stage — auto margins centre the frame and still let a wide one scroll */}
      <div ref={stageRef} style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', alignItems: 'flex-start' }}>
        {blocked ? (
          <div style={{ margin: '80px auto 0', maxWidth: 360, padding: 16, background: color.background, borderRadius: radius.md, boxShadow: shadow.md, fontSize: 13, lineHeight: 1.5 }}>
            {t('screens.blocked')}
          </div>
        ) : (
          <div style={{ position: 'relative', flexShrink: 0, margin: '0 auto', paddingTop: gutter, paddingLeft: gutter, paddingRight: GRIP, paddingBottom: GRIP }}>
            {rulers && <Ruler axis="x" length={size.width} scale={scale} band={selection ? [selection.x, selection.width] : null} />}
            {rulers && <Ruler axis="y" length={size.height} scale={scale} band={selection ? [selection.y, selection.height] : null} />}
            {rulers && <div style={{ position: 'absolute', top: 0, left: 0, width: RULER, height: RULER, background: color.background, borderRight: `1px solid ${color.border}`, borderBottom: `1px solid ${color.border}` }} />}
            <div style={{ width: size.width * scale, height: size.height * scale, overflow: 'hidden', background: '#fff', boxShadow: shadow.lg }}>
              <iframe
                ref={frameRef}
                name={EMBED_FRAME_NAME}
                src={src}
                // aria-label, not title: Ilse's tooltip layer takes over any `title` in its UI — the frame's would stick
                aria-label={`${device.label} ${size.width} × ${size.height}`}
                onLoad={onLoad}
                style={{
                  width: size.width, height: size.height, border: 'none', display: 'block',
                  transform: `scale(${scale})`, transformOrigin: '0 0',
                  // The frame would swallow the pointer mid-drag
                  pointerEvents: dragScale !== null ? 'none' : undefined,
                }}
              />
            </div>
            <Grip edge="x" dragging={dragScale !== null} onPointerDown={startResize('x')} style={{ top: gutter, right: 0, width: GRIP, height: size.height * scale }} />
            <Grip edge="y" dragging={dragScale !== null} onPointerDown={startResize('y')} style={{ left: gutter, bottom: 0, width: size.width * scale, height: GRIP }} />
            <Grip edge="xy" dragging={dragScale !== null} onPointerDown={startResize('xy')} style={{ right: 0, bottom: 0, width: GRIP + 6, height: GRIP + 6 }} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A resize handle along the frame's right or bottom edge (or its corner); shows on hover. */
function Grip({ edge, dragging, onPointerDown, style }: { edge: Edge; dragging: boolean; onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void; style: React.CSSProperties }) {
  const [hover, setHover] = useState(false);
  const lit = hover || dragging;
  const x = edge === 'x';
  return (
    <div
      title={t('screens.resize')}
      onPointerDown={onPointerDown}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: 'absolute', ...style, touchAction: 'none', zIndex: edge === 'xy' ? 2 : 1,
        cursor: edge === 'x' ? 'ew-resize' : edge === 'y' ? 'ns-resize' : 'nwse-resize',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {edge !== 'xy' && (
        <div style={{
          width: x ? 4 : 40, height: x ? 40 : 4, borderRadius: 2,
          background: lit ? ilse.orange : 'rgba(0,0,0,0.18)', transition: 'background 0.15s',
        }} />
      )}
    </div>
  );
}

/** Ticks in frame pixels; the band is the selection's span on this axis. */
function Ruler({ axis, length, scale, band }: { axis: 'x' | 'y'; length: number; scale: number; band: [number, number] | null }) {
  const x = axis === 'x';
  return (
    <div aria-hidden style={{
      position: 'absolute', top: x ? 0 : RULER, left: x ? RULER : 0,
      width: x ? length * scale : RULER, height: x ? RULER : length * scale,
      background: color.background, overflow: 'hidden', fontFamily: font.mono, fontSize: 9, color: color.mutedForeground,
      [x ? 'borderBottom' : 'borderRight']: `1px solid ${color.border}`,
    }}>
      {band && band[1] > 0 && (
        <div style={{
          position: 'absolute', background: ON_BG,
          [x ? 'left' : 'top']: band[0] * scale, [x ? 'width' : 'height']: band[1] * scale,
          [x ? 'top' : 'left']: 0, [x ? 'height' : 'width']: RULER,
          [x ? 'borderLeft' : 'borderTop']: `1px solid ${ilse.orange}`, [x ? 'borderRight' : 'borderBottom']: `1px solid ${ilse.orange}`,
        }} />
      )}
      {rulerTicks(length, scale).map(tk => (
        <div key={tk.pos} style={{ position: 'absolute', [x ? 'left' : 'top']: tk.pos * scale }}>
          <div style={{
            position: 'absolute', background: '#b5b5b5',
            ...(x ? { left: 0, top: RULER - (tk.major ? 8 : 4), width: 1, height: tk.major ? 8 : 4 }
                  : { top: 0, left: RULER - (tk.major ? 8 : 4), height: 1, width: tk.major ? 8 : 4 }),
          }} />
          {tk.label && (
            <span style={x
              ? { position: 'absolute', left: 2, top: 1 }
              : { position: 'absolute', top: 2, left: 1, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              {tk.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Embedded side: the Ilse inside the frame ───────────────────────────────

/**
 * Keeps the host's Screens bar in sync and takes its actions (the toolbar's own).
 * The selected element's box goes up for the rulers, followed while the page scrolls.
 */
export function useScreensEmbed(on: boolean, s: { state: EmbedState; selectedId?: string; act: (action: ScreensAction) => void }): void {
  const act = useRef(s.act);
  act.current = s.act;
  const post = (m: EmbedToHost) => { try { window.parent.postMessage(m, location.origin); } catch { /* host gone */ } };

  useEffect(() => {
    if (!on) return;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window.parent || e.origin !== location.origin || !isHostToEmbed(e.data)) return;
      act.current(e.data.action);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [on]);

  const key = JSON.stringify(s.state);
  useEffect(() => {
    if (on) post({ ilseScreens: 'state', state: s.state });
  }, [on, key]);

  useEffect(() => {
    if (!on) return;
    if (!s.selectedId) { post({ ilseScreens: 'selection', rect: null }); return; }
    let last = '';
    let frame = 0;
    const tick = () => {
      const el = document.querySelector(`[data-ilse-pixel-target="${s.selectedId}"]`);
      const r = el?.getBoundingClientRect();
      const rect = r ? { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null;
      const k = JSON.stringify(rect);
      if (k !== last) { last = k; post({ ilseScreens: 'selection', rect }); }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [on, s.selectedId]);
}

/** Esc with nothing left to close inside the frame leaves Screens mode. */
export function leaveScreens(): void {
  try { window.parent.postMessage({ ilseScreens: 'close' } satisfies EmbedToHost, location.origin); } catch { /* host gone */ }
}
