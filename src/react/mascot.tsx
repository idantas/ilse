/**
 * Ilse's mascot — shown whenever Ilse talks to the designer: a question, a
 * status, the steps of what she's doing. Design mode is an orange squircle, test
 * mode a blue octagon, both hand-drawn: the outline is redrawn a few times a
 * second with a little jitter, so it "boils" like frame-by-frame animation.
 *
 * What she does is a reaction: how the body moves, where she looks, her eyes,
 * mouth, and a prop (a keyboard, a magnifier, a sleep bubble, a
 * thought cloud). The mode and state pick one; toasts can ask for their own.
 *
 * Below DETAIL_AT px the props turn into simple silhouettes with heavy lines,
 * and the outline boils less, so she still reads at 21px in the toolbar.
 *
 * One canvas per mascot, one shared animation loop, no dependencies. Still
 * under prefers-reduced-motion; stops drawing when off screen.
 */

import { useEffect, useRef } from 'react';
import { modeAccent } from './tokens.js';

export type MascotMode = 'design' | 'test';
/**
 * idle: breathes, blinks, follows the pointer · working: design types on a
 * keyboard, test looks through a magnifier and nods · done: a happy hop with
 * sparkles when the work lands · asleep: now and then a sleep bubble grows
 * until it pops, she wakes, shakes her head and falls asleep again
 */
export type MascotState = 'idle' | 'working' | 'done' | 'asleep';
/** What the agent is doing while she works: she types only while it edits */
export type MascotActivity = 'edit' | 'think';
/** What a toast asks of her (toasts are idle otherwise) */
export type MascotReaction = 'say' | 'copied' | 'oops' | 'failed' | 'queued' | 'conflict' | 'nothing-left' | 'recentered';

type Motion = 'breathe-hop' | 'breathe' | 'hop-loop' | 'sleep' | 'bounce' | 'shake' | 'tilt' | 'typing' | 'nod';
type Gaze = 'pointer' | 'lens' | 'center' | 'keys';
type Eyes = 'dots' | 'closed' | 'squint' | 'happy';
type Mouth = 'none' | 'smile-o' | 'smirk' | 'grin';
type Extra = 'none' | 'typing' | 'lens' | 'bubble' | 'clock';
interface Look {
  motion: Motion; gaze: Gaze; eyes: Eyes; mouth: Mouth; extra: Extra;
  /** Hop height, ×1 */
  amp: number;
  /** Jitter of the outline, ×1 */
  boil: number;
  /** Outline redraws per second */
  fps: number;
  blink: boolean;
}

const BASE: Look = { motion: 'breathe-hop', gaze: 'pointer', eyes: 'dots', mouth: 'none', extra: 'none', amp: 1, boil: 1, fps: 6, blink: true };
const TOAST: Record<MascotReaction, Partial<Look>> = {
  say: {},
  copied: { motion: 'hop-loop' },
  oops: { motion: 'tilt' },
  failed: { motion: 'shake', boil: 1.5 },
  queued: { extra: 'clock' },
  conflict: { motion: 'tilt' },
  'nothing-left': { motion: 'breathe' },
  recentered: { motion: 'bounce' },
};

/** The look for a mode and state, or for a toast's reaction */
export function mascotLook(mode: MascotMode, state: MascotState, reaction?: MascotReaction): Look {
  if (state === 'asleep') return { ...BASE, motion: 'sleep', gaze: 'center', eyes: 'closed', extra: 'bubble', blink: false, fps: 3 };
  if (state === 'done') return { ...BASE, motion: 'breathe', gaze: 'center', eyes: 'happy', mouth: 'grin' };
  if (state === 'working') {
    return mode === 'design'
      // Typing, happy, eyes on the keys — or on the pointer when it moves
      ? { ...BASE, motion: 'typing', gaze: 'keys', eyes: 'happy', mouth: 'smirk', extra: 'typing' }
      // Looks through the magnifier, then at you, and nods: "yes, got it"
      : { ...BASE, motion: 'nod', gaze: 'lens', mouth: 'smile-o', extra: 'lens' };
  }
  if (reaction) return { ...BASE, ...TOAST[reaction] };
  return { ...BASE, amp: mode === 'design' ? 1.35 : 1 };
}

/** Per mode: the outline's weight and how much it boils */
const MODE_STYLE: Record<MascotMode, { stroke: number; boilAmp: number }> = {
  design: { stroke: 0.6, boilAmp: 8.5 },
  test: { stroke: 2, boilAmp: 6.5 },
};
/** Waking up: design opens her eyes first, then a big hop */
const WAKE: Record<MascotMode, { openFirst: boolean; amp: number }> = {
  design: { openFirst: true, amp: 1.75 },
  test: { openFirst: false, amp: 1 },
};

type Pt = [number, number];
const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (x: number) => x * x * (3 - 2 * x);

/** Rounded polygon: each corner cut by `f` and bent with a quadratic, so the shape stays readable */
function rounded(v: Pt[], f: number): Pt[] {
  return v.flatMap((q, i) => {
    const p = v[(i - 1 + v.length) % v.length], n = v[(i + 1) % v.length];
    const a: Pt = [lerp(q[0], p[0], f), lerp(q[1], p[1], f)], b: Pt = [lerp(q[0], n[0], f), lerp(q[1], n[1], f)];
    return Array.from({ length: 9 }, (_, k): Pt => {
      const t = k / 8, u = 1 - t;
      return [u * u * a[0] + 2 * u * t * q[0] + t * t * b[0], u * u * a[1] + 2 * u * t * q[1] + t * t * b[1]];
    });
  });
}

