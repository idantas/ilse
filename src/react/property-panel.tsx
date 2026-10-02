/**
 * Property panel — edit the selected element's styles directly.
 *
 * Docked to the right edge, Figma-style: it stays open while an element is
 * selected instead of hiding inside the annotation card.
 *
 * The point of difference: every dropdown is populated from the project's own
 * design tokens (via getDSTokens()), not from a generic scale. A change made
 * here is on-standard by construction — the designer can't reach for a value
 * the project doesn't have without being told it's off-standard.
 *
 * Edits apply to the DOM immediately as a preview. The real change is written
 * by the agent, from the structured StyleChange[] the panel records.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { radius, color, shadow, font, ilse } from './tokens.js';
import { scopeTwins } from './live-layout.js';
import { useFrontLayer } from './front-layer.js';
import { t } from '../i18n/index.js';
import { getDSTokens, type DSToken } from './analyze.js';
import { readColor, canonicalColor, toHex, isTransparent } from './color.js';
import { collectColorTokens, withStaticTokens, byBaseness, type ColorToken } from './color-tokens.js';
import { ColorPicker } from './color-picker.js';
import { readPageScales, onScale, type PageScales } from './scale.js';
import {
  readLayout, flowStyles, alignStyles, readSize, sizeStyles, readStroke, strokeWidths, type SidesOn,
  effectiveSides, boxMode, boxStyles, withBoxLonghands,
  type Flow, type Pos, type Axis, type SizeMode, type ParentFlow, type BoxProp, type BoxMode, type Sides,
} from './layout-flow.js';
import { ValueSelect } from './value-select.js';
import type { StyleChange } from '../types.js';

// ── Which properties the panel exposes, and how ────────────────────────────

type Group = 'layout' | 'typography' | 'color' | 'stroke' | 'appearance';

interface PropSpec {
  key: string;              // camelCase CSS property
  label: string;
  group: Group;
  tokenType?: DSToken['type'];  // which token family feeds the options
  options?: string[];       // fallback scale when no token family applies
  scale?: keyof PageScales; // spacing/radius: the page's own scale feeds the options
  /** Edited through the Layout controls, not a row of its own */
  control?: boolean;
}

const SPACING_FALLBACK = ['0px', '4px', '8px', '12px', '16px', '24px', '32px'];

const PROPS: PropSpec[] = [
  { key: 'display',        label: 'Display',   group: 'layout', control: true },
  { key: 'flexDirection',  label: 'Direction', group: 'layout', control: true },
  { key: 'flexWrap',       label: 'Wrap',      group: 'layout', control: true },
  { key: 'justifyContent', label: 'Justify',   group: 'layout', control: true },
  { key: 'alignItems',     label: 'Align',     group: 'layout', control: true },
  { key: 'width',          label: 'W',         group: 'layout', control: true },
  { key: 'height',         label: 'H',         group: 'layout', control: true },
  { key: 'flexGrow',       label: 'Grow',      group: 'layout', control: true },
  { key: 'gap',            label: 'Gap',       group: 'layout', scale: 'spacing', options: SPACING_FALLBACK },
  // Padding/margin: one control per property (all · X/Y · sides), every longhand it can write listed
  ...(['padding', 'margin'] as const).flatMap(prop => ['', 'Inline', 'Block', 'Top', 'Right', 'Bottom', 'Left'].map(suffix => ({
    key: `${prop}${suffix}`, label: prop === 'padding' ? 'Padding' : 'Margin', group: 'layout' as Group,
    scale: 'spacing' as const, control: true, options: SPACING_FALLBACK,
  }))),

  { key: 'fontSize',      label: 'Size',        group: 'typography', tokenType: 'typography' },
  { key: 'fontWeight',    label: 'Weight',      group: 'typography', options: ['100', '200', '300', '400', '500', '600', '700', '800', '900'] },
  { key: 'lineHeight',    label: 'Line height', group: 'typography', tokenType: 'typography' },
  { key: 'letterSpacing', label: 'Letter',      group: 'typography' },

  { key: 'color',           label: 'Text',   group: 'color', tokenType: 'color' },
  { key: 'backgroundColor', label: 'Fill',   group: 'color', tokenType: 'color' },
  { key: 'borderColor',     label: 'Color',  group: 'stroke', tokenType: 'color' },
  // Stroke weight/style/sides: edited through the Stroke controls
  ...['borderWidth', 'borderStyle', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']
    .map(key => ({ key, label: 'Stroke', group: 'stroke' as Group, control: true })),

  { key: 'borderRadius', label: 'Radius',  group: 'appearance', scale: 'radius' },
  { key: 'opacity',      label: 'Opacity', group: 'appearance', options: ['0.25', '0.5', '0.75', '0.9', '1'] },
];

const GROUP_LABELS: Record<Group, string> = {
  layout: 'Layout',
  typography: 'Typography',
  color: 'Colors',
  stroke: 'Stroke',
  appearance: 'Appearance',
};

/** Space between the panel's sections (Layout, Typography…) */
const GROUP_GAP = 18;
const groupTitle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: color.mutedForeground, marginBottom: 6,
} as const;

/** Properties whose lists start with "None" (0): spacing, radius, stroke weight */
const NONE_KEYS = /^(gap|padding|margin|borderRadius|border(Top|Right|Bottom|Left)?Width)/;
const isZero = (v: string) => /^-?0(\.0+)?(px|rem|em|%)?$/.test(v.trim());

const COLOR_PROPS = new Set(['color', 'backgroundColor', 'borderColor']);

// ── Value helpers ──────────────────────────────────────────────────────────

