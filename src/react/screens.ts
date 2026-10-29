/**
 * Screens mode — the same page in an iframe at a device's width, one at a time.
 *
 * Ilse lives inside the page, so it can't resize the browser the way an
 * editor with its own browser can. An iframe on the same address and origin
 * keeps the login and cookies, and its media queries answer to the frame's
 * real width. The Ilse inside the frame runs "embedded": select and edit,
 * no toolbar; the host's Screens bar sends it Run / Undo.
 */

export type DeviceKind = 'phone' | 'tablet' | 'desktop';

export interface Device { id: string; label: string; kind: DeviceKind; width: number; height: number }

export const DEVICES: readonly Device[] = [
  { id: 'iphone-15', label: 'iPhone 15', kind: 'phone', width: 390, height: 844 },
  { id: 'ipad-mini', label: 'iPad Mini', kind: 'tablet', width: 768, height: 1024 },
  { id: 'desktop', label: 'Desktop', kind: 'desktop', width: 1280, height: 800 },
];

/** The iframe's name: how the Ilse inside it knows it runs embedded. */
export const EMBED_FRAME_NAME = 'ilse-embed';

export function deviceById(id: string | null | undefined): Device {
  return DEVICES.find(d => d.id === id) ?? DEVICES[0];
}

/** Only phones turn to landscape — a tablet or desktop width is the layout being checked. */
export function canRotate(device: Device): boolean {
  return device.kind === 'phone';
}

export function frameSize(device: Device, landscape: boolean): { width: number; height: number } {
  return landscape && canRotate(device)
    ? { width: device.height, height: device.width }
    : { width: device.width, height: device.height };
}

/**
 * Scale that fits the frame in the stage, never above 1:1. The width is what
 * matters (it drives the media queries); a tall frame scrolls in the stage instead
 * of shrinking a desktop to a stamp.
 */
export function fitScale(frameWidth: number, stageWidth: number): number {
  if (frameWidth <= 0 || stageWidth <= 0) return 1;
  return Math.min(1, stageWidth / frameWidth);
}

/** Free size from the resize handles: kept inside what a screen can sensibly be. */
export function clampSize(width: number, height: number): { width: number; height: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));
  return { width: clamp(width, 240, 2560), height: clamp(height, 240, 4000) };
}

export interface Tick { pos: number; major: boolean; label?: string }

/**
 * Ruler ticks in the frame's own pixels: a short tick every `step`, a labelled
 * one every `labelEvery`. Steps widen when the frame is scaled down so labels
 * don't collide.
 */
export function rulerTicks(length: number, scale = 1): Tick[] {
  const step = scale < 0.6 ? 20 : 10;
  const labelEvery = scale < 0.6 ? 200 : scale < 0.9 ? 100 : 50;
  const ticks: Tick[] = [];
  for (let pos = 0; pos <= length; pos += step) {
    const major = pos % labelEvery === 0;
    ticks.push(major ? { pos, major, label: String(pos) } : { pos, major });
  }
  return ticks;
}

/** A selection as the embedded Ilse reports it: viewport pixels inside the frame. */
export interface FrameRect { x: number; y: number; width: number; height: number }

// ── Messages between the host and the embedded Ilse ────────────────────────
// postMessage on the same origin; both sides check source and origin.

/** The toolbar's actions, in its order — the Screens bar repeats them for the Ilse in the frame. */
export const SCREENS_ACTIONS = ['run', 'stop', 'undo', 'select', 'pencil', 'catalog', 'pause', 'markers', 'clear'] as const;
export type ScreensAction = typeof SCREENS_ACTIONS[number];

/** What the Screens bar needs to draw the pill as the toolbar would. */
export interface EmbedState {
  pending: number; processing: number; undo: number; notes: number;
  selecting: boolean; drawing: boolean; catalog: boolean; paused: boolean; markers: boolean; clearConfirm: boolean;
}

export const EMBED_IDLE: EmbedState = {
  pending: 0, processing: 0, undo: 0, notes: 0,
  selecting: true, drawing: false, catalog: false, paused: false, markers: true, clearConfirm: false,
};

export type HostToEmbed = { ilseScreens: 'action'; action: ScreensAction };

export type EmbedToHost =
  | { ilseScreens: 'state'; state: EmbedState }
  | { ilseScreens: 'selection'; rect: FrameRect | null }
  | { ilseScreens: 'close' };

export function isEmbedToHost(data: unknown): data is EmbedToHost {
  if (!data || typeof data !== 'object') return false;
  const kind = (data as { ilseScreens?: unknown }).ilseScreens;
  return kind === 'state' || kind === 'selection' || kind === 'close';
}

export function isHostToEmbed(data: unknown): data is HostToEmbed {
  if (!data || typeof data !== 'object') return false;
  const m = data as { ilseScreens?: unknown; action?: unknown };
  return m.ilseScreens === 'action' && (SCREENS_ACTIONS as readonly unknown[]).includes(m.action);
}

/**
 * Is this Ilse running inside the Screens iframe? The frame's name says so,
 * and the parent must be on the same origin — a page that frames itself for
 * its own reasons never turns the toolbar off.
 */
export function isEmbedded(win: Window = window): boolean {
  try {
    return win.self !== win.top && win.name === EMBED_FRAME_NAME && win.parent.location.origin === win.location.origin;
  } catch {
    return false; // cross-origin parent: reading its location throws
  }
}

/** Computed once: the frame's name is set before the page inside it loads. */
export const EMBEDDED = typeof window !== 'undefined' && isEmbedded();

/** Height of the Screens bar: the embedded panel docks below it. */
export const SCREENS_BAR_H = 56;

/**
 * Where Ilse's panels render. Embedded, the panel goes out to the host page
 * (same origin, so React renders there fine) — inside a 390px frame it would
 * cover the very layout being adjusted. The element it edits stays in the frame.
 */
export function uiDocument(): Document { return EMBEDDED ? window.parent.document : document; }
export function uiWindow(): Window { return EMBEDDED ? window.parent : window; }

/** Panels from the frame sit above the host's Screens view. */
export function uiLayer(z: number): number { return EMBEDDED ? z + 10 : z; }
