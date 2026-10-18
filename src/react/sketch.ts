/**
 * Pencil sketches: freehand strokes on the page, turned into something the
 * agent can act on.
 *
 * The browser can't screenshot the page (html2canvas-style renderers choke on
 * Tailwind 4's oklch colours, getDisplayMedia prompts every time), so a sketch
 * travels as:
 * 1. **Words** — each stroke classified by shape (encircled, underlined, line
 *    or arrow from A to B, scribble) and tied to the elements it lands on. Sent
 *    to the agent alongside the designer's note.
 * 2. **A picture** — the strokes drawn over the outlines and labels of the
 *    elements beneath them, attached as an image.
 * 3. **A target** — the element the sketch is mostly about becomes the
 *    annotation's element, so the agent also gets its source file and line.
 *
 * Geometry is pure and tested; the DOM helpers only run in the browser.
 */

export interface Point { x: number; y: number }

export interface Stroke {
  /** Page coordinates (client + scroll), so the sketch stays put on scroll */
  points: Point[];
  color: string;
}

export type StrokeShape = 'enclosure' | 'line' | 'underline' | 'scribble';

export interface StrokeReading {
  shape: StrokeShape;
  /** For a line: the end with an arrowhead, when one was drawn */
  arrowTo?: 'start' | 'end';
}

export interface Box { left: number; top: number; width: number; height: number }

// ── Geometry (pure) ────────────────────────────────────────────────────────

export function bounds(points: Point[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

export function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * What a single stroke looks like.
 * - enclosure: ends near where it started and wraps an area (circle, box, lasso)
 * - line: close to straight (chord ≥ 85% of the path)
 *   - underline: a line that is mostly horizontal and flat
 * - scribble: everything else — hatching, zig-zags, crossing-out, a squiggle
 */
export function classifyStroke(points: Point[]): StrokeShape {
  if (points.length < 2) return 'scribble';
  const b = bounds(points);
  const len = pathLength(points);
  const span = Math.max(b.width, b.height);
  if (len < 4 || span < 4) return 'scribble';
  const chord = dist(points[0], points[points.length - 1]);

  if (chord / len >= 0.85) {
    return b.width > 3 * b.height && b.height < 24 ? 'underline' : 'line';
  }
  // Closed: the ends meet (relative to size), and the path goes round roughly once.
  const closed = chord < span * 0.3;
  const perimeter = 2 * (b.width + b.height);
  if (closed && b.width > 12 && b.height > 12 && len < perimeter * 1.8) return 'enclosure';
  return 'scribble';
}

/**
 * Read all strokes together: a short stroke drawn at the end of a line is an
 * arrowhead, not a stroke of its own.
 */
export function readStrokes(strokes: Stroke[]): { stroke: Stroke; reading: StrokeReading }[] {
  const shapes = strokes.map(s => classifyStroke(s.points));
  const lengths = strokes.map(s => pathLength(s.points));
  const absorbed = new Set<number>();
  const arrows = new Map<number, 'start' | 'end'>();

  strokes.forEach((s, i) => {
    // A one-stroke arrow: the pen doubles back sharply at one end. Without the
    // hook, the rest must read as a line.
    if (shapes[i] === 'scribble') {
      const hook = hookAt(s.points);
      if (hook) {
        const shaft = hook.end === 'end' ? s.points.slice(0, hook.index + 1) : s.points.slice(hook.index);
        if (classifyStroke(shaft) !== 'scribble' && classifyStroke(shaft) !== 'enclosure') {
          shapes[i] = 'line';
          arrows.set(i, hook.end);
        }
      }
      return;
    }
    if (shapes[i] !== 'line' && shapes[i] !== 'underline') return;
    const start = s.points[0];
    const end = s.points[s.points.length - 1];
    strokes.forEach((h, j) => {
      if (j === i || absorbed.has(j) || lengths[j] > lengths[i] * 0.45) return;
      const near = (p: Point) => h.points.some(q => dist(q, p) < Math.max(18, lengths[i] * 0.12));
      if (near(end)) { arrows.set(i, 'end'); absorbed.add(j); }
      else if (near(start)) { arrows.set(i, 'start'); absorbed.add(j); }
    });
    if (!arrows.has(i)) {
      const hook = hookAt(s.points);
      if (hook) arrows.set(i, hook.end);
    }
  });

  return strokes
    .map((stroke, i) => ({ i, stroke }))
    .filter(({ i }) => !absorbed.has(i))
    .map(({ i, stroke }) => ({
      stroke,
      reading: {
        shape: arrows.has(i) && shapes[i] === 'underline' ? 'line' : shapes[i],
        ...(arrows.has(i) ? { arrowTo: arrows.get(i) } : {}),
      },
    }));
}

/** A tail at either end that turns back more than ~120° — the head of an arrow drawn without lifting the pen. */
function hookAt(points: Point[]): { end: 'start' | 'end'; index: number } | undefined {
  if (points.length < 6) return undefined;
  const len = pathLength(points);
  const tail = Math.max(10, len * 0.15);
  const turn = (a: Point, b: Point, c: Point) => {
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const d = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
    return d ? Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / d))) * 180 / Math.PI : 0;
  };
  const pointAt = (from: number, step: number, distance: number) => {
    let acc = 0;
    for (let k = from; k + step >= 0 && k + step < points.length; k += step) {
      acc += dist(points[k], points[k + step]);
      if (acc >= distance) return k + step;
    }
    return undefined;
  };
  const endBack = pointAt(points.length - 1, -1, tail);
  const endMid = endBack !== undefined ? pointAt(endBack, -1, tail) : undefined;
  if (endBack !== undefined && endMid !== undefined) {
    // The sharpest corner near the end is where the head starts
    const corner = sharpestCorner(points, endMid, points.length - 1);
    if (corner !== undefined && turn(points[Math.max(0, corner - 2)], points[corner], points[Math.min(points.length - 1, corner + 2)]) > 120) {
      return { end: 'end', index: corner };
    }
  }
  const startFwd = pointAt(0, 1, tail);
  const startMid = startFwd !== undefined ? pointAt(startFwd, 1, tail) : undefined;
  if (startFwd !== undefined && startMid !== undefined) {
    const corner = sharpestCorner(points, 0, startMid);
    if (corner !== undefined && turn(points[Math.max(0, corner - 2)], points[corner], points[Math.min(points.length - 1, corner + 2)]) > 120) {
      return { end: 'start', index: corner };
    }
  }
  return undefined;
}

