import { describe, it, expect } from 'vitest';
import {
  holds,
  classifyStroke, readStrokes, pointInPolygon, formatSketchNote,
  SKETCH_NOTE_HEADING, type Point, type Stroke, type SketchPart,
} from '../sketch.js';

const circle = (cx: number, cy: number, r: number, turns = 1, n = 40): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2 * turns;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
const line = (a: Point, b: Point, n = 20): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }));
const zigzag = (x: number, y: number, w: number, h: number, n = 8): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x + (w * i) / n, y: i % 2 ? y + h : y }));
const stroke = (points: Point[]): Stroke => ({ points, color: '#FF6C03' });

describe('classifyStroke', () => {
  it('reads a loop as an enclosure', () => {
    expect(classifyStroke(circle(100, 100, 50))).toBe('enclosure');
    // An almost-closed loop drawn by hand still counts
    expect(classifyStroke(circle(100, 100, 50).slice(0, 38))).toBe('enclosure');
  });
  it('reads straight strokes as lines, flat horizontal ones as underlines', () => {
    expect(classifyStroke(line({ x: 0, y: 0 }, { x: 200, y: 150 }))).toBe('line');
    expect(classifyStroke(line({ x: 0, y: 100 }, { x: 200, y: 104 }))).toBe('underline');
    expect(classifyStroke(line({ x: 100, y: 0 }, { x: 102, y: 200 }))).toBe('line');
  });
  it('reads zig-zags and repeated loops as scribbles', () => {
    expect(classifyStroke(zigzag(0, 0, 200, 40))).toBe('scribble');
    expect(classifyStroke(circle(100, 100, 30, 4, 160))).toBe('scribble');
  });
});

describe('readStrokes', () => {
  it('folds a short head stroke into the line it tips', () => {
    const shaft = stroke(line({ x: 0, y: 100 }, { x: 200, y: 100 }));
    const head = stroke([{ x: 185, y: 88 }, { x: 200, y: 100 }, { x: 185, y: 112 }]);
    const read = readStrokes([shaft, head]);
    expect(read).toHaveLength(1);
    expect(read[0].reading).toEqual({ shape: 'line', arrowTo: 'end' });
  });
  it('spots a one-stroke arrow by its hook', () => {
    const pts = [...line({ x: 0, y: 0 }, { x: 200, y: 200 }), ...line({ x: 200, y: 200 }, { x: 170, y: 195 }, 6).slice(1)];
    expect(readStrokes([stroke(pts)])[0].reading).toEqual({ shape: 'line', arrowTo: 'end' });
  });
  it('keeps independent strokes apart', () => {
    const read = readStrokes([stroke(circle(100, 100, 40)), stroke(zigzag(300, 300, 100, 20))]);
    expect(read.map(r => r.reading.shape)).toEqual(['enclosure', 'scribble']);
  });
});

describe('pointInPolygon', () => {
  it('works on a drawn loop', () => {
    const loop = circle(0, 0, 10);
    expect(pointInPolygon({ x: 0, y: 0 }, loop)).toBe(true);
    expect(pointInPolygon({ x: 20, y: 0 }, loop)).toBe(false);
  });
});

describe('sketch note', () => {
  const t = (label: string) => ({ el: {} as Element, label });
  const parts: SketchPart[] = [
    { reading: { shape: 'enclosure' }, color: '#FF6C03', targets: [t('botão "Salvar"')] },
    { reading: { shape: 'line', arrowTo: 'end' }, color: '#3B82F6', targets: [], from: t('card "A"'), to: t('card "B"') },
    { reading: { shape: 'scribble' }, color: '#EF4444', targets: [] },
  ];

  it('reads as plain language, one line per stroke', () => {
    expect(formatSketchNote(parts)).toBe([
      SKETCH_NOTE_HEADING,
      '1. Circulou (laranja): botão "Salvar"',
      '2. Seta (azul) de card "A" apontando para card "B"',
      '3. Rabiscou por cima (vermelho): uma área vazia',
      'A imagem anexada mostra o desenho sobre os elementos da página.',
    ].join('\n'));
  });
});

describe('holds', () => {
  const box = { left: 100, top: 100, width: 50, height: 40 };
  it('is true when the rect covers the drawing, with a little slack for the stroke', () => {
    expect(holds({ left: 90, top: 90, right: 200, bottom: 200 }, box)).toBe(true);
    expect(holds({ left: 101, top: 101, right: 149, bottom: 139 }, box)).toBe(true);
  });
  it('is false when part of the drawing is outside', () => {
    expect(holds({ left: 120, top: 90, right: 200, bottom: 200 }, box)).toBe(false);
    expect(holds({ left: 90, top: 90, right: 200, bottom: 130 }, box)).toBe(false);
  });
});