/** Evenly spaced points along a closed outline */
function resample(pts: Pt[], n: number): Pt[] {
  const d = [0];
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1], b = pts[i % pts.length];
    d.push(d[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = d[pts.length], out: Pt[] = [];
  let j = 0;
  for (let s = 0; s < n; s++) {
    const t = (s / n) * total;
    while (d[j + 1] < t) j++;
    const f = (t - d[j]) / (d[j + 1] - d[j] || 1), p = pts[j], q = pts[(j + 1) % pts.length];
    out.push([lerp(p[0], q[0], f), lerp(p[1], q[1], f)]);
  }
  return out;
}

/** The mode's outline in a 100×100 box, fitted to 82 units and centered on (50, 50) */
export function mascotOutline(mode: MascotMode): Pt[] {
  const raw = mode === 'test'
    ? rounded(Array.from({ length: 8 }, (_, i): Pt => { const a = Math.PI / 8 + (i / 8) * TAU; return [50 + 42 * Math.cos(a), 50 + 42 * Math.sin(a)]; }), 0.22)
    // Squircle: |x|⁴ + |y|⁴ = r⁴ — a square with continuous, soft corners
    : Array.from({ length: 240 }, (_, i): Pt => { const a = (i / 240) * TAU; const r = 40 / Math.pow(Math.abs(Math.cos(a)) ** 4 + Math.abs(Math.sin(a)) ** 4, 0.25); return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]; });
  const xs = raw.map(p => p[0]), ys = raw.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = 82 / Math.max(maxX - minX, maxY - minY);
  return resample(raw.map(([x, y]): Pt => [50 + (x - (minX + maxX) / 2) * k, 50 + (y - (minY + maxY) / 2) * k]), 160);
}
const OUTLINES: Record<MascotMode, Pt[]> = { design: mascotOutline('design'), test: mascotOutline('test') };

const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)));
  return '#' + c.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}
const smooth = (p: Pt[]): Pt[] => p.map((q, i): Pt => {
  const a = p[(i - 2 + p.length) % p.length], b = p[(i + 2) % p.length];
  return [(a[0] + q[0] * 2 + b[0]) / 4, (a[1] + q[1] * 2 + b[1]) / 4];
});
function trace(ctx: CanvasRenderingContext2D, pts: Pt[], dx = 0, dy = 0) {
  const n = pts.length, mid = (i: number): Pt => [(pts[i][0] + pts[(i + 1) % n][0]) / 2 + dx, (pts[i][1] + pts[(i + 1) % n][1]) / 2 + dy];
  ctx.beginPath();
  const s = mid(n - 1); ctx.moveTo(s[0], s[1]);
  for (let i = 0; i < n; i++) { const q = mid(i); ctx.quadraticCurveTo(pts[i][0] + dx, pts[i][1] + dy, q[0], q[1]); }
  ctx.closePath();
}

/** How far the eyes travel inside the body (in the 100-unit box): enough to read at 22px */
const EYE_X = 7, EYE_Y = 5.5;

/** 0 = smiling, 1 = "o": a 7 s cycle — smile for about 4.5 s, ease over, hold the "o", ease back */
export function surprise(t: number): number {
  const c = t % 7;
  if (c < 4.5) return 0;
  if (c < 5.1) return ease((c - 4.5) / 0.6);
  if (c < 6.3) return 1;
  return ease(1 - (c - 6.3) / 0.7);
}

/**
 * Asleep, a 9 s cycle: the bubble grows to about half her size (radius in
 * body units, null once it's gone), pops at 6.15 s; she wakes wide-eyed, shakes
 * her head, closes her eyes again by 7.9 s.
 */
export function sleepBubble(t: number): { radius: number | null; pop: number | null; eyes: 'closed' | 'wide' | 'open'; open: number; shake: number } {
  const c = t % 9;
  const radius = c < 6.15 ? 2 + 18 * ease(Math.min(1, c / 6)) : null;
  const pop = c >= 6.15 && c < 6.45 ? (c - 6.15) / 0.3 : null;
  if (c < 6.15 || c > 7.9) return { radius, pop, eyes: 'closed', open: 0, shake: 0 };
  const k = (c - 6.6) / 0.8;
  return {
    radius, pop,
    eyes: c < 6.6 ? 'wide' : 'open',
    open: c > 7.5 ? 1 - ease((c - 7.5) / 0.4) : 1,
    shake: c > 6.6 && c < 7.4 ? Math.sin(k * TAU * 2.5) * 0.14 * (1 - k) : 0,
  };
}

/** Testing, a 5 s cycle: the nod's depth (0–1) — twice, between 3.5 s and 4.7 s */
export function nod(t: number): number {
  const c = t % 5;
  return c > 3.5 && c < 4.7 ? Math.max(0, Math.sin(((c - 3.5) / 1.2) * TAU * 2)) : 0;
}

/** Testing: where the magnifier is (body units) and where she looks — through it, then at you while she nods */
export function lensGaze(t: number): { lens: Pt; look: Pt } {
  const lens: Pt = [100 + Math.sin(t * 1.2) * 5, 50 + Math.cos(t * 0.9) * 4];
  const look: Pt = t % 5 < 3.3
    ? [EYE_X * (0.75 + Math.sin(t * 1.2) * 0.2), EYE_Y * (0.1 + Math.cos(t * 0.9) * 0.35)]
    : [0, 0.5 + nod(t) * 2.5];
  return { lens, look };
}

/** Below this slot size (px) the props are simple silhouettes and the outline boils less */
export const DETAIL_AT = 40;
/** Asleep, the bubble comes once every this many seconds: often enough to show she's there, rare enough not to compete with the mode that's on */
export const SLEEP_EVERY = 30;
/** Seconds into the 9 s bubble sequence, or null while she just sleeps — `elapsed` counts from her sleep's start */
export function sleepPhase(elapsed: number): number | null {
  const s = (((elapsed % SLEEP_EVERY) + SLEEP_EVERY) % SLEEP_EVERY) - (SLEEP_EVERY - 9);
  return s >= 0 ? s : null;
}
/** How much the outline boils at a slot size: held back when small, so the edge stays crisp */
export const boilScale = (size: number) => Math.max(0.35, Math.min(1, size / 64));