/** Index of the tightest turn between two indices (inclusive), comparing neighbours two apart. */
function sharpestCorner(points: Point[], from: number, to: number): number | undefined {
  let best: number | undefined;
  let bestDot = Infinity;
  for (let k = Math.max(2, from); k <= Math.min(points.length - 3, to); k++) {
    const a = points[k - 2], b = points[k], c = points[k + 2];
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const d = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
    if (!d) continue;
    const cos = (v1.x * v2.x + v1.y * v2.y) / d;
    if (cos < bestDot) { bestDot = cos; best = k; }
  }
  return best;
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ── Reading the page (browser) ─────────────────────────────────────────────

const SKIP = new Set(['HTML', 'BODY', 'svg', 'path', 'g', 'SCRIPT', 'STYLE']);

/** The page element at a client point, looking through Ilse's own layers. */
function pageElementAt(x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest('[data-ilse-toolbar]')) continue;
    // An icon's path/svg says less than the button it sits in
    const lifted = el.closest('button, a, [role="button"], label') ?? el;
    if (SKIP.has(lifted.tagName)) continue;
    return lifted;
  }
  return null;
}

/** The rect holds the whole box (a couple of pixels of slack for the stroke's width) */
export function holds(r: { left: number; top: number; right: number; bottom: number }, box: Box, slack = 2): boolean {
  return r.left <= box.left + slack && r.top <= box.top + slack
    && r.right >= box.left + box.width - slack && r.bottom >= box.top + box.height - slack;
}

/**
 * Where a sketch over empty space goes: the smallest element that holds the whole
 * drawing. It reaches the agent the way a click does — component and file:line —
 * so a circle in a blank corner lands in this page's container, not in whatever
 * screen of the app the note happens to describe. Null at <body>: too generic to
 * point at, and the page URL says as much.
 */
export function drawnContainer(box: Box, scroll: Point): Element | null {
  const view: Box = { left: box.left - scroll.x, top: box.top - scroll.y, width: box.width, height: box.height };
  const at = document.elementsFromPoint(view.left + view.width / 2, view.top + view.height / 2)
    .find(el => !el.closest('[data-ilse-toolbar]') && !SKIP.has(el.tagName));
  for (let el: Element | null = at ?? null; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (holds(el.getBoundingClientRect(), view)) return el;
  }
  return null;
}

/** Share of a rect inside a polygon, from a 4×4 sample grid. */
function insideShare(r: DOMRect, poly: Point[]): number {
  let n = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    if (pointInPolygon({ x: r.left + r.width * (i + 0.5) / 4, y: r.top + r.height * (j + 0.5) / 4 }, poly)) n++;
  }
  return n / 16;
}

/** Says something on its own: text, an image, a control. */
function isMeaningful(el: Element): boolean {
  if (/^(IMG|BUTTON|INPUT|SELECT|TEXTAREA|A|VIDEO|CANVAS)$/.test(el.tagName)) return true;
  if (el.querySelector('svg, img')) return true;
  return ((el as HTMLElement).innerText ?? '').trim().length > 0;
}