function norm(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sameValue(a: string, b: string, isColor: boolean): boolean {
  return isColor ? canonicalColor(a) === canonicalColor(b) : norm(a) === norm(b);
}

function tokensFor(spec: PropSpec, all: DSToken[], colors: ColorToken[], scales: PageScales): DSToken[] {
  if (spec.scale) return scales[spec.scale];
  if (!spec.tokenType) return [];
  if (spec.tokenType === 'color') return colors;
  return all.filter(t => t.type === spec.tokenType);
}

const CLASS_PREFIX: Record<string, string> = { color: 'text', backgroundColor: 'bg', borderColor: 'border' };

/**
 * The token the element's own classes name for this property (`text-foreground`
 * → foreground), so equal colours resolve to the one actually in the code rather
 * than whichever sorts first. Opacity modifiers (`/70`) and variants are ignored.
 */
function tokenFromClasses(el: Element | null, key: string, tokens: DSToken[]): string | undefined {
  const prefix = CLASS_PREFIX[key];
  if (!el || !prefix) return undefined;
  const re = new RegExp(`^${prefix}-(.+?)(?:/\\d+)?$`);
  // Text colour is inherited, so the class may sit on an ancestor.
  const depth = key === 'color' ? 6 : 1;
  for (let node: Element | null = el, i = 0; node && i < depth; node = node.parentElement, i++) {
    for (const cls of Array.from(node.classList)) {
      if (cls.includes(':')) continue; // hover:, dark:, md: — not the resting value
      const m = re.exec(cls);
      if (!m) continue;
      const hit = tokens.find(t => t.name.replace(/^color\./, '').replace(/^color-/, '') === m[1]);
      if (hit) return hit.name;
    }
  }
  return undefined;
}

/**
 * Several tokens can share a colour (surface-2…8 are all white in light mode).
 * `preferred` — the token the designer actually picked — wins among equals.
 */
function matchToken(value: string, tokens: DSToken[], isColor: boolean, preferred?: string): DSToken | undefined {
  const equal = tokens.filter(t => sameValue(t.value, value, isColor));
  // Otherwise the base token over its derivatives: foreground, not accent-foreground.
  return equal.find(t => t.name === preferred) ?? equal.sort(byBaseness)[0];
}

// ── Panel ──────────────────────────────────────────────────────────────────

/** Handle the toolbar keeps to step the panel back (⌘Z while a draft is open) */
export interface PanelHistory {
  undo: () => string | undefined;
  size: () => number;
  resetText: () => void;
  /** The preview outlives the panel (the draft was added): how to put the page back later */
  detachPreview: () => () => void;
}

export interface TextEdit { from: string; to: string }

export function PropertyPanel({ styles, targetId, textSelection, contextLabel, committedRef, onChange, onPickerOpen, onClose, historyRef, onStep, onRemove, removed, textEdit, onTextChange, mirrorAll }: {
  /** "Apply to: all of them" — preview the edits on the component's other instances too */
  mirrorAll?: boolean;
  /** The text already retyped in this draft — a remounted panel picks it up again */
  textEdit?: TextEdit;
  /** The element's text was retyped (undefined: back to what it was) */
  onTextChange?: (edit: TextEdit | undefined) => void;
  /** Remove the element (preview: hidden; the agent takes it out of the JSX) */
  onRemove?: () => void;
  /** Already marked for removal — the command's × in the card takes it back */
  removed?: boolean;
  /** Filled by the panel: undo its last edit */
  historyRef?: { current: PanelHistory | null };
  /** An edit worth one ⌘Z happened (label: what changed) */
  onStep?: (label: string) => void;
  styles: Record<string, string>;
  /** A text selection, not an element — edited like a Figma text layer */
  textSelection?: boolean;
  /** data-ilse-pixel-target of the element being edited — used for live preview */
  targetId?: string;
  contextLabel?: string;
  /**
   * Set by the parent when the annotation is sent. The preview then stays on
   * screen instead of snapping back — reverting at that moment reads as "nothing
   * happened", when in fact the agent is on its way to make it real.
   */
  committedRef?: { current: boolean };
  onChange: (changes: StyleChange[]) => void;
  /** The colour picker opened/closed — the selection overlay steps aside meanwhile */
  onPickerOpen?: (open: boolean) => void;
  onClose?: () => void;
}) {
  // Held once found: on cancel the selection's marker attribute can be gone
  // before this panel unmounts, and the preview must still be put back
  const targetEl = useRef<HTMLElement | null>(null);
  const dsTokens = getDSTokens();
  const [edits, setEdits] = useState<Record<string, string>>({});
  // Mirror for apply(): the picker emits many values in a row while dragging,
  // faster than a render can refresh the closure.
  const editsRef = useRef<Record<string, string>>({});
  // Which token each colour edit came from, when it came from one
  const editTokens = useRef<Record<string, string>>({});
  const originalInline = useRef<Record<string, string>>({});
  // What each edited CSS property previews as (a value or a token's var()),
  // replayed on the component's other instances when the scope is "all"
  const previews = useRef<Record<string, string>>({});
  const twinOriginals = useRef(new Map<HTMLElement, Record<string, string>>());
  const mirrorAllRef = useRef(!!mirrorAll);
  mirrorAllRef.current = !!mirrorAll;
  function unpaintTwins() {
    for (const [tw, orig] of twinOriginals.current) for (const [p, v] of Object.entries(orig).reverse()) tw.style.setProperty(p, v || null);
    twinOriginals.current.clear();
  }
  function syncTwins() {
    unpaintTwins();
    const e = getElement();
    if (!mirrorAllRef.current || !e || Object.keys(previews.current).length === 0) return;
    for (const tw of scopeTwins(e)) {
      const orig: Record<string, string> = {};
      for (const [p, v] of Object.entries(previews.current)) { orig[p] = tw.style.getPropertyValue(p); tw.style.setProperty(p, v); }
      twinOriginals.current.set(tw, orig);
    }
  }
  useEffect(() => { syncTwins(); /* scope switched */ }, [mirrorAll]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Text: retyped in place. The preview writes into the element's own text
  // nodes — React keeps pointing at them, so its next render simply wins. ──
  // `from` comes from the draft when there is one: a remounted panel renders
  // before the old one has put the original text back.
  const [textOriginal] = useState(() => textEdit?.from ?? getElement()?.textContent ?? '');
  const [text, setText] = useState(textEdit?.to ?? textOriginal);
  const textRef = useRef(text);
  const textNodes = useRef<Array<{ node: Text; data: string }> | null>(null);
  function previewText(value: string) {
    const e = getElement();
    if (!e) return;
    textNodes.current ??= Array.from(e.childNodes).filter((n): n is Text => n.nodeType === Node.TEXT_NODE).map(node => ({ node, data: node.data }));
    textNodes.current.forEach((n, i) => { n.node.data = i === 0 ? value : ''; });
  }
  function revertText() { textNodes.current?.forEach(n => { n.node.data = n.data; }); }
  function setTextValue(value: string) {
    setText(value);
    textRef.current = value;
    if (value === textOriginal) revertText(); else previewText(value);
    onTextChange?.(value === textOriginal ? undefined : { from: textOriginal, to: value });
  }
  useEffect(() => {
    if (textEdit && textEdit.to !== textOriginal) previewText(textEdit.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Colour tokens resolved against the element itself — its theme, its scope.
  // Re-read whenever the picker opens, so a theme toggle mid-edit is picked up.
  const [colorEpoch, setColorEpoch] = useState(0);
  const colorTokens = useMemo(
    () => withStaticTokens(collectColorTokens(getElement()), dsTokens),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colorEpoch, targetId, dsTokens],
  );
  const scales = useMemo(() => readPageScales(dsTokens), [dsTokens]);
  // Computed styles + the padding/margin longhands they imply — what "no change" is compared against
  const base = useMemo(() => withBoxLonghands(styles), [styles]);
  const [picker, setPicker] = useState<{ key: string; anchor: DOMRect; anchorEl: Element } | null>(null);
  const closePicker = useCallback(() => setPicker(null), []);
  const pickerOpen = picker !== null;
  useEffect(() => {
    onPickerOpen?.(pickerOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onPickerOpen?.(false), []);

  // Docked to the top-right until dragged, then free-floating like the card.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origTop: number; origLeft: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        top: dragRef.current.origTop + (e.clientY - dragRef.current.startY),
        left: dragRef.current.origLeft + (e.clientX - dragRef.current.startX),
      });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent) {
    const el = panelRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      origTop: box.top, origLeft: box.left,
    };
    // Switch from right-docked to explicit coordinates on the first drag,
    // otherwise the panel would jump as `right` and `left` fight each other.
    setPos({ top: box.top, left: box.left });
  }

  function getElement(): HTMLElement | null {
    if (targetEl.current?.isConnected) return targetEl.current;
    if (!targetId) return null;
    targetEl.current = document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${targetId}"]`);
    return targetEl.current;
  }

  // Revert every preview on unmount — unless the annotation was sent, in which
  // case the preview stands until the agent rewrites the source for real.
  useEffect(() => {
    return () => {
      if (committedRef?.current) return;
      revertText();
      unpaintTwins();
      const el = getElement();
      if (!el) return;
      // Newest first: `padding` then `padding-top` were saved in that order, and
      // the second original was read after the first edit — undo it first
      for (const [prop, original] of Object.entries(originalInline.current).reverse()) {
        el.style.setProperty(prop.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`), original || null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(spec: PropSpec, raw: string, picked?: ColorToken) {
    const value = raw.trim();
    const el = getElement();
    const cssProp = spec.key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
    const isColor = COLOR_PROPS.has(spec.key);

    if (picked) editTokens.current[spec.key] = picked.name;
    else delete editTokens.current[spec.key];

    if (el) {
      if (!(spec.key in originalInline.current)) {
        originalInline.current[spec.key] = el.style.getPropertyValue(cssProp);
      }
      // A token previews through its variable, so it keeps following the theme.
      const preview = picked?.cssVar ? `var(${picked.cssVar})` : value;
      if (value) el.style.setProperty(cssProp, preview);
      else el.style.setProperty(cssProp, originalInline.current[spec.key] || null);
      if (value) previews.current[cssProp] = preview; else delete previews.current[cssProp];
      syncTwins();
    }

    const next = { ...editsRef.current };
    if (!value || sameValue(value, base[spec.key] ?? '', isColor)) delete next[spec.key];
    else next[spec.key] = value;
    editsRef.current = next;
    setEdits(next);
    onChange(buildChanges(next));
  }

  function buildChanges(next: Record<string, string>): StyleChange[] {
    return Object.entries(next).map(([key, to]) => {
      const s = PROPS.find(p => p.key === key)!;
      const family = tokensFor(s, dsTokens, colorTokens, scales);
      const token = matchToken(to, family, COLOR_PROPS.has(key), editTokens.current[key]);
      return {
        property: key,
        from: base[key] ?? '',
        to,
        token: token?.name,
        offToken: family.length > 0 && !token && !onScale(to, family) && !(COLOR_PROPS.has(key) && isTransparent(to))
          && !(NONE_KEYS.test(key) && isZero(to)),
      };
    });
  }

  // What the element looks like with the edits so far — the Layout controls
  // decide which rows make sense (gap only exists in flex/grid).
  const effective: Record<string, string> = { ...styles, ...edits };
  const layout = readLayout(effective);
  // Text reads like a Figma text layer: its colour *is* the fill. A separate
  // "Text" row next to a transparent "Fill" is two answers to one question.
  const el = getElement();
  const isText = !!textSelection || (!!el && el.childElementCount === 0 && !!el.textContent?.trim());
  const parentStyle = el?.parentElement ? getComputedStyle(el.parentElement) : null;
  const parentFlow: ParentFlow = parentStyle && /flex/.test(parentStyle.display)
    ? (parentStyle.flexDirection.startsWith('column') ? 'column' : 'row') : null;
  const [boxModes, setBoxModes] = useState<Partial<Record<BoxProp, BoxMode>>>({});
  // Once the designer picks a mode it's theirs; before that, read it off the classes
  const [sizeModes, setSizeModes] = useState<Partial<Record<Axis, SizeMode>>>({});
  const sizeMode = (axis: Axis): SizeMode =>
    sizeModes[axis] ?? readSize(axis, el ? Array.from(el.classList) : [], parentFlow, styles.display ?? '');
  const textFill = isText && (!styles.backgroundColor || isTransparent(styles.backgroundColor));
  // Stroke: read with the zero widths / `none` filled in, edits on top
  // (adding a stroke writes one `border-width`; the per-side computed zeros must not hide it)
  const strokeInput: Record<string, string> = { ...base, ...edits };
  if (edits.borderWidth) for (const k of ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']) {
    if (!(k in edits)) strokeInput[k] = edits.borderWidth;
  }
  const stroke = readStroke(strokeInput);
  const shown = (p: PropSpec) => {
    if (p.control) return false;
    if (textFill && p.key === 'backgroundColor') return false;
    if (p.key === 'borderColor') return stroke.has;
    if (p.key === 'gap') return layout.flow !== 'block';
    return !!styles[p.key];
  };
  const groups = (['layout', 'typography', 'color', 'stroke', 'appearance'] as Group[])
    .map(g => ({ group: g, specs: PROPS.filter(p => p.group === g && shown(p)) }))
    .filter(g => g.specs.length > 0 || ((g.group === 'layout' || g.group === 'stroke') && !!styles.display));

  // ── History: one step per decision, so ⌘Z walks the draft back ──
  // A colour drag or a stream of the same control within half a second is one step.
  const history = useRef<Array<{ edits: Record<string, string>; tokens: Record<string, string>; text: string; label: string; at: number }>>([]);
  function record(label: string) {
    const last = history.current[history.current.length - 1];
    if (last && last.label === label && Date.now() - last.at < 500) { last.at = Date.now(); return; }
    history.current.push({ edits: { ...editsRef.current }, tokens: { ...editTokens.current }, text: textRef.current, label, at: Date.now() });
    onStep?.(label);
  }
  function undo(): string | undefined {
    const snap = history.current.pop();
    if (!snap) return undefined;
    const keys = new Set([...Object.keys(editsRef.current), ...Object.keys(snap.edits)]);
    for (const key of keys) {
      const spec = PROPS.find(p => p.key === key);
      if (!spec) continue;
      const tokenName = snap.tokens[key];
      const picked = tokenName ? colorTokens.find(tk => tk.name === tokenName) : undefined;
      apply(spec, snap.edits[key] ?? '', picked);
    }
    if (snap.text !== textRef.current) setTextValue(snap.text);
    return snap.label;
  }
  function detachPreview() {
    const styles = { ...originalInline.current };
    const texts = [...(textNodes.current ?? [])];
    const twins = [...twinOriginals.current];
    const target = getElement();
    return () => {
      for (const [tw, orig] of twins) for (const [p, v] of Object.entries(orig).reverse()) tw.style.setProperty(p, v || null);
      const e = target;
      if (e) for (const [prop, original] of Object.entries(styles).reverse()) {
        e.style.setProperty(prop.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`), original || null);
      }
      texts.forEach(n => { n.node.data = n.data; });
    };
  }
  if (historyRef) historyRef.current = { undo, size: () => history.current.length, resetText: () => setTextValue(textOriginal), detachPreview };
  const [front, bringToFront] = useFrontLayer('panel', false);

  function applyMany(values: Record<string, string>, label = PROPS.find(p => p.key === Object.keys(values)[0])?.label ?? 'Layout') {
    record(label);
    for (const [key, v] of Object.entries(values)) apply(PROPS.find(p => p.key === key)!, v);
  }

  if (groups.length === 0 || typeof document === 'undefined') return null;

  const editCount = Object.keys(edits).length;

  return createPortal(
    <div
      ref={panelRef}
      data-ilse-toolbar
      data-ilse-panel
      onMouseDownCapture={bringToFront}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', width: 248,
        ...(pos ? { top: pos.top, left: pos.left } : { top: 16, right: 16 }),
        maxHeight: 'calc(100vh - 120px)',
        display: 'flex', flexDirection: 'column',
        backgroundColor: color.popover,
        border: `1px solid ${color.border}`,
        borderRadius: radius.xl,
        boxShadow: shadow.xl,
        fontFamily: font.sans,
        zIndex: front ? 99999 : 99998,
        overflow: 'hidden',
      }}
    >
      {/* Header — element + how much design context is backing the options */}
      <div
        onMouseDown={startDrag}
        style={{
          padding: '10px 12px', borderBottom: `1px solid ${color.border}`,
          display: 'flex', alignItems: 'center', gap: 6,
          cursor: 'move', userSelect: 'none',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, color: color.foreground, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {contextLabel || 'Element'}
          </div>
          <div style={{ fontSize: 9, color: color.mutedForeground, marginTop: 1 }}>
            {(() => {
              const all = [...dsTokens.filter(t => t.type !== 'color'), ...colorTokens];
              return all.length > 0 ? `${all.length} tokens · ${countByType(all)}` : t('panel.noTokens');
            })()}
          </div>
        </div>
        {editCount > 0 && (
          <span style={{
            fontSize: 9, padding: '2px 6px', borderRadius: radius.full,
            backgroundColor: '#FFECDE', color: '#8A4B12', flexShrink: 0,
          }}>
            {editCount}
          </span>
        )}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: color.mutedForeground, fontSize: 14, lineHeight: 1, flexShrink: 0,
            }}
          >
            ×
          </button>
        )}
      </div>

      <div style={{ padding: '10px 12px 12px', overflowY: 'auto', fontSize: 11 }}>
        {isText && !textSelection && el && (
          <div style={{ marginBottom: GROUP_GAP }}>
            <div style={groupTitle}>Text</div>
            <textarea
              value={text}
              onChange={(e) => { record('Texto'); setTextValue(e.target.value); }}
              rows={Math.min(4, Math.max(1, Math.ceil(text.length / 34)))}
              spellCheck
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'none', display: 'block',
                fontSize: 11, fontFamily: font.sans, lineHeight: 1.4,
                padding: '4px 6px', borderRadius: radius.sm,
                border: `1px solid ${text !== textOriginal ? '#E8A33D' : color.border}`,
                backgroundColor: color.background, color: color.foreground, outline: 'none',
              }}
            />
          </div>
        )}
        {groups.map(({ group, specs }, gi) => (
          <div key={group} style={{ marginBottom: gi === groups.length - 1 ? 0 : GROUP_GAP }}>
            <div style={groupTitle}>
              {GROUP_LABELS[group]}
              {group === 'stroke' && (
                <IconButton
                  title={stroke.has ? 'Remover stroke' : 'Adicionar stroke'}
                  onClick={() => applyMany(stroke.has
                    ? strokeWidths([false, false, false, false], '0px')
                    : { borderStyle: 'solid', ...strokeWidths([true, true, true, true], '1px') })}
                >
                  {stroke.has ? '−' : '+'}
                </IconButton>
              )}
            </div>
            {group === 'layout' && (
              <LayoutControls
                layout={layout}
                edited={['display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems'].some(k => k in edits)}
                onFlow={(flow) => applyMany(flowStyles(flow, effective.display ?? ''))}
                onAlign={(x, y) => applyMany(alignStyles(layout.flow, x, y, layout.between))}
                onBetween={(on) => applyMany({ justifyContent: on ? 'space-between' : 'flex-start' })}
                onWrap={(on) => applyMany({ flexWrap: on ? 'wrap' : 'nowrap' })}
                size={textSelection ? undefined : {
                  mode: sizeMode,
                  value: (axis) => effective[axis] ?? '',
                  fillHint: parentFlow ? 'flex-1' : 'w-full',
                  edited: ['width', 'height', 'flexGrow'].some(k => k in edits),
                  onMode: (axis, mode) => {
                    setSizeModes(m => ({ ...m, [axis]: mode }));
                    applyMany(sizeStyles(axis, mode, parentFlow, styles[axis] ?? ''));
                  },
                  onValue: (axis, v) => {
                    setSizeModes(m => ({ ...m, [axis]: 'fixed' }));
                    applyMany(sizeStyles(axis, 'fixed', parentFlow, /^\d+(\.\d+)?$/.test(v.trim()) ? `${v.trim()}px` : v.trim()));
                  },
                }}
              />
            )}
            {specs.map(spec => (
              <PropertyRow
                key={spec.key}
                spec={textFill && spec.key === 'color' ? { ...spec, label: 'Fill' } : spec}
                current={styles[spec.key] ?? '0px'}
                edited={edits[spec.key]}
                tokens={tokensFor(spec, dsTokens, colorTokens, scales)}
                preferredToken={editTokens.current[spec.key] ?? tokenFromClasses(getElement(), spec.key, colorTokens)}
                pickerOpen={picker?.key === spec.key}
                onOpenPicker={(el) => {
                  if (picker?.key === spec.key) { setPicker(null); return; }
                  setColorEpoch(n => n + 1);
                  setPicker({ key: spec.key, anchor: (panelRef.current ?? el).getBoundingClientRect(), anchorEl: el });
                }}
                onApply={(v) => { record(spec.label); apply(spec, v); }}
              />
            ))}
            {group === 'stroke' && stroke.has && (
              <StrokeControls
                stroke={stroke}
                onWeight={(w) => applyMany(strokeWidths(stroke.on, /^\d+(\.\d+)?$/.test(w) ? `${w}px` : w))}
                onStyle={(st) => applyMany({ borderStyle: st })}
                onSides={(on) => applyMany(on.some(Boolean) ? strokeWidths(on, stroke.weight) : strokeWidths(on, '0px'))}
              />
            )}
            {group === 'layout' && !textSelection && (['padding', 'margin'] as const).map(prop => {
              const sides = effectiveSides(prop, styles, edits);
              const mode = boxModes[prop] ?? boxMode(sides);
              return (
                <BoxSpacing
                  key={prop}
                  prop={prop}
                  sides={sides}
                  mode={mode}
                  tokens={scales.spacing}
                  fallback={SPACING_FALLBACK}
                  edited={Object.keys(edits).some(k => k.startsWith(prop))}
                  onMode={(m) => setBoxModes(prev => ({ ...prev, [prop]: m }))}
                  onSides={(next) => applyMany(boxStyles(prop, mode, next))}
                />
              );
            })}
          </div>
        ))}
      </div>

      {onRemove && (
        <div style={{ borderTop: `1px solid ${color.border}`, padding: 8 }}>
          <button
            onClick={onRemove}
            disabled={removed}
            title={removed ? t('panel.removed') : t('panel.removeHint')}
            className="ilse-panel-remove"
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '6px 8px', borderRadius: radius.md, border: 'none',
              background: 'none', fontSize: 11, fontFamily: font.sans,
              color: removed ? ilse.brand : color.mutedForeground,
              cursor: removed ? 'default' : 'pointer',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v4.5M9.5 6.5v4.5" />
            </svg>
            {removed ? t('panel.removedShort') : t('panel.remove')}
          </button>
        </div>
      )}

      {picker && (() => {
        const spec = PROPS.find(p => p.key === picker.key)!;
        return (
          <ColorPicker
            value={edits[spec.key] ?? styles[spec.key] ?? ''}
            tokens={colorTokens}
            tokenName={editTokens.current[spec.key] ?? tokenFromClasses(getElement(), spec.key, colorTokens)}
            anchor={picker.anchor}
            anchorEl={picker.anchorEl}
            onPick={(v, token) => { record(spec.label); apply(spec, v, token); }}
            onClose={closePicker}
          />
        );
      })()}
    </div>,
    document.body,
  );
}