/** The keyboard, seen from above-front: a trapezoid, staggered rows, a space bar (drawing-space units) */
const KB = (() => {
  const rows = [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.6], [1.3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.3], [1.6, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2], [1.3, 1.3, 7.4, 1.3, 1.3]];
  const keys: { r: number; u0: number; u1: number; space: boolean }[] = [];
  rows.forEach((row, r) => {
    const total = row.reduce((a, b) => a + b, 0);
    let u = 0;
    for (const w of row) { keys.push({ r, u0: u / total, u1: (u + w) / total, space: w > 5 }); u += w; }
  });
  const idx = keys.map((_, i) => i), mid = (i: number) => (keys[i].u0 + keys[i].u1) / 2;
  return {
    keys, rows: rows.length,
    left: idx.filter(i => keys[i].r < 3 && mid(i) < 0.5), right: idx.filter(i => keys[i].r < 3 && mid(i) >= 0.5),
    space: idx.find(i => keys[i].space)!, home: [27, 32],
    cx: 70, yTop: 97, yBot: 112.5, wTop: 70, wBot: 88, lip: 3.4,
  };
})();
const kbAt = (u: number, v: number): Pt => [KB.cx + (u - 0.5) * lerp(KB.wTop, KB.wBot, v), lerp(KB.yTop, KB.yBot, v)];
function kbQuad(i: number, inset = 0): Pt[] {
  const k = KB.keys[i], rh = 0.84 / KB.rows;
  const v0 = 0.09 + k.r * rh + rh * 0.09 + inset, v1 = 0.09 + (k.r + 1) * rh - rh * 0.09 - inset;
  const u0 = 0.04 + k.u0 * 0.92 + 0.0045 + inset * 0.3, u1 = 0.04 + k.u1 * 0.92 - 0.0045 - inset * 0.3;
  return [kbAt(u0, v0), kbAt(u1, v0), kbAt(u1, v1), kbAt(u0, v1)];
}
const kbCenter = (i: number): Pt => { const q = kbQuad(i); return [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4]; };
/** One strike every KB_STEP s, hands alternating; a hand spends KB_HIT of its turn pressing, the rest moving to its next key */
const KB_STEP = 0.16, KB_HIT = 0.34;
/** The key of strike `n`: even strikes are the left hand's, odd the right's, which now and then hits the space bar */
const kbKey = (n: number) => {
  const right = n % 2 === 1;
  if (right && hash(n, 4.2) > 0.84) return KB.space;
  const pool = right ? KB.right : KB.left;
  return pool[Math.floor(hash(n, 1.7) * pool.length)];
};
export interface Typing {
  hands: { x: number; y: number; depth: number; side: -1 | 1 }[];
  /** Key index → how lit it is (0–1) */
  glow: Map<number, number>;
  /** How hard the latest strike lands (body dips with it), and which hand leads (body leans to it) */
  beat: number;
  lean: number;
}
/** Hands and lit keys at time `t`, for an amount of typing `on`: 0 rests the hands on the home keys, 1 types */
export function keyboardTyping(t: number, on: number): Typing {
  const f = Math.floor(t / KB_STEP), glow = new Map<number, number>(), hands: Typing['hands'] = [];
  for (const s of [0, 1]) {
    const n = f - (((f - s) % 2) + 2) % 2, q = (t - n * KB_STEP) / (2 * KB_STEP);
    const from = kbCenter(kbKey(n)), to = kbCenter(kbKey(n + 2)), home = kbCenter(KB.home[s]);
    const depth = q < KB_HIT ? Math.sin((q / KB_HIT) * Math.PI) : 0, travel = q < KB_HIT ? 0 : ease((q - KB_HIT) / (1 - KB_HIT));
    const lift = q < KB_HIT ? 0 : Math.sin(travel * Math.PI) * 1.6;
    hands.push({
      x: lerp(home[0], lerp(from[0], to[0], travel), on),
      y: lerp(home[1] - 5, lerp(from[1], to[1], travel) - 3.4 - lift + depth * 2.6, on),
      depth: depth * on, side: s ? 1 : -1,
    });
    const after = q < KB_HIT ? depth : Math.max(0, 1 - (q - KB_HIT) / 0.45) * 0.55;
    if (on > 0.3) glow.set(kbKey(n), Math.max(glow.get(kbKey(n)) ?? 0, after * on));
  }
  return { hands, glow, beat: Math.max(hands[0].depth, hands[1].depth), lean: hands[1].depth - hands[0].depth };
}

interface Mascot {
  canvas: HTMLCanvasElement;
  mode: MascotMode;
  state: MascotState;
  reaction?: MascotReaction;
  /** Gray instead of the mode's colour — the mode that isn't on */
  muted: boolean;
  seed: number;
  look: Pt;
  target: Pt;
  nextWander: number;
  blinkAt: number;
  visible: boolean;
  /** A hop in progress (start time), its height, and when the next idle one comes */
  jump: number | null;
  jumpAmp: number | null;
  jumpAt: number;
  /** Waking with her eyes opening first: when that started */
  wakeAt: number | null;
  /** Units of headroom above the drawing space (for the thought cloud) */
  headroom: number;
  /** The slot's size in px: picks the level of detail */
  size: number;
  activity: MascotActivity;
  /** CSS selector of what's being changed: she glances at it while typing */
  focus?: string;
  /** When the state last changed (for the done sparkles) */
  stateAt: number;
  /** When her sleep's clock started: the bubble comes every SLEEP_EVERY s from here */
  sleepOff: number;
  /** The prop on screen and how far in it is (0–1): the old one leaves before the new one comes */
  prop: { kind: 'none' | 'keyboard' | 'lens'; p: number };
  /** How much she's typing (0–1), eased toward the agent's activity */
  typeOn: number;
  last: number;
}

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const live = new Set<Mascot>();
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
let pointer: Pt | null = null;
/** When the pointer last moved: while typing she looks up at it only if it just moved */
let pointerAt = -Infinity;
let looping = false;
let observer: IntersectionObserver | null = null;

