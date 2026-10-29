import { describe, expect, it } from 'vitest';
import { DEVICES, EMBED_FRAME_NAME, EMBED_IDLE, canRotate, clampSize, deviceById, fitScale, frameSize, isEmbedToHost, isEmbedded, isHostToEmbed, rulerTicks } from '../screens.js';

const phone = deviceById('iphone-15');
const tablet = deviceById('ipad-mini');
const desktop = deviceById('desktop');

describe('devices', () => {
  it('ships the three widths, phone first', () => {
    expect(DEVICES.map(d => d.width)).toEqual([390, 768, 1280]);
    expect(deviceById('nope')).toBe(phone);
    expect(deviceById(undefined)).toBe(phone);
  });

  it('turns only the phone to landscape', () => {
    expect(canRotate(phone)).toBe(true);
    expect(canRotate(tablet)).toBe(false);
    expect(canRotate(desktop)).toBe(false);
    expect(frameSize(phone, true)).toEqual({ width: 844, height: 390 });
    expect(frameSize(phone, false)).toEqual({ width: 390, height: 844 });
    expect(frameSize(tablet, true)).toEqual({ width: 768, height: 1024 });
  });
});

describe('fitScale', () => {
  it('never zooms in, shrinks to the stage width', () => {
    expect(fitScale(390, 1200)).toBe(1);
    expect(fitScale(1280, 640)).toBe(0.5);
    expect(fitScale(0, 640)).toBe(1);
  });
});

describe('clampSize', () => {
  it('keeps a dragged size between a narrow phone and a wide monitor', () => {
    expect(clampSize(100, 5000)).toEqual({ width: 240, height: 4000 });
    expect(clampSize(1024.6, 700.2)).toEqual({ width: 1025, height: 700 });
  });
});

describe('rulerTicks', () => {
  it('ticks every 10px and labels every 50px at full size', () => {
    const ticks = rulerTicks(100);
    expect(ticks.map(t => t.pos)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(ticks.filter(t => t.label).map(t => t.label)).toEqual(['0', '50', '100']);
  });

  it('spreads out when the frame is scaled down', () => {
    const ticks = rulerTicks(400, 0.5);
    expect(ticks[1].pos).toBe(20);
    expect(ticks.filter(t => t.label).map(t => t.label)).toEqual(['0', '200', '400']);
  });
});

describe('messages', () => {
  it('accepts only its own shapes', () => {
    expect(isEmbedToHost({ ilseScreens: 'state', state: EMBED_IDLE })).toBe(true);
    expect(isEmbedToHost({ ilseScreens: 'action', action: 'run' })).toBe(false);
    expect(isEmbedToHost('close')).toBe(false);
    expect(isHostToEmbed({ ilseScreens: 'action', action: 'pencil' })).toBe(true);
    expect(isHostToEmbed({ ilseScreens: 'action', action: 'settings' })).toBe(false);
    expect(isHostToEmbed({ ilseScreens: 'close' })).toBe(false);
    expect(isHostToEmbed(null)).toBe(false);
  });
});

describe('isEmbedded', () => {
  const frame = (name: string, parentOrigin: string | 'throws') => {
    const top = {} as Window;
    const parent = parentOrigin === 'throws'
      ? { get location(): Location { throw new Error('cross-origin'); } }
      : { location: { origin: parentOrigin } };
    return { self: {} as Window, top, name, parent, location: { origin: 'http://localhost:4700' } } as unknown as Window;
  };

  it('needs the frame name and a parent on the same origin', () => {
    expect(isEmbedded(frame(EMBED_FRAME_NAME, 'http://localhost:4700'))).toBe(true);
    expect(isEmbedded(frame('other', 'http://localhost:4700'))).toBe(false);
    expect(isEmbedded(frame(EMBED_FRAME_NAME, 'http://evil.test'))).toBe(false);
    expect(isEmbedded(frame(EMBED_FRAME_NAME, 'throws'))).toBe(false);
  });

  it('is false at the top of the tab', () => {
    const win = { name: EMBED_FRAME_NAME } as unknown as Window & { self: unknown; top: unknown };
    (win as { self: unknown }).self = win;
    (win as { top: unknown }).top = win;
    expect(isEmbedded(win)).toBe(false);
  });
});