function countByType(tokens: DSToken[]): string {
  const by: Record<string, number> = {};
  for (const t of tokens) by[t.type] = (by[t.type] ?? 0) + 1;
  return Object.entries(by).map(([k, n]) => `${n} ${k}`).join(', ');
}

// ── Layout — flow + alignment, Figma auto layout as the reference ─────────

const FLOWS: Array<{ flow: Flow; title: string; icon: React.ReactNode }> = [
  { flow: 'block', title: 'Block — sem flow', icon: (
    <><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="4" width="5" height="5" rx="1.2" /><rect x="4" y="9" width="5" height="5" rx="1.2" /></>
  ) },
  { flow: 'vertical', title: 'Vertical — flex-col', icon: (
    <><rect x="2" y="2" width="7" height="5" rx="1.2" /><rect x="2" y="9" width="7" height="5" rx="1.2" /><path d="M13 3v9m-2-2 2 2 2-2" /></>
  ) },
  { flow: 'horizontal', title: 'Horizontal — flex-row', icon: (
    <><rect x="2" y="2" width="5" height="7" rx="1.2" /><rect x="9" y="2" width="5" height="7" rx="1.2" /><path d="M3 13h9m-2-2 2 2-2 2" /></>
  ) },
  { flow: 'grid', title: 'Grid', icon: (
    <><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="9" width="5" height="5" rx="1.2" /><rect x="9" y="9" width="5" height="5" rx="1.2" /></>
  ) },
];