function draw(m: Mascot, now: number) {
  const ctx = m.canvas.getContext('2d');
  if (!ctx) return;
  const cssW = m.canvas.clientWidth || 24, cssH = m.canvas.clientHeight || cssW, dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (m.canvas.width !== Math.round(cssW * dpr) || m.canvas.height !== Math.round(cssH * dpr)) { m.canvas.width = Math.round(cssW * dpr); m.canvas.height = Math.round(cssH * dpr); }
  const g = mascotLook(m.mode, m.state, m.reaction), style = MODE_STYLE[m.mode];
  const t = now + m.seed * 10, dt = Math.min(0.1, Math.max(0, now - m.last));
  m.last = now;
  const color = m.muted ? '#A3A3A8' : modeAccent(m.mode).hex;
  const detail = m.size >= DETAIL_AT;

  // The prop leaves before the next one comes: the keyboard sinks, the magnifier drops away
  const want = g.extra === 'typing' ? 'keyboard' : g.extra === 'lens' ? 'lens' : 'none';
  if (reduce) m.prop = { kind: want, p: 1 };
  else if (m.prop.kind !== want) { m.prop.p -= dt / 0.3; if (m.prop.p <= 0 || m.prop.kind === 'none') m.prop = { kind: want, p: 0 }; }
  else if (want !== 'none') m.prop.p = Math.min(1, m.prop.p + dt / 0.45);
  const enter = ease(clamp01(m.prop.p));

  // She types while the agent edits and rests her hands while it thinks
  const thinking = m.state === 'working' && m.activity === 'think';
  m.typeOn = reduce ? (thinking ? 0 : 1) : lerp(m.typeOn, m.state === 'working' && !thinking ? 1 : 0, 1 - Math.exp(-dt * 6));
  const kb = m.prop.kind === 'keyboard' ? keyboardTyping(reduce ? 0 : t, m.typeOn * enter) : null;

  // Body
  let sx = 1, sy = 1, rot = 0, dy = 0, dx = 0;
  const breathe = () => { sy = 1 + 0.015 * Math.sin(t * 2); sx = 1 - 0.008 * Math.sin(t * 2); };
  if (!reduce) {
    switch (g.motion) {
      case 'hop-loop': {
        // A soft hop every 1.6 s: a small rise and fall, a gentle squash before and after, still in between
        const c = (t % 1.6) / 1.6, air = c < 0.4 ? Math.sin((c / 0.4) * Math.PI) : 0;
        const squash = c < 0.08 ? ease(c / 0.08) * (1 - c / 0.08) * 4 : c > 0.4 && c < 0.55 ? Math.sin(((c - 0.4) / 0.15) * Math.PI) : 0;
        dy = -6 * g.amp * air; sy = 1 + 0.035 * air - 0.05 * squash; sx = 1 - 0.02 * air + 0.04 * squash;
        rot = 0.03 * Math.sin((t / 3.2) * TAU);
        break;
      }
      case 'sleep': sy = 1 + 0.025 * Math.sin(t * 1.2); sx = 1 - 0.012 * Math.sin(t * 1.2); dy = 1; break;
      case 'typing': {
        // Leaning in over the keys: dips with each strike, leans toward the hand that strikes
        const on = m.typeOn * enter, b = kb?.beat ?? 0;
        sy = 1 + 0.012 * Math.sin(t * 2) - 0.018 * b; sx = 1 - 0.006 * Math.sin(t * 2) + 0.01 * b;
        dy = 1.4 * on + 0.7 * b - 1.6 * (1 - on) * enter; rot = 0.035 * (kb?.lean ?? 0) + 0.01 * Math.sin(t * 0.9);
        break;
      }
      case 'nod': { breathe(); const n = nod(t); dy = 3.2 * g.amp * n; sy *= 1 - 0.05 * n; sx *= 1 + 0.025 * n; break; }
      case 'shake': {
        breathe();
        const c = t % 2.4;
        if (c < 0.5) { const k = 1 - c / 0.5; dx = Math.sin(c * TAU * 7) * 4 * g.amp * k; rot = Math.sin(c * TAU * 7) * 0.04 * k; }
        break;
      }
      case 'tilt': breathe(); rot = 0.12 * g.amp * Math.sin(t * 1.3); break;
      case 'bounce': breathe(); if (m.jump === null) m.jump = now + 0.12; break;
      case 'breathe': breathe(); break;
      default:
        breathe();
        if (m.jump === null && t > m.jumpAt) { m.jump = now; m.jumpAt = t + 7 + hash(t, m.seed) * 5; }
    }
    // A hop: up and down in 0.75 s, squashing as she takes off and lands
    if (m.jump !== null && g.motion !== 'sleep' && now >= m.jump) {
      const p = (now - m.jump) / 0.75;
      if (p >= 1) { m.jump = null; m.jumpAmp = null; }
      else {
        const h = Math.sin(p * Math.PI), sq = p < 0.12 ? p / 0.12 : p > 0.88 ? (1 - p) / 0.12 : 0;
        dy -= 14 * (m.jumpAmp ?? g.amp) * h; sy *= 1 + 0.08 * h - 0.12 * sq; sx *= 1 - 0.05 * h + 0.1 * sq;
      }
    }
  }

  // Eyes a sequence takes over: the sleep bubble wakes her; waking, the eyes open before the hop
  let eyes: Eyes | 'wide' = thinking ? 'dots' : g.eyes, openCap = 1;
  const phase = g.extra === 'bubble' && !reduce ? sleepPhase(now - m.sleepOff) : null;
  const bubble = phase !== null ? sleepBubble(phase) : null;
  if (bubble) {
    eyes = bubble.eyes === 'closed' ? 'closed' : bubble.eyes === 'wide' ? 'wide' : 'dots';
    openCap = bubble.open; rot += bubble.shake;
  }
  if (m.wakeAt !== null) {
    const ph = (now - m.wakeAt) / 0.55;
    if (ph < 0.4) eyes = 'closed'; else if (ph < 1) openCap = ease((ph - 0.4) / 0.6); else m.wakeAt = null;
  }

  // Gaze
  const r = m.canvas.getBoundingClientRect(), u = r.width / ROOM, cx = r.left + 70 * u, cy = r.top + (m.headroom + 64) * u;
  const follow = (x: number, y: number) => {
    const ddx = x - cx, ddy = y - cy, d = Math.hypot(ddx, ddy) || 1;
    m.target = [(ddx / d) * Math.min(EYE_X, d / 20), (ddy / d) * Math.min(EYE_Y, d / 20)];
  };
  const lensG = m.prop.kind === 'lens' ? lensGaze(reduce ? 0 : t) : null;
  if (eyes === 'closed') m.target = [0, 1];
  else if (g.extra === 'lens' && lensG) m.target = lensG.look;
  else if (g.gaze === 'center') m.target = [0, 0.5];
  else if (g.gaze === 'keys') {
    // Typing: up at the pointer if it just moved; now and then a glance at what she's changing;
    // up at her thoughts while the agent thinks; otherwise down at the keys
    const glanceAt = m.focus && !thinking && t % 5.5 > 4.3 ? focusCenter(m.focus) : null;
    if (pointer && now - pointerAt < 1.2) follow(pointer[0], pointer[1]);
    else if (glanceAt) follow(glanceAt[0], glanceAt[1]);
    else if (thinking) m.target = [-EYE_X * 0.45, -EYE_Y];
    else m.target = [(kb?.lean ?? 0) * EYE_X * 0.35 + Math.sin(t * 1.3) * 1.2, EYE_Y * 0.85];
  } else if (pointer) follow(pointer[0], pointer[1]); // she follows the mouse anywhere on the page
  else if (t > m.nextWander) {
    m.target = [(hash(t, 1) - 0.5) * 5, (hash(1, t) - 0.5) * 3];
    m.nextWander = t + 1.6 + hash(t, t) * 2.5;
  }
  m.look = [lerp(m.look[0], m.target[0], 0.08), lerp(m.look[1], m.target[1], 0.08)];
  let open = 1;
  if (!reduce && g.blink) {
    const b = t - m.blinkAt;
    if (b > 0) { open = b < 0.07 ? 1 - b / 0.07 : b < 0.15 ? (b - 0.07) / 0.08 : 1; if (b > 0.15) m.blinkAt = t + 2.4 + hash(m.seed, t) * 3; }
  }
  open = Math.min(open, openCap);

  // The drawing space is 140 units across: the body in the middle, room around it for the hop
  // and the shadow, plus headroom above when there's a thought cloud
  const px = m.canvas.width / ROOM;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, m.canvas.width, m.canvas.height);
  ctx.setTransform(px, 0, 0, px, 0, m.headroom * px);
  const lift = Math.max(0, -dy);
  ctx.globalAlpha = 1;
  ctx.fillStyle = m.muted ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.15)';
  ctx.beginPath(); ctx.ellipse(70 + dx, 106, 27 * (1 - lift / 40), 3.6 * (1 - lift / 60), 0, 0, TAU); ctx.fill();
  if (g.extra === 'clock') drawThoughtClock(ctx, reduce ? 0 : t);
  if (m.state === 'done') drawSparkles(ctx, reduce ? 0.45 : now - m.stateAt, detail);

  ctx.save();
  ctx.translate(70 + dx, 64 + dy); ctx.rotate(rot); ctx.scale(sx * 0.9, sy * 0.9); ctx.translate(-50, -50);

  // Hand-drawn body: three translucent fills and two pencil lines, each jittered per frame step.
  // Small, the jitter is held back and the line is heavier, so the edge doesn't go fuzzy.
  const boil = reduce ? 0 : Math.floor(t * g.fps);
  const amp = style.boilAmp * g.boil * boilScale(m.size);
  const strokeW = detail ? style.stroke : Math.max(style.stroke, 1.4);
  const pts = OUTLINES[m.mode];
  const jit = (seed: number, a: number) => smooth(pts.map(([x, y], i): Pt => [x + (hash(i * 0.37 + seed, boil) - 0.5) * a, y + (hash(boil, i * 0.53 + seed) - 0.5) * a]));
  ([[shade(color, 0.18), 1, -1.2], [color, 2, 0.8], [shade(color, -0.14), 3, 1.5]] as const).forEach(([fill, seed, off]) => {
    ctx.globalAlpha = 0.55; trace(ctx, jit(seed, amp), off * 0.6, off * 0.4); ctx.fillStyle = fill; ctx.fill();
  });
  ctx.strokeStyle = shade(color, -0.55); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.globalAlpha = 0.85; ctx.lineWidth = strokeW; trace(ctx, jit(7, amp * 0.6)); ctx.stroke();
  ctx.globalAlpha = 0.45; ctx.lineWidth = strokeW * 0.6; trace(ctx, jit(11, amp * 0.8)); ctx.stroke();

  // Eyes: slightly uneven dots, like ink
  const ink = '#1d1b2b';
  ctx.globalAlpha = 0.92; ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const ex = 50 + side * 13 + m.look[0], ey = 45 + m.look[1];
    if (eyes === 'closed') {
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(50 + side * 13, 44, 4.6, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      continue;
    }
    if (eyes === 'happy') {
      // ^^
      ctx.lineWidth = 2.8;
      ctx.beginPath(); ctx.arc(ex, ey + 3, 4.8, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      continue;
    }
    if (eyes === 'squint') {
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(ex - 4.6, ey + side * 0.8); ctx.lineTo(ex + 4.6, ey - side * 0.8); ctx.stroke();
      continue;
    }
    const big = eyes === 'wide' ? 1.35 : 1;
    ctx.beginPath();
    ctx.ellipse(ex + (hash(side, boil) - 0.5), ey + (hash(boil, side) - 0.5),
      (4.6 + hash(side * 3, boil) * 0.8) * big, Math.max(0.8, 6.4 * open * big), (hash(boil, 9) - 0.5) * 0.4, 0, TAU);
    ctx.fill();
    if (eyes === 'wide') { ctx.save(); ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(ex + 1.6, ey - 2.2, 1.5, 0, TAU); ctx.fill(); ctx.restore(); }
  }

  // Mouth
  const mx = 50 + m.look[0] * 0.4;
  ctx.lineWidth = 2.6;
  if (g.mouth === 'smile-o') {
    // Expressions held long and blended: a smile most of the time, easing into an "o" and back
    const e = reduce ? 0 : surprise(t);
    if (e < 1) { ctx.globalAlpha = 0.9 * (1 - e); ctx.beginPath(); ctx.arc(mx, 56, 7, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke(); }
    if (e > 0) { ctx.globalAlpha = 0.9 * e; ctx.beginPath(); ctx.ellipse(mx, 61, 2.4 + 1.2 * e, 1.2 + 3.6 * e, 0, 0, TAU); ctx.fill(); }
  } else if (g.mouth === 'smirk') {
    ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.moveTo(mx - 5, 61); ctx.quadraticCurveTo(mx + 2, 63, mx + 7, 57); ctx.stroke();
  } else if (g.mouth === 'grin') {
    ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(mx, 57, 7, 0.05 * Math.PI, 0.95 * Math.PI); ctx.closePath(); ctx.fill();
  }

  // The magnifier comes in from her side
  if (lensG) {
    ctx.globalAlpha = enter;
    drawMagnifier(ctx, [lensG.lens[0] + (1 - enter) * 30, lensG.lens[1] + (1 - enter) * 20], color, detail);
  }
  if (bubble && phase !== null) drawSleepBubble(ctx, bubble, t, phase, detail);
  ctx.restore();

  // In front of her: the keyboard she types on, and her hands. It rises into place and sinks on the way out.
  if (kb) {
    ctx.save(); ctx.globalAlpha = enter; ctx.translate(0, (1 - enter) * 26);
    if (detail) drawKeyboard(ctx, kb, color, px); else drawKeyboardSimple(ctx, kb, color);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** Where on the page (client px) the element she's changing is, or null */
function focusCenter(selector: string): Pt | null {
  let el: Element | null = null;
  try { el = document.querySelector(selector); } catch { return null; }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

const quad = (ctx: CanvasRenderingContext2D, q: Pt[]) => { ctx.beginPath(); q.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); };

/** From DETAIL_AT up: the keyboard in perspective, keycaps that sink and glow, round hands with a shine */
function drawKeyboard(ctx: CanvasRenderingContext2D, k: Typing, color: string, px: number) {
  const TL = kbAt(0, 0), TR = kbAt(1, 0), BR = kbAt(1, 1), BL = kbAt(0, 1);
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.beginPath(); ctx.ellipse(KB.cx, KB.yBot + KB.lip + 1, KB.wBot * 0.56, 2.6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = ctx.strokeStyle = '#18171d'; ctx.lineWidth = 2.4;
  quad(ctx, [BL, BR, [BR[0] - 0.6, BR[1] + KB.lip], [BL[0] + 0.6, BL[1] + KB.lip]]); ctx.fill(); ctx.stroke();
  const deck = ctx.createLinearGradient(0, KB.yTop, 0, KB.yBot); deck.addColorStop(0, '#45444f'); deck.addColorStop(1, '#2e2d36');
  ctx.fillStyle = ctx.strokeStyle = deck; quad(ctx, [TL, TR, BR, BL]); ctx.fill(); ctx.stroke();
  // A light rim, so it reads on a dark page too
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 0.8;
  quad(ctx, [[TL[0] - 1.2, TL[1] - 1.2], [TR[0] + 1.2, TR[1] - 1.2], [BR[0] + 1.2, BR[1] + KB.lip], [BL[0] - 1.2, BL[1] + KB.lip]]); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(TL[0] + 1, TL[1] - 0.9); ctx.lineTo(TR[0] - 1, TR[1] - 0.9); ctx.stroke();
  KB.keys.forEach((_, i) => {
    const lit = k.glow.get(i) ?? 0, sink = lit > 0.55 ? 0.6 : 0, cap = kbQuad(i, 0.012).map(([x, y]): Pt => [x, y - 0.6 + sink]);
    ctx.lineWidth = 0.9;
    ctx.fillStyle = ctx.strokeStyle = '#1f1e25'; quad(ctx, kbQuad(i)); ctx.fill(); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle = '#5b5a66'; quad(ctx, cap); ctx.fill(); ctx.stroke();
    if (lit > 0) {
      ctx.save(); ctx.globalAlpha *= lit; ctx.shadowColor = color; ctx.shadowBlur = 5 * px * lit;
      ctx.fillStyle = ctx.strokeStyle = color; quad(ctx, cap); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    ctx.strokeStyle = `rgba(255,255,255,${0.22 * (1 - lit)})`; ctx.lineWidth = 0.45;
    ctx.beginPath(); ctx.moveTo(cap[0][0] + 0.4, cap[0][1] - 0.35); ctx.lineTo(cap[1][0] - 0.4, cap[1][1] - 0.35); ctx.stroke();
  });
  for (const h of k.hands) {
    ctx.fillStyle = `rgba(0,0,0,${0.18 + 0.17 * h.depth})`;
    ctx.beginPath(); ctx.ellipse(h.x + 0.6, h.y + 4.6 - h.depth * 1.4, 4.7 - 0.5 * h.depth, 1.8, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(-h.side * 0.28); ctx.scale(1 + 0.06 * h.depth, 1 - 0.1 * h.depth);
    ctx.fillStyle = shade(color, -0.06); ctx.strokeStyle = shade(color, -0.5); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(0, 0, 5, 3.8, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.ellipse(0, 0, 3.3, 2.3, 0, Math.PI * 1.15, Math.PI * 1.6); ctx.stroke();
    ctx.restore();
  }
}

/** Below DETAIL_AT: one slab, the key under the striking hand lit, big hands with a heavy outline */
function drawKeyboardSimple(ctx: CanvasRenderingContext2D, k: Typing, color: string) {
  ctx.fillStyle = '#1c1b22'; ctx.beginPath(); ctx.roundRect(30, 98, 80, 17, 4); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#4b4a55'; ctx.beginPath(); ctx.roundRect(34, 100.5, 72, 9, 2.5); ctx.fill();
  for (const h of k.hands) {
    if (h.depth <= 0.25) continue;
    ctx.save(); ctx.globalAlpha *= h.depth; ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(Math.max(40, Math.min(100, h.x)) - 6, 101.5, 12, 7, 2); ctx.fill(); ctx.restore();
  }
  for (const h of k.hands) {
    // Kept on the slab's top edge: the detailed hands travel further than this drawing has room for
    ctx.fillStyle = shade(color, -0.04); ctx.strokeStyle = shade(color, -0.6); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(h.x, Math.max(94, Math.min(101, h.y)) + h.depth * 2, 7, 5.4, -h.side * 0.25, 0, TAU); ctx.fill(); ctx.stroke();
  }
}

function drawMagnifier(ctx: CanvasRenderingContext2D, [lx, ly]: Pt, color: string, detail: boolean) {
  const hx = lx - 14, hy = ly + 16;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = detail ? 4.5 : 6.5;
  ctx.beginPath(); ctx.moveTo(lx - 7, ly + 8); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.fillStyle = detail ? 'rgba(210,235,255,0.55)' : 'rgba(225,242,255,0.85)'; ctx.strokeStyle = '#3b2a1a'; ctx.lineWidth = detail ? 3 : 4.5;
  ctx.beginPath(); ctx.arc(lx, ly, detail ? 11 : 12, 0, TAU); ctx.fill(); ctx.stroke();
  if (detail) { ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(lx, ly, 7, Math.PI * 1.1, Math.PI * 1.5); ctx.stroke(); }
  ctx.fillStyle = shade(color, -0.1); ctx.strokeStyle = shade(color, -0.55); ctx.lineWidth = detail ? 1.2 : 2;
  ctx.beginPath(); ctx.ellipse(hx, hy, detail ? 5.5 : 7, detail ? 4.5 : 5.6, -0.5, 0, TAU); ctx.fill(); ctx.stroke();
}

function drawSleepBubble(ctx: CanvasRenderingContext2D, b: ReturnType<typeof sleepBubble>, t: number, phase: number, detail: boolean) {
  ctx.globalAlpha = 1;
  if (b.radius !== null) {
    const r = b.radius + Math.sin(t * 1.2) * 1.2 * Math.min(1, phase / 6), bx = 60 + r * 0.75, by = 58 + r * 0.1;
    ctx.fillStyle = 'rgba(170,210,255,0.45)'; ctx.strokeStyle = 'rgba(110,160,225,0.9)'; ctx.lineWidth = detail ? 1.3 : 2.6;
    ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU); ctx.fill(); ctx.stroke();
    if (detail) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(bx, by, r * 0.62, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
    }
  } else if (b.pop !== null) {
    const k = b.pop;
    ctx.globalAlpha = 1 - k; ctx.strokeStyle = 'rgba(110,160,225,1)'; ctx.lineWidth = detail ? 1.5 : 2.6;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      ctx.beginPath();
      ctx.moveTo(75 + Math.cos(a) * (14 + k * 10), 60 + Math.sin(a) * (14 + k * 10));
      ctx.lineTo(75 + Math.cos(a) * (19 + k * 12), 60 + Math.sin(a) * (19 + k * 12));
      ctx.stroke();
    }
  }
}

/** Done: four sparkles rise around her and fade, `e` seconds in */
function drawSparkles(ctx: CanvasRenderingContext2D, e: number, detail: boolean) {
  ctx.fillStyle = '#f5b301';
  for (const [x, y, delay] of [[24, 34, 0], [114, 28, 0.15], [118, 70, 0.3], [20, 72, 0.22]]) {
    const k = clamp01((e - delay) / 0.9), s = Math.sin(k * Math.PI);
    if (s <= 0) continue;
    const r = detail ? 3 + s * 4 : 5 + s * 5, sy = y - k * 6;
    ctx.globalAlpha = s; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.35 : r; ctx.lineTo(x + rr * Math.cos(a), sy + rr * Math.sin(a)); }
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** A thought cloud about her size above her head, a clock ticking inside (drawing-space units) */
function drawThoughtClock(ctx: CanvasRenderingContext2D, t: number) {
  const bob = Math.sin(t * 1.5) * 1.5, Z = 2.6, ccx = 88, ccy = -26 + bob;
  const puffs = ([[0, 0, 11], [9, 4, 9], [-9, 4, 8], [1, 10, 9], [5, -7, 8], [-5, -7, 7]] as const).map(([x, y, r]) => [ccx + x * Z, ccy + y * Z, r * Z]);
  const blobs = [[80, 33, 3], [85, 26, 4.4], ...puffs];
  ctx.globalAlpha = 1; ctx.fillStyle = '#c9c9cf';
  blobs.forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r + 1.8, 0, TAU); ctx.fill(); });
  ctx.fillStyle = '#ffffff';
  blobs.forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); });
  const kx = ccx + 1, ky = ccy + 3, kr = 21;
  ctx.strokeStyle = '#1d1b2b'; ctx.fillStyle = '#1d1b2b'; ctx.lineCap = 'round'; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.arc(kx, ky, kr, 0, TAU); ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6, r0 = i % 3 ? kr - 3 : kr - 5;
    ctx.beginPath(); ctx.moveTo(kx + Math.cos(a) * r0, ky + Math.sin(a) * r0); ctx.lineTo(kx + Math.cos(a) * (kr - 1.5), ky + Math.sin(a) * (kr - 1.5)); ctx.stroke();
  }
  const mA = (t * TAU) / 3 - Math.PI / 2, hA = (t * TAU) / 36 - Math.PI / 2;
  ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(kx + Math.cos(mA) * 15, ky + Math.sin(mA) * 15); ctx.stroke();
  ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(kx + Math.cos(hA) * 9.5, ky + Math.sin(hA) * 9.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(kx, ky, 2, 0, TAU); ctx.fill();
}