/** Elements mostly inside the drawn loop — outermost only, capped. */
function enclosedElements(poly: Point[], scroll: Point): Element[] {
  const client = poly.map(p => ({ x: p.x - scroll.x, y: p.y - scroll.y }));
  const b = bounds(client);
  const found = new Set<Element>();
  const stepX = Math.max(8, b.width / 12);
  const stepY = Math.max(8, b.height / 12);
  for (let x = b.left + stepX / 2; x < b.left + b.width; x += stepX) {
    for (let y = b.top + stepY / 2; y < b.top + b.height; y += stepY) {
      if (!pointInPolygon({ x, y }, client)) continue;
      const el = pageElementAt(x, y);
      if (!el) continue;
      // Climb to the largest ancestor that is still mostly inside the loop
      let best: Element = el;
      for (let up = el.parentElement; up && !SKIP.has(up.tagName); up = up.parentElement) {
        if (insideShare(up.getBoundingClientRect(), client) < 0.7) break;
        best = up;
      }
      if (insideShare(best.getBoundingClientRect(), client) >= 0.5) found.add(best);
    }
  }
  // Drop anything nested inside another hit, and empty decoration when there's content
  let list = [...found].filter(el => ![...found].some(o => o !== el && o.contains(el)));
  if (list.some(isMeaningful)) list = list.filter(isMeaningful);
  return list.slice(0, 4);
}

/** The elements a stroke passes over, most-hit first. */
function elementsUnder(points: Point[], scroll: Point): Element[] {
  const hits = new Map<Element, number>();
  const step = Math.max(1, Math.floor(points.length / 24));
  for (let i = 0; i < points.length; i += step) {
    const el = pageElementAt(points[i].x - scroll.x, points[i].y - scroll.y);
    if (el) hits.set(el, (hits.get(el) ?? 0) + 1);
  }
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([el]) => el).slice(0, 3);
}

export interface SketchTarget { el: Element; label: string }

export interface SketchPart {
  reading: StrokeReading;
  color: string;
  /** What the stroke is about: enclosed, crossed, underlined, or the two ends of a line */
  targets: SketchTarget[];
  from?: SketchTarget;
  to?: SketchTarget;
}

export interface SketchResult {
  parts: SketchPart[];
  /** The element the sketch is mostly about — becomes the annotation's element */
  primary: Element | null;
  /** Page-coordinate bounds of all strokes */
  box: Box;
}

export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const role = { a: 'link', button: 'botão', img: 'imagem', input: 'campo', h1: 'título', h2: 'título', h3: 'título', h4: 'título', p: 'parágrafo', li: 'item', label: 'rótulo' }[tag] ?? tag;
  // A container reads by its first lines (usually heading + value), not all its text
  const lines = ((el as HTMLElement).innerText ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const text = (el.getAttribute('aria-label') || lines.slice(0, 2).join(' · ') || el.getAttribute('alt') || '')
    .replace(/\s+/g, ' ').trim();
  return text ? `${role} "${text.length > 40 ? text.slice(0, 39) + '…' : text}"` : role;
}

export function analyzeSketch(strokes: Stroke[]): SketchResult {
  const scroll = { x: window.scrollX, y: window.scrollY };
  const target = (el: Element): SketchTarget => ({ el, label: describeElement(el) });
  const weight = new Map<Element, number>();
  const bump = (el: Element | undefined, n: number) => { if (el) weight.set(el, (weight.get(el) ?? 0) + n); };

  const parts: SketchPart[] = readStrokes(strokes).map(({ stroke, reading }) => {
    const pts = stroke.points;
    const at = (p: Point) => pageElementAt(p.x - scroll.x, p.y - scroll.y);
    switch (reading.shape) {
      case 'enclosure': {
        const els = enclosedElements(pts, scroll);
        els.forEach(el => bump(el, 3));
        return { reading, color: stroke.color, targets: els.map(target) };
      }
      case 'underline': {
        // What's underlined sits just above the line
        const mid = pts[Math.floor(pts.length / 2)];
        const el = at({ x: mid.x, y: bounds(pts).top - 8 });
        bump(el ?? undefined, 3);
        return { reading, color: stroke.color, targets: el ? [target(el)] : [] };
      }
      case 'line': {
        const a = at(pts[0]);
        const b = at(pts[pts.length - 1]);
        // The arrow's tail is what's being talked about; the head is where it goes
        const [from, to] = reading.arrowTo === 'start' ? [b, a] : [a, b];
        bump(from ?? undefined, 2);
        bump(to ?? undefined, 1);
        return {
          reading, color: stroke.color, targets: [],
          ...(from ? { from: target(from) } : {}),
          ...(to && to !== from ? { to: target(to) } : {}),
        };
      }
      default: {
        const els = elementsUnder(pts, scroll);
        els.forEach((el, i) => bump(el, 2 - i * 0.5));
        return { reading, color: stroke.color, targets: els.map(target) };
      }
    }
  });

  const primary = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { parts, primary, box: bounds(strokes.flatMap(s => s.points)) };
}