const POSITIONS: Pos[] = ['start', 'center', 'end'];

interface SizeControl {
  mode: (axis: Axis) => SizeMode;
  value: (axis: Axis) => string;
  fillHint: string;
  edited: boolean;
  onMode: (axis: Axis, mode: SizeMode) => void;
  onValue: (axis: Axis, value: string) => void;
}

const SIZE_MODES: Array<{ mode: SizeMode; label: string; hint: (axis: Axis, fill: string) => string }> = [
  { mode: 'fixed', label: 'Fixed', hint: (a) => `${a === 'width' ? 'w' : 'h'}-[px] ou %` },
  { mode: 'hug',   label: 'Hug',   hint: (a) => `${a === 'width' ? 'w' : 'h'}-fit — abraça o conteúdo` },
  { mode: 'fill',  label: 'Fill',  hint: (a, fill) => `${fill === 'flex-1' ? 'flex-1' : a === 'width' ? 'w-full' : 'h-full'} — ocupa o espaço do pai` },
];

function SizeRow({ axis, size }: { axis: Axis; size: SizeControl }) {
  const mode = size.mode(axis);
  const value = size.value(axis);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
      <span style={{ width: 60, flexShrink: 0, color: color.mutedForeground }}>{axis === 'width' ? 'Width' : 'Height'}</span>
      <select
        value={mode}
        onChange={(e) => size.onMode(axis, e.target.value as SizeMode)}
        title={SIZE_MODES.find(m => m.mode === mode)!.hint(axis, size.fillHint)}
        style={{
          width: 62, flexShrink: 0, fontSize: 11, fontFamily: font.sans, cursor: 'pointer',
          padding: '3px 2px', borderRadius: radius.sm, border: `1px solid ${color.border}`,
          backgroundColor: color.background, color: color.foreground,
        }}
      >
        {SIZE_MODES.map(m => <option key={m.mode} value={m.mode}>{m.label}</option>)}
      </select>
      <input
        key={`${mode}-${value}`}
        defaultValue={shortValue(value)}
        placeholder="px ou %"
        title="Número = px · aceita 50%, 20rem…"
        onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== shortValue(value)) size.onValue(axis, e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{
          flex: 1, minWidth: 0, fontSize: 11, fontFamily: font.mono,
          padding: '3px 4px', borderRadius: radius.sm, border: `1px solid ${color.border}`,
          backgroundColor: color.background,
          color: mode === 'fixed' ? color.foreground : color.mutedForeground,
        }}
      />
    </div>
  );
}