function loop(ms: number) {
  for (const m of live) if (m.visible) draw(m, ms / 1000);
  if (live.size > 0) requestAnimationFrame(loop); else looping = false;
}
function onPointer(e: PointerEvent) { pointer = [e.clientX, e.clientY]; pointerAt = performance.now() / 1000; }

function add(m: Mascot) {
  if (live.size === 0) window.addEventListener('pointermove', onPointer, { passive: true });
  live.add(m);
  observer ??= new IntersectionObserver(es => es.forEach(e => {
    for (const x of live) if (x.canvas === e.target) x.visible = e.isIntersecting;
  }));
  observer.observe(m.canvas);
  if (reduce) draw(m, 0);
  else if (!looping) { looping = true; requestAnimationFrame(loop); }
}
function remove(m: Mascot) {
  live.delete(m);
  observer?.unobserve(m.canvas);
  if (live.size === 0) window.removeEventListener('pointermove', onPointer);
}

/**
 * `grow`: the mascot pops up from its place — taller than the toolbar — without
 * moving anything around it. The canvas is drawn at the grown size and scaled
 * down at rest, so it stays sharp either way.
 */
export function IlseMascot({ mode, state = 'idle', reaction, size = 28, muted = false, grow = false, label, activity = 'edit', focus }: {
  mode: MascotMode; state?: MascotState;
  /** A toast's reaction, while she's idle */
  reaction?: MascotReaction;
  size?: number; muted?: boolean; grow?: boolean;
  label?: string;
  /** While working: is the agent editing (she types) or thinking (she rests and looks up)? */
  activity?: MascotActivity;
  /** CSS selector of the element being changed: she glances at it while typing */
  focus?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mascot = useRef<Mascot | null>(null);
  // The thought cloud needs room above her head; it's fixed for the canvas's life
  const headroom = reaction === 'queued' ? 78 : 0;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const now = performance.now() / 1000;
    const m: Mascot = {
      canvas, mode, state, reaction, muted, seed: Math.random(), look: [0, 0], target: [0, 0], nextWander: 0, blinkAt: 1 + Math.random() * 3,
      visible: true, jump: null, jumpAmp: null, jumpAt: 4 + Math.random() * 6, wakeAt: null, headroom,
      size, activity, focus, stateAt: now, prop: { kind: 'none', p: 0 }, typeOn: 0, last: now,
      // Each sleeper on its own clock, so two of them never bubble together
      sleepOff: now - Math.random() * SLEEP_EVERY,
    };
    mascot.current = m;
    add(m);
    return () => { remove(m); mascot.current = null; };
  // Mode and state change in place, without a new canvas
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const m = mascot.current;
    if (!m) return;
    // Woken up (her mode was switched on): a hop to say hi — design opens her eyes first
    if (m.state === 'asleep' && state === 'idle') {
      const now = performance.now() / 1000, w = WAKE[mode];
      if (w.openFirst) m.wakeAt = now;
      m.jump = now + (w.openFirst ? 0.55 : 0); m.jumpAmp = w.amp;
    }
    // The work landed: a big hop, with sparkles
    if (state === 'done' && m.state !== 'done') { m.jump = performance.now() / 1000; m.jumpAmp = 1.6; }
    if (state !== m.state) m.stateAt = performance.now() / 1000;
    m.mode = mode; m.state = state; m.reaction = reaction; m.muted = muted;
    m.size = size; m.activity = activity; m.focus = focus;
    if (reduce) draw(m, 0);
  }, [mode, state, reaction, muted, size, activity, focus]);
  // Asleep, the bubble is rare; pointing at her starts it now
  const nudge = () => {
    const m = mascot.current;
    if (!m || m.state !== 'asleep') return;
    const now = performance.now() / 1000;
    if (sleepPhase(now - m.sleepOff) === null) m.sleepOff = now - (SLEEP_EVERY - 9);
  };
  // Drawn at the grown size; at rest scaled so the body fills the slot as before. It grows from
  // the ground under her, and the extra room (shadow, hop, cloud) spills over the slot, moving nothing.
  const rest = size * (ROOM / 100), big = Math.round(rest * GROW), k = rest / big;
  const ground = 0.76, bodyY = 64 / ROOM, up = (headroom * big) / ROOM;
  return (
    <span onPointerEnter={nudge} style={{ position: 'relative', display: 'inline-block', width: size, height: size, flexShrink: 0, verticalAlign: 'middle' }}>
      <canvas
        ref={ref}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        style={{
          position: 'absolute', width: big, height: big + up,
          left: size / 2 - big / 2, top: size / 2 - ground * big + (ground - bodyY) * k * big - up,
          transformOrigin: `50% ${ground * big + up}px`, transform: `scale(${grow ? 1 : k})`,
          transition: reduce ? undefined : 'transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)',
          zIndex: grow ? 2 : undefined, pointerEvents: 'none',
        }}
      />
    </span>
  );
}

/** The drawing space, in units: the 100-unit body box plus room around it */
const ROOM = 140;
/** How much bigger a growing mascot gets */
const GROW = 1.16;