// ── The note block ─────────────────────────────────────────────────────────

export const SKETCH_NOTE_HEADING = 'Desenho na tela:';

const COLOR_NAMES: Record<string, string> = {
  '#FF6C03': 'laranja', '#EF4444': 'vermelho', '#3B82F6': 'azul', '#22C55E': 'verde', '#111111': 'preto',
};

/** Plain-language reading of the sketch, for the agent (the designer's note field stays theirs). */
export function formatSketchNote(parts: SketchPart[]): string {
  if (parts.length === 0) return '';
  const lines = parts.map((p, i) => {
    const c = COLOR_NAMES[p.color.toUpperCase()] ? ` (${COLOR_NAMES[p.color.toUpperCase()]})` : '';
    const list = (ts: SketchTarget[]) => ts.map(t => t.label).join(', ');
    switch (p.reading.shape) {
      case 'enclosure':
        return `${i + 1}. Circulou${c}: ${p.targets.length ? list(p.targets) : 'uma área vazia'}`;
      case 'underline':
        return `${i + 1}. Sublinhou${c}: ${p.targets.length ? list(p.targets) : 'uma área vazia'}`;
      case 'line': {
        const from = p.from?.label ?? 'área vazia';
        const to = p.to?.label ?? 'área vazia';
        return p.reading.arrowTo
          ? `${i + 1}. Seta${c} de ${from} apontando para ${to}`
          : `${i + 1}. Traço${c} de ${from} até ${to}`;
      }
      default:
        return `${i + 1}. Rabiscou por cima${c}: ${p.targets.length ? list(p.targets) : 'uma área vazia'}`;
    }
  });
  return [SKETCH_NOTE_HEADING, ...lines, 'A imagem anexada mostra o desenho sobre os elementos da página.'].join('\n');
}

// ── The picture ────────────────────────────────────────────────────────────

/** Text written directly in the element, not in its children. */
function ownText(el: Element): string {
  let text = '';
  for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * Strokes over a wireframe of what's beneath them: element outlines and their
 * labels, in the sketch's neighbourhood. PNG data URL, at most ~1400px wide.
 */
export function renderSketchImage(strokes: Stroke[], result: SketchResult): string | null {
  if (typeof document === 'undefined' || strokes.length === 0) return null;
  const scroll = { x: window.scrollX, y: window.scrollY };
  const pad = 80;
  const view = { left: scroll.x, top: scroll.y, right: scroll.x + window.innerWidth, bottom: scroll.y + window.innerHeight };
  const left = Math.max(view.left, result.box.left - pad);
  const top = Math.max(view.top, result.box.top - pad);
  const right = Math.min(view.right, result.box.left + result.box.width + pad);
  const bottom = Math.min(view.bottom, result.box.top + result.box.height + pad);
  const w = Math.max(40, right - left);
  const h = Math.max(40, bottom - top);
  const scale = Math.min(2, 1400 / w);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Wireframe: visible, labelled elements in the region
  const seen = new Set<Element>();
  const targets = new Set(result.parts.flatMap(p => [...p.targets.map(t => t.el), p.from?.el, p.to?.el]).filter(Boolean) as Element[]);
  ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textBaseline = 'top';
  for (let x = left + 10; x < right; x += 24) {
    for (let y = top + 10; y < bottom; y += 24) {
      const el = pageElementAt(x - scroll.x, y - scroll.y);
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width > w * 1.5 && r.height > h * 1.5) continue; // page-sized containers add noise
      const rx = r.left + scroll.x - left;
      const ry = r.top + scroll.y - top;
      const isTarget = targets.has(el);
      const own = ownText(el);
      if (!isTarget && !own) continue; // containers are implied by their contents
      ctx.strokeStyle = isTarget ? '#6366f1' : '#e5e5e5';
      ctx.lineWidth = isTarget ? 2 : 1;
      ctx.strokeRect(rx, ry, r.width, r.height);
      ctx.fillStyle = isTarget ? '#4338ca' : '#525252';
      ctx.fillText(isTarget ? describeElement(el) : own, rx + 3, ry + 2, Math.max(20, r.width - 6));
    }
  }

  // Targets the grid didn't land on directly (a circled container) still get outlined
  for (const el of targets) {
    if (seen.has(el)) continue;
    const r = el.getBoundingClientRect();
    const rx = r.left + scroll.x - left;
    const ry = r.top + scroll.y - top;
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, r.width, r.height);
    ctx.fillStyle = '#4338ca';
    ctx.fillText(describeElement(el), rx + 3, Math.max(2, ry - 14), Math.max(20, r.width - 6));
  }

  // Strokes on top
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const x = p.x - left, y = p.y - top;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  return canvas.toDataURL('image/png');
}
