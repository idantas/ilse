import { describe, it, expect } from 'vitest';
import { mascotOutline, surprise, sleepBubble, nod, lensGaze, mascotLook, sleepPhase, SLEEP_EVERY, boilScale, keyboardTyping, DETAIL_AT } from '../mascot.js';

describe('mascot outline', () => {
  for (const mode of ['design', 'test'] as const) {
    it(`${mode}: fits the 82-unit box centered on (50, 50)`, () => {
      const pts = mascotOutline(mode);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      expect(Math.max(w, h)).toBeCloseTo(82, 0);
      expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(50, 0);
      expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(50, 0);
      expect(pts).toHaveLength(160);
    });
  }
  it('design is the squircle, test the octagon: the octagon cuts the corners off', () => {
    // Distance from the center to the farthest point: a squircle reaches further into its corners
    const reach = (m: 'design' | 'test') => Math.max(...mascotOutline(m).map(([x, y]) => Math.hypot(x - 50, y - 50)));
    expect(reach('design')).toBeGreaterThan(reach('test') + 4);
  });
});

describe('mascot expressions', () => {
  it('changes slowly: no jumps between frames, a smile held for seconds', () => {
    let prev = surprise(0), maxStep = 0, smile = 0;
    for (let t = 0.016; t < 14; t += 0.016) {
      const e = surprise(t);
      maxStep = Math.max(maxStep, Math.abs(e - prev));
      if (e === 0) smile += 0.016;
      prev = e;
    }
    expect(maxStep).toBeLessThan(0.06);
    expect(smile / 2).toBeGreaterThan(4);
  });
});

describe('mascot looks', () => {
  it('working: design types on a keyboard, test looks through a magnifier and nods', () => {
    expect(mascotLook('design', 'working')).toMatchObject({ motion: 'typing', extra: 'typing', eyes: 'happy', mouth: 'smirk', gaze: 'keys' });
    expect(mascotLook('test', 'working')).toMatchObject({ motion: 'nod', extra: 'lens', gaze: 'lens' });
  });
  it('done: happy eyes, a grin, no prop', () => {
    for (const mode of ['design', 'test'] as const) expect(mascotLook(mode, 'done')).toMatchObject({ eyes: 'happy', mouth: 'grin', extra: 'none' });
  });
  it('asleep, both modes: the sleep bubble, eyes shut', () => {
    for (const mode of ['design', 'test'] as const) expect(mascotLook(mode, 'asleep')).toMatchObject({ extra: 'bubble', eyes: 'closed' });
  });
  it('a toast reaction only applies while idle', () => {
    expect(mascotLook('design', 'idle', 'failed')).toMatchObject({ motion: 'shake' });
    expect(mascotLook('design', 'idle', 'queued')).toMatchObject({ extra: 'clock' });
    expect(mascotLook('design', 'working', 'failed').motion).toBe('typing');
  });
});

describe('sleep bubble', () => {
  it('grows to about half her size, then pops', () => {
    expect(sleepBubble(1).radius).toBeLessThan(sleepBubble(5).radius!);
    expect(sleepBubble(6.1).radius).toBeGreaterThan(19);
    expect(sleepBubble(6.2).radius).toBeNull();
    expect(sleepBubble(6.2).pop).not.toBeNull();
  });
  it('she wakes wide-eyed, shakes her head, and is asleep again before the next bubble', () => {
    expect(sleepBubble(3).eyes).toBe('closed');
    expect(sleepBubble(6.3).eyes).toBe('wide');
    expect(Math.abs(sleepBubble(6.8).shake)).toBeGreaterThan(0);
    expect(sleepBubble(8.5).eyes).toBe('closed');
    expect(sleepBubble(9 + 3).eyes).toBe('closed');
  });
});

describe('testing: magnifier, then a nod', () => {
  it('looks through the magnifier, to her right, without nodding', () => {
    expect(nod(1)).toBe(0);
    expect(lensGaze(1).look[0]).toBeGreaterThan(3);
  });
  it('then looks at you and nods twice', () => {
    expect(lensGaze(4).look[0]).toBe(0);
    let peaks = 0, prev = 0, rising = false;
    for (let t = 3.4; t < 4.8; t += 0.01) { const n = nod(t); if (rising && n < prev) { peaks++; rising = false; } else if (n > prev) rising = true; prev = n; }
    expect(peaks).toBe(2);
  });
});

describe('asleep, quietly', () => {
  it('the bubble comes once per cycle, in its last 9 s', () => {
    expect(SLEEP_EVERY).toBeGreaterThanOrEqual(20);
    expect(sleepPhase(1)).toBeNull();
    expect(sleepPhase(SLEEP_EVERY - 10)).toBeNull();
    expect(sleepPhase(SLEEP_EVERY - 9)).toBeCloseTo(0);
    expect(sleepPhase(SLEEP_EVERY - 1)).toBeCloseTo(8);
    expect(sleepPhase(SLEEP_EVERY + 1)).toBeNull();
  });
});

describe('small sizes', () => {
  it('the outline boils less when small, never below a third', () => {
    expect(boilScale(21)).toBeLessThan(boilScale(DETAIL_AT));
    expect(boilScale(21)).toBeGreaterThanOrEqual(0.35);
    expect(boilScale(96)).toBe(1);
  });
});

describe('typing', () => {
  it('resting: hands still on the home keys, nothing lit', () => {
    const a = keyboardTyping(1, 0), b = keyboardTyping(1.37, 0);
    expect(a.hands.map(h => [h.x, h.y])).toEqual(b.hands.map(h => [h.x, h.y]));
    expect(a.glow.size).toBe(0);
    expect(a.beat).toBe(0);
  });
  it('typing: the hands take turns, keys light up', () => {
    let left = 0, right = 0, lit = 0;
    for (let t = 0; t < 4; t += 0.01) {
      const k = keyboardTyping(t, 1);
      if (k.hands[0].depth > 0.5) left++;
      if (k.hands[1].depth > 0.5) right++;
      if (k.hands[0].depth > 0.5 && k.hands[1].depth > 0.5) throw new Error('both hands strike at once');
      if (k.glow.size > 0) lit++;
    }
    expect(left).toBeGreaterThan(20);
    expect(right).toBeGreaterThan(20);
    expect(lit).toBeGreaterThan(300);
  });
});
