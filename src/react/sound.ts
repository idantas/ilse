/**
 * The toolbar's two sounds: one when a change lands, one when something needs the person
 * (an error, a question, a login). Off in Settings → Sounds, per browser.
 *
 * After replacing an mp3 in `sounds/`, run `node scripts/sound-data.mjs`.
 */

import { ATTENTION_MP3, DONE_MP3 } from './sound-data.js';

export type SoundKind = 'done' | 'attention';

const KEY = 'ilse-sounds';
// A batch resolves its notes one after another: one chime for the batch, not one per note
const GAP_MS = 1500;
const VOLUME = 0.5;

export function soundsOn(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function setSoundsOn(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* per-browser preference only */ }
}

/** Whether `kind` plays now, given when each sound last played. Attention is never held back by a chime. */
export function shouldPlay(kind: SoundKind, now: number, last: Record<SoundKind, number>): boolean {
  if (kind === 'attention') return now - last.attention >= GAP_MS;
  // Something went wrong in the same moment: the warning is the one to hear
  return now - last.done >= GAP_MS && now - last.attention >= GAP_MS;
}

const last: Record<SoundKind, number> = { done: -Infinity, attention: -Infinity };
const cache: Partial<Record<SoundKind, HTMLAudioElement>> = {};

export function playSound(kind: SoundKind): void {
  if (typeof window === 'undefined' || !soundsOn()) return;
  const now = Date.now();
  if (!shouldPlay(kind, now, last)) return;
  last[kind] = now;
  try {
    const audio = cache[kind] ??= new Audio(kind === 'done' ? DONE_MP3 : ATTENTION_MP3);
    audio.volume = VOLUME;
    audio.currentTime = 0;
    // Blocked until the page had a click (autoplay rule) — silent then, never an error
    void audio.play().catch(() => {});
  } catch { /* no audio in this browser */ }
}