function LayoutControls({ layout, edited, onFlow, onAlign, onBetween, onWrap, size }: {
  size?: SizeControl;
  layout: ReturnType<typeof readLayout>;
  edited: boolean;
  onFlow: (flow: Flow) => void;
  onAlign: (x: Pos, y: Pos) => void;
  onBetween: (on: boolean) => void;
  onWrap: (on: boolean) => void;
}) {
  const flex = layout.flow === 'vertical' || layout.flow === 'horizontal';
  // While distributing, the main axis is spread — the whole line lights up
  const lit = (x: Pos, y: Pos) => !layout.between
    ? layout.x === x && layout.y === y
    : layout.flow === 'vertical' ? layout.x === x : layout.y === y;

  return (
    <div style={{ marginBottom: 6 }}>
      {/* Size — Fixed / Hug / Fill per axis, like Figma's W/H */}
      {size && (
        <>
          <SizeRow axis="width" size={size} />
          <SizeRow axis="height" size={size} />
        </>
      )}
      {/* Flow — segmented, four ways a box can lay out its children */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
        <span style={{ width: 60, flexShrink: 0, color: color.mutedForeground }}>Flow</span>
        <div style={{
          flex: 1, display: 'flex', padding: 2, gap: 2, borderRadius: radius.sm,
          backgroundColor: color.muted, position: 'relative',
        }}>
          {FLOWS.map(f => {
            const on = layout.flow === f.flow;
            return (
              <button
                key={f.flow}
                title={f.title}
                onClick={() => { if (!on) onFlow(f.flow); }}
                style={{
                  flex: 1, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none', borderRadius: radius.sm - 2, cursor: on ? 'default' : 'pointer',
                  backgroundColor: on ? color.background : 'transparent',
                  boxShadow: on ? shadow.xs : 'none',
                  color: on ? color.foreground : color.mutedForeground,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  {f.icon}
                </svg>
              </button>
            );
          })}
        </div>
        {edited && <span title="alterado" style={{ width: 5, height: 5, flexShrink: 0, borderRadius: '50%', backgroundColor: '#E8A33D' }} />}
      </div>

      {/* Alignment — a 3×3 grid in screen terms, plus distribute and wrap */}
      {flex && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 2 }}>
          <span style={{ width: 60, flexShrink: 0, color: color.mutedForeground, paddingTop: 4 }}>Align</span>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 18px)', gridTemplateRows: 'repeat(3, 18px)',
            padding: 3, borderRadius: radius.sm, backgroundColor: color.muted, flexShrink: 0,
          }}>
            {POSITIONS.map(y => POSITIONS.map(x => {
              const on = lit(x, y);
              return (
                <button
                  key={`${x}-${y}`}
                  title={`${x === 'start' ? 'esquerda' : x === 'center' ? 'centro' : 'direita'} · ${y === 'start' ? 'topo' : y === 'center' ? 'meio' : 'base'}`}
                  onClick={() => onAlign(x, y)}
                  style={{
                    width: 18, height: 18, padding: 0, border: 'none', background: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <span style={{
                    width: on ? 8 : 3, height: on ? 8 : 3, borderRadius: on ? 2 : '50%',
                    backgroundColor: on ? color.foreground : color.ring,
                    transition: 'all 0.12s',
                  }} />
                </button>
              );
            }))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
            <Toggle on={layout.between} onClick={() => onBetween(!layout.between)} label="Space between" hint="justify-between" />
            {layout.flow === 'horizontal' && (
              <Toggle on={layout.wrap} onClick={() => onWrap(!layout.wrap)} label="Wrap" hint="flex-wrap" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      onClick={onClick}
      title={hint}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, width: '100%',
        padding: '3px 6px', borderRadius: radius.sm, cursor: 'pointer', textAlign: 'left',
        fontSize: 10, fontFamily: font.sans,
        border: `1px solid ${on ? color.foreground : color.border}`,
        backgroundColor: on ? color.foreground : color.background,
        color: on ? color.background : color.foreground,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

// ── One property row ───────────────────────────────────────────────────────

function PropertyRow({ spec, current, edited, tokens, preferredToken, pickerOpen, onOpenPicker, onApply }: {
  spec: PropSpec;
  current: string;
  edited?: string;
  tokens: DSToken[];
  preferredToken?: string;
  pickerOpen?: boolean;
  onOpenPicker?: (anchor: HTMLElement) => void;
  onApply: (value: string) => void;
}) {
  const value = edited ?? current;
  const isColor = COLOR_PROPS.has(spec.key);
  const matched = matchToken(value, tokens, isColor, preferredToken);
  // `transparent` is a keyword every system has (bg-transparent), not a stray value.
  const clear = isColor && !matched && isTransparent(value);
  const isOffToken = tokens.length > 0 && !matched && !clear && !onScale(value, tokens) && !(NONE_KEYS.test(spec.key) && isZero(value));
  const controlStyle = {
    flex: 1, minWidth: 0, fontSize: 11, fontFamily: font.sans,
    padding: '3px 4px', borderRadius: radius.sm,
    border: `1px solid ${isOffToken ? '#E8A33D' : color.border}`,
    backgroundColor: color.background, color: color.foreground,
  } as const;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
      <span style={{
        width: 60, flexShrink: 0, color: color.mutedForeground,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {spec.label}
      </span>

      {isColor ? (
        // Colour: swatch + name open the picker (tokens and custom in one place).
        // Shown as the token name, or hex — `oklch(0.505 0.213 27.518)` tells a
        // designer nothing at a glance. The authored value is what gets sent.
        <button
          onClick={(e) => onOpenPicker?.(e.currentTarget)}
          title={value}
          style={{
            ...controlStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textAlign: 'left',
            borderColor: pickerOpen ? color.ring : isOffToken ? '#E8A33D' : color.border,
          }}
        >
          <Swatch value={value} />
          <span style={{
            flex: isOffToken ? 'none' : 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: matched || clear ? font.sans : font.mono,
          }}>
            {matched ? tokenLabel(matched) : clear ? 'transparent' : toHex(value).toUpperCase()}
          </span>
          {isOffToken && (
            <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontSize: 9, color: '#8A4B12', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              fora do padrão
            </span>
          )}
        </button>
      ) : (
        <ScaleControl spec={spec} value={value} tokens={tokens} preferredToken={preferredToken} onApply={onApply} />
      )}

      {edited && (
        <span title="alterado" style={{
          width: 5, height: 5, flexShrink: 0, borderRadius: '50%', backgroundColor: '#E8A33D',
        }} />
      )}
    </div>
  );
}

/**
 * The value control for anything that isn't a colour: the scale as a dropdown
 * (with "Outro valor…" on top), a free input for a value off the list, or a
 * plain input when there's no list at all.
 */
function ScaleControl({ spec, value, tokens, preferredToken, onApply, prefix, compact }: {
  spec: PropSpec;
  value: string;
  tokens: DSToken[];
  preferredToken?: string;
  onApply: (value: string) => void;
  prefix?: React.ReactNode;
  compact?: boolean;
}) {
  const none = NONE_KEYS.test(spec.key);
  const isNone = none && isZero(value);
  const matched = isNone ? undefined : matchToken(value, tokens, false, preferredToken);
  const isOffToken = tokens.length > 0 && !matched && !isNone && !onScale(value, tokens);
  const [custom, setCustom] = useState(false);
  const listed = tokens.length > 0
    ? tokens.map(t => ({ label: t.label ?? t.name, value: t.value, hint: t.value }))
    : (spec.options ?? []).map(o => ({ label: o, value: o }));
  // "None" first, where zero means something (no padding, square corners, no stroke)
  const options = none ? [{ label: 'None', value: '0px', hint: '0' }, ...listed.filter(o => !isZero(o.value))] : listed;

  const inputStyle = {
    flex: 1, minWidth: 0, fontSize: 11, fontFamily: font.mono,
    padding: '3px 4px', borderRadius: radius.sm,
    border: `1px solid ${isOffToken ? '#E8A33D' : color.border}`,
    backgroundColor: color.background, color: color.foreground,
  } as const;

  if (custom || options.length === 0) {
    return (
      <input
        key={custom ? 'custom' : value}
        autoFocus={custom}
        defaultValue={value}
        placeholder="ex. 10px"
        onBlur={(e) => { setCustom(false); if (e.target.value.trim()) onApply(e.target.value.trim()); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape' && custom) { e.stopPropagation(); setCustom(false); }
        }}
        style={inputStyle}
      />
    );
  }
  const shown = isNone ? 'None' : matched ? (matched.label ?? tokenLabel(matched)) : shortValue(value);
  return (
    <ValueSelect
      options={options}
      current={isNone ? '0px' : matched?.value}
      display={isOffToken && !compact ? `${shown} · fora do padrão` : shown}
      offToken={isOffToken}
      prefix={prefix}
      compact={compact}
      groupLabel={tokens.length > 0 ? 'No padrão do projeto' : 'Valores comuns'}
      onPick={onApply}
      onCustom={() => setCustom(true)}
    />
  );
}

// ── Stroke — weight, style, sides ──────────────────────────────────────────

function IconButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        width: 20, height: 20, flexShrink: 0, padding: 0, borderRadius: radius.sm - 2, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, lineHeight: 1, fontFamily: font.sans,
        border: `1px solid ${active ? color.foreground : 'transparent'}`,
        backgroundColor: active ? color.muted : 'transparent',
        color: active ? color.foreground : color.mutedForeground,
      }}
    >
      {children}
    </button>
  );
}

const STROKE_WEIGHTS = ['1px', '2px', '4px', '8px'];
const STROKE_STYLES: Array<{ value: string; title: string; dash?: string }> = [
  { value: 'solid', title: 'Sólido — border-solid' },
  { value: 'dashed', title: 'Tracejado — border-dashed', dash: '3 2' },
  { value: 'dotted', title: 'Pontilhado — border-dotted', dash: '0.1 2.4' },
];
const SIDE_TITLES = ['Em cima — border-t', 'Direita — border-r', 'Embaixo — border-b', 'Esquerda — border-l'];
const SIDE_PATHS = ['M4 2.5h8', 'M13.5 4v8', 'M4 13.5h8', 'M2.5 4v8'];

function StrokeControls({ stroke, onWeight, onStyle, onSides }: {
  stroke: ReturnType<typeof readStroke>;
  onWeight: (w: string) => void;
  onStyle: (s: string) => void;
  onSides: (on: SidesOn) => void;
}) {
  const weightSpec: PropSpec = { key: 'borderWidth', label: 'Weight', group: 'stroke', options: STROKE_WEIGHTS };
  const row = (label: string, control: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
      <span style={{ width: 60, flexShrink: 0, color: color.mutedForeground }}>{label}</span>
      {control}
    </div>
  );
  return (
    <>
      {row('Weight', <ScaleControl spec={weightSpec} value={stroke.weight} tokens={[]} onApply={onWeight} />)}
      {row('Style', (
        <div style={{ flex: 1, display: 'flex', gap: 2, padding: 2, borderRadius: radius.sm, backgroundColor: color.muted }}>
          {STROKE_STYLES.map(st => {
            const on = stroke.style === st.value;
            return (
              <button
                key={st.value}
                title={st.title}
                aria-pressed={on}
                onClick={() => { if (!on) onStyle(st.value); }}
                style={{
                  flex: 1, height: 20, border: 'none', borderRadius: radius.sm - 2, cursor: on ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: on ? color.background : 'transparent', boxShadow: on ? shadow.xs : 'none',
                  color: on ? color.foreground : color.mutedForeground,
                }}
              >
                <svg width="22" height="6" viewBox="0 0 22 6"><path d="M1 3h20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray={st.dash} /></svg>
              </button>
            );
          })}
        </div>
      ))}
      {row('Sides', (
        <div style={{ flex: 1, display: 'flex', gap: 2 }}>
          {stroke.on.map((on, i) => (
            <IconButton
              key={i}
              title={SIDE_TITLES[i]}
              active={on}
              onClick={() => { const next = [...stroke.on] as SidesOn; next[i] = !on; onSides(next); }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2.5" y="2.5" width="11" height="11" rx="2" strokeOpacity="0.3" />
                <path d={SIDE_PATHS[i]} strokeWidth="2.2" strokeLinecap="round" strokeOpacity={on ? 1 : 0.45} />
              </svg>
            </IconButton>
          ))}
          <span style={{ flex: 1 }} />
          <IconButton
            title="Todos os lados — border"
            active={stroke.on.every(Boolean)}
            onClick={() => onSides([true, true, true, true])}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2.5" y="2.5" width="11" height="11" rx="2" /></svg>
          </IconButton>
        </div>
      ))}
    </>
  );
}

// ── Padding / margin — all sides, per axis, or per side ────────────────────

const BOX_MODES: Array<{ mode: BoxMode; title: string; icon: React.ReactNode }> = [
  { mode: 'all',   title: 'Todos os lados — p-4',             icon: <rect x="3" y="3" width="10" height="10" rx="1.5" /> },
  { mode: 'axis',  title: 'Horizontal e vertical — px-4 py-2', icon: <><path d="M2 8h12M4 6 2 8l2 2M12 6l2 2-2 2" /></> },
  { mode: 'sides', title: 'Cada lado — pt pr pb pl',          icon: <><path d="M3 3h10M3 13h10M3 3v10M13 3v10" strokeDasharray="2 2" /></> },
];

/** Side markers — the stroke shows which edge the value is for */
const SIDE_ICON = (d: string) => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" strokeOpacity="0.35" />
    <path d={d} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const SIDE_ICONS = {
  top: SIDE_ICON('M4 2.5h8'), right: SIDE_ICON('M13.5 4v8'), bottom: SIDE_ICON('M4 13.5h8'), left: SIDE_ICON('M2.5 4v8'),
  x: SIDE_ICON('M2.5 5v6M13.5 5v6'), y: SIDE_ICON('M5 2.5h6M5 13.5h6'),
};

function BoxSpacing({ prop, sides, mode, tokens, fallback, edited, onMode, onSides }: {
  prop: BoxProp;
  sides: Sides;
  mode: BoxMode;
  tokens: DSToken[];
  fallback: string[];
  edited: boolean;
  onMode: (mode: BoxMode) => void;
  onSides: (sides: Sides) => void;
}) {
  const [t, r, b, l] = sides;
  const spec: PropSpec = { key: prop, label: prop, group: 'layout', options: fallback };
  const next = BOX_MODES[(BOX_MODES.findIndex(m => m.mode === mode) + 1) % BOX_MODES.length];
  const current = BOX_MODES.find(m => m.mode === mode)!;
  const control = (value: string, set: (v: string) => Sides, icon?: React.ReactNode) => (
    <ScaleControl spec={spec} value={value} tokens={tokens} compact={!!icon} prefix={icon} onApply={(v) => onSides(set(v))} />
  );

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 4 }}>
      <span style={{ width: 60, flexShrink: 0, color: color.mutedForeground, paddingTop: 4 }}>
        {prop === 'padding' ? 'Padding' : 'Margin'}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4, gridTemplateColumns: mode === 'all' ? '1fr' : '1fr 1fr' }}>
        {mode === 'all' && control(t, v => [v, v, v, v])}
        {mode === 'axis' && <>
          {control(r, v => [t, v, b, v], SIDE_ICONS.x)}
          {control(t, v => [v, r, v, l], SIDE_ICONS.y)}
        </>}
        {mode === 'sides' && <>
          {control(t, v => [v, r, b, l], SIDE_ICONS.top)}
          {control(r, v => [t, v, b, l], SIDE_ICONS.right)}
          {control(b, v => [t, r, v, l], SIDE_ICONS.bottom)}
          {control(l, v => [t, r, b, v], SIDE_ICONS.left)}
        </>}
      </div>
      <button
        onClick={() => onMode(next.mode)}
        title={`${current.title}\nClique: ${next.title}`}
        style={{
          width: 22, height: 22, flexShrink: 0, padding: 0, borderRadius: radius.sm, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${mode === 'all' ? color.border : color.foreground}`,
          backgroundColor: mode === 'all' ? color.background : color.muted,
          color: color.foreground,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {current.icon}
        </svg>
      </button>
      {edited && <span title="alterado" style={{ width: 5, height: 5, flexShrink: 0, marginTop: 9, borderRadius: '50%', backgroundColor: '#E8A33D' }} />}
    </div>
  );
}

function tokenLabel(t: DSToken): string {
  return t.name.replace(/^color\./, '').replace(/^color-/, '');
}

/** Checkerboard shows through transparency — a solid chip would read as a colour. */
function Swatch({ value }: { value: string }) {
  const c = readColor(value);
  return (
    <span style={{
      width: 14, height: 14, flexShrink: 0, borderRadius: 3, overflow: 'hidden',
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
      backgroundImage:
        'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%),' +
        'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)',
      backgroundSize: '6px 6px', backgroundPosition: '0 0, 3px 3px', backgroundColor: '#fff',
    }}>
      <span style={{
        display: 'block', width: '100%', height: '100%',
        backgroundColor: c ? `rgba(${c.r},${c.g},${c.b},${c.a})` : 'transparent',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
      }} />
    </span>
  );
}

/** Long computed values (oklch/oklab/rgba) blow out the select width. */
function shortValue(v: string): string {
  return v.length > 18 ? `${v.slice(0, 17)}…` : v;
}
