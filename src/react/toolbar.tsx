import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import {
  IconPointer,
  IconCrosshair,
  IconPlayerPause,
  IconPlayerPlay,
  IconEye,
  IconEyeOff,
  IconTrash,
  IconBolt,
  IconEyeglass2,
  IconSettings,
  IconArrowBackUp,
  IconX,
  IconArrowUp,
  IconChevronRight,
  IconCornerLeftUp,
  IconMessage,

  IconRefresh,
  IconMaximize,
  IconPencil,
  IconRoute,
  IconListDetails,
  IconComponents,
  IconDevices,
} from '@tabler/icons-react';
import { captureElement, captureTextSelection, captureArea, captureEnvironment, humanizeSelector, pageComponents, type ElementCapture } from './annotator.js';
import { analyzeElement, scanPage, setDSTokens, getDSTokens, parseTokensJSON, type Suggestion, type PageIssue } from './analyze.js';
import { connect, disconnect, send, onMessage, onStatus, isConnected } from './ws-client.js';
import { watchRepaints, REPAINT_WAIT_MS, sameText, softRefresh } from './repaint-watch.js';
import { copyPlacement, lineOf, type Neighbour } from './copy-place.js';
import { watchPageErrors, newErrors } from './page-errors.js';
import { useImageInput, InlineAttachments } from './image-input.js';
import { CatalogPanel, CatalogWindow, bestSnapshot, type DsInfo } from './catalog-panel.js';
import { DsViewer, type DsViewData, type DsCheckState } from './ds-viewer.js';
import { componentAt, findInstances, instanceAt, liftAnchor, namesOnPage, sameVariant, snapshotPage, variantKey, type InstanceRef, type CatalogItem, type CatalogSnapshot } from './catalog-snapshot.js';
import { ComponentSection, type PropChange } from './component-section.js';
import { previewVariant, makeDraft, placeDraft, placeholderHtml, removeDraft, restyleDraft, jsxPreview, type DropTarget, type Placement } from './component-drop.js';
import { PropertyPanel, resetPanelPosition, type PanelTab, type PanelHistory, type TextEdit } from './property-panel.js';
import { useFrontLayer } from './front-layer.js';
import { SketchLayer, PencilControl, PEN_COLORS } from './sketch-layer.js';
import { ElementTree } from './element-tree.js';
import { IlseMascot, type MascotActivity, type MascotMode, type MascotReaction } from './mascot.js';
import { SpeechBubble, speechButton, reasoningLine, ReasoningDot } from './speech-bubble.js';
import { findingsForPage, findingNote, findingElement, findingRef, type TestFinding, type TestFindingRef, type TestRunMeta } from './test-findings.js';
import { analyzeSketch, renderSketchImage, formatSketchNote, drawnContainer, pageElementAt, type Stroke } from './sketch.js';
import { recordScrollers, scrollShift, scrollerNow, visibleIn } from './scroll-anchor.js';
import { beginDrag, beginInsert, anchorOf as insertAnchor, type LiveInsert, beginResize, settleElement, expireElement, formatReorder, formatReparent, reorderUnit, neighboursAfterReorder, componentScope, scopeTwins, type LiveDrag, selectionTarget, selectableParent, isDataRow, itemLabel } from './live-layout.js';
import type { StyleChange, StyleData } from '../types.js';
import { toggleFreeze, isFrozen } from './freeze.js';
import { shieldPage } from './shield.js';
import { MemoryPanel, type MemoryData } from './memory-panel.js';
import { TestSetup, parseOffer, type TestOffer, type TestGroup, type ScreenSize } from './test-setup.js';
import { FindingActions, TestReport, type ReportTab } from './test-report.js';
import { journeyFinding, parseReport, type JourneyReport } from './journey-report.js';
import { useLift } from './above-stack.js';
import { JourneysPanel, type JourneySummary, type JourneyLive, type JourneySuggestion } from './journeys-panel.js';
import { TooltipLayer } from './tooltip-layer.js';
import { PillBtn } from './pill-btn.js';
// Inside the Screens iframe (EMBEDDED): select and edit, no toolbar — the host's Screens bar has Run / Undo
import { EMBEDDED, uiDocument, type Device, type EmbedState, type ScreensAction } from './screens.js';
import { ScreensMenu, ScreensView, useScreensEmbed, leaveScreens } from './screens-view.js';
import { radius, color, shadow, ilse, font, modeAccent, proText } from './tokens.js';
import { t, detectLocale, setLocale, getLocale, type Locale } from '../i18n/index.js';
import { withShortcut, isTyping, doublePress, mod, SHORTCUT_GROUPS } from './shortcuts.js';

// ── Clipboard fallback: format annotations as markdown ──────────────────────

function formatAnnotationMarkdown(ann: AnnotationDraft, index: number, env?: ReturnType<typeof captureEnvironment>): string {
  const lines: string[] = [];
  lines.push(`### ${index + 1}. ${ann.capture.element}${ann.capture.component ? ` (${ann.capture.component})` : ''}`);
  if (ann.capture.grepPattern) lines.push(`**Grep:** \`${ann.capture.grepPattern}\``);
  if (ann.capture.componentStack?.length) lines.push(`**Stack:** ${ann.capture.componentStack.join(' > ')}`);
  if (ann.capture.domPath) lines.push(`**DOM:** ${ann.capture.domPath}`);
  const feedback = composeNote(ann.note, ann.auto);
  if (feedback) lines.push(`**Feedback:** ${feedback}`);
  const styleEntries = Object.entries(ann.capture.styles).slice(0, 10);
  if (styleEntries.length > 0) {
    lines.push(`**Styles:** ${styleEntries.map(([k, v]) => `${k}: ${v}`).join('; ')}`);
  }
  if (ann.capture.parent) lines.push(`**Parent:** ${ann.capture.parent}`);
  return lines.join('\n');
}

function formatAllAsMarkdown(annotations: AnnotationDraft[]): string {
  const env = captureEnvironment();
  const pending = annotations.filter(a => a.status === 'pending');
  const lines: string[] = [
    `## Page Feedback: ${env.url}`,
    '',
    `**Environment:** ${env.viewport} · DPR ${env.devicePixelRatio}`,
    `**Timestamp:** ${env.timestamp}`,
    '',
    ...pending.map((ann, i) => formatAnnotationMarkdown(ann, i, env)),
    '',
    '---',
    `*${t('toolbar.generatedBy')}*`,
  ];
  return lines.join('\n');
}

// ─── Types ────────────────────────────────────────────────────────────────────

type MarkerType = 'element' | 'text' | 'area';

type DraftIntent = 'fix' | 'change' | 'create' | 'move' | 'resize' | 'style';
type DraftSeverity = 'blocking' | 'important' | 'suggestion';

/** Panel edits, written out for the agent (see AutoContext). */
const STYLE_NOTE_HEADING = 'Ajustes do painel:';

function formatStyleNote(changes: StyleChange[]): string {
  if (changes.length === 0) return '';
  const lines = changes.map(c => {
    const prop = c.property.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
    const source = c.token
      ? ` (token ${c.token})`
      : c.offToken ? ' (fora do padrão do projeto)' : '';
    return `- ${prop}: ${c.to}${source}`;
  });
  return `${STYLE_NOTE_HEADING}\n${lines.join('\n')}`;
}

/**
 * What Ilse itself works out about an annotation — panel edits, a sketch's
 * reading, a drag's distance, an area's contents. It goes to the agent only:
 * the note field stays the designer's, empty until they write in it.
 */
interface AutoContext {
  reorder?: string;
  /** Short form of the reorder, shown to the designer in the card */
  reorderLabel?: string;
  style?: string;
  sketch?: string;
  area?: string;
  move?: string;
  resize?: string;
  /** Remove the element: what the agent reads, and the chip's text */
  remove?: string;
  removeLabel?: string;
  /** Text retyped in the panel: what the agent reads, and the chip's text */
  text?: string;
  textLabel?: string;
  /** Component props changed in the Component section: what the agent reads, and the chip's text */
  props?: string;
  propsLabel?: string;
  /** A catalog component the designer pointed at ("use this one"): what the agent reads, and the chip */
  component?: string;
  componentLabel?: string;
  /** A catalog component dropped on the page: what the agent reads, and the chip */
  insert?: string;
  insertLabel?: string;
}

/** The note as the agent receives it: the designer's words first, then Ilse's context. */
function composeNote(note: string, auto?: AutoContext): string {
  const blocks = auto ? [auto.insert, auto.remove, auto.text, auto.props, auto.component, auto.reorder, auto.move, auto.resize, auto.area, auto.style, auto.sketch].filter(Boolean) as string[] : [];
  return [note.trim(), ...blocks].filter(Boolean).join('\n\n');
}

const newClientId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Bring "sent" drafts in line with what the server actually knows. A draft the
 * server resolved is resolved; one it never heard of (page reloaded mid-run,
 * CLI restarted, answer lost) goes back to pending — marked, not flickering —
 * so it can be re-sent or removed. "Resolved" includes notes the project's
 * ledger says were applied in an earlier session.
 */
function reconcileSent(drafts: AnnotationDraft[], known: Array<{ id: string; status: string }>): AnnotationDraft[] {
  const byId = new Map(known.map(k => [k.id, k.status]));
  let changed = false;
  const next = drafts.map(d => {
    // Sent once, back to pending because a CLI didn't know it — the ledger may say it was applied after all
    if (d.status === 'pending' && d.id && byId.get(d.id) === 'resolved') { changed = true; return { ...d, status: 'resolved' as const }; }
    if (d.status !== 'sent') return d;
    const status = d.id ? byId.get(d.id) : undefined;
    if (status === 'resolved') { changed = true; return { ...d, status: 'resolved' as const }; }
    if (status === undefined) { changed = true; return { ...d, status: 'pending' as const }; }
    return d; // still in the works
  });
  return changed ? next : drafts;
}

/**
 * One line per thing Ilse will tell the agent — shown in the card so the
 * designer sees how it read the gesture, while the note stays theirs.
 */
type AutoKey = 'insert' | 'remove' | 'text' | 'props' | 'component' | 'reorder' | 'move' | 'resize' | 'style' | 'sketch' | 'area';
interface AutoLine { key: AutoKey; text: string }

function autoSummary(auto?: AutoContext): AutoLine[] {
  if (!auto) return [];
  const out: AutoLine[] = [];
  const push = (key: AutoKey, text: string) => out.push({ key, text });
  const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
  if (auto.insertLabel) push('insert', auto.insertLabel);
  if (auto.removeLabel) push('remove', auto.removeLabel);
  if (auto.textLabel) push('text', auto.textLabel);
  if (auto.propsLabel) push('props', auto.propsLabel);
  if (auto.componentLabel) push('component', auto.componentLabel);
  if (auto.reorderLabel) push('reorder', auto.reorderLabel);
  if (auto.move) push('move', `${auto.move.replace(/\.$/, '')}`);
  if (auto.resize) push('resize', `${auto.resize.replace(/\.$/, '')}`);
  if (auto.style) {
    const n = count(auto.style, /^- /gm);
    push('style', n === 1 ? t('toolbar.chip.panelOne') : t('toolbar.chip.panelMany', { n }));
  }
  if (auto.sketch) {
    const n = count(auto.sketch, /^\d+\. /gm);
    push('sketch', n === 1 ? t('toolbar.chip.sketchOne') : t('toolbar.chip.sketchMany', { n }));
  }
  if (auto.area) push('area', `${auto.area.split(':')[0]}`);
  return out;
}

/** The command for a retyped text: the chip, and what the agent is told */
function textCommand(edit?: { from: string; to: string }): Pick<AutoContext, 'text' | 'textLabel'> {
  if (!edit) return { text: undefined, textLabel: undefined };
  const short = (x: string) => x.length > 28 ? `${x.slice(0, 27)}…` : x;
  return {
    textLabel: `${t('toolbar.textCommand')} “${short(edit.to.trim() || '∅')}”`,
    text: [
      `Trocar o texto deste elemento de ${JSON.stringify(edit.from)} para ${JSON.stringify(edit.to)}.`,
      'Se o texto vem de uma variável, prop, tradução (i18n) ou dados de lista, troque na origem — só este texto, respeitando o Scope.',
      ...(/\n/.test(edit.from + edit.to) ? ['As quebras de linha (\\n) são <br> no código: mantenha uma <br> por quebra.'] : []),
    ].join('\n'),
  };
}

/** The command for component props picked in the panel: the chip, and what the agent is told */
function propsCommand(name: string, source: string, changes: PropChange[]): Pick<AutoContext, 'props' | 'propsLabel'> {
  if (changes.length === 0) return { props: undefined, propsLabel: undefined };
  return {
    propsLabel: `${t('toolbar.propsCommand', { name })} ${changes.map(c => `${c.prop}: ${c.to || '—'}`).join(', ')}`,
    props: [
      `Componente <${name}> (de ${source}): neste uso, ${changes.map(c => `${c.prop} ${c.from !== undefined ? JSON.stringify(c.from) : '(não definida)'} → ${JSON.stringify(c.to)}`).join('; ')}.`,
      `Mude a prop onde este <${name}> é escrito, respeitando o Scope. Use só valores que o ${name} aceita; não troque por outro componente.`,
    ].join('\n'),
  };
}

/** A dropped component: the chip, and what the agent is told when Ilse can't write it alone */
function insertCommand(d: InsertDraft, styled = false): Pick<AutoContext, 'insert' | 'insertLabel'> {
  if (d.copy) return copyCommand(d, styled);
  const from = d.item.library ? `import de '${d.item.module ?? d.item.source}'` : `definido em ${d.item.source}`;
  const self = d.at ? `deste <${d.at.component}>` : 'deste elemento';
  const where = { before: `antes ${self}`, after: `depois ${self}`, inside: `dentro ${self}, no fim` }[d.placement]
    + (d.at ? ` (onde este <${d.at.component}> é usado, não dentro da definição dele)` : '');
  return {
    insertLabel: `+ ${d.item.name} ${t(`toolbar.insert.${d.placement}` as Parameters<typeof t>[0])}`,
    insert: [
      `Inserir o componente <${d.item.name}> que o projeto já tem (${from}) ${where}, assim:`,
      jsxPreview(d.item.name, d.props, d.text),
      ...(d.item.example ? [`Como o código já o escreve (${d.item.example.file}:${d.item.example.line}): ${d.item.example.code}`] : []),
      'Use este componente; não crie outro. Ligue props obrigatórias ou dados como o projeto já faz.',
    ].join('\n'),
  };
}

/**
 * The reload bubble's words: `legibleText`'s blend can't reach the page from inside the fixed
 * bubble (it blends with its own transparent layer, so it shows as light grey) — solid ink with
 * a light halo reads on light and dark pages
 */
const STALE_TEXT: React.CSSProperties = { color: color.foreground, mixBlendMode: 'normal', opacity: 1, textShadow: '0 0 2px #fff, 0 0 8px #fff' };

/** A copy of an element that isn't a component: the chip, and what the agent works out in the code */
function copyCommand(d: InsertDraft, styled = false): Pick<AutoContext, 'insert' | 'insertLabel'> {
  const place = d.place;
  // The panel edits were made on the copy, but the note points at the original (where the code is)
  const style = styled ? ' Os ajustes de estilo desta nota foram feitos na CÓPIA: aplique-os só nela; o original não muda.' : '';
  const text = d.text?.trim() ? ` A cópia mostra o texto ${JSON.stringify(d.text.trim())} no lugar do original.` : '';
  // Dragged elsewhere: the copy's place is where it stands now, named by its neighbour on the page
  const shown = place ? `e a arrastou para ${place}` : 'logo depois';
  return {
    insertLabel: t(d.copy === 'item' ? 'toolbar.copy.item' : 'toolbar.copy.block'),
    insert: d.copy === 'item'
      ? [
        `Duplicar este item da lista (${JSON.stringify(d.item.name)}): o designer pôs na tela uma cópia dele ${shown}. Ela só existe na tela, não no código — escreva-a no código.`,
        'Ele é uma linha de uma lista gerada a partir de dados (um .map): não copie o JSX do template. Acrescente um novo item aos dados que essa lista renderiza, com o mesmo formato deste, '
          + (place ? `na posição em que a lista o mostra: ${place} (o original fica onde está).` : 'logo DEPOIS dele (o original continua primeiro).') + text + style,
        'O que a lista usa como key (id, slug, nome…) tem de ser único: duas keys iguais fazem o React duplicar ou sumir com linhas. Se a key vem de um campo visível (como o nome), use um valor provisório distinto no novo item (por exemplo "Replit 2") e diga no resumo que é provisório.',
        'Se os dados vêm de uma fonte local (mock, sample, constante, i18n), acrescente lá. Se vêm do backend ou são calculados de outros dados, não invente: diga no resumo o que precisaria existir para a linha aparecer.',
      ].join('\n')
      : [
        `Duplicar este elemento (${JSON.stringify(d.item.name)}): o designer pôs na tela uma cópia dele ${shown}. Ela só existe na tela, não no código — escreva-a no código.`,
        (place
          ? `Escreva uma cópia deste JSX ${place}, no código que renderiza esse lugar, com o mesmo conteúdo e os mesmos dados. O original fica onde está, intocado — qualquer ajuste feito na cópia vai nela, não no original.`
          : 'Escreva uma cópia deste JSX logo DEPOIS dele, no mesmo lugar do código, com o mesmo conteúdo e os mesmos dados. O original continua primeiro, intocado; a cópia é a segunda — qualquer ajuste feito na cópia vai nela, não no original.') + text + style,
        ...(d.at ? [`Este elemento é um <${d.at.component}> inteiro: a cópia é outro <${d.at.component}> com as mesmas props, escrito ${place ?? 'logo depois deste'} onde ele é usado — não dentro da definição de ${d.at.component}, e sem prop nova nele.`] : []),
        'A cópia aparece sempre, como o original: não crie prop, flag ou condição para mostrá-la. Se o JSX tem key ou id fixos, a cópia recebe outros (nunca dois iguais). Se ele faz parte de um componente usado em outros lugares, a cópia vale só aqui (respeite o Scope). Não crie um componente novo.',
      ].join('\n'),
  };
}

/** "Use this component": the chip, and the card the agent gets — import, the usual way it's written, the rule */
function componentCommand(item: CatalogItem): Pick<AutoContext, 'component' | 'componentLabel'> {
  const from = item.library ? `import de '${item.module ?? item.source}'` : `definido em ${item.source}`;
  return {
    componentLabel: `⟨${item.name}⟩`,
    component: [
      `Use o componente <${item.name}> que o projeto já tem (${from}).`,
      ...(item.example ? [`Como o código já o escreve (${item.example.file}:${item.example.line}):`, item.example.code] : []),
      `Use este componente aqui; não crie outro nem troque por outro.`,
    ].join('\n'),
  };
}

const hasAuto = (auto?: AutoContext) => !!auto && Object.values(auto).some(Boolean);

function moveText(dx: number, dy: number): string {
  const parts: string[] = [];
  if (Math.abs(dy) > 2) parts.push(t(dy < 0 ? 'toolbar.chip.up' : 'toolbar.chip.down', { px: Math.abs(Math.round(dy)) }));
  if (Math.abs(dx) > 2) parts.push(t(dx < 0 ? 'toolbar.chip.left' : 'toolbar.chip.right', { px: Math.abs(Math.round(dx)) }));
  return parts.length > 0 ? t('toolbar.chip.dragged', { parts: parts.join(t('toolbar.chip.and')) }) : '';
}

const INTENT_LABELS: Record<DraftIntent, string> = {
  fix: 'fix →',
  change: 'change →',
  create: 'create →',
  move: 'move →',
  resize: 'resize →',
  style: 'style →',
};

function inferDraftIntent(note: string, hasElement: boolean): DraftIntent {
  const lower = note.toLowerCase();
  const creationVerbs = /\b(cria|crie|adiciona|adicione|coloca|coloque|insert|add|create|new|novo|nova)\b/;
  const moveVerbs = /\b(mova|mover|move|arrast|reposicion)\b/;
  const changeVerbs = /\b(e se|muda|troca|altera|tenta|experimenta|change|try|what if|talvez|seria|poderia)\b/;
  // Creation verbs take priority — even if "mova" is also present (composite: "mova e adicione")
  // No 'resize' from prose: "menor"/"maior" describe opacity, font size, spacing…
  // just as often as dimensions. Resize comes only from an actual drag (resolveIntent).
  if (creationVerbs.test(lower)) return 'create';
  if (moveVerbs.test(lower)) return 'move';
  if (changeVerbs.test(lower)) return 'change';
  // Empty area → create; element with content → fix
  return hasElement ? 'fix' : 'create';
}

type Rect = { x?: number; y?: number; top?: number; left?: number; width: number; height: number };

/**
 * Final intent for an annotation. Property-panel edits are the most explicit
 * statement of intent there is — the designer picked exact values, so they
 * outrank anything inferred from prose or from a drag. Resize still beats move
 * when both happened.
 */
function resolveIntent(
  inferred: DraftIntent,
  { hasStyle, orig, curr }: { hasStyle: boolean; orig?: Rect; curr?: Rect },
): DraftIntent {
  if (hasStyle) return 'style';
  if (inferred !== 'fix' || !orig || !curr) return inferred;
  const top = (r: Rect) => r.top ?? r.y ?? 0;
  const left = (r: Rect) => r.left ?? r.x ?? 0;
  if (Math.abs(curr.width - orig.width) > 3 || Math.abs(curr.height - orig.height) > 3) return 'resize';
  if (Math.abs(top(curr) - top(orig)) > 3 || Math.abs(left(curr) - left(orig)) > 3) return 'move';
  return inferred;
}

/**
 * Drop the property-panel preview once the source decides: after a write, the
 * real class shows through; after an undo, the original look comes back.
 */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function clearStylePreview(ann: { pixelTargetId?: string; styleData?: StyleData }): void {
  if (!ann.pixelTargetId || !ann.styleData) return;
  const el = document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${ann.pixelTargetId}"]`);
  if (!el) return;
  for (const c of ann.styleData.changes) {
    el.style.removeProperty(c.property.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`));
  }
}

/** Where an edit goes when the element comes from a component repeated on the page */
interface Scope {
  component: string; count: number; choice: 'one' | 'all';
  /** Places it's written in the code (catalog): one on screen can still be on other screens */
  uses?: number;
}

interface AnnotationDraft {
  id?: string;
  scope?: Scope;
  /** The toolbar's own id, echoed by the server — pairs the answer with this draft */
  clientId?: string;
  capture: ElementCapture;
  note: string;
  imageRefs?: string[];
  imageFilenames?: string[];
  status: 'pending' | 'sent' | 'resolved';
  resolvedSummary?: string;
  markerType: MarkerType;
  styleData?: StyleData;
  composeMs?: number;     // capture → added, for the journal
  // Unique data attribute value tagged onto the DOM element at capture time,
  // so the PixelOverlay can re-query the EXACT element later — the generated
  // CSS selector is frequently non-unique (e.g. 10x "h2.text-xl.font-semibold"
  // on the page → querySelector returns the first, which is the wrong one).
  pixelTargetId?: string;
  // Schema rico
  intent?: DraftIntent;
  severity?: DraftSeverity;
  suggestions?: Suggestion[];
  aiAnalysis?: string;
  rearrangeData?: {
    originalRect: { x: number; y: number; width: number; height: number };
    currentRect:  { x: number; y: number; width: number; height: number };
  };
  /** Pencil strokes (page coordinates) — shown on the page until the note is sent */
  sketch?: Stroke[];
  auto?: AutoContext;
  textEdit?: TextEdit;
  propEdit?: PropEditDraft;
  insert?: InsertDraft;
  /** The `ilse test` finding this note fixes — the CLI tests its page again after the agent */
  testFinding?: TestFindingRef;
}

/** A catalog component dropped on the page: the draft copy standing there, and how it's written */
interface InsertDraft {
  item: CatalogItem;
  placement: Placement;
  props: Record<string, string | number | boolean>;
  text?: string;
  /** The copy on screen */
  html: string;
  draftId: string;
  /** The anchor is a component instance's root: the code place is where that instance is written */
  at?: InstanceRef;
  /** A copy the designer dragged: where it goes, in words (see copy-place.ts) */
  place?: string;
  /**
   * Not a catalog component: a copy of the selected element, on screen only. A list's row
   * becomes a new item in its data, any other element a copy of its JSX — the agent decides
   * in the code; `item` only names it
   */
  copy?: 'item' | 'block';
}

/** Component props changed in the panel, with what the CLI needs to find the JSX */
interface PropEditDraft {
  component: string;
  source: string;
  frameUrl?: string;
  props: Record<string, string | number | boolean>;
  text?: string;
  changes: PropChange[];
}

interface PopoverRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface PendingCapture {
  /** The element's text, retyped in the panel */
  textEdit?: TextEdit;
  /** Props of the component it is, changed in the Component section */
  propEdit?: PropEditDraft;
  /** A component dropped from the catalog: this draft is its copy (the capture is its anchor) */
  insert?: InsertDraft;
  capture: ElementCapture;
  scope?: Scope;
  context: string;        // CSS selector (for grep/code)
  contextLabel: string;   // human-readable: "button: 'Submit'" or "heading: 'Product Designer...'"
  rect: PopoverRect;
  originalRect?: PopoverRect; // snapshot at capture time — used to detect drag
  note: string;
  markerType: MarkerType;
  pixelTargetId?: string;
  areaElementCount?: number;
  styleChanges?: StyleChange[];
  suggestions?: Suggestion[];
  aiAnalysis?: string;  // streamed from agent
  imageRefs?: string[];
  imageFilenames?: string[];
  sketch?: Stroke[];
  auto?: AutoContext;
  /** The `ilse test` finding this note fixes — the CLI tests its page again after the agent */
  testFinding?: TestFindingRef;
}

/** Build a human-readable label: "tag: 'text content truncated...'" */
function buildContextLabel(el: Element): string {
  const TAG_NAMES: Record<string, string> = {
    H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
    P: 'paragraph', A: 'link', BUTTON: 'button', INPUT: 'input', TEXTAREA: 'textarea',
    IMG: 'image', VIDEO: 'video', SVG: 'icon', CANVAS: 'canvas', SELECT: 'select',
    LI: 'list item', UL: 'list', OL: 'list', NAV: 'nav', HEADER: 'header', FOOTER: 'footer',
    MAIN: 'main', SECTION: 'section', ARTICLE: 'article', ASIDE: 'aside', FORM: 'form',
    TABLE: 'table', TD: 'cell', TH: 'cell', TR: 'row', LABEL: 'label', SPAN: 'span',
    DIV: 'container', FIGCAPTION: 'caption', BLOCKQUOTE: 'quote', PRE: 'code block',
    CODE: 'code',
  };
  const tag = TAG_NAMES[el.tagName] ?? el.tagName.toLowerCase();
  const text = el.textContent?.trim();
  if (!text || text.length === 0) return tag;
  const truncated = text.length > 32 ? text.slice(0, 32) + '...' : text;
  // Collapse whitespace
  const clean = truncated.replace(/\s+/g, ' ');
  return `${tag}: "${clean}"`;
}

// ─── AnnotationEditor (inside settings panel) ─────────────────────────────────

function AnnotationEditor({
  note,
  imageRefs,
  onNoteChange,
  onAddImage,
  onRemoveImage,
  onSend,
}: {
  note: string;
  imageRefs?: string[];
  onNoteChange: (note: string) => void;
  onAddImage: (dataUrl: string, filename?: string) => void;
  onRemoveImage: (index: number) => void;
  onSend: () => void;
}) {
  const { handlePaste, handleFileChange, openFilePicker, fileRef } = useImageInput(onAddImage);

  return (
    <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
      <div
        ref={(el) => {
          if (el && !el.dataset.init) {
            el.textContent = note;
            el.dataset.init = '1';
          }
        }}
        contentEditable
        role="textbox"
        suppressContentEditableWarning
        onInput={(e) => onNoteChange((e.target as HTMLDivElement).textContent ?? '')}
        onPaste={handlePaste}
        data-placeholder={t('toolbar.placeholder.issue')}
        style={{
          width: '100%', minHeight: 48, padding: 8,
          backgroundColor: color.background, border: `1px solid ${color.border}`,
          borderRadius: radius.md, color: color.foreground,
          fontSize: 13, fontFamily: font.sans,
          outline: 'none', boxSizing: 'border-box',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          textAlign: 'left',
          WebkitUserModify: 'read-write-plaintext-only' as unknown as undefined,
        }}
      />
      <InlineAttachments
        images={imageRefs ?? []}
        onAdd={openFilePicker}
        onRemove={onRemoveImage}
        fileRef={fileRef}
        onFileChange={handleFileChange}
      />
      <button
        onClick={onSend}
        style={{
          marginTop: 4, padding: '5px 12px', backgroundColor: color.primary,
          color: color.primaryForeground, border: 'none', borderRadius: radius.md,
          cursor: 'pointer', fontSize: 12, fontFamily: font.sans,
        }}
      >
        Enviar
      </button>
    </div>
  );
}

// ─── AnnotationPopover ────────────────────────────────────────────────────────

function computePopoverPos(rect: PopoverRect, height = 168, width = 322): { top: number; left: number } {
  if (typeof window === 'undefined') return { top: rect.top, left: rect.left };
  const gap = 8;
  const vw = window.innerWidth, vh = window.innerHeight;
  const clamp = (p: { top: number; left: number }) => ({
    top: Math.max(8, Math.min(p.top, vh - height - 8)),
    left: Math.max(8, Math.min(p.left, vw - width - 8)),
  });
  // The property panel is a window of its own: the card is placed around it,
  // never on top of it (the designer can still drag one over the other)
  const panel = document.querySelector('[data-ilse-panel]')?.getBoundingClientRect();
  const hits = (p: { top: number; left: number }) => !!panel && p.left < panel.right + gap && p.left + width > panel.left - gap
    && p.top < panel.bottom + gap && p.top + height > panel.top - gap;
  const below = { top: rect.top + rect.height + gap, left: rect.left };
  const above = { top: rect.top - height - gap, left: rect.left };
  const candidates = [
    below.top + height <= vh - 8 ? below : above,
    below.top + height <= vh - 8 ? above : below,
    ...(panel ? [
      { top: below.top, left: panel.left - width - gap },
      { top: above.top, left: panel.left - width - gap },
      { top: rect.top, left: panel.left - width - gap },
    ] : []),
  ].map(clamp);
  return candidates.find(p => !hits(p)) ?? candidates[0];
}

function AnnotationPopover({
  context, contextLabel, rect, note, styles, grepPattern, hasElement, suggestions, imageRefs, hasContext, summary, onRemoveSummary, scope, onScope,
  onSelectParent, treeTarget, onSelectElement, onNoteChange, onApplySuggestion, onRequestAnalysis, onAddImage, onRemoveImage, onAdd, onCancel,
  onPickComponent, picker,
}: {
  /** + → "Component…": open the catalog to point at the component to use */
  onPickComponent?: () => void;
  /** The catalog list, under the input, while picking */
  picker?: React.ReactNode;
  context: string;
  contextLabel: string;
  rect: PopoverRect;
  note: string;
  styles?: Record<string, string>;
  grepPattern?: string;
  hasElement: boolean;
  suggestions?: Suggestion[];
  imageRefs?: string[];
  /** Ilse already has something to send (a sketch, panel edits, a drag) — the note is optional */
  hasContext?: boolean;
  /** How Ilse read the gesture (reorder, resize, sketch…) — what the agent will get */
  summary?: AutoLine[];
  /** Element of a repeated component: apply here or everywhere */
  scope?: Scope;
  onScope?: (choice: Scope['choice']) => void;
  /** Move the selection up to the containing element; absent when there is none or the draft has changes */
  onSelectParent?: () => void;
  /** The selected element, for the tree; absent for text, area and sketch captures */
  treeTarget?: Element | null;
  /** Move the selection to another element of the tree; absent while the draft has changes */
  onSelectElement?: (el: Element) => void;
  /** The designer took a command back — it no longer goes to the agent */
  onRemoveSummary?: (key: AutoKey) => void;
  onApplySuggestion?: (text: string) => void;
  onRequestAnalysis?: () => void;
  onAddImage?: (dataUrl: string, filename?: string) => void;
  onRemoveImage?: (index: number) => void;
  onNoteChange: (note: string) => void;
  onAdd: () => void;
  onCancel: () => void;
}) {
  // Initialize with correct position synchronously — avoids flash from 0,0 to target
  const [pos, setPos] = useState<{ top: number; left: number }>(() => computePopoverPos(rect));
  const [copied, setCopied] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const { handlePaste, handleFileChange, openFilePicker, fileRef } = useImageInput(
    (dataUrl, filename) => onAddImage?.(dataUrl, filename)
  );
  const intent = inferDraftIntent(note, hasElement);
  const dragRef = useRef<{ startX: number; startY: number; origTop: number; origLeft: number } | null>(null);
  const noteFocusedRef = useRef(false);

  // Re-compute on rect change — only when not being dragged. After layout: the
  // panel it steers around mounts in the same commit, and the card's own height is known.
  const cardRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!dragRef.current) setPos(computePopoverPos(rect, cardRef.current?.offsetHeight || undefined, cardRef.current?.offsetWidth || undefined));
  }, [rect]);
  const [front, bringToFront] = useFrontLayer('card', true);

  // Drag handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPos({ top: dragRef.current.origTop + dy, left: dragRef.current.origLeft + dx });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  return (
    <div
      ref={cardRef}
      data-ilse-toolbar
      onMouseDownCapture={bringToFront}
      style={{
        position: 'fixed', top: pos.top, left: pos.left, width: 290,
        backgroundColor: color.popover, border: `1px solid ${color.border}`,
        borderRadius: radius.xl, padding: 16, zIndex: front ? 99999 : 99998,
        boxShadow: shadow.xl,
        fontFamily: font.sans,
      }}
      onMouseDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        const editable = (e.target as HTMLElement).contentEditable === 'true';
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
        e.preventDefault();
        dragRef.current = { startX: e.clientX, startY: e.clientY, origTop: pos.top, origLeft: pos.left };
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header — contextual label (opens the element's place in the tree) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <button
          onClick={() => setTreeOpen(v => !v)}
          disabled={!treeTarget}
          aria-expanded={treeTarget ? treeOpen : undefined}
          aria-label={treeTarget ? t('toolbar.tree.toggle') : undefined}
          style={{
            flex: 1, background: 'none', border: 'none', cursor: treeTarget ? 'pointer' : 'default', padding: 0,
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 12, color: color.mutedForeground, fontFamily: font.sans,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textAlign: 'left',
          }}
        >
          {treeTarget && <IconChevronRight size={12} stroke={2} style={{ flexShrink: 0, transform: treeOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contextLabel}</span>
        </button>
        {onSelectParent && (
          <button
            onClick={onSelectParent}
            title={t('toolbar.selectParent')}
            aria-label={t('toolbar.selectParent')}
            style={{
              width: 24, height: 24, flexShrink: 0, padding: 0, border: 'none', borderRadius: radius.sm,
              background: 'none', cursor: 'pointer', color: color.mutedForeground,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <IconCornerLeftUp size={14} stroke={1.75} />
          </button>
        )}
        {/* The suggestions toggle (eyeglass) left the card for now; a sent annotation still lists them */}
        {/* Same as Esc: the draft and its previews go, selection mode stays */}
        <button
          onClick={onCancel}
          title={withShortcut(t('toolbar.close'), 'Esc')}
          aria-label={t('toolbar.close')}
          style={{
            width: 24, height: 24, flexShrink: 0, padding: 0, border: 'none', borderRadius: radius.sm,
            background: 'none', cursor: 'pointer', color: color.mutedForeground,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <IconX size={14} stroke={1.75} />
        </button>
      </div>

      {/* Where the element sits — the styles are already in the property panel */}
      {treeOpen && treeTarget && <ElementTree selected={treeTarget} onSelect={onSelectElement} />}

      {/* Repeated component: the edit goes to this one, or to every one of them */}
      {scope && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: color.mutedForeground, flexShrink: 0 }}>{t('toolbar.scope.label')}</span>
          <div role="radiogroup" aria-label={t('toolbar.scope.label')} style={{
            flex: 1, minWidth: 0, display: 'flex', gap: 2, padding: 2, borderRadius: radius.sm, backgroundColor: color.muted,
          }}>
            {([
              { choice: 'one', label: t('toolbar.scope.one'), title: t('toolbar.scope.oneTitle', { component: scope.component }) },
              (scope.uses ?? 0) > scope.count
                ? { choice: 'all' as const, label: t('toolbar.scope.all', { count: scope.uses! }), title: t('toolbar.scope.allUsesTitle', { count: scope.uses!, component: scope.component }) }
                : { choice: 'all' as const, label: t('toolbar.scope.all', { count: scope.count }), title: t('toolbar.scope.allTitle', { count: scope.count, component: scope.component }) },
            ] as const).map(o => {
              const on = scope.choice === o.choice;
              return (
                <button
                  key={o.choice}
                  role="radio"
                  aria-checked={on}
                  title={o.title}
                  onClick={() => onScope?.(o.choice)}
                  style={{
                    flex: 1, minWidth: 0, height: 22, border: 'none', borderRadius: radius.sm - 2, cursor: 'pointer',
                    fontSize: 11, fontFamily: font.sans, fontWeight: on ? 500 : 400,
                    backgroundColor: on ? color.background : 'transparent', boxShadow: on ? shadow.xs : 'none',
                    color: on ? color.foreground : color.mutedForeground,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <span title={t('toolbar.scope.component', { component: scope.component })} style={{
            fontSize: 10, fontFamily: font.mono, color: color.mutedForeground, flexShrink: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70,
          }}>
            {`<${scope.component}>`}
          </span>
        </div>
      )}

      {/* Input area: textarea + attachments + send — all inside one container */}
      <div style={{
        border: `1px solid ${color.border}`, borderRadius: radius.lg,
        backgroundColor: color.background, overflow: 'hidden',
      }}>
        {/* What Ilse understood — command tokens at the head of the input.
            Read-only: the note typed after them stays the designer's. */}
        {summary && summary.length > 0 && (
          <div title={t('toolbar.summaryTitle')} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 8px 0' }}>
            {summary.map(line => (
              <span key={line.key} title={line.text} contentEditable={false} style={{
                display: 'inline-flex', alignItems: 'center', gap: 2, maxWidth: '100%', boxSizing: 'border-box',
                backgroundColor: color.muted, padding: '2px 2px 2px 7px', borderRadius: 6,
                userSelect: 'none',
              }}>
                <span style={{
                  minWidth: 0, fontSize: 11, lineHeight: 1.35, fontFamily: font.mono, fontWeight: 500,
                  // Brand gradient on the command text — orange → black
                  backgroundImage: `linear-gradient(90deg, ${ilse.brand}, #000000)`,
                  WebkitBackgroundClip: 'text', backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent', color: 'transparent',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {line.text}
                </span>
                {onRemoveSummary && (
                  <button
                    onClick={() => onRemoveSummary(line.key)}
                    title={t('toolbar.removeChip')}
                    aria-label={t('toolbar.removeChip')}
                    style={{
                      width: 16, height: 16, flexShrink: 0, padding: 0, border: 'none', borderRadius: 4,
                      background: 'none', cursor: 'pointer', color: color.mutedForeground,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <IconX size={11} stroke={2} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {/* Remove + a written request go to the agent as one job — easy to miss
            when the removal came from a stray key before typing */}
        {summary?.some(l => l.key === 'remove') && note.trim() && (
          <div style={{ padding: '6px 12px 0', fontSize: 11, lineHeight: 1.4, color: '#8A4B12' }}>
            {t('toolbar.removeWithNote')}
          </div>
        )}
        <div
          ref={(el) => {
            if (!el) return;
            if (el.textContent !== note) {
              el.textContent = note;
              // Only move the caret when this box is the thing being typed in.
              // The note is also rewritten as the property panel transcribes
              // edits into it — grabbing the caret then would yank focus out of
              // the control the designer is actually using.
              if (document.activeElement === el) {
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(el);
                range.collapse(false);
                sel?.removeAllRanges();
                sel?.addRange(range);
              }
            }
            // Focus once, on first mount — not on every render.
            if (!noteFocusedRef.current) {
              noteFocusedRef.current = true;
              el.focus();
            }
          }}
          contentEditable
          role="textbox"
          data-ilse-note=""
          suppressContentEditableWarning
          onInput={(e) => onNoteChange((e.target as HTMLDivElement).textContent ?? '')}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onAdd(); }
            if (e.key === 'Escape') { e.preventDefault(); /* handled by global Esc */ }
          }}
          data-placeholder={t('toolbar.placeholder.describe')}
          style={{
            minHeight: 44, padding: '10px 12px',
            color: color.foreground, fontSize: 13, fontFamily: font.sans,
            outline: 'none', boxSizing: 'border-box',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            textAlign: 'left',
            WebkitUserModify: 'read-write-plaintext-only' as unknown as undefined,
          }}
        />
        {/* Bottom row: attachments + send */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 8px 8px' }}>
          <InlineAttachments
            images={imageRefs ?? []}
            onAdd={openFilePicker}
            onRemove={(i) => onRemoveImage?.(i)}
            fileRef={fileRef}
            onFileChange={handleFileChange}
            onComponent={onPickComponent}
          />
          <button
            onClick={onAdd}
            title={withShortcut(t('toolbar.send'), 'Mod+Enter')}
            aria-label={t('toolbar.send')}
            style={{
              width: 30, height: 30, borderRadius: '50%',
              backgroundColor: note.trim() || hasContext || (imageRefs?.length ?? 0) > 0 ? color.primary : color.border,
              border: 'none', cursor: note.trim() || hasContext || (imageRefs?.length ?? 0) > 0 ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'background-color 0.15s',
            }}
          >
            <IconArrowUp size={16} stroke={2} color="#fff" />
          </button>
        </div>
      </div>
      {picker}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeRect(start: { x: number; y: number }, end: { x: number; y: number }): PopoverRect {
  return {
    top: Math.min(start.y, end.y),
    left: Math.min(start.x, end.x),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function clampToViewport(pos: { x: number; y: number }, buttonSize = 40): { x: number; y: number } {
  if (typeof window === 'undefined') return pos;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Tab hidden or minimized → viewport reports 0. Don't clamp with garbage dimensions.
  if (vw < 100 || vh < 100) return pos;
  return {
    x: Math.min(Math.max(pos.x, 8), vw - buttonSize - 8),
    y: Math.min(Math.max(pos.y, 8), vh - buttonSize - 8),
  };
}

/**
 * Namespace a storage key by the current origin + document title so that
 * multiple local projects (all at http://localhost:3000 at different times)
 * don't share state. Without this, anotações de um projeto anterior aparecem
 * no projeto novo só por estarem na mesma origin.
 *
 * The title snapshot is taken at first call in the session — stable enough
 * for dev/dogfood where each project has a distinct <title> in its layout.
 */
/** sessionStorage: the finding the report was on when it sent the dev to another page */
const REPORT_FOCUS_KEY = 'ilse-report-focus';


function getStorageKey(base: string): string {
  if (typeof window === 'undefined') return base;
  const host = window.location.host || 'unknown';
  const title = (document.title || '').slice(0, 40).trim() || 'default';
  return `${base}:${host}:${title}`;
}

/**
 * Experimental features are hidden by default and enabled per browser:
 *   localStorage.setItem('ilse-experimental', '1')
 *
 * Deliberately not an env var — that would need per-bundler wiring
 * (Vite `import.meta.env` vs Next `NEXT_PUBLIC_`) and wouldn't survive install.
 * Not scoped by getStorageKey either: this is a developer preference, not
 * project state, so it applies across every project in that browser.
 */
function isExperimentalEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('ilse-experimental') === '1';
  } catch {
    return false;
  }
}

function getInitialToolbarPos(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  try {
    const saved = sessionStorage.getItem(getStorageKey('ilse-toolbar-pos'));
    if (saved) return clampToViewport(JSON.parse(saved) as { x: number; y: number });
  } catch { /* ignore */ }
  return defaultToolbarPos();
}

/** Where the toolbar lives until the designer drags it — and where "ii" brings it back */
function defaultToolbarPos(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  // Default: bottom-right corner, ~150px from each edge.
  // PILL_W=52, PILL_H=44 — hardcoded here to avoid forward-reference order.
  const MARGIN = 150;
  return {
    x: Math.max(8, window.innerWidth - 52 - MARGIN),
    y: Math.max(8, window.innerHeight - 44 - MARGIN),
  };
}

// ─── Grid snap ──────────────────────────────────────────────────────────────

let gridSize = 8; // px — nudge amount, mutable via settings

/** Snap a value to the nearest grid increment */
function snapToGrid(value: number): number {
  if (gridSize <= 1) return value;
  return Math.round(value / gridSize) * gridSize;
}

// ─── Alignment guides ───────────────────────────────────────────────────────

type SnapRect = { top: number; left: number; right: number; bottom: number; centerX: number; centerY: number };

const SNAP_THRESHOLD = 4;

/** Collect rects of all visible, meaningful elements on the page (once, on drag start). */
function collectSnapRects(): SnapRect[] {
  const rects: SnapRect[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Use TreeWalker for efficient deep traversal — picks up actual content
  // elements at any depth, capped at 500 for performance.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      if (el.closest('[data-ilse-toolbar]')) return NodeFilter.FILTER_REJECT;
      const tag = el.tagName;
      // Skip script, style, SVG internals, br, etc.
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'BR' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let count = 0;
  while (walker.nextNode() && count < 500) {
    const el = walker.currentNode as Element;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
    // Skip elements that span nearly the full viewport (layout wrappers)
    if (r.width > vw * 0.92 && r.height > vh * 0.92) continue;
    rects.push({
      top: r.top, left: r.left, right: r.right, bottom: r.bottom,
      centerX: r.left + r.width / 2, centerY: r.top + r.height / 2,
    });
    count++;
  }
  return rects;
}

const CONTENT_TAGS = new Set([
  'IMG', 'SVG', 'VIDEO', 'CANVAS', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT',
  'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'SPAN', 'LI', 'TD', 'TH',
  'LABEL', 'FIGCAPTION', 'BLOCKQUOTE', 'PRE', 'CODE', 'PICTURE',
]);

function isContentElement(el: Element): boolean {
  if (CONTENT_TAGS.has(el.tagName)) return true;
  // Has direct text content (not just from children)
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) return true;
  }
  // Has background-image
  const bg = getComputedStyle(el).backgroundImage;
  if (bg && bg !== 'none') return true;
  return false;
}

function collectContentRects(): SnapRect[] {
  const rects: SnapRect[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      if (el.closest('[data-ilse-toolbar]')) return NodeFilter.FILTER_REJECT;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'BR' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let count = 0;
  while (walker.nextNode() && count < 500) {
    const el = walker.currentNode as Element;
    if (!isContentElement(el)) continue;
    const pos = getComputedStyle(el).position;
    if (pos === 'absolute' || pos === 'fixed') continue;
    const r = el.getBoundingClientRect();
    // More aggressive minimum: skip tiny separators/spacers
    if (r.width < 16 || r.height < 12) continue;
    if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
    // Skip full-width layout wrappers
    if (r.width > vw * 0.92 && r.height > vh * 0.92) continue;
    // Skip elements nearly the same size as their parent (wrappers)
    const parent = el.parentElement;
    if (parent) {
      const pr = parent.getBoundingClientRect();
      if (pr.width > 0 && pr.height > 0 &&
          r.width > pr.width * 0.95 && r.height > pr.height * 0.95) continue;
    }
    rects.push({
      top: r.top, left: r.left, right: r.right, bottom: r.bottom,
      centerX: r.left + r.width / 2, centerY: r.top + r.height / 2,
    });
    count++;
  }
  return rects;
}

/**
 * Compare dragged rect against snap rects, return only the best guide per edge.
 * At most 2 vertical (X) + 2 horizontal (Y) lines — the closest match wins.
 */
function computeGuides(
  dragged: { top: number; left: number; width: number; height: number },
  snapRects: SnapRect[],
): Array<{ axis: 'x' | 'y'; pos: number }> {
  const dRight = dragged.left + dragged.width;
  const dBottom = dragged.top + dragged.height;
  const dCenterX = dragged.left + dragged.width / 2;
  const dCenterY = dragged.top + dragged.height / 2;

  // For each dragged edge, track the best (closest) snap match
  type Best = { pos: number; delta: number } | null;
  const bestX: Record<string, Best> = { left: null, right: null, centerX: null };
  const bestY: Record<string, Best> = { top: null, bottom: null, centerY: null };

  const dX = { left: dragged.left, right: dRight, centerX: dCenterX };
  const dY = { top: dragged.top, bottom: dBottom, centerY: dCenterY };

  for (const sr of snapRects) {
    const sX = [sr.left, sr.right, sr.centerX];
    const sY = [sr.top, sr.bottom, sr.centerY];

    for (const [edgeName, edgeVal] of Object.entries(dX)) {
      for (const sv of sX) {
        const delta = Math.abs(edgeVal - sv);
        if (delta <= SNAP_THRESHOLD) {
          const prev = bestX[edgeName];
          if (!prev || delta < prev.delta) {
            bestX[edgeName] = { pos: sv, delta };
          }
        }
      }
    }
    for (const [edgeName, edgeVal] of Object.entries(dY)) {
      for (const sv of sY) {
        const delta = Math.abs(edgeVal - sv);
        if (delta <= SNAP_THRESHOLD) {
          const prev = bestY[edgeName];
          if (!prev || delta < prev.delta) {
            bestY[edgeName] = { pos: sv, delta };
          }
        }
      }
    }
  }

  // Deduplicate: if two edges snap to the same pixel, keep only one
  const guides: Array<{ axis: 'x' | 'y'; pos: number }> = [];
  const seenPos = new Set<string>();

  for (const b of Object.values(bestX)) {
    if (!b) continue;
    const key = `x:${Math.round(b.pos)}`;
    if (!seenPos.has(key)) { seenPos.add(key); guides.push({ axis: 'x', pos: b.pos }); }
  }
  for (const b of Object.values(bestY)) {
    if (!b) continue;
    const key = `y:${Math.round(b.pos)}`;
    if (!seenPos.has(key)) { seenPos.add(key); guides.push({ axis: 'y', pos: b.pos }); }
  }

  return guides;
}

// ─── Spacing indicators ─────────────────────────────────────────────────────

type SpacingNode = {
  axis: 'x' | 'y'; // 'y' = vertical gap (top/bottom), 'x' = horizontal gap (left/right)
  neighborEdge: number; // position of the full-width line (neighbor's edge)
  draggedEdge: number;  // position of the dragged element's edge
  crossPos: number;     // perpendicular midpoint (for badge placement)
  distance: number;
};

function computeSpacings(
  dragged: { top: number; left: number; width: number; height: number },
  snapRects: SnapRect[],
  dragAxis?: 'x' | 'y' | null,
): SpacingNode[] {
  const dLeft = dragged.left;
  const dRight = dragged.left + dragged.width;
  const dTop = dragged.top;
  const dBottom = dragged.top + dragged.height;

  let above: { dist: number; edge: number; midX: number } | null = null;
  let below: { dist: number; edge: number; midX: number } | null = null;
  let left:  { dist: number; edge: number; midY: number } | null = null;
  let right: { dist: number; edge: number; midY: number } | null = null;

  const dCenterX = dLeft + (dRight - dLeft) / 2;
  const dCenterY = dTop + (dBottom - dTop) / 2;

  for (const sr of snapRects) {
    // For top/bottom: no strict overlap required, just find nearest above/below
    if (sr.bottom <= dTop) {
      const d = dTop - sr.bottom;
      if (!above || d < above.dist) above = { dist: d, edge: sr.bottom, midX: dCenterX };
    }
    if (sr.top >= dBottom) {
      const d = sr.top - dBottom;
      if (!below || d < below.dist) below = { dist: d, edge: sr.top, midX: dCenterX };
    }
    // For left/right: require vertical overlap
    const vStart = Math.max(dTop, sr.top);
    const vEnd = Math.min(dBottom, sr.bottom);
    if (vEnd > vStart) {
      const midY = (vStart + vEnd) / 2;
      if (sr.right <= dLeft) {
        const d = dLeft - sr.right;
        if (!left || d < left.dist) left = { dist: d, edge: sr.right, midY };
      }
      if (sr.left >= dRight) {
        const d = sr.left - dRight;
        if (!right || d < right.dist) right = { dist: d, edge: sr.left, midY };
      }
    }
  }

  const results: SpacingNode[] = [];
  const showY = !dragAxis || dragAxis === 'y';
  const showX = !dragAxis || dragAxis === 'x';
  if (showY && above && above.dist > 0)
    results.push({ axis: 'y', neighborEdge: above.edge, draggedEdge: dTop, crossPos: above.midX, distance: above.dist });
  if (showY && below && below.dist > 0)
    results.push({ axis: 'y', neighborEdge: below.edge, draggedEdge: dBottom, crossPos: below.midX, distance: below.dist });
  if (showX && left && left.dist > 0)
    results.push({ axis: 'x', neighborEdge: left.edge, draggedEdge: dLeft, crossPos: left.midY, distance: left.dist });
  if (showX && right && right.dist > 0)
    results.push({ axis: 'x', neighborEdge: right.edge, draggedEdge: dRight, crossPos: right.midY, distance: right.dist });
  return results;
}

// ─── CSS Properties collapsible ──────────────────────────────────────────────

function CSSPropertiesSection({ entries }: { entries: Array<[string, string]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
          display: 'flex', alignItems: 'center', gap: 4,
          color: color.mutedForeground, fontSize: 11, fontFamily: font.sans,
        }}
      >
        <IconChevronRight size={12} stroke={2} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
        css properties
      </button>
      {open && (
        <div style={{
          backgroundColor: color.background, border: `1px solid ${color.border}`,
          borderRadius: radius.md, padding: '8px 10px', marginTop: 4,
          fontSize: 11, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          lineHeight: 1.6, maxHeight: 160, overflowY: 'auto',
        }}>
          {entries.map(([key, val]) => (
            <div key={key}>
              <span style={{ color: color.mutedForeground }}>{key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}:</span>{' '}
              <span style={{ color: color.foreground }}>{val};</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SuggestionsSection ──────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#6366f1',
};

function SuggestionsSection({ items, onApply, onRequestAnalysis }: {
  items: Suggestion[];
  onApply?: (text: string) => void;
  onRequestAnalysis?: () => void;
}) {
  const [analysisRequested, setAnalysisRequested] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const prevLengthRef = useRef(0);

  // The AI review runs the full agent — only when asked. Opening the section used
  // to fire it on its own: a paid run (and a stream on the page) nobody requested.
  const requestAnalysis = () => {
    if (analysisRequested || !onRequestAnalysis) return;
    setAnalysisRequested(true);
    onRequestAnalysis();
  };

  // Staggered reveal
  useEffect(() => {
    if (items.length === 0) { setVisibleCount(0); prevLengthRef.current = 0; return; }
    const startFrom = prevLengthRef.current;
    if (startFrom >= items.length) return;
    let i = startFrom;
    setVisibleCount(startFrom);
    const timer = setInterval(() => {
      i++;
      setVisibleCount(i);
      if (i >= items.length) { clearInterval(timer); prevLengthRef.current = items.length; }
    }, 150);
    return () => clearInterval(timer);
  }, [items.length]);

  const applyAll = () => {
    if (!onApply) return;
    const text = items.map(s => `Fix: ${s.message}`).join('\n');
    onApply(text);
  };

  const hasAiItems = items.some(s => s.id.startsWith('ai-'));
  const isAnalyzing = analysisRequested && !hasAiItems;

  return (
    <div style={{
      backgroundColor: color.background, border: `1px solid ${color.border}`,
      borderRadius: radius.md, padding: '8px 10px',
      maxHeight: 160, overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.length === 0 && !isAnalyzing && (
          <span style={{ fontSize: 10, color: color.mutedForeground, padding: '2px 0' }}>{t('suggestions.none')}</span>
        )}
        {(visibleCount < items.length || isAnalyzing) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
            <span style={{
              width: 5, height: 5, backgroundColor: ilse.orange,
              animation: 'ilse-thinking-dot 1.2s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 10, color: color.mutedForeground }}>
              {isAnalyzing && visibleCount >= items.length ? t('suggestions.askingAI') : t('suggestions.analyzing')}
            </span>
          </div>
        )}
        {items.slice(0, visibleCount).map((s, idx) => (
          <div key={`${s.id}-${idx}`} style={{
            display: 'flex', gap: 6, alignItems: 'flex-start',
            fontSize: 11, fontFamily: font.sans, lineHeight: 1.4,
            animation: 'ilse-thinking-in 0.3s ease-out',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 4,
              backgroundColor: SEVERITY_COLORS[s.severity] ?? color.mutedForeground,
            }} />
            <div style={{ flex: 1 }}>
              <div style={{ color: color.foreground }}>{s.message}</div>
              {s.detail && s.detail !== 'AI' && <div style={{ color: color.mutedForeground, fontSize: 10 }}>{s.detail}</div>}
            </div>
          </div>
        ))}
        {onRequestAnalysis && !analysisRequested && visibleCount >= items.length && (
          <button
            onClick={(e) => { e.stopPropagation(); requestAnalysis(); }}
            title={t('suggestions.askAIHint')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              marginTop: 4, padding: '5px 0',
              background: 'none', border: `1px solid ${color.border}`,
              borderRadius: radius.md, cursor: 'pointer',
              fontSize: 10, fontWeight: 500, color: color.foreground,
            }}
          >
            {t('suggestions.askAI')}
          </button>
        )}
        {onApply && items.length > 0 && visibleCount >= items.length && !isAnalyzing && (
          <button
            onClick={(e) => { e.stopPropagation(); applyAll(); }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              marginTop: 4, padding: '5px 0',
              background: 'none', border: `1px solid ${color.border}`,
              borderRadius: radius.md, cursor: 'pointer',
              fontSize: 10, fontWeight: 600, color: ilse.orange,
              fontFamily: font.sans, transition: 'background-color 0.15s',
              animation: 'ilse-thinking-in 0.3s ease-out',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ilse.orangePale; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
          >
            <IconBolt size={12} stroke={2} />
            {t('suggestions.fixAll')}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── IlseToolbar ─────────────────────────────────────────────────────────────

// Initialize browser locale once (before first render)
if (typeof navigator !== 'undefined') setLocale(detectLocale());


/** A toast: what Ilse says, and what her mascot does while saying it (none when there's nothing to say) */
const saying = (text: string | null, reaction?: MascotReaction) => (text ? { text, reaction } : null);
type AgentInfo = { name?: string; email?: string; plan?: string; calls?: number; model?: string };

export function IlseToolbar({ demoMode, demoEndpoint }: { demoMode?: boolean; demoEndpoint?: string } = {}) {
  const [mounted, setMounted] = useState(false);
  const [langKey, setLangKey] = useState(0); // force re-render on locale change
  const [isOpen, setIsOpen] = useState(false);
  const isOpenRef = useRef(false);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  const [annotating, setAnnotating] = useState(false);
  const [screensMenuOpen, setScreensMenuOpen] = useState(false);
  const [screens, setScreens] = useState<{ device: Device; rulers: boolean } | null>(null);
  const screensOpenRef = useRef(false);
  // Screens open: what the Ilse in the frame reports, and how to reach it
  const [embedState, setEmbedState] = useState<EmbedState | null>(null);
  const screensActRef = useRef<((action: ScreensAction) => void) | null>(null);
  useEffect(() => { screensOpenRef.current = !!screens; }, [screens]);
  // Embedded: the select / navigate choice from the Screens bar (selection comes back on after an edit)
  const wantSelectRef = useRef(true);
  const [annotations, setAnnotations] = useState<AnnotationDraft[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem(getStorageKey('ilse-annotations'));
      if (saved) return JSON.parse(saved) as AnnotationDraft[];
    } catch { /* ignore */ }
    return [];
  });

  // Persist annotations to localStorage on change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (annotations.length === 0) {
        localStorage.removeItem(getStorageKey('ilse-annotations'));
      } else {
        localStorage.setItem(getStorageKey('ilse-annotations'), JSON.stringify(annotations));
      }
    } catch { /* ignore */ }
  }, [annotations]);
  const [activeMarker, setActiveMarker] = useState<number | null>(null);
  const [markersVisible, setMarkersVisible] = useState(true);
  // Markers inside a box that scrolls on its own (a list, an app shell's <main>)
  // follow it: redraw when any such box scrolls. Window scroll needs nothing —
  // markers are absolute on the page.
  const [, setScrollTick] = useState(0);
  const anchored = annotations.some(a => a.capture._scrollers?.length);
  useEffect(() => {
    if (!anchored) return;
    let frame = 0;
    const onScroll = (e: Event) => {
      if (e.target === document || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; setScrollTick(n => n + 1); });
    };
    document.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('scroll', onScroll, true); cancelAnimationFrame(frame); };
  }, [anchored]);
  /** Where an annotation's element is now: capture position + how far its boxes scrolled, and whether they still show it */
  const anchorOf = (ann: AnnotationDraft) => {
    const r = ann.capture.rect;
    const sh = scrollShift(ann.capture._scrollers, scrollerNow);
    const top = r.top + (ann.capture._scrollY ?? 0) + sh.dy;
    const left = r.left + (ann.capture._scrollX ?? 0) + sh.dx;
    const visible = visibleIn(sh.clip, left - window.scrollX + Math.min(r.width / 2, 8), top - window.scrollY + r.height / 2);
    return { top, left, visible };
  };
  const [showSettings, setShowSettings] = useState(false);
  // Settings header: the agent that runs the changes, its plan, and this session's model runs
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Project memory: asked from the CLI each time it opens, so it is never stale
  const [memoryOpen, setMemoryOpen] = useState(false);
  // Catalog: a tab of the panel while something is selected, its own window when nothing is
  const [panelTab, setPanelTab] = useState<PanelTab>('props');
  const [catalogOpen, setCatalogOpen] = useState(false);
  // The card's "Component…": the catalog list inside the card, to point at the one to use
  const [pickingComponent, setPickingComponent] = useState(false);
  // The panel's ×: hidden until the next selection (or the catalog button)
  const [panelClosed, setPanelClosed] = useState(false);
  // A variant picked for an instance on the page has no copy yet: the panel says it shows once applied
  const [variantMissing, setVariantMissing] = useState(false);
  const [catalog, setCatalog] = useState<{ items: CatalogItem[]; snapshots: Record<string, CatalogSnapshot[]> } | null>(null);
  // The Library's design system: "Create" until .ilse/ds exists, then "Export"
  const [dsInfo, setDsInfo] = useState<DsInfo | null>(null);
  // The DS window: opened by Create DS / Export (just written) or by the DS's path in the Library
  const [dsViewer, setDsViewer] = useState<{ data: DsViewData; justWritten: boolean } | null>(null);
  const dsJustWritten = useRef(false);
  const [dsCheck, setDsCheck] = useState<DsCheckState | null>(null);
  // Read from callbacks that don't re-create on every catalog change (selecting an element)
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const catalogItemsRef = useRef<CatalogItem[] | null>(null);
  /** `id|variant` copied this session */
  const copiedRef = useRef(new Set<string>());
  const captureCopiesRef = useRef<() => void>(() => {});
  /** The copies came too, not just the list */
  const catalogFullRef = useRef(false);
  const [catalogOnPage, setCatalogOnPage] = useState<Set<string>>(new Set());
  const loadCatalog = () => { setCatalogOnPage(namesOnPage()); send({ type: 'catalog' }); };
  /** The list only, no copies: enough to start copying */
  const loadCatalogList = () => send({ type: 'catalog', lite: true });
  const [memoryData, setMemoryData] = useState<MemoryData | null>(null);
  const openMemory = () => { setMemoryData(null); setMemoryOpen(true); send({ type: 'memory' }); };
  // Shortcut groups folded in the modal — the first one starts open
  const [shortcutGroupsOpen, setShortcutGroupsOpen] = useState<Set<string>>(() => new Set([SHORTCUT_GROUPS[0].title]));
  // "Conectar agente": MCP endpoint + token of the running ilse (like Hilo's connection settings)
  const [mcpInfo, setMcpInfo] = useState<{ url: string; token: string } | null>(null);
  // The account the agent runs on ("me@company.com · Team (Acme)") — which limit applies
  const [agentAccount, setAgentAccount] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectTarget, setConnectTarget] = useState<'claude-code' | 'desktop' | 'json'>('claude-code');
  const [copied, setCopied] = useState(false);
  // Settings → Logs: the CLI's journal (timings, tokens, outcomes — no prompt text)
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsFormat, setLogsFormat] = useState<'json' | 'markdown'>('markdown');
  const [logs, setLogs] = useState<{ json: unknown; markdown: string } | null>(null);
  const [logsCopied, setLogsCopied] = useState(false);
  const copyLogsOnArrival = useRef<'json' | 'markdown' | null>(null);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [wsPort, setWsPort] = useState<number | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);
  // Demo mode: track in-flight fetches so Stop can abort them
  const demoAbortRef = useRef<AbortController | null>(null);
  // Chat mode
  type ChatMessage = { role: 'user' | 'agent'; text: string; ts: number };
  const [chatOpen, setChatOpen] = useState(false);
  // Read after mount, never during render — reading localStorage while rendering
  // would desync SSR markup from the client on Next.
  const [experimental, setExperimental] = useState(false);
  useEffect(() => { setExperimental(isExperimentalEnabled()); }, []);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem(getStorageKey('ilse-chat'));
      if (saved) return JSON.parse(saved) as ChatMessage[];
    } catch { /* ignore */ }
    return [];
  });
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatOpenRef = useRef(chatOpen);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  // Persist chat history
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (chatHistory.length === 0) {
        localStorage.removeItem(getStorageKey('ilse-chat'));
      } else {
        localStorage.setItem(getStorageKey('ilse-chat'), JSON.stringify(chatHistory.slice(-50)));
      }
    } catch { /* ignore */ }
  }, [chatHistory]);
  // Auto-scroll chat to bottom
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatHistory]);
  // Grid snap size
  const [snapEnabled, setSnapEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return localStorage.getItem('ilse-snap-enabled') !== '0'; } catch { return true; }
  });
  const [snapSize, setSnapSize] = useState(() => {
    if (typeof window === 'undefined') return 8;
    try {
      const saved = localStorage.getItem('ilse-grid-size');
      if (saved) { const n = parseInt(saved); if (n > 0) { gridSize = n; return n; } }
    } catch { /* ignore */ }
    return 8;
  });
  const updateSnapSize = (n: number) => {
    const val = Math.max(1, Math.min(64, n));
    setSnapSize(val);
    gridSize = snapEnabled ? val : 1;
    try { localStorage.setItem('ilse-grid-size', String(val)); } catch { /* ignore */ }
  };
  const toggleSnap = () => {
    const next = !snapEnabled;
    setSnapEnabled(next);
    gridSize = next ? snapSize : 1;
    try { localStorage.setItem('ilse-snap-enabled', next ? '1' : '0'); } catch { /* ignore */ }
  };

  // Bumped to throw away the panel's edits (the designer removed the command)
  const [panelEpoch, setPanelEpoch] = useState(0);

  // DS Tokens
  const [dsTokensInput, setDsTokensInput] = useState('');
  const [dsTokensLoaded, setDsTokensLoaded] = useState(false);
  // Load DS tokens from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(getStorageKey('ilse-ds-tokens'));
      if (saved) {
        const parsed = JSON.parse(saved);
        const tokens = parseTokensJSON(parsed);
        if (tokens.length > 0) {
          setDSTokens(tokens);
          setDsTokensLoaded(true);
          setDsTokensInput(saved);
        }
      }
    } catch { /* ignore */ }
  }, []);

  const handleLoadTokens = useCallback((input: string) => {
    try {
      const parsed = JSON.parse(input);
      const tokens = parseTokensJSON(parsed);
      if (tokens.length > 0) {
        setDSTokens(tokens);
        setDsTokensLoaded(true);
        localStorage.setItem(getStorageKey('ilse-ds-tokens'), input);
        setClipboardToast(saying(`${tokens.length} tokens loaded`));
        setTimeout(() => setClipboardToast(null), 3000);
      } else {
        setClipboardToast(saying(t('toolbar.clipboard.noTokens')));
        setTimeout(() => setClipboardToast(null), 4000);
      }
    } catch {
      setClipboardToast(saying(t('toolbar.clipboard.invalidJson')));
      setTimeout(() => setClipboardToast(null), 4000);
    }
  }, []);

  // Page scan
  const [scanOpen, setScanOpen] = useState(false);
  // Read from the socket handler, which subscribes once
  const scanOpenRef = useRef(false);
  useEffect(() => { scanOpenRef.current = scanOpen; }, [scanOpen]);
  const toolbarModeRef = useRef<'design' | 'test'>('design');
  // Design mode: annotate and edit (what Ilse always did). Test mode: an agent tests the app.
  // Remembered per browser — a convenience, so a blocked storage just starts in design.
  const [toolbarMode, setToolbarModeState] = useState<'design' | 'test'>(() => {
    try { return localStorage.getItem('ilse-toolbar-mode') === 'test' ? 'test' : 'design'; } catch { return 'design'; }
  });
  const accent = modeAccent(toolbarMode);
  toolbarModeRef.current = toolbarMode;
  const setToolbarMode = (mode: 'design' | 'test') => {
    setToolbarModeState(mode);
    try { localStorage.setItem('ilse-toolbar-mode', mode); } catch { /* per-browser preference only */ }
  };
  // Test mode runs on Ilse Pro. Without it the switch shows her asleep, and a tap says where to get it
  const [proTest, setProTest] = useState(false);
  /** Owner license: the settings badge flips Pro ↔ Free (null: not the owner, no switch) */
  const [owner, setOwner] = useState<{ viewAsFree: boolean } | null>(null);
  // The catalog (list, copies, dragging onto the page) is Pro; the Component section is not
  const [proCatalog, setProCatalog] = useState(false);
  const proCatalogRef = useRef(false);
  useEffect(() => { proCatalogRef.current = proCatalog; }, [proCatalog]);
  // Journeys (Pro): the list, the one running, and whether new ones can be recorded
  const [proJourneys, setProJourneys] = useState(false);
  const [journeysOpen, setJourneysOpen] = useState(false);
  const [journeys, setJourneys] = useState<JourneySummary[]>([]);
  const [journeyRecording, setJourneyRecording] = useState(true);
  const [journeyLive, setJourneyLive] = useState<JourneyLive | null>(null);
  const [journeyError, setJourneyError] = useState<string | null>(null);
  const [journeySuggestions, setJourneySuggestions] = useState<JourneySuggestion[] | null>(null);
  const [journeySuggesting, setJourneySuggesting] = useState(false);
  // Before a run: what Pro offers to test here (test_setup)
  const [testOffer, setTestOffer] = useState<TestOffer | null>(null);
  // The report: what the last run tested, open above the toolbar or docked on the side
  const [testRunMeta, setTestRunMeta] = useState<TestRunMeta | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  // The report is a side panel now (expanding is the report's own): it stays while the dev browses
  const reportDocked = true;
  const [reportFocus, setReportFocus] = useState<string | null>(null);
  // The report's tabs: findings, or journeys (one open step by step)
  const [reportTab, setReportTab] = useState<ReportTab>('findings');
  const [reportJourney, setReportJourney] = useState<string | null>(null);
  const [journeyReport, setJourneyReport] = useState<JourneyReport | null>(null);
  // "Ignore for now": gone from the report and the page until the next test
  const [ignoredNow, setIgnoredNow] = useState<Set<string>>(new Set());
  const [pageIssues, setPageIssues] = useState<PageIssue[]>([]);
  const [scanHighlight, setScanHighlight] = useState<PopoverRect | null>(null);
  // Test mode: hovering Run lists the findings its markers hold
  const [runListOpen, setRunListOpen] = useState(false);
  const runListTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRunList = (open: boolean) => {
    if (runListTimer.current) clearTimeout(runListTimer.current);
    // A short grace on leave, so the pointer can travel from the button to the list
    if (open) setRunListOpen(true);
    else runListTimer.current = setTimeout(() => { setRunListOpen(false); setScanHighlight(null); }, 220);
  };
  const [scanAiSummary, setScanAiSummary] = useState<string | null>(null);
  const [scanCategory, setScanCategory] = useState<string | null>(null); // null = all
  const [scanReportOpen, setScanReportOpen] = useState(false);
  // Findings from the last `ilse test` run that the dev hasn't fixed or discarded yet
  const [testFindings, setTestFindings] = useState<TestFinding[]>([]);
  // Test mode, asked from here and run by the CLI: where it is, and what it needs from the dev
  type TestPhase = 'setup' | 'checking' | 'running' | 'login-ask' | 'login-open' | 'error';
  const [testRun, setTestRun] = useState<{ phase: TestPhase; page?: string; error?: string; expired?: boolean } | null>(null);
  // The reasoning lines above the open toolbar rise over any bubble or panel opened there (above-stack)
  const liftRef = useRef<HTMLDivElement | null>(null);
  const [testSteps, setTestSteps] = useState<string[]>([]);
  /** The mascot at work: is the agent editing (she types) or thinking (she looks up)? */
  const [agentActivity, setAgentActivity] = useState<MascotActivity>('edit');
  /** The mode whose mascot is celebrating a finished run, for a moment */
  const [celebrating, setCelebrating] = useState<MascotMode | null>(null);
  const celebrateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const celebrate = (mode: MascotMode) => {
    setCelebrating(mode);
    if (celebrateTimerRef.current) clearTimeout(celebrateTimerRef.current);
    celebrateTimerRef.current = setTimeout(() => setCelebrating(null), 1600);
  };
  /** Something landed in this agent run: when it ends, she celebrates */
  const resolvedInRunRef = useRef(false);
  /**
   * The test's reasoning, floating above the toolbar exactly like the agent's:
   * no background, newest line at the bottom, older lines fading. The mascot
   * in the mode switch is the one that works; only while the test runs.
   */
  const testStream = (gap: number | string, fontSize: number, maxWidth: number) => {
    const running = testRun?.phase === 'checking' || testRun?.phase === 'running';
    if (!running || testSteps.length === 0) return null;
    const lines = testSteps.slice(-3).reverse();
    return (
      <div style={{ position: 'absolute', bottom: typeof gap === 'number' ? `calc(100% + ${gap}px)` : gap, right: 0, display: 'flex', flexDirection: 'column-reverse', alignItems: 'flex-end', gap: 4, pointerEvents: 'none' }}>
        {lines.map((line, i) => (
          <div key={`${testSteps.length - i}-${line}`} style={{ fontSize, fontFamily: font.sans, maxWidth, ...reasoningLine(i) }}>
            {i === 0 && <ReasoningDot mode="test" />}
            {line}
          </div>
        ))}
      </div>
    );
  };
  /** One line of the test's reasoning: the page it opens, then what it found there */
  const testStepText = (msg: Record<string, unknown>): string => {
    if (msg.group === 'consistency' || msg.group === 'journeys') return t(`test.stepGroup.${msg.group}`);
    if (typeof msg.path !== 'string') return t('toolbar.testStepStart');
    const page = msg.viewport === 'mobile' ? t('toolbar.testOnMobile', { page: msg.path }) : msg.path;
    if (msg.done !== true) return t('toolbar.testStepPage', { page });
    const found = typeof msg.found === 'number' ? msg.found : 0;
    if (found === 0) return t('toolbar.testStepClean', { page });
    const kinds = (Array.isArray(msg.kinds) ? msg.kinds : []).map(k => t(`toolbar.cat.${k}` as Parameters<typeof t>[0])).join(', ');
    return t('toolbar.testStepFound', { page, count: found, kinds });
  };
  const testAction = (action: 'run' | 'run-anon' | 'login' | 'login-done' | 'login-cancel' | 'setup', options?: { groups: TestGroup[]; sizes: ScreenSize[] }) =>
    send({ type: 'test', action, ...(options ? { options } : {}) });
  /** ↻: first the list of what to test; Pro answers with what this project can run */
  const openTestSetup = () => {
    setShowSettings(false); setChatOpen(false); setJourneysOpen(false); setRunListOpen(false);
    if (!reportDocked) setReportOpen(false);
    setTestRun({ phase: 'setup' });
    setScanOpen(true);
    testAction('setup');
  };
  const journeyAction = (a: Record<string, unknown>) => send({ type: 'journey', ...a });
  // A journey open in the report: ask for its steps, and again when the list changes (a run just ended)
  useEffect(() => {
    if (reportOpen && reportTab === 'journeys' && reportJourney) journeyAction({ action: 'report', id: reportJourney });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportOpen, reportTab, reportJourney, journeys]);
  // The Journeys tab needs the list even when the Journeys panel was never opened
  useEffect(() => { if (reportOpen && proJourneys) journeyAction({ action: 'list' }); }, [reportOpen, proJourneys]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The report, on the Journeys tab, on this journey's steps */
  const openJourneyReport = (id: string) => {
    setShowSettings(false); setScanOpen(false); setRunListOpen(false);
    setReportOpen(true); setReportFocus(null); setReportTab('journeys'); setReportJourney(id);
  };

  // Recomputed on every render: a client-side route change shows that page's findings
  const pageFindings = findingsForPage(testFindings, location.pathname, location.search);

  /** Fix → the finding becomes a note, like one the dev wrote; discard → never shown again */
  const decideTestFinding = useCallback((f: Pick<TestFinding, 'id'>, decision: 'approved' | 'discarded') => {
    send({ type: 'finding_decide', id: f.id, decision });
    setTestFindings(prev => prev.filter(x => x.id !== f.id));
  }, []);
  /** Each mode keeps its own notes: design shows the dev's, test shows the findings' */
  const inMode = (a: { testFinding?: TestFindingRef }) => (toolbarMode === 'test') === !!a.testFinding;
  /** Findings whose markers the dev cleared this session: not put back until the next run */
  const clearedFindings = useRef(new Set<string>());

  const runPageScan = useCallback(() => {
    const issues = scanPage(500);
    setPageIssues(issues);
    setScanAiSummary(null);
    setScanCategory(null);
  }, []);

  /** What Ilse says above the toolbar, and what her mascot does while saying it */
  const [clipboardToast, setClipboardToast] = useState<{ text: string; reaction?: MascotReaction } | null>(null);
  /** The last run changed components that aren't on this page — it stays until the designer decides */
  /** The code changed and the page didn't repaint: a reload shows it (files, for the bubble) */
  const [stalePage, setStalePage] = useState<string[] | null>(null);
  const repaints = useRef<ReturnType<typeof watchRepaints> | null>(null);
  /** When the current run's notes reached the CLI: a repaint since then is the change showing */
  const runStart = useRef(0);
  const inRun = useRef(false);
  /**
   * When each note reached the CLI. Runs overlap (two agents at once, a no-AI swap during a
   * run), so one shared start would move past a run's own repaint and call it stale
   */
  const noteStart = useRef(new Map<string, number>());
  const sinceOf = (ids: string[]): number => {
    const times = ids.map(id => noteStart.current.get(id)).filter((n): n is number => n !== undefined);
    return times.length ? Math.min(...times) : runStart.current;
  };
  useEffect(() => {
    repaints.current = watchRepaints();
    return () => repaints.current?.stop();
  }, []);
  /** Errors the page logged after a change, and the change: undo it or ask the agent to fix them */
  const [pageError, setPageError] = useState<{ changeSetId: string; files: string[]; errors: string[] } | null>(null);
  const pageErrors = useRef<ReturnType<typeof watchPageErrors> | null>(null);
  useEffect(() => {
    pageErrors.current = watchPageErrors();
    return () => pageErrors.current?.stop();
  }, []);
  /** How long after a change its errors show: the repaint, then the effects that run after it */
  const ERROR_WAIT_MS = 5000;
  /**
   * Calls `shown` once the page repainted since the run began, or `stale` if it doesn't within
   * the wait. With regions (where the notes were made), only a change there counts; without,
   * any change to the page
   */
  const whenRepainted = (shown: () => void, stale?: () => void, regions: Element[] = [], since = runStart.current, wait = REPAINT_WAIT_MS) => {
    const deadline = Date.now() + wait;
    const tick = () => {
      const w = repaints.current;
      if (w && (regions.length ? w.repaintedIn(regions, since) : w.last() > since)) { shown(); return; }
      if (Date.now() > deadline) { stale?.(); return; }
      setTimeout(tick, 300);
    };
    tick();
  };
  /**
   * Where these notes' change should show: the container of each annotated element (a
   * draft's container is where the real one lands; a restyled element's, where it re-renders)
   */
  const regionsOf = (ids: string[]): Element[] => {
    const out: Element[] = [];
    for (const a of annotationsRef.current) {
      if (!a.id || !ids.includes(a.id) || !a.pixelTargetId) continue;
      const el = document.querySelector(`[data-ilse-pixel-target="${a.pixelTargetId}"]`);
      const region = el?.parentElement ?? el;
      if (region && !out.includes(region)) out.push(region);
    }
    return out;
  };
  /**
   * Notes whose result the page already shows: text the designer retyped on the page stays
   * there, so React has nothing to repaint — no mutation, yet nothing to reload either
   */
  const alreadyOnScreen = (ids: string[]): boolean => {
    const notes = annotationsRef.current.filter(a => a.id && ids.includes(a.id));
    return notes.length > 0 && notes.every(a => {
      // Stand-ins (see 'resolved'): the page looks as asked until it repaints
      if (a.insert && document.querySelector(`[data-ilse-draft="${a.insert.draftId}"]`)) return true;
      if (a.auto?.remove || a.styleData) return true;
      if (!a.textEdit || !a.pixelTargetId) return false;
      const el = document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${a.pixelTargetId}"]`);
      return !!el && sameText(el.innerText, a.textEdit.to);
    });
  };
  /** Test mode clicked without Pro: what it is and where to get it, until answered */
  const [proPitch, setProPitch] = useState(false);
  const [offPage, setOffPage] = useState<{ changeSetId: string; files: string[]; routes: string[] } | null>(null);
  // The project's typecheck or tests still fail after the agent's repair turns
  const [checkFailed, setCheckFailed] = useState<{ changeSetId: string; problems: string[]; count: number } | null>(null);
  // Undo: what the CLI can restore (newest batch first)
  const [undo, setUndo] = useState<{ count: number; label?: string; redoCount?: number; redoLabel?: string }>({ count: 0 });

  // ── Draft history: ⌘Z inside the open card walks back the gestures of this draft ──
  // Each entry is one decision: a panel edit, a drag, a resize. Files are untouched.
  type DraftStep = { kind: 'panel' } | { kind: 'gesture'; key: AutoKey; label: string };
  const draftSteps = useRef<DraftStep[]>([]);
  const draftTouched = useRef(false);
  const panelHistoryRef = useRef<PanelHistory | null>(null);
  const pushDraftStep = (step: DraftStep) => { draftSteps.current.push(step); draftTouched.current = true; };
  const undoRef = useRef(undo);
  useEffect(() => { undoRef.current = undo; }, [undo]);
  const annotationsRef = useRef<AnnotationDraft[]>([]);
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);
  type ThinkingMessage = { id: number; text: string; final?: boolean };
  const [thinkingMessages, setThinkingMessages] = useState<ThinkingMessage[]>([]);
  const thinkingIdRef = useRef(0);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [darkMode, setDarkMode] = useState<boolean>(() =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
  const [highlight, setHighlight] = useState<PopoverRect | null>(null);
  const [dragRect, setDragRect] = useState<PopoverRect | null>(null);
  // Alignment guides during drag
  type GuideLine = { axis: 'x' | 'y'; pos: number };
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [spacings, setSpacings] = useState<SpacingNode[]>([]);
  const [showGrid, setShowGrid] = useState(false);
  const snapRectsRef = useRef<Array<{ top: number; left: number; right: number; bottom: number; centerX: number; centerY: number }>>([]);
  const contentRectsRef = useRef<SnapRect[]>([]);
  const [pendingCapture, setPendingCapture] = useState<PendingCapture | null>(null);
  // When the current capture started — composeMs in the journal is "designer effort"
  const captureStartedAt = useRef<number>(0);
  const captureOpen = !!pendingCapture;
  useEffect(() => { if (captureOpen) captureStartedAt.current = Date.now(); }, [captureOpen]);
  // Whether the current style preview should survive the panel unmounting.
  // Flipped on send, cleared on cancel and on every new capture.
  const stylePreviewCommitted = useRef(false);
  /** Per element: how to undo the on-screen preview of a draft that was added but not sent */
  const previewReverts = useRef(new Map<string, () => void>());
  // A new selection starts uncommitted, whichever way it was made — else a
  // cancel after an earlier send would leave this draft's preview on the page
  useEffect(() => { if (pendingCapture?.pixelTargetId) stylePreviewCommitted.current = false; }, [pendingCapture?.pixelTargetId]);
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number }>(() => getInitialToolbarPos());

  const [hoverLabel, setHoverLabel] = useState<string | null>(null);

  // Drag state for marker mini card
  const [markerCardPos, setMarkerCardPos] = useState<{ top: number; left: number } | null>(null);
  const markerDragRef = useRef<{ startX: number; startY: number; origTop: number; origLeft: number } | null>(null);
  // Reset card position when switching markers
  useEffect(() => { setMarkerCardPos(null); }, [activeMarker]);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!markerDragRef.current) return;
      const dx = e.clientX - markerDragRef.current.startX;
      const dy = e.clientY - markerDragRef.current.startY;
      setMarkerCardPos({ top: markerDragRef.current.origTop + dy, left: markerDragRef.current.origLeft + dx });
    };
    const onUp = () => { markerDragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);
  const [hoverLabelRect, setHoverLabelRect] = useState<PopoverRect | null>(null);
  const [moveHoverIndex, setMoveHoverIndex] = useState<number | null>(null);
  const [pendingAreaHover, setPendingAreaHover] = useState(false);
  // While the colour picker is open the selection overlay hides, so the colour
  // being tried is seen as is — not through a purple wash.
  const [pickingColor, setPickingColor] = useState(false);
  // While the element itself is being dragged the selection box steps away
  const [liveDragging, setLiveDragging] = useState(false);
  const liveDragRef = useRef<LiveDrag | null>(null);

  // ── Pencil ──
  const [drawMode, setDrawMode] = useState(false);
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const sketchIdle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  // Hovering the element whose style is being edited shouldn't wash it purple either.
  const isEditedElement = (r: PopoverRect) => {
    const pc = pendingCapture;
    if (!pc || !(pc.styleChanges?.length)) return false;
    const p = pc.rect;
    return Math.abs(r.top - p.top) < 2 && Math.abs(r.left - p.left) < 2
      && Math.abs(r.width - p.width) < 2 && Math.abs(r.height - p.height) < 2;
  };
  const pendingAreaRef = useRef<HTMLDivElement | null>(null);
  const pendingCaptureRef = useRef(pendingCapture);
  useEffect(() => { pendingCaptureRef.current = pendingCapture; }, [pendingCapture]);
  const dragStartEmptyRef = useRef(false);

  const toolbarDragRef = useRef<{ startMouseX: number; startMouseY: number; startPosX: number; startPosY: number } | null>(null);
  const annotationDragRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingAnnotationRef = useRef(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarPosRef = useRef(toolbarPos);
  useEffect(() => { toolbarPosRef.current = toolbarPos; }, [toolbarPos]);

  // ── Mount guard (SSR safety) ───────────────────────────────────────────────

  useEffect(() => {
    setMounted(true);
    shieldPage();
    // Sync pause state on mount — freeze state is persisted on window and
    // survives HMR/remount, but the React state does not. Without this
    // sync, the button icon would show "pause" even when already frozen.
    setPaused(isFrozen());
  }, []);

  // ── Clamp position on resize (monitor/window changes) ─────────────────────
  useEffect(() => {
    const onResize = () => setToolbarPos(prev => clampToViewport(prev));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Dark mode detection (for thinking label legibility) ──────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setDarkMode(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── WS connection (skip in demo mode) ──────────────────────────────────────

  useEffect(() => {
    if (demoMode) return; // no WS in demo mode
    connect();
    // Reactive status — event-based (onopen/onclose) instead of polling.
    // Initial sync in case WS is already open when we subscribe.
    setConnected(isConnected());
    const unsubStatus = onStatus(setConnected);

    const unsub = onMessage((msg) => {
      // The owner flipped Pro ↔ Free: a fresh page, so every Pro piece comes up (or stays down) from scratch
      if (msg.type === 'view_as_free') { window.location.reload(); return; }
      if (msg.type === 'connected' && typeof msg.port === 'number') {
        setWsPort(msg.port);
        setConnected(true);
        const canTest = (msg.pro as { test?: unknown } | undefined)?.test === true;
        setProTest(canTest);
        setProJourneys((msg.pro as { journeys?: unknown } | undefined)?.journeys === true);
        setProCatalog((msg.pro as { catalog?: unknown } | undefined)?.catalog === true);
        const own = msg.owner as { viewAsFree?: unknown } | undefined;
        setOwner(own ? { viewAsFree: own.viewAsFree === true } : null);
        // A browser that remembers test mode from a machine with Pro: back to design
        if (!canTest && toolbarModeRef.current === 'test') { setToolbarMode('design'); setScanOpen(false); }
        if (canTest) send({ type: 'findings' });
        if (Array.isArray(msg.known)) {
          const known = msg.known as Array<{ id: string; status: string }>;
          setAnnotations(prev => reconcileSent(prev, known));
        }
        const mcp = msg.mcp as { url?: unknown; token?: unknown } | undefined;
        if (mcp && typeof mcp.url === 'string' && typeof mcp.token === 'string') {
          setMcpInfo({ url: mcp.url, token: mcp.token });
        }
        if (typeof msg.account === 'string') {
          setAgentAccount(msg.account);
        }
        if (msg.agent && typeof msg.agent === 'object') setAgentInfo(msg.agent as AgentInfo);
        if (msg.undo && typeof (msg.undo as { count?: unknown }).count === 'number') {
          setUndo(msg.undo as { count: number; label?: string });
        }
        // Sync locale from CLI
        if (typeof msg.locale === 'string') {
          setLocale(msg.locale as 'pt' | 'en');
        }
        // Auto-load DS tokens from CLI detection
        if (Array.isArray(msg.tokens) && msg.tokens.length > 0) {
          const tokens = msg.tokens as Array<{ name: string; value: string; type: 'color' | 'spacing' | 'typography' }>;
          setDSTokens(tokens);
          setDsTokensLoaded(true);
        }
      }
      if (msg.type === 'code-changed') {
        const files = ((msg.files as string[]) ?? []).map(f => f.split('/').pop()!);
        const ids = (msg.annotationIds as string[]) ?? [];
        const regions = regionsOf(ids);
        // The reload bubble is the last resort: first the page may already show it, then one
        // quiet framework re-render (keeps state); only if that doesn't repaint, ask
        const stale = () => {
          if (alreadyOnScreen(ids)) { setStalePage(null); return; }
          if (softRefresh()) whenRepainted(() => setStalePage(null), () => setStalePage(files), regions, Date.now());
          else setStalePage(files);
        };
        whenRepainted(() => setStalePage(null), stale, regions, sinceOf(ids));
        // A change that broke the page says so in the console: show it, with undo or a fix
        const since = sinceOf(ids);
        const changeSetId = msg.changeSetId as string;
        setTimeout(() => {
          const errors = newErrors(pageErrors.current?.seen() ?? [], since);
          if (errors.length) setPageError({ changeSetId, files, errors });
        }, ERROR_WAIT_MS);
      }
      if (msg.type === 'annotated' && msg.annotation) {
        runStart.current = Date.now();
        const a = msg.annotation as Record<string, unknown>;
        if (typeof a.id === 'string') noteStart.current.set(a.id, runStart.current);
        const clientId = typeof msg.clientId === 'string' ? msg.clientId : undefined;
        setAnnotations(prev => {
          // The echoed client id is exact; the selector is a fallback for older servers
          const byClient = clientId ? prev.findIndex(ann => ann.clientId === clientId) : -1;
          const target = byClient >= 0 ? byClient : prev.findIndex(ann => !ann.id && ann.capture.element === a.element);
          return target < 0 ? prev : prev.map((ann, i) => i === target ? { ...ann, id: a.id as string } : ann);
        });
      }
      if (msg.type === 'resolved' && msg.annotation) {
        const a = msg.annotation as Record<string, unknown>;
        resolvedInRunRef.current = true;
        const draft = annotationsRef.current.find(d => d.id === a.id);
        // What the designer previewed (a style, a copy, a hidden element) stands in for the real
        // change until the page repaints with it — never a blink back to the old look
        const since = draft?.id ? sinceOf([draft.id]) : runStart.current;
        const standInRegions = draft?.id ? regionsOf([draft.id]) : [];
        const STAND_IN_MS = 10 * 60_000;
        if (draft?.styleData) whenRepainted(() => setTimeout(() => clearStylePreview(draft), 600), undefined, standInRegions, since, STAND_IN_MS);
        if (draft?.insert) {
          // The copy stays as a stand-in, no longer marked as a draft, until the real one renders —
          // the designer sees the result either way and is never asked to reload for it
          const id = draft.insert.draftId;
          const gone = () => setTimeout(() => removeDraft(id), 300);
          const standIn = document.querySelector<HTMLElement>(`[data-ilse-draft="${id}"]`);
          standIn?.style.removeProperty('outline');
          whenRepainted(gone, () => { softRefresh(); whenRepainted(gone, undefined, standInRegions, Date.now(), STAND_IN_MS); }, standInRegions, since);
        }
        if (draft?.propEdit && draft.pixelTargetId) {
          const id = draft.pixelTargetId;
          setTimeout(() => { const el = document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${id}"]`); if (el) previewVariant(el, id, null); }, 900);
        }
        if (draft?.pixelTargetId) expireElement(document.querySelector(`[data-ilse-pixel-target="${draft.pixelTargetId}"]`));
        // Still in the DOM once the page repainted = the code kept it; no repaint, it stays hidden
        if (draft?.pixelTargetId) { const id = draft.pixelTargetId; whenRepainted(() => setTimeout(() => unhide(id), 1000), undefined, standInRegions, since, STAND_IN_MS); }
        setAnnotations(prev => prev.map(ann =>
          ann.id === a.id ? { ...ann, status: 'resolved' as const, resolvedSummary: a.resolvedSummary as string } : ann
        ));
        // Analyze: merge AI findings into suggestions
        if (a.intent === 'analyze' && typeof a.resolvedSummary === 'string' &&
            a.resolvedSummary !== t('toolbar.resolved')) {
          const aiText = a.resolvedSummary as string;
          // Parse AI response into suggestion items (split by bullets or newlines)
          const aiItems: Suggestion[] = aiText
            .split(/\n|•|[-–—]\s/)
            .map(l => l.trim())
            .filter(l => l.length > 5)
            .map((line, idx) => ({
              id: `ai-${idx}`,
              message: line,
              severity: 'info' as const,
              category: 'component' as const,
              detail: 'AI',
            }));
          if (aiItems.length > 0) {
            setPendingCapture(prev => prev ? {
              ...prev,
              suggestions: [...(prev.suggestions ?? []), ...aiItems],
            } : null);
            setAnnotations(prevAnns => prevAnns.map(ann2 =>
              ann2.capture.element === (a.element as string)
                ? { ...ann2, suggestions: [...(ann2.suggestions ?? []), ...aiItems] }
                : ann2
            ));
          }
        }
        // Chat: append agent response to chat history
        if (a.intent === 'chat' && typeof a.resolvedSummary === 'string') {
          const safeText = (a.resolvedSummary as string).slice(0, 800);
          setChatHistory(prev => [...prev, { role: 'agent', text: safeText, ts: Date.now() }]);
        }
      }
      // Held while the agent's account is out of quota: stays "sent" (it will run on
      // its own at the reset), so nothing invites a resend that would run it twice
      if (msg.type === 'deferred') {
        setClipboardToast(saying(typeof msg.message === 'string' ? msg.message : t('toolbar.deferred'), 'queued'));
        setTimeout(() => setClipboardToast(null), 8000);
      }
      if (msg.type === 'status') {
        setAnnotations(prev => prev.map(ann =>
          ann.id === msg.id ? { ...ann, status: msg.status as AnnotationDraft['status'] } : ann
        ));
      }
      if (msg.type === 'findings' && Array.isArray(msg.findings)) {
        setTestFindings(msg.findings as TestFinding[]);
        setTestRunMeta((msg.run ?? null) as TestRunMeta | null);
      }
      if (msg.type === 'test_setup') setTestOffer(parseOffer(msg));
      if (msg.type === 'journey_report') setJourneyReport(parseReport(msg.report));
      if (msg.type === 'journey_suggestions' && Array.isArray(msg.list)) {
        setJourneySuggesting(false);
        setJourneySuggestions(msg.list as JourneySuggestion[]);
      }
      if (msg.type === 'journeys' && Array.isArray(msg.list)) {
        setJourneys(msg.list as JourneySummary[]);
        setJourneyRecording(msg.recording !== false);
      }
      if (msg.type === 'journey_started' && typeof msg.id === 'string') {
        setJourneyError(null);
        setJourneyLive({ id: msg.id, goal: String(msg.goal ?? ''), lines: [] });
      }
      if (msg.type === 'journey_step') {
        const text = (msg.text ?? {}) as { pt?: string; en?: string };
        const line = { viewport: msg.viewport === 'mobile' ? 'mobile' as const : 'desktop' as const, text: (getLocale() === 'pt' ? text.pt : text.en) ?? '' };
        setJourneyLive(prev => prev && prev.id === msg.id ? { ...prev, confirm: undefined, waiting: undefined, lines: [...prev.lines, line].slice(-30) } : prev);
      }
      if (msg.type === 'journey_needs' && Array.isArray(msg.needs)) {
        const needs = (msg.needs as unknown[]).filter((n): n is string => typeof n === 'string');
        setJourneyLive(prev => prev && prev.id === msg.id ? { ...prev, needs } : prev);
      }
      if (msg.type === 'journey_waiting') {
        setJourneyLive(prev => prev && prev.id === msg.id ? { ...prev, waiting: { need: String(msg.need ?? ''), say: String(msg.say ?? '') } } : prev);
        setJourneysOpen(true);
      }
      if (msg.type === 'journey_confirm') {
        setJourneyLive(prev => prev && prev.id === msg.id ? { ...prev, confirm: String(msg.name ?? '') } : prev);
        setJourneysOpen(true);
      }
      if (msg.type === 'journey_done' && msg.journey && typeof msg.journey === 'object') {
        const done = msg.journey as JourneySummary;
        setJourneyLive(prev => prev && prev.id === done.id ? { ...prev, confirm: undefined, waiting: undefined, done } : prev);
        celebrate('test');
      }
      if (msg.type === 'journey_error') {
        setJourneyLive(null);
        setJourneySuggesting(false);
        setJourneyError(msg.reason === 'no-browser' ? t('toolbar.testNoBrowser')
          : msg.reason === 'suggest-failed' ? t('journeys.suggestFailed')
          : msg.reason === 'no-agent' ? t('journeys.noRecording') : t('toolbar.testFailed'));
      }
      if (msg.type === 'test_checking') { setTestRun({ phase: 'checking' }); setTestSteps([t('toolbar.testStepChecking')]); }
      if (msg.type === 'test_login_needed') { setTestRun({ phase: 'login-ask', expired: msg.expired === true }); if (toolbarModeRef.current === 'test') setScanOpen(true); }
      if (msg.type === 'test_login_open') setTestRun({ phase: 'login-open' });
      if (msg.type === 'test_login_cancelled') setTestRun(null);
      if (msg.type === 'test_progress') {
        setTestRun({ phase: 'running' });
        setTestSteps(prev => [...prev, testStepText(msg)].slice(-20));
      }
      if (msg.type === 'test_done') {
        setTestRun(null);
        celebrate('test');
        if (Array.isArray(msg.findings)) setTestFindings(msg.findings as TestFinding[]);
        setTestRunMeta((msg.run ?? null) as TestRunMeta | null);
        setIgnoredNow(new Set());
        // The findings land on their markers by themselves; the report sums them up by group
        setScanOpen(false);
        if (toolbarModeRef.current === 'test') { setReportOpen(true); setReportTab('findings'); setReportFocus(null); setJourneysOpen(false); }
        const here = Array.isArray(msg.findings) ? findingsForPage(msg.findings as TestFinding[], location.pathname, location.search).length : 0;
        clearedFindings.current.clear();
        // The report says it all in test mode; the toast is for a run asked from elsewhere
        if (toolbarModeRef.current === 'test') return;
        setClipboardToast(saying(here > 0
          ? t('toolbar.testFoundHere', { count: here })
          : t('toolbar.testDone', { count: typeof msg.count === 'number' ? msg.count : 0, pages: typeof msg.pages === 'number' ? msg.pages : 0 })));
        setTimeout(() => setClipboardToast(null), 5000);
      }
      // After the agent fixed findings from the test, the CLI tests their pages again
      if (msg.type === 'test_retest_started') setClipboardToast(saying(t('toolbar.testRetesting')));
      if (msg.type === 'test_retest_done') {
        const fixed = Array.isArray(msg.fixed) ? msg.fixed.length : 0;
        const still = Array.isArray(msg.still) ? msg.still.length : 0;
        setClipboardToast(saying(still > 0 ? t('toolbar.testRetestStill', { count: still }) : fixed > 0 ? t('toolbar.testRetestFixed', { count: fixed }) : null));
        setTimeout(() => setClipboardToast(null), 5000);
      }
      if (msg.type === 'test_error') {
        setTestRun({ phase: 'error', error: msg.reason === 'no-browser' ? t('toolbar.testNoBrowser') : t('toolbar.testFailed') });
        if (toolbarModeRef.current === 'test') setScanOpen(true);
      }
      if (msg.type === 'logs') {
        const next = { json: msg.json, markdown: typeof msg.markdown === 'string' ? msg.markdown : '' };
        setLogs(next);
        const fmt = copyLogsOnArrival.current;
        copyLogsOnArrival.current = null;
        if (fmt) {
          const text = fmt === 'json' ? JSON.stringify(next.json, null, 2) : next.markdown;
          void navigator.clipboard?.writeText(text).then(() => { setLogsCopied(true); setTimeout(() => setLogsCopied(false), 1500); });
        }
      }
      if (msg.type === 'undo-state' && typeof msg.count === 'number') {
        setUndo({
          count: msg.count, label: typeof msg.label === 'string' ? msg.label : undefined,
          redoCount: typeof msg.redoCount === 'number' ? msg.redoCount : 0,
          redoLabel: typeof msg.redoLabel === 'string' ? msg.redoLabel : undefined,
        });
      }
      if (msg.type === 'redone') {
        const ids = new Set((msg.annotationIds as string[]) ?? []);
        setAnnotations(prev => prev.map(ann => ann.id && ids.has(ann.id) ? { ...ann, status: 'resolved' as const } : ann));
        const conflicts = (msg.conflicts as string[]) ?? [];
        setClipboardToast(conflicts.length
          ? saying(t('undo.toastConflicts', { files: conflicts.map(f => f.split('/').pop()).join(', ') }), 'conflict')
          : saying(t('redo.toast')));
        setTimeout(() => setClipboardToast(null), 3000);
      }
      if (msg.type === 'agent-usage') {
        setAgentInfo(prev => prev ? { ...prev, calls: typeof msg.calls === 'number' ? msg.calls : prev.calls, model: typeof msg.model === 'string' ? msg.model : prev.model } : prev);
      }
      if (msg.type === 'catalog') {
        const items = (Array.isArray(msg.entries) ? msg.entries : []) as CatalogItem[];
        const snapshots = (msg.snapshots && typeof msg.snapshots === 'object' ? msg.snapshots : {}) as Record<string, CatalogSnapshot[]>;
        // What this session copied stays: the stored list may be older than it
        const lite = msg.lite === true;
        if (!lite) catalogFullRef.current = true;
        if (msg.ds && typeof msg.ds === 'object') setDsInfo(msg.ds as DsInfo);
        setCatalog(prev => {
          if (lite) return { items, snapshots: prev?.snapshots ?? {} };
          const merged = { ...snapshots };
          if (prev) for (const k of copiedRef.current) {
            const [id, variant] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
            const mine = prev.snapshots[id]?.find(s => s.variant === variant);
            if (mine) merged[id] = [mine, ...(merged[id] ?? []).filter(s => s.variant !== variant)];
          }
          return { items, snapshots: merged };
        });
        catalogItemsRef.current = items;
        setTimeout(() => captureCopiesRef.current(), 60);
      }
      if (msg.type === 'catalog_file') {
        const path = typeof msg.path === 'string' ? msg.path : '.ilse/catalog.md';
        setClipboardToast(saying(msg.failed ? t('catalog.fileFailed') : t(msg.created ? 'catalog.fileCreated' : 'catalog.fileExists', { path })));
        setTimeout(() => setClipboardToast(null), 6000);
      }
      if (msg.type === 'ds_export') {
        setClipboardToast(null);
        if (msg.failed) {
          setClipboardToast(saying(t('ds.failed')));
          setTimeout(() => setClipboardToast(null), 9000);
        } else {
          // What was written opens on screen, instead of a line saying where it went
          setDsInfo(prev => prev ? { ...prev, exists: true, changes: null } : prev);
          dsJustWritten.current = true;
          send({ type: 'ds_view' });
        }
      }
      if (msg.type === 'ds_check') {
        const r = msg.result as { tasks?: unknown; rules?: unknown } | null;
        setDsCheck(r && Array.isArray(r.tasks) && r.tasks.length
          ? { status: 'done', tasks: r.tasks as Array<{ task: string; code: string; problems: string[] }>, rules: Array.isArray(r.rules) ? r.rules as string[] : [] }
          : { status: 'failed' });
      }
      if (msg.type === 'ds_view') {
        if (msg.view && typeof msg.view === 'object') {
          // A refresh of the open window (Add to AGENTS.md) keeps its "just written"
          const fresh = dsJustWritten.current;
          setDsViewer(prev => ({ data: msg.view as DsViewData, justWritten: fresh || !!prev?.justWritten }));
        }
        dsJustWritten.current = false;
      }
      if (msg.type === 'memory') {
        setMemoryData({ design: msg.design as MemoryData['design'], pro: !!msg.pro, test: (msg.test ?? null) as MemoryData['test'] });
      }
      if (msg.type === 'check-failed' && typeof msg.changeSetId === 'string') {
        setCheckFailed({
          changeSetId: msg.changeSetId,
          problems: Array.isArray(msg.problems) ? (msg.problems as string[]) : [],
          count: typeof msg.count === 'number' ? msg.count : 0,
        });
      }
      if (msg.type === 'off-page' && typeof msg.changeSetId === 'string') {
        setOffPage({
          changeSetId: msg.changeSetId,
          files: Array.isArray(msg.files) ? (msg.files as string[]) : [],
          routes: Array.isArray(msg.routes) ? (msg.routes as string[]) : [],
        });
      }
      if (msg.type === 'undone') {
        setOffPage(null);
        const ids = new Set((msg.annotationIds as string[]) ?? []);
        for (const d of annotationsRef.current) if (d.id && ids.has(d.id)) clearStylePreview(d);
        setAnnotations(prev => prev.map(ann =>
          ann.id && ids.has(ann.id) ? { ...ann, status: 'pending' as const, resolvedSummary: undefined } : ann
        ));
        const conflicts = (msg.conflicts as string[]) ?? [];
        setClipboardToast(conflicts.length
          ? saying(t('undo.toastConflicts', { files: conflicts.map(f => f.split('/').pop()).join(', ') }), 'conflict')
          : saying(t('undo.toast')));
        setTimeout(() => setClipboardToast(null), 3000);
      }
      if (msg.type === 'stopped') {
        // Agent was stopped by user — revert all 'sent' annotations back to pending
        setAnnotations(prev => prev.map(ann =>
          ann.status === 'sent' ? { ...ann, status: 'pending' as const } : ann
        ));
      }
      if (msg.type === 'error') {
        // Revert sent annotations back to pending so user can retry
        if (typeof msg.id === 'string') {
          setAnnotations(prev => prev.map(ann =>
            ann.id === msg.id ? { ...ann, status: 'pending' as const } : ann
          ));
        }
        // Show error in toast
        const errorMsg = typeof msg.message === 'string' ? msg.message : t('toolbar.runFailed');
        setClipboardToast(saying(errorMsg, 'failed'));
        setTimeout(() => setClipboardToast(null), 6000);
      }
      // A run starting (the first 'thinking' since the last one ended): a repaint from here on is its change showing
      if (msg.type === 'thinking' && !inRun.current) { inRun.current = true; runStart.current = Date.now(); }
      if (msg.type === 'thinking-end') inRun.current = false;
      if (msg.type === 'thinking' && typeof msg.text === 'string') {
        const id = ++thinkingIdRef.current;
        if (msg.activity === 'edit' || msg.activity === 'think') setAgentActivity(msg.activity);
        const text = msg.text as string;
        // Don't stream intermediate thinking into aiAnalysis —
        // only the final resolved summary should appear there.
        // Stream AI scan summary when scan panel is open
        if (scanOpen && pageIssues.length > 0) {
          setScanAiSummary(text);
        }
        // When chat is open, stream thinking into chat panel instead
        if (chatOpenRef.current) {
          setChatHistory(prev => {
            // Update last agent message if it's a streaming update, otherwise add new
            if (prev.length > 0 && prev[prev.length - 1].role === 'agent' && !prev[prev.length - 1].ts) {
              return [...prev.slice(0, -1), { role: 'agent', text, ts: 0 }];
            }
            return [...prev, { role: 'agent', text, ts: 0 }]; // ts=0 marks streaming
          });
        }
        setThinkingMessages(prev => {
          // Dedup: skip if last message has the same text
          if (prev.length > 0 && prev[prev.length - 1].text === text) return prev;
          return [...prev, { id, text }].slice(-3);
        });
        if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = setTimeout(() => setThinkingMessages([]), 120000);
      }
      if (msg.type === 'sync' && Array.isArray(msg.known)) {
        const known = msg.known as Array<{ id: string; status: string }>;
        setAnnotations(prev => reconcileSent(prev, known));
      }
      if (msg.type === 'thinking-end') {
        // Agents that don't say what they're doing just type, so start the next run there
        setAgentActivity('edit');
        if (resolvedInRunRef.current) { resolvedInRunRef.current = false; celebrate('design'); }
        // The run is over: every answer it had is in. Anything still "sent" lost its answer.
        setTimeout(() => send({ type: 'sync' }), 1200);
      }
      if (msg.type === 'thinking-end' && typeof msg.text === 'string') {
        const id = ++thinkingIdRef.current;
        const text = msg.text as string;
        // Finalize streaming chat message
        if (chatOpenRef.current) {
          setChatHistory(prev => {
            if (prev.length > 0 && prev[prev.length - 1].role === 'agent' && !prev[prev.length - 1].ts) {
              return [...prev.slice(0, -1), { role: 'agent', text, ts: Date.now() }];
            }
            return [...prev, { role: 'agent', text, ts: Date.now() }];
          });
        }
        setThinkingMessages(prev => {
          // Dedup: if last message is the same text, replace it with final version
          if (prev.length > 0 && prev[prev.length - 1].text === text) {
            return [...prev.slice(0, -1), { id, text, final: true }].slice(-3);
          }
          return [...prev, { id, text, final: true }].slice(-3);
        });
        if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = setTimeout(() => setThinkingMessages([]), 7000);
        // Revert any annotations still in 'sent' state — agent finished without
        // explicitly resolving them (stale from previous session or missed broadcast).
        setAnnotations(prev => prev.map(a => a.status === 'sent' ? { ...a, status: 'pending' as const } : a));
      }
    });

    return () => {
      unsubStatus();
      unsub();
      disconnect();
      if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
      if (celebrateTimerRef.current) clearTimeout(celebrateTimerRef.current);
    };
  }, []);

  // ── Annotation helpers ─────────────────────────────────────────────────────

  const addAnnotation = useCallback((capture: ElementCapture, prefillNote = '', markerType: MarkerType = 'element', pixelTargetId?: string, intent?: DraftIntent, testFinding?: TestFindingRef) => {
    setAnnotations(prev => [...prev, {
      capture, note: prefillNote, status: 'pending' as const, markerType, pixelTargetId,
      intent: intent ?? inferDraftIntent(prefillNote, !!capture.element),
      severity: 'important' as DraftSeverity,
      ...(testFinding ? { testFinding } : {}),
    }]);
  }, []);

  // Test mode: every finding on this page is already a marker on its element,
  // with the note written — the dev opens it to change it, ignores it, or runs the fixes.
  const pageFindingIds = pageFindings.map(f => f.id).join('|');
  const [findingRetry, setFindingRetry] = useState(0);
  useEffect(() => {
    if (toolbarMode !== 'test' || !pageFindings.length) return;
    const have = new Set(annotationsRef.current.flatMap(a => a.testFinding ? [a.testFinding.id] : []));
    let missing = false;
    for (const f of pageFindings) {
      if (have.has(f.id) || clearedFindings.current.has(f.id)) continue;
      const el = findingElement(f);
      const rect = el?.getBoundingClientRect();
      if (el && rect && (rect.width > 0 || rect.height > 0)) {
        const pixelTargetId = el.getAttribute('data-ilse-pixel-target') ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        el.setAttribute('data-ilse-pixel-target', pixelTargetId);
        addAnnotation(captureElement(el), findingNote(f), 'element', pixelTargetId, undefined, findingRef(f));
      } else if (f.selector && findingRetry < 3) {
        missing = true; // the page may still be rendering: look again shortly
      } else {
        // Console errors, failed requests, mobile-only elements: a note for the page, listed under Run
        addAnnotation({ element: '', styles: {}, rect: { top: 0, left: 0, width: 0, height: 0 } }, findingNote(f), 'element', undefined, undefined, findingRef(f));
      }
    }
    if (!missing) return;
    const timer = setTimeout(() => setFindingRetry(n => n + 1), 1000);
    return () => clearTimeout(timer);
  }, [toolbarMode, pageFindingIds, findingRetry, addAnnotation]);
  useEffect(() => { setFindingRetry(0); }, [pageFindingIds]);

  const confirmCapture = useCallback(() => {
    if (!pendingCapture) return;
    const hasElement = pendingCapture.markerType === 'area'
      ? (pendingCapture.areaElementCount ?? 0) > 0
      : !!pendingCapture.capture.element;

    // Detect if the selection was dragged (moved) or resized
    const orig = pendingCapture.originalRect;
    const curr = pendingCapture.rect;
    const wasMoved = orig && (Math.abs(curr.top - orig.top) > 3 || Math.abs(curr.left - orig.left) > 3);
    const wasResized = orig && (Math.abs(curr.width - orig.width) > 3 || Math.abs(curr.height - orig.height) > 3);
    const inferred = inferDraftIntent(pendingCapture.note, hasElement);
    const styleChanges = pendingCapture.styleChanges ?? [];
    const intent = resolveIntent(inferred, { hasStyle: styleChanges.length > 0, orig, curr });

    setAnnotations(prev => [...prev, {
      capture: pendingCapture.capture,
      note: pendingCapture.note,
      status: 'pending' as const,
      markerType: pendingCapture.markerType,
      scope: pendingCapture.scope,
      composeMs: captureStartedAt.current ? Date.now() - captureStartedAt.current : undefined,
      pixelTargetId: pendingCapture.pixelTargetId,
      intent,
      severity: 'important' as DraftSeverity,
      suggestions: pendingCapture.suggestions,
      imageRefs: pendingCapture.imageRefs,
      ...(pendingCapture.sketch ? { sketch: pendingCapture.sketch } : {}),
      ...(pendingCapture.auto ? { auto: pendingCapture.auto } : {}),
      ...(pendingCapture.textEdit ? { textEdit: pendingCapture.textEdit } : {}),
      ...(pendingCapture.propEdit ? { propEdit: pendingCapture.propEdit } : {}),
      ...(pendingCapture.insert ? { insert: pendingCapture.insert } : {}),
      ...(pendingCapture.testFinding ? { testFinding: pendingCapture.testFinding } : {}),
      ...(styleChanges.length > 0 ? {
        styleData: { selector: pendingCapture.capture.element, changes: styleChanges },
      } : {}),
      ...((wasMoved || wasResized) && orig ? {
        rearrangeData: {
          selector: pendingCapture.capture.element,
          label: pendingCapture.capture.component ?? pendingCapture.capture.element,
          tagName: pendingCapture.capture.element.split(/[.#\[: ]/)[0] || 'div',
          originalRect: { x: orig.left, y: orig.top, width: orig.width, height: orig.height },
          currentRect: { x: curr.left, y: curr.top, width: curr.width, height: curr.height },
        },
      } : {}),
    }]);
    // Sent — leave the preview standing until the agent rewrites the source.
    stylePreviewCommitted.current = styleChanges.length > 0 || !!pendingCapture.textEdit;
    // …but keep a way back: deleting this draft before it's sent undoes it on screen
    const revert = panelHistoryRef.current?.detachPreview();
    if (revert && pendingCapture.pixelTargetId) previewReverts.current.set(pendingCapture.pixelTargetId, revert);
    setPendingCapture(null);
    setAnnotating(true);
  }, [pendingCapture]);

  const cancelCapture = useCallback(() => {
    stylePreviewCommitted.current = false;
    liveDragRef.current?.cancel();
    liveDragRef.current = null;
    setLiveDragging(false);
    const pc = pendingCaptureRef.current;
    // A dropped component not confirmed in the card: its draft goes
    if (pc?.insert) removeDraft(pc.insert.draftId);
    // A variant previewed on a component: the real one comes back
    if (pc?.propEdit && pc.pixelTargetId) {
      const el = document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${pc.pixelTargetId}"]`);
      if (el) previewVariant(el, pc.pixelTargetId, null);
    }
    if (pc?.pixelTargetId) settleElement(document.querySelector(`[data-ilse-pixel-target="${pc.pixelTargetId}"]`));
    if (pc?.pixelTargetId) unhide(pc.pixelTargetId);
    setPendingCapture(null);
    setAnnotating(true);
  }, []);
  const cancelCaptureRef = useRef<(() => void) | null>(null);
  cancelCaptureRef.current = cancelCapture;

  // ── Toolbar drag ───────────────────────────────────────────────────────────

  const handleToolbarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    toolbarDragRef.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPosX: toolbarPosRef.current.x,
      startPosY: toolbarPosRef.current.y,
    };
    document.body.style.cursor = 'grabbing';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!toolbarDragRef.current) return;
      const dx = e.clientX - toolbarDragRef.current.startMouseX;
      const dy = e.clientY - toolbarDragRef.current.startMouseY;
      setToolbarPos({
        x: toolbarDragRef.current.startPosX + dx,
        y: toolbarDragRef.current.startPosY + dy,
      });
    };
    const onUp = (e: MouseEvent) => {
      if (!toolbarDragRef.current) return;
      const dx = e.clientX - toolbarDragRef.current.startMouseX;
      const dy = e.clientY - toolbarDragRef.current.startMouseY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasDraggedRef.current = true;
      const finalPos = { x: toolbarDragRef.current.startPosX + dx, y: toolbarDragRef.current.startPosY + dy };
      try { sessionStorage.setItem(getStorageKey('ilse-toolbar-pos'), JSON.stringify(finalPos)); } catch { /* ignore */ }
      toolbarDragRef.current = null;
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []);

  // ── Unified annotation mode handlers ──────────────────────────────────────

  /** Put the selection (card + property panel) on this element */
  const selectElement = useCallback((clicked: Element, deep = false) => {
    const target = selectionTarget(clicked, deep);
    const capture = captureElement(target);
    const domRect = target.getBoundingClientRect();
    // Tag the exact clicked element with a unique attribute so the PixelOverlay
    // can re-query it reliably even when the generated CSS selector matches
    // multiple elements on the page.
    const pixelTargetId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    target.setAttribute('data-ilse-pixel-target', pixelTargetId);
    stylePreviewCommitted.current = false;
    const elemRect = { top: Math.round(domRect.top), left: Math.round(domRect.left), width: Math.round(domRect.width), height: Math.round(domRect.height) };
    const suggestions = analyzeElement(target, capture.styles);
    // Part of a component repeated on the page, or written on other screens too? Then the
    // designer chooses: this one (the default) or all of them. Once on screen isn't once in the code
    const owned = componentScope(target);
    const item = owned ? catalogRef.current?.items.find(i => i.name === owned.component && !i.library) : undefined;
    const uses = item && item.uses > 1 ? item.uses : undefined;
    setPanelEpoch(n => n + 1); // a fresh panel for the new element
    setPendingCapture({
      ...(owned && (owned.count > 1 || uses) ? { scope: { ...owned, choice: 'one' as const, ...(uses ? { uses } : {}) } } : {}),
      capture,
      context: capture.element,
      contextLabel: buildContextLabel(target),
      rect: elemRect,
      originalRect: { ...elemRect },
      note: '',
      markerType: 'element',
      pixelTargetId,
      suggestions,
    });
    setAnnotating(false);
  }, []);

  /**
   * The browser's right-click menu (Ilse for Chrome): "Open with Ilse" opens
   * the toolbar with the card on the element that was right-clicked. The
   * extension marks the element (data-ilse-context)
   * and asks through an event — or a flag, when the toolbar is mounting.
   */
  const fromContextMenu = useCallback((action: unknown) => {
    if (action !== 'select' && action !== 'open') return;
    const marked = document.querySelector('[data-ilse-context]');
    marked?.removeAttribute('data-ilse-context');
    setIsOpen(true);
    setShowSettings(false);
    if (action === 'open' || !marked || marked.closest('[data-ilse-toolbar]')) { setAnnotating(true); return; }
    // A draft with work in it isn't thrown away by a right-click
    const pc = pendingCaptureRef.current;
    if (pc && (pc.note.trim() || hasAuto(pc.auto) || pc.styleChanges?.length || pc.imageRefs?.length || pc.sketch)) return;
    if (pc?.pixelTargetId) settleElement(document.querySelector(`[data-ilse-pixel-target="${pc.pixelTargetId}"]`));
    if (toolbarModeRef.current !== 'design') setToolbarMode('design');
    selectElement(marked);
  }, [selectElement]);
  useEffect(() => {
    const w = window as Window & { __ilseContext?: string };
    const onContext = (e: Event) => { delete w.__ilseContext; fromContextMenu((e as CustomEvent).detail?.action); };
    window.addEventListener('ilse:context', onContext);
    // Asked before the toolbar was there (the extension just put it on the page)
    if (w.__ilseContext) { const a = w.__ilseContext; delete w.__ilseContext; setTimeout(() => fromContextMenu(a), 0); }
    return () => window.removeEventListener('ilse:context', onContext);
  }, [fromContextMenu]);

  // A new selection (or none) starts a new draft history
  const draftKey = pendingCapture ? (pendingCapture.pixelTargetId ?? pendingCapture.context) : null;
  useEffect(() => { draftSteps.current = []; draftTouched.current = false; }, [draftKey]);

  // Selected but untouched (no note, no command, no panel edit, no image): a click
  // on another element moves the selection there, like picking a layer in Figma.
  // Once the designer has changed something, a stray click must not lose it.
  useEffect(() => {
    if (!pendingCapture || annotating) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as Element | null;
      if (!target || target.closest('[data-ilse-toolbar]') || target.closest('[data-ilse-placeholder]')) return;
      const pc = pendingCaptureRef.current;
      if (!pc) return;
      const selected = pc.pixelTargetId ? document.querySelector(`[data-ilse-pixel-target="${pc.pixelTargetId}"]`) : null;
      if (selected && (selected === target || selected.contains(target))) return; // that's a drag of the selection
      const untouched = !pc.note.trim() && !hasAuto(pc.auto) && !(pc.styleChanges?.length) && !(pc.imageRefs?.length) && !pc.sketch;
      if (!untouched) return;
      e.preventDefault();
      e.stopPropagation();
      const swallow = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      if (selected) settleElement(selected);
      selectElement(target, e.metaKey || e.ctrlKey);
    };
    // pointerdown so a disabled control, which gets no mousedown, can be picked too
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [pendingCapture, annotating, selectElement]);


  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (toolbarDragRef.current) return;
    if ((e.target as Element).closest('[data-ilse-toolbar]')) return;
    annotationDragRef.current = { x: e.clientX, y: e.clientY };
    isDraggingAnnotationRef.current = false;
    const target = e.target as Element;
    dragStartEmptyRef.current = target === document.body || target === document.documentElement;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (toolbarDragRef.current) return;
    const target = e.target as Element;

    if (annotationDragRef.current && e.buttons === 1) {
      const dx = e.clientX - annotationDragRef.current.x;
      const dy = e.clientY - annotationDragRef.current.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        isDraggingAnnotationRef.current = true;
        setHighlight(null);
        setHoverLabel(null);
        setHoverLabelRect(null);
        setDragRect(normalizeRect(annotationDragRef.current, { x: e.clientX, y: e.clientY }));
        return;
      }
    }

    if (!target.closest('[data-ilse-toolbar]')) {
      // Highlight what a click would select (a whole <svg>, not one of its paths)
      const hovered = selectionTarget(target, e.metaKey || e.ctrlKey);
      const rect = hovered.getBoundingClientRect();
      const r: PopoverRect = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      // Only update if rect actually changed — avoids re-render loops
      setHighlight(prev => {
        if (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height) return prev;
        return r;
      });
      const tag = hovered.tagName.toLowerCase();
      const id = hovered.id ? `#${hovered.id}` : '';
      const cls = !id && hovered.classList.length > 0 ? `.${hovered.classList[0]}` : '';
      setHoverLabel(`${tag}${id}${cls}`);
      setHoverLabelRect(r);
    } else {
      setHighlight(null);
    }
  }, []);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (toolbarDragRef.current) return;
    const target = e.target as Element;
    if (target.closest('[data-ilse-toolbar]')) return;

    // One-shot click blocker that survives the upcoming state change.
    // When setAnnotating(false) triggers useEffect cleanup, the persistent blocker
    // is removed — this one-shot catches the native click fired right after mouseup.
    const oneShotBlocker = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    };
    window.addEventListener('click', oneShotBlocker, { capture: true, once: true });
    window.addEventListener('auxclick', oneShotBlocker, { capture: true, once: true });

    const start = annotationDragRef.current;
    const wasDragging = isDraggingAnnotationRef.current;

    annotationDragRef.current = null;
    isDraggingAnnotationRef.current = false;
    setDragRect(null);

    if (wasDragging && start) {
      const rect = normalizeRect(start, { x: e.clientX, y: e.clientY });
      if (rect.width > 10 && rect.height > 10) {
        const area = captureArea(rect);
        const isEmpty = area.elementCount === 0;
        setPendingCapture({
          capture: { element: `[área: ${area.elementCount} elementos]`, styles: {}, rect: area.region, _scrollX: window.scrollX, _scrollY: window.scrollY, _scrollers: recordScrollers(pageElementAt(rect.left + rect.width / 2, rect.top + rect.height / 2)) },
          context: isEmpty ? t('toolbar.area.empty') : t('toolbar.area.elements', { count: area.elementCount }),
          contextLabel: isEmpty ? t('toolbar.area.empty') : t('toolbar.area.elements', { count: area.elementCount }),
          rect,
          originalRect: { ...rect },
          note: '',
          ...(isEmpty ? {} : { auto: { area: `Área com ${area.elementCount} elementos: ${area.elements.slice(0, 5).map(el => el.selector).join(', ')}${area.elementCount > 5 ? '…' : ''}` } }),
          markerType: 'area',
          areaElementCount: area.elementCount,
        });
        setAnnotating(false);
      }
      return;
    }

    const textCapture = captureTextSelection();
    if (textCapture) {
      setPendingCapture({
        capture: {
          element: textCapture.element,
          component: textCapture.component,
          styles: textCapture.styles,
          parent: undefined,
          rect: textCapture.rect,
          grepPattern: textCapture.grepPattern,
          componentStack: textCapture.componentStack,
          _scrollX: window.scrollX,
          _scrollY: window.scrollY,
          _scrollers: recordScrollers(window.getSelection()?.anchorNode?.parentElement),
        },
        context: textCapture.element,
        contextLabel: `text: "${textCapture.text.length > 32 ? textCapture.text.slice(0, 32) + '...' : textCapture.text}"`,
        rect: textCapture.rect,
        originalRect: { ...textCapture.rect },
        note: '',
        markerType: 'text',
      });
      window.getSelection()?.removeAllRanges();
      setAnnotating(false);
      return;
    }

    selectElement(target, e.metaKey || e.ctrlKey);
  }, []);

  // Aggressive event blocker — prevents page events from firing while annotating.
  // Covers all interaction event types (click, pointer, mouse, touch) in capture phase.
  const blockInteraction = useCallback((e: Event) => {
    const target = e.target as Element | null;
    if (target?.closest?.('[data-ilse-toolbar]')) return; // allow our own UI
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, []);

  useEffect(() => {
    if (annotating && isOpen) { // never selecting with the toolbar closed
      // Annotation capture handlers (run first in capture phase). Pointer, not
      // mouse, down/up: browsers never send mousedown/mouseup/click to a disabled
      // button or input, but they do send pointer events, so it can be selected.
      document.addEventListener('pointerdown', handleMouseDown, true);
      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('pointerup', handleMouseUp, true);

      // Block click-based page interactions — links, buttons, context menus
      const blocked = ['click', 'auxclick', 'dblclick', 'contextmenu'] as const;
      for (const type of blocked) {
        document.addEventListener(type, blockInteraction, { capture: true, passive: false });
      }

      document.body.style.cursor = 'crosshair';
      return () => {
        document.removeEventListener('pointerdown', handleMouseDown, true);
        document.removeEventListener('mousemove', handleMouseMove, true);
        document.removeEventListener('pointerup', handleMouseUp, true);
        for (const type of blocked) {
          document.removeEventListener(type, blockInteraction, { capture: true });
        }
        document.body.style.cursor = '';
      };
    } else {
      document.body.style.cursor = '';
      setHighlight(null);
      setDragRect(null);
      setHoverLabel(null);
      setHoverLabelRect(null);
      return undefined;
    }
  }, [annotating, isOpen, handleMouseDown, handleMouseMove, handleMouseUp, blockInteraction]);

  // ── Escape: close everything ───────────────────────────────────────────────

  const pendingCaptureForEsc = useRef(pendingCapture);
  const activeMarkerForEsc = useRef(activeMarker);
  const showSettingsForEsc = useRef(showSettings);
  const shortcutsOpenForEsc = useRef(false);
  const chatOpenForEsc = useRef(chatOpen);
  useEffect(() => { pendingCaptureForEsc.current = pendingCapture; }, [pendingCapture]);
  useEffect(() => { activeMarkerForEsc.current = activeMarker; }, [activeMarker]);
  useEffect(() => { showSettingsForEsc.current = showSettings; }, [showSettings]);
  useEffect(() => { shortcutsOpenForEsc.current = shortcutsOpen; }, [shortcutsOpen]);
  const memoryOpenForEsc = useRef(false);
  useEffect(() => { memoryOpenForEsc.current = memoryOpen; }, [memoryOpen]);
  useEffect(() => { chatOpenForEsc.current = chatOpen; }, [chatOpen]);
  const journeysOpenForEsc = useRef(false);
  useEffect(() => { journeysOpenForEsc.current = journeysOpen; }, [journeysOpen]);
  const reportOpenForEsc = useRef(false);
  // Back from a finding on another page: the report reopens docked, on it
  useEffect(() => {
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(REPORT_FOCUS_KEY); sessionStorage.removeItem(REPORT_FOCUS_KEY); } catch { return; }
    if (!saved) return;
    try {
      const { id } = JSON.parse(saved) as { id?: string };
      if (typeof id !== 'string') return;
      setToolbarMode('test'); setIsOpen(true);
      setReportOpen(true); setReportFocus(id);
    } catch { /* not ours */ }
  }, []);
  useEffect(() => { reportOpenForEsc.current = reportOpen && !reportDocked; }, [reportOpen, reportDocked]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Screens mode open on this page: its view and the Ilse in the frame handle Esc
      if (screensOpenRef.current) return;
      // Progressive close: dismiss the topmost layer first
      if (pendingCaptureForEsc.current) {
        // Same as cancel: every preview of this draft goes, selection mode stays
        cancelCapture();
        return;
      }
      if (chatOpenForEsc.current) {
        setChatOpen(false);
        return;
      }
      if (journeysOpenForEsc.current) {
        setJourneysOpen(false);
        return;
      }
      // The docked report stays while browsing; only the one above the toolbar closes with Esc
      if (reportOpenForEsc.current) {
        setReportOpen(false);
        return;
      }
      if (scanOpen) {
        setScanOpen(false);
        setScanHighlight(null);
        return;
      }
      if (activeMarkerForEsc.current !== null) {
        setActiveMarker(null);
        return;
      }
      if (shortcutsOpenForEsc.current) {
        setShortcutsOpen(false);
        return;
      }
      if (memoryOpenForEsc.current) {
        setMemoryOpen(false);
        return;
      }
      if (showSettingsForEsc.current) {
        setShowSettings(false);
        return;
      }
      if (EMBEDDED) { leaveScreens(); return; }
      setAnnotating(false);
      setIsOpen(false);
    };
    // Embedded, the panel is in the host's document: its Esc comes from there too
    const docs = EMBEDDED ? [document, uiDocument()] : [document];
    for (const d of docs) d.addEventListener('keydown', onEsc);
    return () => { for (const d of docs) d.removeEventListener('keydown', onEsc); };
  }, []);

  // ── Persistent selection drag (native events — bypasses React delegation) ─
  const hasPendingCapture = pendingCapture !== null;
  useEffect(() => {
    const el = pendingAreaRef.current;
    if (!el) return;

    const onEnter = () => setPendingAreaHover(true);
    const onLeave = () => setPendingAreaHover(false);
    const onDown = (e: MouseEvent) => {
      // Don't drag when clicking resize handles
      const target = e.target as HTMLElement;
      if (target !== el) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;

      // An element selection drags the element itself: its list re-flows live.
      const pcLive = pendingCaptureRef.current;
      const liveEl = pcLive?.markerType === 'element' && pcLive.pixelTargetId
        ? document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${pcLive.pixelTargetId}"]`)
        : null;
      // Out of the flow (absolute/fixed, e.g. set in the panel's Position): it goes
      // wherever it's dropped — no list, no drop zones — and the move is its X/Y
      if (liveEl && /^(absolute|fixed)$/.test(getComputedStyle(liveEl).position)) {
        const cs = getComputedStyle(liveEl);
        const left0 = parseFloat(cs.left) || 0;
        const top0 = parseFloat(cs.top) || 0;
        const inline = { left: liveEl.style.left, top: liveEl.style.top };
        let moved = false;
        const at = (mv: MouseEvent) => ({ left: `${Math.round(left0 + mv.clientX - startX)}px`, top: `${Math.round(top0 + mv.clientY - startY)}px` });
        const onMoveFree = (mv: MouseEvent) => {
          if (!moved) {
            if (Math.abs(mv.clientX - startX) < 4 && Math.abs(mv.clientY - startY) < 4) return;
            moved = true;
            document.body.style.cursor = 'grabbing';
            setShowGrid(true);
            snapRectsRef.current = collectSnapRects();
            contentRectsRef.current = collectContentRects();
          }
          const next = at(mv);
          liveEl.style.left = next.left;
          liveEl.style.top = next.top;
          const b = liveEl.getBoundingClientRect();
          const rect = { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) };
          setGuides(computeGuides(rect, snapRectsRef.current));
          setSpacings(computeSpacings(rect, contentRectsRef.current, Math.abs(mv.clientY - startY) > Math.abs(mv.clientX - startX) ? 'y' : 'x'));
          setPendingCapture(prev => prev ? { ...prev, rect, capture: { ...prev.capture, rect } } : null);
        };
        const onUpFree = (mv: MouseEvent) => {
          document.removeEventListener('mousemove', onMoveFree);
          document.removeEventListener('mouseup', onUpFree);
          document.body.style.cursor = '';
          if (!moved) return;
          setGuides([]);
          setSpacings([]);
          setShowGrid(false);
          const next = at(mv);
          // Back to the inline style the panel knows, so it records the right "before"
          liveEl.style.left = inline.left;
          liveEl.style.top = inline.top;
          panelHistoryRef.current?.setStyles(next, t('undo.move'));
        };
        document.addEventListener('mousemove', onMoveFree);
        document.addEventListener('mouseup', onUpFree);
        return;
      }
      if (liveEl) {
        let drag: LiveDrag | null = null;
        const onMoveLive = (mv: MouseEvent) => {
          if (!drag) {
            if (Math.abs(mv.clientX - startX) < 4 && Math.abs(mv.clientY - startY) < 4) return;
            drag = beginDrag(liveEl, { x: startX, y: startY });
            liveDragRef.current = drag;
            setLiveDragging(true);
            document.body.style.cursor = 'grabbing';
            setShowGrid(true);
            snapRectsRef.current = collectSnapRects();
            contentRectsRef.current = collectContentRects();
          }
          drag.move(mv.clientX, mv.clientY);
          // The grid and the distances to neighbours, as when resizing
          const b = reorderUnit(liveEl).getBoundingClientRect();
          const box = { top: b.top, left: b.left, width: b.width, height: b.height };
          const ddx = mv.clientX - startX;
          const ddy = mv.clientY - startY;
          setGuides(computeGuides(box, snapRectsRef.current));
          setSpacings(computeSpacings(box, contentRectsRef.current, Math.abs(ddy) > Math.abs(ddx) ? 'y' : 'x'));
        };
        const onUpLive = () => {
          document.removeEventListener('mousemove', onMoveLive);
          document.removeEventListener('mouseup', onUpLive);
          document.body.style.cursor = '';
          liveDragRef.current = null;
          if (!drag) return;
          setGuides([]);
          setSpacings([]);
          setShowGrid(false);
          const result = drag.end();
          // Let the element glide into place, then put the selection on it
          if (result) pushDraftStep({ kind: 'gesture', key: result.kind === 'offset' ? 'move' : 'reorder', label: result.kind === 'offset' ? t('undo.move') : t('undo.reorder') });
          setTimeout(() => {
            setLiveDragging(false);
            // The list item that moved, not necessarily the clicked child — or,
            // moved into another container, the stand-in that shows it there
            const r = (result?.kind === 'reparent' ? result.landed : reorderUnit(liveEl)).getBoundingClientRect();
            const rect = { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) };
            // A copy isn't in the code yet: its drop is where to write it, not a reorder of the code.
            // The drag only previews (the DOM isn't moved), so the place comes from the result
            const copyIns = pendingCaptureRef.current?.insert?.copy ? pendingCaptureRef.current.insert : null;
            const copyDraft = copyIns ? document.querySelector<HTMLElement>(`[data-ilse-draft="${copyIns.draftId}"]`) : null;
            let copyPlace: string | undefined;
            if (copyDraft && result?.kind === 'reorder') {
              const { prev: p, next: n } = neighboursAfterReorder(copyDraft, result.to);
              copyPlace = placeBetween(copyDraft, p, n, copyDraft.parentElement);
            } else if (copyDraft && result?.kind === 'reparent') {
              const { anchor, placement } = insertAnchor(result.target, result.index, result.landed, copyDraft);
              copyPlace = placeBetween(copyDraft, placement === 'after' ? anchor : null, placement === 'before' ? anchor : null, placement === 'inside' ? anchor : result.target);
            }
            setPendingCapture(prev => {
              if (!prev) return null;
              const moved = { ...prev, rect, capture: { ...prev.capture, rect } };
              if (copyIns && prev.insert && (result?.kind === 'reorder' || result?.kind === 'reparent')) {
                const insert = { ...prev.insert, place: copyPlace };
                return { ...moved, originalRect: rect, insert, auto: { ...prev.auto, ...insertCommand(insert), reorder: undefined, reorderLabel: undefined, move: undefined } };
              }
              if (!result) return { ...moved, originalRect: rect, auto: { ...prev.auto, reorder: undefined, reorderLabel: undefined, move: undefined } };
              if (result.kind === 'reorder') {
                // A reorder is structural, not a pixel offset: no "move N px" for the agent
                const owner = result.listOwner ?? result.react.owner;
                return {
                  ...moved, originalRect: rect,
                  auto: {
                    ...prev.auto, reorder: formatReorder(result), move: undefined,
                    reorderLabel: t(owner ? 'toolbar.chip.reorderIn' : 'toolbar.chip.reorder', { item: result.item, to: result.to + 1, count: result.after.length, owner: owner ?? '' }),
                  },
                };
              }
              if (result.kind === 'reparent') {
                // Structural too: which container, where in it — not pixels
                return {
                  ...moved, originalRect: rect,
                  auto: {
                    ...prev.auto, move: undefined,
                    reorder: formatReparent(result, captureElement(result.target).grepPattern),
                    reorderLabel: t(result.out ? 'toolbar.chip.moveOut' : 'toolbar.chip.moveInto', { item: result.item, into: result.intoLabel }),
                  },
                };
              }
              return { ...moved, auto: { ...prev.auto, reorder: undefined, reorderLabel: undefined, move: moveText(result.dx, result.dy) || undefined } };
            });
          }, 190);
        };
        document.addEventListener('mousemove', onMoveLive);
        document.addEventListener('mouseup', onUpLive);
        return;
      }

      // Snapshot rect at drag start — read from ref to avoid stale closure
      const pc = pendingCaptureRef.current;
      if (!pc) return;
      const origRect = { ...pc.rect };
      document.body.style.cursor = 'grabbing';
      setShowGrid(true);
      let didMove = false;
      // Collect snap targets once at drag start
      snapRectsRef.current = collectSnapRects();
      contentRectsRef.current = collectContentRects();
      const onMove = (mv: MouseEvent) => {
        const dx = snapToGrid(mv.clientX - startX);
        const dy = snapToGrid(mv.clientY - startY);
        if (Math.abs(dx) >= gridSize || Math.abs(dy) >= gridSize) didMove = true;
        const newRect = { ...origRect, top: origRect.top + dy, left: origRect.left + dx };
        const axis: 'x' | 'y' | null = Math.abs(dy) > Math.abs(dx) ? 'y' : Math.abs(dx) > Math.abs(dy) ? 'x' : null;
        setGuides(computeGuides(newRect, snapRectsRef.current));
        setSpacings(computeSpacings(newRect, contentRectsRef.current, axis));
        setPendingCapture(prev => prev ? {
          ...prev,
          rect: newRect,
          capture: { ...prev.capture, rect: { top: newRect.top, left: newRect.left, width: newRect.width, height: newRect.height } },
        } : null);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        setGuides([]);
        setSpacings([]);
        setShowGrid(false);
        if (didMove) {
          // The distance goes to the agent; the note stays the designer's.
          const pc2 = pendingCaptureRef.current;
          const oRect = pc2?.originalRect;
          if (pc2 && oRect) {
            const text = moveText(pc2.rect.left - oRect.left, pc2.rect.top - oRect.top);
            setPendingCapture(prev => prev ? { ...prev, auto: { ...prev.auto, move: text || undefined } } : null);
          }
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('mousedown', onDown);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('mousedown', onDown);
    };
  // Only re-subscribe when the overlay mounts/unmounts, not on every rect change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPendingCapture]);

  // ── Send / remove ──────────────────────────────────────────────────────────

  /** Where a copy stands on the page, for the agent — undefined while it's right after its original */
  /** The copy's place from its neighbours on the page (or after a drag, where it was dropped) */
  const placeBetween = (draft: HTMLElement, prev: Element | null, next: Element | null, parent: Element | null): string | undefined => {
    const twin = (el: Element) => el.tagName === draft.tagName && el.getAttribute('class') === draft.getAttribute('class')
      && sameText((el as HTMLElement).innerText ?? '', draft.innerText);
    const describe = (el: Element | null): Neighbour | null => el && {
      name: `<${instanceAt(el, catalog?.items ?? [])?.component ?? el.tagName.toLowerCase()}>`,
      text: lineOf((el as HTMLElement).innerText ?? ''),
      twin: twin(el),
    };
    return copyPlacement(describe(prev), describe(next), describe(parent));
  };
  const placeOfCopy = (draftId: string): string | undefined => {
    const draft = document.querySelector<HTMLElement>(`[data-ilse-draft="${draftId}"]`);
    if (!draft) return undefined;
    const isIlse = (el: Element) => !!el.closest('[data-ilse-toolbar],[data-ilse-placeholder],[data-ilse-marker],[data-ilse-draft]');
    const step = (el: Element, back: boolean): Element | null => {
      let s = back ? el.previousElementSibling : el.nextElementSibling;
      while (s && isIlse(s)) s = back ? s.previousElementSibling : s.nextElementSibling;
      return s;
    };
    return placeBetween(draft, step(draft, true), step(draft, false), draft.parentElement);
  };
  /**
   * The real copy showed up (the page re-rendered mid-run): the draft gives way at once,
   * not when the run ends — two of the same on screen for a few seconds reads as a bug
   */
  const watchForRealCopy = (draftId: string) => {
    const draft = document.querySelector<HTMLElement>(`[data-ilse-draft="${draftId}"]`);
    if (!draft) return;
    // Tag and text, not classes: a copy restyled in the panel comes back with other classes
    const tag = draft.tagName, text = draft.innerText;
    if (!text.trim()) return; // no text to recognise it by (an icon, an image): 'resolved' handles it
    const twins = () => Array.from(document.getElementsByTagName(tag)).filter(el =>
      !el.closest('[data-ilse-draft],[data-ilse-toolbar]') && sameText((el as HTMLElement).innerText ?? '', text)).length;
    const before = twins();
    const deadline = Date.now() + 10 * 60_000;
    const tick = () => {
      if (!document.querySelector(`[data-ilse-draft="${draftId}"]`) || Date.now() > deadline) return;
      if (twins() > before) { removeDraft(draftId); return; }
      setTimeout(tick, 400);
    };
    setTimeout(tick, 400);
  };

  const sendAnnotation = useCallback((index: number) => {
    const ann = annotations[index];
    if (!ann) return;
    // A copy: its place is where it stands now (the drag of a copy isn't a reorder of the code)
    const auto = ann.insert?.copy
      ? { ...ann.auto, ...insertCommand({ ...ann.insert, place: ann.insert.place ?? placeOfCopy(ann.insert.draftId) }, !!ann.styleData?.changes.length), reorder: undefined, reorderLabel: undefined, move: undefined }
      : ann.auto;
    // The same request on the same element is already on its way: a second agent would edit
    // the same file at the same time
    const note = composeNote(ann.note, auto);
    if (annotations.some((a, i) => i !== index && a.status === 'sent' && a.capture.element === ann.capture.element && composeNote(a.note, a.auto) === note)) {
      setAnnotations(prev => prev.filter((_, i) => i !== index));
      return;
    }
    if (ann.insert?.copy) watchForRealCopy(ann.insert.draftId);
    // A finding sent to the agent is one the dev approved (test memory counts it)
    if (ann.testFinding && ann.status === 'pending') decideTestFinding(ann.testFinding, 'approved');
    // Exit annotation mode on send — user gets normal cursor while agent works
    setAnnotating(false);
    const env = captureEnvironment();
    const clientId = ann.clientId ?? newClientId();
    if (!ann.clientId) setAnnotations(prev => prev.map((a, i) => i === index ? { ...a, clientId } : a));
    const payload: Record<string, unknown> = {
      type: 'annotate',
      clientId,
      note,
      // What the designer typed, apart from Ilse's own context — the CLI must not skip it
      designerNote: ann.note.trim() || undefined,
      scope: ann.scope,
      remove: ann.auto?.remove ? true : undefined,
      textEdit: ann.textEdit,
      propEdit: ann.propEdit,
      insert: ann.insert && !ann.insert.copy ? {
        component: ann.insert.item.name, source: ann.insert.item.source, module: ann.insert.item.module,
        importAs: ann.insert.item.importAs ?? 'named', library: ann.insert.item.library,
        placement: ann.insert.placement, props: ann.insert.props, text: ann.insert.text,
        required: ann.insert.item.props.filter(p => p.required).map(p => p.name),
        example: ann.insert.item.example?.code,
        at: ann.insert.at,
      } : undefined,
      element: ann.capture.element,
      component: ann.capture.component,
      styles: ann.capture.styles,
      parent: ann.capture.parent,
      grepPattern: ann.capture.grepPattern,
      frames: ann.capture.frames,
      copyOf: ann.capture.copyOf,
      componentStack: ann.capture.componentStack,
      domPath: ann.capture.domPath,
      nearbyElements: ann.capture.nearbyElements,
      text: ann.capture.text,
      position: ann.capture.rect,
      environment: env,
      // What renders on this page: the CLI checks the run's edits landed here
      pageComponents: pageComponents(),
      // Schema rico
      // A copy is new code to write, never a mechanical class edit — even with a margin set on it
      intent: ann.insert?.copy ? 'change' : ann.intent ?? inferDraftIntent(ann.note, !!ann.capture.element),
      severity: ann.severity ?? 'important',
    };
    if (ann.imageRefs?.length) {
      payload.imageRefs = ann.imageRefs;
      if (ann.imageFilenames?.length) payload.imageFilenames = ann.imageFilenames;
    }
    if (ann.styleData?.changes.length) payload.styleData = ann.styleData;
    if (ann.composeMs !== undefined) payload.composeMs = ann.composeMs;
    if (ann.testFinding) payload.testFinding = ann.testFinding;
    payload.captureMode = ann.markerType;
    if (ann.rearrangeData) {
      payload.rearrangeData = {
        selector: ann.capture.element,
        label: ann.capture.component ?? ann.capture.element,
        tagName: ann.capture.element.split(/[.#[: ]/)[0] || 'div',
        originalRect: ann.rearrangeData.originalRect,
        currentRect: ann.rearrangeData.currentRect,
      };
    }
    if (ann.intent === 'create' && ann.capture.rect) {
      payload.placementData = {
        x: ann.capture.rect.left,
        y: ann.capture.rect.top,
        scrollY: window.scrollY,
        nearestSelector: ann.capture.parent ?? undefined,
      };
    }

    // Smart fallback: MCP → demo API → clipboard
    if (send(payload)) {
      // WS connected — sent to MCP
      setAnnotations(prev => prev.map((a, i) => i === index ? { ...a, status: 'sent' } : a));
      setSendFeedback('sending');
      setTimeout(() => setSendFeedback(null), 1500);
    } else if (demoMode && demoEndpoint) {
      // Demo mode — call API endpoint, apply DOM patches
      setAnnotations(prev => prev.map((a, i) => i === index ? { ...a, status: 'sent' } : a));
      setSendFeedback('sending');
      const ctrl = new AbortController();
      demoAbortRef.current = ctrl;
      fetch(demoEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          element: ann.capture.element,
          styles: ann.capture.styles,
          note: composeNote(ann.note, ann.auto),
          context: ann.capture.component ?? ann.capture.element,
        }),
        signal: ctrl.signal,
      })
        .then(r => r.json())
        .then((data: { patches?: Array<{ selector: string; property: string; value: string }>; summary?: string }) => {
          if (data.patches) {
            for (const patch of data.patches) {
              try {
                const targets = document.querySelectorAll(patch.selector);
                for (const target of targets) {
                  if (target.closest('[data-ilse-toolbar]')) continue;
                  (target as HTMLElement).style[patch.property as any] = patch.value;
                }
              } catch { /* invalid selector */ }
            }
          }
          setAnnotations(prev => prev.map((a, i) =>
            i === index ? { ...a, status: 'resolved', resolvedSummary: data.summary ?? 'Done' } : a
          ));
          setSendFeedback(null);
        })
        .catch(() => {
          setAnnotations(prev => prev.map((a, i) => i === index ? { ...a, status: 'pending' } : a));
          setSendFeedback(null);
          setClipboardToast(saying('Demo API error', 'failed'));
          setTimeout(() => setClipboardToast(null), 4000);
        });
    } else {
      // WS not connected — copy to clipboard
      const markdown = formatAnnotationMarkdown(ann, index);
      navigator.clipboard.writeText(markdown).then(() => {
        setAnnotations(prev => prev.map((a, i) => i === index ? { ...a, status: 'sent' } : a));
        setClipboardToast(saying(t('toolbar.clipboard.copied'), 'copied'));
        setTimeout(() => setClipboardToast(null), 4000);
      }).catch(() => {
        setClipboardToast(saying(t('toolbar.clipboard.error'), 'oops'));
        setTimeout(() => setClipboardToast(null), 4000);
      });
    }
  }, [annotations]);

  const sendAll = useCallback(() => {
    // Exit annotation mode so the user gets a normal cursor while the agent works
    setAnnotating(false);
    if (isConnected() || demoMode) {
      // WS connected or demo mode — send each individually
      annotations.forEach((ann, i) => { if (ann.status === 'pending' && inMode(ann)) sendAnnotation(i); });
    } else {
      // WS not connected — copy all as markdown
      const markdown = formatAllAsMarkdown(annotations);
      navigator.clipboard.writeText(markdown).then(() => {
        setAnnotations(prev => prev.map(a => a.status === 'pending' ? { ...a, status: 'sent' } : a));
        setClipboardToast(saying(t('toolbar.clipboard.copied'), 'copied'));
        setTimeout(() => setClipboardToast(null), 4000);
      }).catch(() => {
        setClipboardToast(saying(t('toolbar.clipboard.error'), 'oops'));
        setTimeout(() => setClipboardToast(null), 4000);
      });
    }
  }, [annotations, sendAnnotation, toolbarMode]);

  // ── Remove the selected element ──
  // Preview: hidden in place (display:none on React's own node — never removed
  // from the DOM, React owns it). The agent takes it out of the JSX; × or ⌘Z
  // shows it again. Kept per pixel target, so the original display comes back.
  const hiddenDisplay = useRef(new Map<string, string>());
  const unhide = (id: string) => {
    const saved = hiddenDisplay.current.get(id);
    if (saved === undefined) return;
    hiddenDisplay.current.delete(id);
    const el = document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${id}"]`);
    if (el?.isConnected) el.style.display = saved;
  };
  const removeSelected = useCallback(() => {
    const pc = pendingCaptureRef.current;
    if (!pc?.pixelTargetId || pc.markerType !== 'element' || pc.auto?.remove) return;
    const el = document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${pc.pixelTargetId}"]`);
    if (!el) return;
    hiddenDisplay.current.set(pc.pixelTargetId, el.style.display);
    el.style.display = 'none';
    const what = pc.contextLabel;
    setPendingCapture(prev => prev ? {
      ...prev,
      auto: {
        ...prev.auto,
        removeLabel: t('toolbar.removeCommand', { what }),
        remove: [
          `Remover este elemento (já escondido na tela pelo designer): ${what}.`,
          'Tire o elemento do JSX. Se ele vem de uma lista gerada por .map, remova este item dos dados (ou filtre só ele), não o template de todos — a menos que o Scope diga ALL.',
          'Limpe imports, props, estado e estilos que ficarem sem uso. Não simule com CSS (display:none, hidden, opacity).',
        ].join('\n'),
      },
    } : null);
    pushDraftStep({ kind: 'gesture', key: 'remove', label: t('undo.remove') });
  }, []);

  // Delete / Backspace removes the selected element, like in a design tool —
  // never while typing. The note takes focus as soon as the card opens; there
  // only the forward Delete (fn+⌫ on a Mac) counts: ⌫ in an empty box is a
  // reflex — it once queued a removal on top of a whole new page request.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      const emptyNote = e.key === 'Delete' && el?.hasAttribute('data-ilse-note') && !el.textContent;
      if (el && !emptyNote && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (!pendingCaptureRef.current || pendingCaptureRef.current.markerType !== 'element') return;
      e.preventDefault();
      removeSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [removeSelected]);

  /** Take back one of Ilse's commands (× on its chip, or ⌘Z in the draft): its preview goes away, the card stays */
  const takeBack = useCallback((key: AutoKey) => {
    // Retyped text: the panel puts the original back (and clears the command)
    if (key === 'text') { panelHistoryRef.current?.resetText(); return; }
    if (key === 'insert') { cancelCaptureRef.current?.(); return; }
    if (key === 'component') {
      setPendingCapture(prev => prev ? { ...prev, auto: { ...prev.auto, component: undefined, componentLabel: undefined } } : null);
      return;
    }
    if (key === 'props') {
      const pc = pendingCaptureRef.current;
      const el = pc?.pixelTargetId ? document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${pc.pixelTargetId}"]`) : null;
      if (el) previewVariant(el, pc!.pixelTargetId!, null);
      setVariantMissing(false);
      setPendingCapture(prev => prev ? { ...prev, propEdit: undefined, auto: { ...prev.auto, props: undefined, propsLabel: undefined } } : null);
      return;
    }
    if (key === 'remove') {
      const id = pendingCaptureRef.current?.pixelTargetId;
      if (id) unhide(id);
      setPendingCapture(prev => prev ? { ...prev, auto: { ...prev.auto, remove: undefined, removeLabel: undefined } } : null);
      return;
    }
    // Panel edits: remount the panel, which reverts its preview and starts clean
    if (key === 'style') setPanelEpoch(n => n + 1);
    // Move / resize / reorder: put the element back. The selection and
    // this card stay — the designer is taking back a gesture, not the note.
    // A reorder is an order preview; moving into/out of a container may also be an offset
    const kind = ({ move: ['move'], resize: ['size'], reorder: ['order', 'move'] } as const)[key as 'move' | 'resize' | 'reorder'];
    const pc = pendingCaptureRef.current;
    const el = pc?.pixelTargetId ? document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${pc.pixelTargetId}"]`) : null;
    if (kind && el) settleElement(el, [...kind]);
    const measure = () => {
      if (!kind) return undefined;
      if (!el) return pc?.originalRect ? { ...pc.originalRect } : undefined; // overlay-only move
      // Re-query: undoing a move into another container hands the selection back to the original
      const now = document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${pc!.pixelTargetId}"]`) ?? el;
      const r = (key === 'reorder' ? reorderUnit(now) : now).getBoundingClientRect();
      return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) };
    };
    setPendingCapture(prev => prev ? {
      ...prev,
      ...(key === 'style' ? { styleChanges: [] } : {}),
      auto: { ...prev.auto, [key]: undefined, ...(key === 'reorder' ? { reorderLabel: undefined } : {}) },
    } : null);
    // Re-read the box once it has glided back, so the selection sits on it
    if (kind) setTimeout(() => {
      const rect = measure();
      if (!rect) return;
      setPendingCapture(prev => prev ? {
        ...prev, rect, capture: { ...prev.capture, rect },
        ...(key === 'reorder' ? { originalRect: rect } : {}),
      } : null);
    }, 220);
  }, []);

  const undoLast = useCallback(() => {
    if (undoRef.current.count === 0) return;
    send({ type: 'undo' });
  }, []);

  // ⌘Z / ⇧⌘Z, two levels:
  //  - a draft being made (card open and changed): steps back through its
  //    gestures and panel edits, never through to the files — at the start of
  //    the draft it stops, with a word, instead of undoing a saved batch;
  //  - otherwise: the last batch applied to the files (and ⇧⌘Z puts it back).
  // Inside inputs the shortcut keeps its normal meaning; with nothing to do at
  // either level the page's own undo still works.
  useEffect(() => {
    const toast = (text: string, reaction?: MascotReaction) => { setClipboardToast(saying(text, reaction)); setTimeout(() => setClipboardToast(null), 2200); };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const redo = e.shiftKey;
      if (pendingCaptureRef.current && draftTouched.current) {
        e.preventDefault();
        if (redo) return; // redo inside a draft: next step
        const step = draftSteps.current.pop();
        if (!step) { toast(t('undo.draftStart'), 'nothing-left'); return; }
        if (step.kind === 'panel') {
          const label = panelHistoryRef.current?.undo();
          toast(t('undo.draftStep', { what: label ?? t('undo.panel') }));
        } else {
          takeBack(step.key);
          toast(t('undo.draftStep', { what: step.label }));
        }
        return;
      }
      if (redo) {
        if (!undoRef.current.redoCount) return;
        e.preventDefault();
        send({ type: 'redo' });
        return;
      }
      if (undoRef.current.count === 0) return;
      e.preventDefault();
      send({ type: 'undo' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [takeBack]);

  const stopExecution = useCallback(() => {
    if (demoMode) {
      // Demo mode — abort in-flight fetch and revert annotations
      demoAbortRef.current?.abort();
      demoAbortRef.current = null;
      setAnnotations(prev => prev.map(a => a.status === 'sent' ? { ...a, status: 'pending' as const } : a));
      setSendFeedback(null);
    } else {
      send({ type: 'stop' });
    }
  }, [demoMode]);

  const sendChatMessage = useCallback(() => {
    const text = chatInput.trim().slice(0, 500);
    if (!text) return;
    setChatHistory(prev => [
      ...prev,
      { role: 'user', text, ts: Date.now() },
      { role: 'agent', text: '...', ts: 0 }, // streaming placeholder
    ]);
    setChatInput('');
    const env = captureEnvironment();
    const sent = send({
      type: 'annotate',
      note: text,
      element: '',
      styles: {},
      intent: 'chat',
      severity: 'suggestion',
      environment: env,
    });
    // Demo mode fallback — call API endpoint for chat
    if (!sent && demoMode && demoEndpoint) {
      const ctrl = new AbortController();
      demoAbortRef.current = ctrl;
      fetch(demoEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ element: 'page', styles: {}, note: text, context: 'chat' }),
        signal: ctrl.signal,
      })
        .then(r => r.json())
        .then((data: { patches?: Array<{ selector: string; property: string; value: string }>; summary?: string }) => {
          if (data.patches) {
            for (const patch of data.patches) {
              try {
                const targets = document.querySelectorAll(patch.selector);
                for (const target of targets) {
                  if (target.closest('[data-ilse-toolbar]')) continue;
                  (target as HTMLElement).style[patch.property as any] = patch.value;
                }
              } catch { /* invalid selector */ }
            }
          }
          setChatHistory(prev => {
            const updated = [...prev];
            const last = updated.findIndex(m => m.role === 'agent' && m.text === '...');
            if (last !== -1) updated[last] = { role: 'agent', text: data.summary ?? 'Done', ts: Date.now() };
            return updated;
          });
        })
        .catch(() => {
          setChatHistory(prev => {
            const updated = [...prev];
            const last = updated.findIndex(m => m.role === 'agent' && m.text === '...');
            if (last !== -1) updated[last] = { role: 'agent', text: 'Error — try again', ts: Date.now() };
            return updated;
          });
        });
    }
  }, [chatInput, demoMode, demoEndpoint]);

  const removeAnnotation = useCallback((index: number) => {
    const gone = annotationsRef.current[index];
    if (gone?.insert) removeDraft(gone.insert.draftId);
    if (gone?.propEdit && gone.pixelTargetId && gone.status === 'pending') {
      const el = document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${gone.pixelTargetId}"]`);
      if (el) previewVariant(el, gone.pixelTargetId, null);
    }
    if (gone?.pixelTargetId) settleElement(document.querySelector(`[data-ilse-pixel-target="${gone.pixelTargetId}"]`));
    // Never sent: nothing will make its preview real, so it goes (panel edits, text, removal)
    if (gone?.pixelTargetId && gone.status === 'pending') {
      previewReverts.current.get(gone.pixelTargetId)?.();
      unhide(gone.pixelTargetId);
    }
    if (gone?.pixelTargetId) previewReverts.current.delete(gone.pixelTargetId);
    setAnnotations(prev => prev.filter((_, i) => i !== index));
    if (activeMarker === index) setActiveMarker(null);
  }, [activeMarker]);

  const updateNote = (index: number, note: string) => {
    setAnnotations(prev => prev.map((a, i) => {
      if (i !== index) return a;
      // Re-infer from the note, but keep what the drag or the property panel
      // already said (resize/move/style) unless the note now names another verb.
      const inferred = inferDraftIntent(note, !!a.capture.element);
      const intent = resolveIntent(inferred, {
        hasStyle: !!a.styleData,
        orig: a.rearrangeData?.originalRect,
        curr: a.rearrangeData?.currentRect,
      });
      return { ...a, note, intent };
    }));
  };

  const addImageRef = (index: number, dataUrl: string, filename?: string) => {
    setAnnotations(prev => prev.map((a, i) => i === index ? {
      ...a,
      imageRefs: [...(a.imageRefs ?? []), dataUrl],
      imageFilenames: [...(a.imageFilenames ?? []), filename ?? ''],
    } : a));
  };
  const removeImageRef = (index: number, imgIndex: number) => {
    setAnnotations(prev => prev.map((a, i) => i === index ? {
      ...a,
      imageRefs: (a.imageRefs ?? []).filter((_, j) => j !== imgIndex),
      imageFilenames: (a.imageFilenames ?? []).filter((_, j) => j !== imgIndex),
    } : a));
  };

  const updateSeverity = (index: number, severity: DraftSeverity) => {
    setAnnotations(prev => prev.map((a, i) => i === index ? { ...a, severity } : a));
  };

  const updateRearrange = (index: number, rearrangeData: AnnotationDraft['rearrangeData']) => {
    setAnnotations(prev => prev.map((a, i) => {
      if (i !== index || !rearrangeData) return a;
      const text = moveText(
        rearrangeData.currentRect.x - rearrangeData.originalRect.x,
        rearrangeData.currentRect.y - rearrangeData.originalRect.y,
      );
      return { ...a, rearrangeData, intent: 'move', auto: { ...a.auto, move: text || undefined } };
    }));
  };

  const markerDragOffset = (ann: AnnotationDraft) => ann.rearrangeData
    ? { dx: ann.rearrangeData.currentRect.x - ann.rearrangeData.originalRect.x, dy: ann.rearrangeData.currentRect.y - ann.rearrangeData.originalRect.y }
    : { dx: 0, dy: 0 };

  /**
   * Mousedown on a marker badge: a click opens/closes the note; a drag (past a
   * few px, and only outside annotation mode) moves the annotated element.
   */
  const startMarkerDrag = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ann = annotations[i];
    if (!ann) return;
    const r = ann.capture.rect;
    // Where the element is now (its list or panel may have scrolled since the capture)
    const at = anchorOf(ann);
    const scrollX = at.left - r.left;
    const scrollY = at.top - r.top;
    const { dx: origDx, dy: origDy } = markerDragOffset(ann);
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const onMove = (mv: MouseEvent) => {
      if (annotating) return;
      if (!dragging) {
        if (Math.abs(mv.clientX - startX) < 4 && Math.abs(mv.clientY - startY) < 4) return;
        dragging = true;
        setActiveMarker(null);
        document.body.style.cursor = 'grabbing';
        snapRectsRef.current = collectSnapRects();
        contentRectsRef.current = collectContentRects();
      }
      const dx = origDx + snapToGrid(mv.clientX - startX);
      const dy = origDy + snapToGrid(mv.clientY - startY);
      const viewportRect = { top: r.top + scrollY + dy - window.scrollY, left: r.left + scrollX + dx - window.scrollX, width: r.width, height: r.height };
      const axis: 'x' | 'y' | null = Math.abs(dy) > Math.abs(dx) ? 'y' : Math.abs(dx) > Math.abs(dy) ? 'x' : null;
      setGuides(computeGuides(viewportRect, snapRectsRef.current));
      setSpacings(computeSpacings(viewportRect, contentRectsRef.current, axis));
      updateRearrange(i, {
        originalRect: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height },
        currentRect: { x: r.left + scrollX + dx, y: r.top + scrollY + dy, width: r.width, height: r.height },
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (dragging) {
        document.body.style.cursor = '';
        setGuides([]);
        setSpacings([]);
      } else {
        setActiveMarker(prev => prev === i ? null : i);
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleClear = () => {
    if (clearConfirm) {
      // Unsent drafts take their on-screen previews with them
      for (const a of annotationsRef.current) {
        if (!inMode(a)) continue;
        if (a.testFinding) clearedFindings.current.add(a.testFinding.id);
        // A dropped component goes with its note: only a change that lands keeps it on the page
        if (a.insert) removeDraft(a.insert.draftId);
        if (!a.pixelTargetId) continue;
        if (a.propEdit && a.status === 'pending') {
          const el = document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${a.pixelTargetId}"]`);
          if (el) previewVariant(el, a.pixelTargetId, null);
        }
        if (a.status === 'pending') { previewReverts.current.get(a.pixelTargetId)?.(); unhide(a.pixelTargetId); }
        previewReverts.current.delete(a.pixelTargetId);
      }
      setAnnotations(prev => prev.filter(a => !inMode(a)));
      setActiveMarker(null);
      setClearConfirm(false);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    } else {
      setClearConfirm(true);
      clearTimerRef.current = setTimeout(() => setClearConfirm(false), 2000);
    }
  };

  const pendingCount = annotations.filter(a => a.status === 'pending' && inMode(a)).length;
  /** Ignore a test finding: Ilse stops warning about it, and its marker goes */
  const ignoreFinding = (index: number) => {
    const ann = annotationsRef.current[index];
    if (ann?.testFinding) decideTestFinding(ann.testFinding, 'discarded');
    removeAnnotation(index);
  };
  /** A finding's marker or page note leaves (ignored from the report) */
  const dropFindingMarker = (id: string) => {
    const i = annotationsRef.current.findIndex(a => a.testFinding?.id === id && a.status === 'pending');
    if (i >= 0) removeAnnotation(i);
  };
  /**
   * "Apply fix" from the report: the finding joins the notes Run fixes sends.
   * On this page it's a marker on its element; elsewhere, or only in the code,
   * a note that says where.
   */
  const applyFinding = (f: TestFinding) => {
    if (annotationsRef.current.some(a => a.testFinding?.id === f.id && a.status === 'pending')) return;
    clearedFindings.current.delete(f.id);
    const here = findingsForPage([f], location.pathname, location.search).length > 0;
    const el = here ? findingElement(f) : null;
    if (el) {
      const pixelTargetId = el.getAttribute('data-ilse-pixel-target') ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      el.setAttribute('data-ilse-pixel-target', pixelTargetId);
      addAnnotation(captureElement(el), findingNote(f), 'element', pixelTargetId, undefined, findingRef(f));
      return;
    }
    const where = f.page && !here ? ` On the page ${f.page}.` : '';
    addAnnotation({ element: '', styles: {}, rect: { top: 0, left: 0, width: 0, height: 0 } }, findingNote(f) + where, 'element', undefined, undefined, findingRef(f));
  };
  // "Fix" on a finding (card or report) and "Fix all": the finding becomes a note if it isn't one
  // yet (another page, the code only), then goes to the agent — once the note exists
  const fixQueue = useRef(new Set<string>());
  const [fixTick, setFixTick] = useState(0);
  const fixFindings = (list: TestFinding[]) => {
    for (const f of list) { fixQueue.current.add(f.id); applyFinding(f); }
    setFixTick(n => n + 1);
  };
  useEffect(() => {
    if (fixQueue.current.size === 0) return;
    annotations.forEach((a, i) => {
      if (a.testFinding && a.status === 'pending' && fixQueue.current.has(a.testFinding.id)) {
        fixQueue.current.delete(a.testFinding.id);
        sendAnnotation(i);
      }
    });
  }, [annotations, fixTick, sendAnnotation]);
  /** Skip: out of this test's report and off the page; back on the next test */
  const skipFinding = (f: Pick<TestFinding, 'id'>) => {
    dropFindingMarker(f.id);
    clearedFindings.current.add(f.id);
    setIgnoredNow(prev => new Set(prev).add(f.id));
    if (reportFocus === f.id) setReportFocus(null);
  };
  const processingCount = annotations.filter(a => a.status === 'sent').length;
  const testing = testRun?.phase === 'checking' || testRun?.phase === 'running';
  const feedLift = useLift(liftRef, isOpen && (thinkingMessages.length > 0 || testing), 24);

  // ── Toolbar open/close ─────────────────────────────────────────────────────

  const wasDraggedRef = useRef(false);
  const openToolbar = () => {
    if (wasDraggedRef.current) { wasDraggedRef.current = false; return; }
    setIsOpen(true); setAnnotating(true);
  };
  /**
   * Turn the strokes into an annotation: read them, pick the element they're
   * mostly about, attach the picture, and open the card for optional context.
   */
  const finishSketch = useCallback((drawn: Stroke[]) => {
    if (sketchIdle.current) { clearTimeout(sketchIdle.current); sketchIdle.current = null; }
    if (drawn.length === 0) return;
    const result = analyzeSketch(drawn);
    const image = renderSketchImage(drawn, result);
    const box = result.box;
    const rect = {
      top: Math.round(box.top - window.scrollY), left: Math.round(box.left - window.scrollX),
      width: Math.max(12, Math.round(box.width)), height: Math.max(12, Math.round(box.height)),
    };
    const primary = result.primary;
    let capture: ElementCapture;
    let pixelTargetId: string | undefined;
    let holder: Element | null = null;
    if (primary) {
      capture = captureElement(primary);
      pixelTargetId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      primary.setAttribute('data-ilse-pixel-target', pixelTargetId);
    } else {
      // Nothing circled: anchor on the container that holds the drawing, so the
      // agent gets its component and file:line like a click — not bare coordinates
      holder = drawnContainer(box, { x: window.scrollX, y: window.scrollY });
      if (holder) {
        const held = captureElement(holder);
        // The new thing goes inside the holder: it is the parent, the drawn spot the position
        capture = { ...held, parent: held.element, rect };
      } else {
        capture = { element: t('toolbar.sketch.empty'), styles: {}, rect };
      }
    }
    capture = { ...capture, _scrollX: window.scrollX, _scrollY: window.scrollY };
    stylePreviewCommitted.current = false;
    setPendingCapture({
      capture,
      context: capture.element,
      contextLabel: primary
        ? `${t('toolbar.sketch.label')} · ${buildContextLabel(primary)}`
        : holder
          ? `${t('toolbar.sketch.label')} · ${t('toolbar.sketch.inside', { label: buildContextLabel(holder) })}`
          : t('toolbar.sketch.label'),
      rect,
      originalRect: { ...rect },
      note: '',
      auto: { sketch: formatSketchNote(result.parts) },
      markerType: 'area',
      areaElementCount: primary ? result.parts.reduce((n, p) => n + p.targets.length + (p.from ? 1 : 0) + (p.to ? 1 : 0), 0) : 0,
      pixelTargetId,
      ...(image ? { imageRefs: [image], imageFilenames: ['desenho.png'] } : {}),
      sketch: drawn,
    });
    setStrokes([]);
    setDrawMode(false);
  }, []);

  // Done drawing = a pause. It doesn't run while the pointer is on the colour
  // bar, so undo / clear / a colour change never race it.
  const barHovered = useRef(false);
  const armSketchIdle = useCallback(() => {
    if (sketchIdle.current) clearTimeout(sketchIdle.current);
    sketchIdle.current = null;
    if (barHovered.current || strokesRef.current.length === 0) return;
    sketchIdle.current = setTimeout(() => finishSketch(strokesRef.current), 2500);
  }, [finishSketch]);

  const setSketch = useCallback((next: Stroke[]) => {
    strokesRef.current = next;
    setStrokes(next);
    // Another stroke within the pause keeps the sketch open (an arrowhead, a second circle).
    armSketchIdle();
  }, [armSketchIdle]);

  const addStroke = useCallback((stroke: Stroke) => setSketch([...strokesRef.current, stroke]), [setSketch]);

  const exitDrawMode = useCallback(() => {
    if (sketchIdle.current) { clearTimeout(sketchIdle.current); sketchIdle.current = null; }
    setStrokes([]);
    setDrawMode(false);
  }, []);

  // Esc while drawing drops the sketch — captured, so the toolbar doesn't also close.
  useEffect(() => {
    if (!drawMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exitDrawMode();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finishSketch(strokesRef.current);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        setSketch(strokesRef.current.slice(0, -1));
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [drawMode, exitDrawMode, finishSketch, setSketch]);

  // V — toggle between selecting elements and using the page, like Figma's move tool
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'v' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      if (drawMode) exitDrawMode();
      setAnnotating(v => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, drawMode, exitDrawMode]);

  // I I — the toolbar back to its default corner, for when it was dragged out of
  // sight. Works open or minimized; never while typing.
  useEffect(() => {
    const pressedTwice = doublePress('i');
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
      if (!pressedTwice(e.key)) return;
      const pos = defaultToolbarPos();
      setToolbarPos(pos);
      try { sessionStorage.removeItem(getStorageKey('ilse-toolbar-pos')); } catch { /* ignore */ }
      setClipboardToast(saying(t('shortcuts.recentered'), 'recentered'));
      setTimeout(() => setClipboardToast(null), 1800);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The catalog is read once the toolbar opens: the Component section needs it on the first click
  useEffect(() => { if (isOpen && !catalogFullRef.current) loadCatalog(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isOpen]);

  // Copies are taken as the app is used, not only when the catalog opens: a
  // dialog opened later, the next screen. Each look (`id|variant`) once per
  // session; what's being edited in the panel waits until it's in the code.
  captureCopiesRef.current = () => {
    const items = catalogItemsRef.current;
    if (!proCatalogRef.current || !items?.length) return;
    const editing = new Set<string>();
    // Selected is fine; changed in the panel and not in the code yet is not
    const pc = pendingCapture;
    if (pc?.pixelTargetId && (pc.styleChanges?.length || pc.textEdit || pc.propEdit)) editing.add(pc.pixelTargetId);
    for (const a of annotations) {
      if (a.pixelTargetId && a.status !== 'resolved' && (a.styleData || a.rearrangeData || a.textEdit || a.propEdit)) editing.add(a.pixelTargetId);
    }
    const shows = (root: HTMLElement) => [...editing].some(id => {
      const el = document.querySelector(`[data-ilse-pixel-target="${id}"]`);
      return !!el && (root.contains(el) || el.contains(root));
    });
    const seen = snapshotPage(items, copiedRef.current, shows);
    if (seen.length === 0) return;
    for (const { id, variant } of seen) copiedRef.current.add(`${id}|${variant}`);
    // In batches: the store takes a bounded number per message (a busy page has more)
    for (let i = 0; i < seen.length; i += 40) send({ type: 'catalog_snapshot', items: seen.slice(i, i + 40) });
    setCatalog(prev => {
      if (!prev) return prev;
      const next = { ...prev.snapshots };
      for (const { id, ...snap } of seen) next[id] = [snap, ...(next[id] ?? []).filter(s => s.variant !== snap.variant)];
      return { ...prev, snapshots: next };
    });
  };

  // The list is read on connect, Free or Pro: it names the selected component and its props and
  // variants in the Component section (Free). With Pro, copying can also start before anyone opens the toolbar
  useEffect(() => { if (connected && !catalog) loadCatalogList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [connected]);

  // The page changed (a dialog opened, another screen): copy what's new once it settles
  useEffect(() => {
    if (!proCatalog) return;
    let timer = 0;
    const ours = (n: Node | null) => !!(n instanceof Element ? n : n?.parentElement)?.closest('[data-ilse-toolbar],[data-ilse-draft],[data-ilse-variant-for]');
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
        if (idle) idle(() => captureCopiesRef.current(), { timeout: 2000 }); else captureCopiesRef.current();
      }, 1200);
    };
    const observer = new MutationObserver(records => {
      if (records.some(r => !ours(r.target) && [...r.addedNodes].some(n => n instanceof HTMLElement && !ours(n)))) later();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', later);
    return () => { observer.disconnect(); window.removeEventListener('popstate', later); window.clearTimeout(timer); };
  }, [proCatalog]);

  // The catalog component the selected element is, if any (the <Button> the app wrote)
  const componentHit = useMemo(() => {
    const ins = pendingCapture?.insert;
    if (ins?.copy) return null;
    if (ins) return { item: ins.item, props: ins.props, ...(ins.text ? { text: ins.text } : {}) };
    const id = pendingCapture?.pixelTargetId;
    if (!id || !catalog?.items.length || pendingCapture?.markerType !== 'element') return null;
    const el = document.querySelector(`[data-ilse-pixel-target="${id}"]`);
    return el ? componentAt(el, catalog.items) : null;
  }, [pendingCapture?.pixelTargetId, pendingCapture?.markerType, pendingCapture?.insert, catalog]);

  // ── Dragging a component from the catalog onto the page ──
  // Same engine as moving an element on the page (live-layout): the copy stands in for real,
  // the items around make room, the destination is outlined, the grid and distances show
  const [catalogDrag, setCatalogDrag] = useState<{ item: CatalogItem; snap?: CatalogSnapshot; x: number; y: number; active: boolean } | null>(null);
  /**
   * The container a drop belongs to: the one under the pointer, or — inside a reused
   * component (see liftAnchor) — the one where that component is written, so the
   * copy lands next to it and never inside its definition.
   */
  const catalogContainer = (c: HTMLElement): HTMLElement | null => {
    if (c.closest('[data-ilse-toolbar]')) return null;
    // Whose code writes this container's children decides: a Stack's children are the page's
    // (fine), a StatCard's label and value are StatCard's (climb out, next to the StatCard)
    const kid = Array.from(c.children).find((k): k is HTMLElement => k instanceof HTMLElement && !k.hasAttribute('data-ilse-draft') && !k.hasAttribute('data-ilse-placeholder'));
    const { anchor } = liftAnchor(kid ?? c, catalog?.items ?? []);
    const into = anchor !== (kid ?? c) && (anchor === c || anchor.contains(c)) ? anchor.parentElement : c;
    return into && into !== document.body && into !== document.documentElement ? into : null;
  };
  /**
   * Dragging from the catalog, or the draft already on the page to another spot.
   * The listeners go on right away, not in an effect after a render: a quick
   * release would otherwise be missed and the drag left hanging.
   */
  const dragHandlers = useRef<{ move: (e: MouseEvent) => void; up: (e: MouseEvent) => void; esc: (e: KeyboardEvent) => void; session: LiveInsert } | null>(null);
  const endCatalogDrag = (cancel = true) => {
    const h = dragHandlers.current;
    if (h) {
      window.removeEventListener('mousemove', h.move, true);
      window.removeEventListener('pointerup', h.up, true);
      window.removeEventListener('keydown', h.esc, true);
      if (cancel) h.session.cancel();
    }
    dragHandlers.current = null;
    document.body.style.cursor = '';
    document.documentElement.style.userSelect = '';
    setGuides([]);
    setSpacings([]);
    setShowGrid(false);
    setCatalogDrag(null);
  };
  const startCatalogDrag = (item: CatalogItem, x: number, y: number, moving?: { snap?: CatalogSnapshot }) => {
    endCatalogDrag();
    const snap = moving ? moving.snap : bestSnapshot(catalog?.snapshots[item.id]);
    // Moving: the draft on the page steps out of its spot while it's carried. New: a draft not on the page yet
    const movingId = moving ? pendingCaptureRef.current?.insert?.draftId : undefined;
    const old = movingId ? document.querySelector<HTMLElement>(`[data-ilse-draft="${movingId}"]`) : null;
    if (moving && !old) return;
    const draftId = old ? movingId! : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const el = old ?? makeDraft(snap?.html ?? placeholderHtml(item.name), draftId);
    const size = old ? old.getBoundingClientRect() : { width: snap?.w ?? 120, height: snap?.h ?? 36 };
    const session = beginInsert(el, { x, y }, { width: size.width, height: size.height }, catalogContainer);
    setShowGrid(true);
    snapRectsRef.current = collectSnapRects();
    contentRectsRef.current = collectContentRects();
    setCatalogDrag({ item, snap, x, y, active: false });
    let frame = 0;
    const move = (e: MouseEvent) => {
      e.preventDefault();
      cancelAnimationFrame(frame);
      const { clientX, clientY } = e;
      frame = requestAnimationFrame(() => {
        // Back over the panel or the toolbar: no place — letting go there cancels
        if (document.elementFromPoint(clientX, clientY)?.closest('[data-ilse-toolbar]:not([data-ilse-ghost])')) session.move(-1, -1);
        else session.move(clientX, clientY);
        const b = session.box;
        if (b) {
          const box = { top: b.top, left: b.left, width: b.width, height: b.height };
          setGuides(computeGuides(box, snapRectsRef.current));
          setSpacings(computeSpacings(box, contentRectsRef.current, 'y'));
        } else { setGuides([]); setSpacings([]); }
        setCatalogDrag(d => d ? { ...d, x: clientX, y: clientY, active: session.active } : d);
      });
    };
    // pointerup, not mouseup: selection mode picks on pointerup, so the drop must come first and stop it
    const up = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelAnimationFrame(frame);
      const landed = session.end();
      endCatalogDrag(false);
      // The click the browser fires after this release must not select what's under it
      const swallow = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 300);
      if (!landed) return;
      const { anchor, placement } = insertAnchor(landed.target, landed.index, landed.landed, el);
      const target: DropTarget = { anchor, placement, line: { left: 0, top: 0, width: 0, height: 0 } };
      if (old) { old.remove(); moveDraft(target, landed.landed); }
      else dropComponent(item, snap, target, landed.landed);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); endCatalogDrag(); } };
    dragHandlers.current = { move, up, esc, session };
    // Capture phase: the page's own handlers can't swallow them
    window.addEventListener('mousemove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('keydown', esc, true);
    document.body.style.cursor = 'grabbing';
    document.documentElement.style.userSelect = 'none';
  };
  /** `placed`: the draft the drag already put on the page (else it's made and placed here, as Duplicate does) */
  const dropComponent = (item: CatalogItem, snap: CatalogSnapshot | undefined, target: DropTarget, placed?: HTMLElement) => {
    // A draft with work in it isn't thrown away by a drop
    const pc = pendingCaptureRef.current;
    if (pc && (pc.note.trim() || hasAuto(pc.auto) || pc.styleChanges?.length || pc.imageRefs?.length || pc.sketch)) { placed?.remove(); return; }
    if (pc) cancelCaptureRef.current?.();
    const html = snap?.html ?? placeholderHtml(item.name);
    const draft = placed ?? makeDraft(html, `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
    const draftId = draft.getAttribute('data-ilse-draft')!;
    // What it is a copy of: clicking inside it later names the component, not a look-alike
    draft.setAttribute('data-ilse-component', item.name);
    if (!placed) placeDraft(draft, target.anchor, target.placement);
    const pixelTargetId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    draft.setAttribute('data-ilse-pixel-target', pixelTargetId);
    const at = instanceAt(target.anchor, catalog?.items ?? []);
    const insert: InsertDraft = { item, placement: target.placement, props: snap?.props ?? {}, ...(snap?.text ? { text: snap.text } : {}), html, draftId, ...(at ? { at } : {}) };
    // Where it goes in the code is the anchor's place; what it looks like is the draft
    const capture = { ...captureElement(target.anchor), styles: captureElement(draft).styles };
    const box = draft.getBoundingClientRect();
    const rect = { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width), height: Math.round(box.height) };
    stylePreviewCommitted.current = false;
    setPanelEpoch(n => n + 1);
    setPanelTab('props');
    setPendingCapture({
      capture, context: capture.element, contextLabel: t('catalog.new', { name: item.name }),
      rect, originalRect: { ...rect }, note: '', markerType: 'element', pixelTargetId, insert,
      auto: insertCommand(insert),
    });
    setAnnotating(false);
  };
  /**
   * Duplicate the selected component: a copy of it right after this instance, written
   * with the same props and text — then its variant can be changed in the Component
   * section. The copy follows the page's layout: beside it in a row, below it otherwise.
   */
  const duplicateSelected = () => {
    const pc = pendingCaptureRef.current;
    const hit = componentHit;
    if (!pc?.pixelTargetId || pc.insert || !hit) return;
    const el = document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${pc.pixelTargetId}"]`);
    if (!el) return;
    // The instance's own root (the selection may be something inside it)
    const root = findInstances(new Set([hit.item.name])).map(i => i.root).filter(r => r.contains(el) || r === el).pop() ?? el;
    const copy = root.cloneNode(true) as HTMLElement;
    for (const n of [copy, ...Array.from(copy.querySelectorAll('*'))]) {
      n.removeAttribute('data-ilse-pixel-target');
      n.removeAttribute('data-ilse-hidden-for');
    }
    copy.style.removeProperty('outline');
    const box = root.getBoundingClientRect();
    const target: DropTarget = { anchor: root, placement: 'after', line: { left: box.right, top: box.top, width: 2, height: box.height } };
    // The selection gives way to the copy (its card had nothing in it worth keeping, or it's kept as is)
    cancelCaptureRef.current?.();
    pendingCaptureRef.current = null;
    dropComponent(hit.item, { variant: '', html: copy.outerHTML, w: box.width, h: box.height, props: hit.props, ...(hit.text ? { text: hit.text } : {}) }, target);
  };

  /**
   * Duplicate an element that isn't a component's root (a list row, a card written inline):
   * a copy on screen next to it, and a note on the original — where it is in the code is
   * known — telling the agent what the copy means there: a new item in the list's data, or
   * a copy of the JSX
   */
  const duplicateElement = () => {
    const pc = pendingCaptureRef.current;
    if (!pc?.pixelTargetId || pc.insert) return;
    const el = document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${pc.pixelTargetId}"]`);
    if (!el) return;
    const copy = el.cloneNode(true) as HTMLElement;
    for (const n of [copy, ...Array.from(copy.querySelectorAll('*'))]) {
      n.removeAttribute('data-ilse-pixel-target');
      n.removeAttribute('data-ilse-hidden-for');
    }
    copy.style.removeProperty('outline');
    cancelCaptureRef.current?.();
    pendingCaptureRef.current = null;
    const html = copy.outerHTML;
    // Before the copy joins the page: next to its own copy, any element looks like a list row
    const kind = isDataRow(el) ? 'item' as const : 'block' as const;
    const draft = makeDraft(html, `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
    const draftId = draft.getAttribute('data-ilse-draft')!;
    placeDraft(draft, el, 'after');
    const pixelTargetId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    draft.setAttribute('data-ilse-pixel-target', pixelTargetId);
    // The whole visible text names it ("$ npx ilse-design@latest"), not just its first line ("$")
    const text = (el.innerText ?? '').replace(/\s+/g, ' ').trim();
    const name = text ? (text.length > 60 ? text.slice(0, 59) + '…' : text) : itemLabel(el);
    const item: CatalogItem = { id: '', name, source: '', folder: '', library: false, uses: 0, props: [] };
    // The root of a component instance: the copy is that instance, written where it's used
    const at = instanceAt(el, catalog?.items ?? []) ?? undefined;
    const insert: InsertDraft = { item, placement: 'after', props: {}, html, draftId, copy: kind, ...(at ? { at } : {}) };
    // Where it goes in the code is the original's place; what it looks like is the copy
    const capture = { ...captureElement(el), styles: captureElement(draft).styles };
    const box = draft.getBoundingClientRect();
    const rect = { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width), height: Math.round(box.height) };
    stylePreviewCommitted.current = false;
    setPanelEpoch(n => n + 1);
    setPanelTab('props');
    setPendingCapture({
      capture, context: capture.element, contextLabel: t('toolbar.copy.label', { name }),
      rect, originalRect: { ...rect }, note: '', markerType: 'element', pixelTargetId, insert,
      auto: insertCommand(insert),
    });
    setAnnotating(false);
  };

  // A click on a catalog component: its instances on the page, outlined for a moment
  const [spot, setSpot] = useState<{ rects: DOMRect[]; none: boolean } | null>(null);
  const spotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spotComponent = (item: CatalogItem) => {
    const roots = findInstances(new Set([item.name])).map(i => i.root).filter(el => !el.closest('[data-ilse-toolbar]'));
    if (roots[0]) {
      const r = roots[0].getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) roots[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    const show = () => setSpot({ rects: roots.map(el => el.getBoundingClientRect()), none: roots.length === 0 });
    show();
    setTimeout(show, 350); // after a smooth scroll
    if (spotTimer.current) clearTimeout(spotTimer.current);
    spotTimer.current = setTimeout(() => setSpot(null), 2400);
  };

  // Create DS / Export: with Pro the agent writes "when to use" first, so the toolbar says it's working
  const exportDs = () => {
    setClipboardToast(saying(t('ds.writing')));
    send({ type: 'ds_export' });
  };

  // The Library: the list, search and spotting are Free; dragging, copies and organizing the areas are Pro
  const libraryProps = {
    items: catalog?.items ?? null,
    snapshots: catalog?.snapshots ?? {},
    onPage: catalogOnPage,
    onSpot: spotComponent,
    copies: proCatalog,
    onDragStart: proCatalog ? startCatalogDrag : undefined,
    onEditFile: proCatalog ? () => send({ type: 'catalog_file' }) : undefined,
    ds: dsInfo,
    onCreateDs: () => exportDs(),
    onExportDs: () => exportDs(),
    onViewDs: () => send({ type: 'ds_view' }),
  };

  /** The draft dragged to another spot: same component and props, a new place in the page and the code */
  const moveDraft = (target: DropTarget, draft: HTMLElement) => {
    const pc = pendingCaptureRef.current;
    const ins = pc?.insert;
    if (!pc || !ins) return;
    const at = instanceAt(target.anchor, catalog?.items ?? []);
    const insert: InsertDraft = { ...ins, placement: target.placement, ...(at ? { at } : { at: undefined }) };
    const capture = { ...captureElement(target.anchor), styles: captureElement(draft).styles };
    const box = draft.getBoundingClientRect();
    const rect = { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width), height: Math.round(box.height) };
    setPendingCapture(prev => prev ? { ...prev, capture, context: capture.element, rect, originalRect: { ...rect }, insert, auto: { ...prev.auto, ...insertCommand(insert) } } : prev);
  };
  // Leaving a dropped component without confirming it — any way out (card ×, Esc, closing the
  // toolbar, another selection) — takes its draft off the page, like any panel edit not kept
  const lastInsert = useRef<string | null>(null);
  useEffect(() => {
    const now = pendingCapture?.insert?.draftId ?? null;
    const before = lastInsert.current;
    lastInsert.current = now;
    if (!before || before === now) return;
    if (!annotationsRef.current.some(a => a.insert?.draftId === before)) removeDraft(before);
  }, [pendingCapture?.insert?.draftId, annotations]);

  // The draft on the page is grabbed to move it: before Ilse's own drag of a selected element
  useEffect(() => {
    const id = pendingCapture?.insert?.draftId;
    if (!id || pendingCapture?.insert?.copy) return;
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const el = onDraft(e);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const x0 = e.clientX, y0 = e.clientY;
      const ins = pendingCaptureRef.current?.insert;
      if (!ins) return;
      const pre = (m: MouseEvent) => {
        if (Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) < 5) return;
        stop();
        startCatalogDrag(ins.item, m.clientX, m.clientY, { snap: { variant: '', html: ins.html, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height } });
      };
      const stop = () => { window.removeEventListener('mousemove', pre, true); window.removeEventListener('mouseup', stop, true); };
      window.addEventListener('mousemove', pre, true);
      window.addEventListener('mouseup', stop, true);
    };
    // Ilse's own drag of a selection starts on pointerdown: the draft's grab goes first, on window
    // The press lands on the draft, or on the selection box drawn over it
    const onDraft = (e: MouseEvent): HTMLElement | null => {
      const draft = document.querySelector<HTMLElement>(`[data-ilse-draft="${id}"]`);
      if (!draft) return null;
      const t = e.target as Element | null;
      if (t && draft.contains(t)) return draft;
      const box = pendingAreaRef.current;
      if (!t || !box || !box.contains(t)) return null;
      const r = draft.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom ? draft : null;
    };
    const guard = (e: PointerEvent) => { if (onDraft(e)) e.stopImmediatePropagation(); };
    window.addEventListener('pointerdown', guard, true);
    window.addEventListener('mousedown', down, true);
    return () => { window.removeEventListener('pointerdown', guard, true); window.removeEventListener('mousedown', down, true); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCapture?.insert?.draftId, catalog]);

  // Drafts stay on the page until their change is applied — a reload puts them back next to their anchor
  useEffect(() => {
    // A draft with no note behind it (deleted, cleared) never stays: the page only keeps a dropped
    // component while its note exists or the card is still open. An applied one gives way on its
    // own once the real component is there (see 'resolved')
    const keep = new Set(annotationsRef.current.filter(a => a.insert).map(a => a.insert!.draftId));
    const open = pendingCaptureRef.current?.insert?.draftId;
    if (open) keep.add(open);
    document.querySelectorAll<HTMLElement>('[data-ilse-draft]').forEach(el => {
      const id = el.getAttribute('data-ilse-draft');
      if (id && !keep.has(id) && !el.hasAttribute('data-ilse-moving')) el.remove();
    });
    let tries = 0;
    const restore = () => {
      let missing = 0;
      for (const a of annotationsRef.current) {
        if (!a.insert || a.status === 'resolved' || document.querySelector(`[data-ilse-draft="${a.insert.draftId}"]`)) continue;
        let anchor: Element | null = null;
        try { anchor = document.querySelector(a.capture.element); } catch { /* not a selector anymore */ }
        if (!anchor) { missing++; continue; }
        const draft = makeDraft(a.insert.html, a.insert.draftId);
        if (a.pixelTargetId) draft.setAttribute('data-ilse-pixel-target', a.pixelTargetId);
        placeDraft(draft, anchor, a.insert.placement);
      }
      // The app may still be rendering: look again a few times
      if (missing && tries++ < 6) setTimeout(restore, 500);
    };
    const timer = setTimeout(restore, 300);
    return () => clearTimeout(timer);
  // Annotations load from storage after mount: look whenever the list changes
  }, [annotations]);

  const setComponentProp = (prop: string, value: string) => {
    const hit = componentHit;
    if (!hit) return;
    // A dropped draft: its props are the ones it will be written with; the copy follows when one exists
    const ins = pendingCaptureRef.current?.insert;
    if (ins) {
      const props = { ...ins.props };
      if (value === '') delete props[prop];
      else props[prop] = value === 'true' ? true : value === 'false' ? false : value;
      const key = variantKey(ins.item, props);
      const look = catalog?.snapshots[ins.item.id]?.find(sn => sameVariant(ins.item, sn.variant, key));
      if (look) restyleDraft(ins.draftId, look.html);
      const next: InsertDraft = { ...ins, props, ...(look ? { html: look.html } : {}) };
      setPendingCapture(prev => prev ? { ...prev, insert: next, auto: { ...prev.auto, ...insertCommand(next) } } : prev);
      return;
    }
    setPendingCapture(prev => {
      if (!prev) return prev;
      const original = hit.props[prop] !== undefined ? String(hit.props[prop]) : undefined;
      const others = (prev.propEdit?.changes ?? []).filter(c => c.prop !== prop);
      const changes = value === (original ?? '') ? others : [...others, { prop, ...(original !== undefined ? { from: original } : {}), to: value }];
      // See it now: the copy of that variant in its place, when one has been seen
      const id = prev.pixelTargetId;
      const el = id ? document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${id}"]`) : null;
      if (el && id) {
        const merged: Record<string, string | number | boolean> = { ...hit.props };
        for (const c of changes) { if (c.to === '') delete merged[c.prop]; else merged[c.prop] = c.to === 'true' ? true : c.to === 'false' ? false : c.to; }
        const look = changes.length ? catalog?.snapshots[hit.item.id]?.find(sn => sameVariant(hit.item, sn.variant, variantKey(hit.item, merged))) : undefined;
        previewVariant(el, id, look?.html ?? null, { from: look?.text, to: hit.text });
        setVariantMissing(changes.length > 0 && !look);
      }
      return {
        ...prev,
        propEdit: changes.length ? { component: hit.item.name, source: hit.item.source, frameUrl: hit.frameUrl, props: hit.props, text: hit.text, changes } : undefined,
        auto: { ...prev.auto, ...propsCommand(hit.item.name, hit.item.source, changes) },
      };
    });
  };

  // Selecting an element turns the catalog window into the panel (its Catalog tab is a click away)
  useEffect(() => { if (pendingCapture) setCatalogOpen(false); }, [pendingCapture]);
  useEffect(() => { setPickingComponent(false); setPanelClosed(false); setVariantMissing(false); }, [pendingCapture?.pixelTargetId]);

  // The panel keeps where it was dragged while the toolbar is open
  useEffect(() => { if (!isOpen) resetPanelPosition(); }, [isOpen]);

  // In the Screens iframe the toolbar is open and selecting from the start
  useEffect(() => { if (EMBEDDED) { setIsOpen(true); setAnnotating(true); } }, []);
  // The toolbar's actions, shared by its pill and (embedded) the Screens bar's copy of it
  const toggleSelect = () => {
    if (drawMode) exitDrawMode();
    setAnnotating(v => { wantSelectRef.current = !v; return !v; });
  };
  const togglePencil = () => {
    if (drawMode) { exitDrawMode(); return; }
    setAnnotating(false);
    if (pendingCaptureRef.current) cancelCapture();
    setActiveMarker(null);
    setDrawMode(true);
  };
  const toggleCatalog = () => {
    if (pendingCaptureRef.current) {
      if (panelClosed) { setPanelClosed(false); setPanelTab('catalog'); loadCatalog(); return; }
      const next = panelTab === 'catalog' ? 'props' : 'catalog';
      setPanelTab(next);
      if (next === 'catalog') loadCatalog();
      return;
    }
    if (!catalogOpen) loadCatalog();
    setCatalogOpen(o => !o);
  };
  const togglePause = () => { toggleFreeze(); setPaused(isFrozen()); };

  useScreensEmbed(EMBEDDED, {
    state: {
      pending: pendingCount, processing: processingCount, undo: undo.count, notes: annotations.length,
      selecting: annotating, drawing: drawMode, catalog: catalogOpen || (!!pendingCapture && !panelClosed && panelTab === 'catalog'),
      paused, markers: markersVisible, clearConfirm,
    },
    selectedId: pendingCapture?.pixelTargetId,
    act: (action) => {
      if (action === 'run') { setRunListOpen(false); setScanHighlight(null); sendAll(); }
      else if (action === 'stop') stopExecution();
      else if (action === 'undo') undoLast();
      else if (action === 'select') toggleSelect();
      else if (action === 'pencil') togglePencil();
      else if (action === 'catalog') toggleCatalog();
      else if (action === 'pause') togglePause();
      else if (action === 'markers') setMarkersVisible(v => !v);
      else handleClear();
    },
  });
  // Applying a change turns selection off on a normal page; in Screens there's no toolbar to turn it back on
  useEffect(() => {
    if (!EMBEDDED || !wantSelectRef.current || annotating || drawMode || pendingCapture) return;
    const id = setTimeout(() => setAnnotating(true), 150);
    return () => clearTimeout(id);
  }, [annotating, drawMode, pendingCapture]);

  // The device menu closes on a click anywhere else
  useEffect(() => {
    if (!screensMenuOpen) return;
    const away = () => setScreensMenuOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [screensMenuOpen]);

  const openScreens = (device: Device, rulers: boolean) => {
    // The page underneath is covered: nothing stays selected or selecting there
    if (pendingCaptureRef.current) cancelCapture();
    if (drawMode) exitDrawMode();
    setAnnotating(false); setScreensMenuOpen(false); setShowSettings(false); setCatalogOpen(false);
    setScreens({ device, rulers });
  };

  const closeToolbar = () => {
    // The draft first: cancelling it turns selection back on, closing turns it off
    if (pendingCaptureRef.current) cancelCapture();
    if (EMBEDDED) return;
    setIsOpen(false);
    setAnnotating(false);
    setDrawMode(false);
    setStrokes([]);
    setActiveMarker(null);
    setShowSettings(false);
    setChatOpen(false);
    setScanOpen(false);
    setScanHighlight(null);
    setCatalogOpen(false);
    setPanelTab('props');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!mounted) return null;

  // Don't render at all until the CLI WS server is reachable. The ws-client
  // auto-reconnects every 2s, so as soon as the user starts `ilse` in a
  // terminal the toolbar appears. If the CLI dies, the toolbar disappears.
  // In demo mode, skip this check — no WS needed.
  if (!demoMode && !connected) return null;

  // Screens open: this same pill drives the Ilse in the frame — its counts, its actions.
  // The pill below shadows these names with the frame's when `sv` is set.
  const sv = screens && !EMBEDDED ? embedState : null;
  const closeScreens = () => { setScreens(null); setEmbedState(null); setAnnotating(true); };
  const host = {
    pendingCount, processingCount, undo, annotating, drawMode, paused, markersVisible, clearConfirm,
    sendAll, stopExecution, undoLast, toggleSelect, togglePencil, toggleCatalog, togglePause, handleClear, setMarkersVisible, closeToolbar,
  };

  return (
    <>
      {/* ── Animation keyframes + contentEditable placeholder ── */}
      <style>{`
        [data-ilse-toolbar] .ilse-hidden-scroll::-webkit-scrollbar { width: 0; height: 0; }
        [data-ilse-toolbar] .ilse-hidden-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        [data-ilse-toolbar] .ilse-catalog-row:not([aria-current]):hover { background: ${color.muted}; }
        [data-ilse-toolbar] .ilse-panel-remove:not(:disabled):hover { background: ${color.muted} !important; color: ${color.destructive} !important; }
        [data-ilse-toolbar] [contenteditable][data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
        @keyframes ilse-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(var(--ilse-accent-rgb, 255,108,3),0.4), 0 0 20px rgba(var(--ilse-accent-rgb, 255,108,3),0.3), 0 4px 16px rgba(var(--ilse-accent-rgb, 255,108,3),0.2); }
          50% { box-shadow: 0 0 0 6px rgba(var(--ilse-accent-rgb, 255,108,3),0.2), 0 0 30px rgba(var(--ilse-accent-rgb, 255,108,3),0.4), 0 4px 16px rgba(var(--ilse-accent-rgb, 255,108,3),0.3); }
        }
        @keyframes ilse-pixel {
          0%, 100% { transform: scale(0.3); opacity: 0.2; }
          50% { transform: scale(1); opacity: 1; }
        }
        @keyframes ilse-processing {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,108,3,0.6); }
          50% { box-shadow: 0 0 0 8px rgba(255,108,3,0); }
        }
        @keyframes ilse-resolved {
          0% { transform: scale(1); }
          50% { transform: scale(1.3); }
          100% { transform: scale(1); }
        }
        @keyframes ilse-open {
          from { clip-path: inset(0 0 0 calc(100% - 52px) round 22px); }
          to   { clip-path: inset(0 0 0 0% round 17px); }
        }
        @keyframes ilse-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes ilse-pixel-flicker {
          0%   { opacity: 0; }
          20%  { opacity: 0.85; }
          50%  { opacity: 0.3; }
          80%  { opacity: 0.9; }
          100% { opacity: 0; }
        }
        @keyframes ilse-thinking-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ilse-thinking-dot {
          0%, 100% { opacity: 0.3; transform: scale(0.9); }
          50%      { opacity: 1;   transform: scale(1.1); }
        }
        @keyframes ilse-fade-out {
          0%, 60% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.6); }
        }
        @keyframes ilse-pixel-dissolve {
          0% { opacity: 1; transform: scale(1); }
          40% { opacity: 0.7; transform: scale(1.05); }
          100% { opacity: 0; transform: scale(0.3) translateY(-8px); }
        }
        @keyframes ilse-run-pulse {
          0%, 100% { background: rgba(var(--ilse-accent-rgb, 255,108,3),0.1); box-shadow: 0 0 0 0 rgba(var(--ilse-accent-rgb, 255,108,3),0.3); }
          50% { background: rgba(var(--ilse-accent-rgb, 255,108,3),0.25); box-shadow: 0 0 0 4px rgba(var(--ilse-accent-rgb, 255,108,3),0); }
        }
        @keyframes ilse-scan-fill {
          0% { clip-path: inset(0 0 100% 0); }
          100% { clip-path: inset(0 0 0 0); }
        }
      `}</style>

      {/* ── Grid overlay (during move/resize, only when snap enabled) ── */}
      {showGrid && snapEnabled && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            pointerEvents: 'none', zIndex: 99993,
            backgroundImage: `
              linear-gradient(to right, rgba(0,0,0,${darkMode ? 0.06 : 0.04}) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(0,0,0,${darkMode ? 0.06 : 0.04}) 1px, transparent 1px)
            `,
            backgroundSize: `${snapSize}px ${snapSize}px`,
          }}
        />
      )}

      {/* ── Alignment guide lines ── */}
      {guides.map((g, i) => (
        <div
          key={`guide-${g.axis}-${i}`}
          style={{
            position: 'fixed',
            top: g.axis === 'y' ? g.pos : 0,
            left: g.axis === 'x' ? g.pos : 0,
            width: g.axis === 'x' ? 1 : '100vw',
            height: g.axis === 'y' ? 1 : '100vh',
            backgroundColor: '#FF6C03',
            opacity: 0.5,
            pointerEvents: 'none',
            zIndex: 99994,
          }}
        />
      ))}

      {/* ── Spacing: line at neighbor edge + badge with distance ── */}
      {spacings.map((s, i) => {
        const isY = s.axis === 'y';
        const mid = (s.neighborEdge + s.draggedEdge) / 2;
        return (
          <Fragment key={`spacing-${i}`}>
            {/* Full-width line at neighbor's edge */}
            <div style={{
              position: 'fixed',
              top: isY ? s.neighborEdge : 0,
              left: isY ? 0 : s.neighborEdge,
              width: isY ? '100vw' : 1,
              height: isY ? 1 : '100vh',
              backgroundColor: '#FF6C03',
              opacity: 0.35,
              pointerEvents: 'none',
              zIndex: 99994,
            }} />
            {/* Dot at line start */}
            <div style={{
              position: 'fixed',
              top: isY ? s.neighborEdge - 3 : s.crossPos - 3,
              left: isY ? s.crossPos - 3 : s.neighborEdge - 3,
              width: 6, height: 6,
              borderRadius: 3,
              backgroundColor: '#FF6C03',
              pointerEvents: 'none',
              zIndex: 99996,
            }} />
            {/* Badge with px distance in the middle of the gap */}
            <div style={{
              position: 'fixed',
              top: isY ? mid : s.crossPos + 8,
              left: isY ? s.crossPos + 8 : mid,
              transform: isY ? 'translateY(-50%)' : 'translateX(-50%)',
              backgroundColor: 'rgba(255, 108, 3, 0.12)',
              color: '#FF6C03',
              fontSize: 10,
              fontFamily: 'monospace',
              padding: '1px 5px',
              borderRadius: 3,
              pointerEvents: 'none',
              zIndex: 99996,
              lineHeight: '14px',
              whiteSpace: 'nowrap',
            }}>
              {Math.round(s.distance)}
            </div>
          </Fragment>
        );
      })}

      {/* ── Element hover highlight ── */}
      {annotating && highlight && !dragRect && !pickingColor && !isEditedElement(highlight) && (
        <div style={{
          position: 'fixed', top: highlight.top, left: highlight.left,
          width: highlight.width, height: highlight.height,
          border: '2px solid #6366f1', backgroundColor: 'rgba(99,102,241,0.08)',
          pointerEvents: 'none', zIndex: 99996, borderRadius: 4,
          transition: 'all 0.08s ease',
        }} />
      )}

      {/* ── Scan hover highlight ── */}
      {scanHighlight && (
        <div style={{
          position: 'fixed', top: scanHighlight.top, left: scanHighlight.left,
          width: scanHighlight.width, height: scanHighlight.height,
          border: '2px solid #ef4444', backgroundColor: 'rgba(239,68,68,0.08)',
          pointerEvents: 'none', zIndex: 99996, borderRadius: 4,
          transition: 'all 0.1s ease',
        }} />
      )}

      {/* ── Element label tooltip ── */}
      {annotating && hoverLabel && hoverLabelRect && !dragRect && (
        <div
          style={{
            position: 'fixed',
            top: hoverLabelRect.top + hoverLabelRect.height + 6,
            left: hoverLabelRect.left,
            backgroundColor: color.foreground,
            borderRadius: 5,
            padding: '3px 8px',
            fontSize: 11,
            color: '#fafafa',
            pointerEvents: 'none',
            zIndex: 99997,
            whiteSpace: 'nowrap',
            boxShadow: shadow.md,
            fontFamily: font.mono,
          }}
        >
          {hoverLabel}
        </div>
      )}

      {/* ── Area drag overlay ── */}
      {dragRect && (() => {
        const empty = dragStartEmptyRef.current;
        return (
          <div style={{
            position: 'fixed', top: dragRect.top, left: dragRect.left,
            width: dragRect.width, height: dragRect.height,
            border: `2px dashed ${empty ? '#22c55e' : '#6366f1'}`,
            backgroundColor: empty ? 'rgba(34,197,94,0.06)' : 'rgba(99,102,241,0.06)',
            pointerEvents: 'none', zIndex: 99996, borderRadius: 4,
          }} />
        );
      })()}

      {/* ── Persistent selection highlight — visible + draggable while popover is open ── */}
      {pendingCapture && (() => {
        const pr = pendingCapture.rect;
        const isArea = pendingCapture.markerType === 'area';
        const isCreate = isArea && !pendingCapture.sketch && (pendingCapture.areaElementCount ?? 0) === 0;
        const selColor = isCreate ? '#22c55e' : '#6366f1';
        // Once the element carries a style edit, the fill would tint exactly
        // what's being judged — keep only a thin outline to say what's selected.
        // A sketch already marks the spot in its own ink.
        const quiet = (pendingCapture.styleChanges?.length ?? 0) > 0 || !!pendingCapture.sketch;
        return (
          <div
            ref={pendingAreaRef}
            data-ilse-toolbar
            style={{
              position: 'fixed', top: pr.top, left: pr.left,
              width: pr.width, height: pr.height,
              border: quiet
                ? `1px dashed ${selColor}`
                : `2px ${isArea ? 'dashed' : 'solid'} ${selColor}`,
              backgroundColor: quiet ? 'transparent' : isCreate
                ? (pendingAreaHover ? 'rgba(34,197,94,0.14)' : 'rgba(34,197,94,0.08)')
                : (pendingAreaHover ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.08)'),
              borderRadius: 4, cursor: 'grab',
              zIndex: 99997, boxSizing: 'border-box',
              pointerEvents: pickingColor ? 'none' : 'auto',
              opacity: pickingColor || liveDragging ? 0 : 1,
              transition: 'background-color 0.15s, opacity 0.12s',
            }}
          >
            {/* Resize handles */}
            {(['nw', 'ne', 'sw', 'se'] as const).map(corner => {
              const isTop = corner.startsWith('n');
              const isLeft = corner.endsWith('w');
              const cursors = { nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize' };
              return (
                <div
                  key={corner}
                  data-ilse-toolbar
                  style={{
                    position: 'absolute',
                    top: isTop ? -4 : undefined,
                    bottom: isTop ? undefined : -4,
                    left: isLeft ? -4 : undefined,
                    right: isLeft ? undefined : -4,
                    width: 8, height: 8,
                    backgroundColor: selColor,
                    borderRadius: 2,
                    cursor: cursors[corner],
                    zIndex: 99998,
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const origRect = { ...pr };
                    document.body.style.cursor = cursors[corner];
                    setShowGrid(true);
                    // The element itself grows/shrinks, so its neighbours react live
                    const target = pendingCapture.markerType === 'element' && pendingCapture.pixelTargetId
                      ? document.querySelector<HTMLElement>(`[data-ilse-pixel-target="${pendingCapture.pixelTargetId}"]`)
                      : null;
                    const live = target ? beginResize(target) : null;
                    snapRectsRef.current = collectSnapRects();
                    contentRectsRef.current = collectContentRects();
                    const onMove = (mv: MouseEvent) => {
                      const dx = snapToGrid(mv.clientX - startX);
                      const dy = snapToGrid(mv.clientY - startY);
                      let newTop = origRect.top;
                      let newLeft = origRect.left;
                      let newWidth = origRect.width;
                      let newHeight = origRect.height;
                      if (isTop) { newTop = origRect.top + dy; newHeight = origRect.height - dy; }
                      else { newHeight = origRect.height + dy; }
                      if (isLeft) { newLeft = origRect.left + dx; newWidth = origRect.width - dx; }
                      else { newWidth = origRect.width + dx; }
                      if (newWidth < gridSize) newWidth = gridSize;
                      if (newHeight < gridSize) newHeight = gridSize;
                      const newRect = { top: newTop, left: newLeft, width: newWidth, height: newHeight };
                      live?.apply(newWidth - origRect.width, newHeight - origRect.height);
                      setGuides(computeGuides(newRect, snapRectsRef.current));
                      const axis4: 'x' | 'y' | null = Math.abs(dy) > Math.abs(dx) ? 'y' : Math.abs(dx) > Math.abs(dy) ? 'x' : null;
                      setSpacings(computeSpacings(newRect, contentRectsRef.current, axis4));
                      setPendingCapture(prev => prev ? {
                        ...prev,
                        rect: newRect,
                        capture: { ...prev.capture, rect: { top: newRect.top, left: newRect.left, width: newRect.width, height: newRect.height } },
                      } : null);
                    };
                    const onUp = () => {
                      document.removeEventListener('mousemove', onMove);
                      document.removeEventListener('mouseup', onUp);
                      document.body.style.cursor = '';
                      setGuides([]);
                      setSpacings([]);
                      setShowGrid(false);
                      // The selection lands on where the element actually is now
                      if (target) {
                        const b = target.getBoundingClientRect();
                        const real = { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) };
                        setPendingCapture(prev => prev ? { ...prev, rect: real, capture: { ...prev.capture, rect: real } } : null);
                        pendingCaptureRef.current = pendingCaptureRef.current ? { ...pendingCaptureRef.current, rect: real } : null;
                      }
                      // Auto-fill note with resize info
                      const pc = pendingCaptureRef.current;
                      if (pc && pc.originalRect) {
                        const ow = pc.originalRect.width;
                        const oh = pc.originalRect.height;
                        const nw2 = pc.rect.width;
                        const nh2 = pc.rect.height;
                        if (Math.abs(nw2 - ow) > 3 || Math.abs(nh2 - oh) > 3) {
                          const desc = t('toolbar.chip.resized', { from: `${Math.round(ow)}×${Math.round(oh)}`, to: `${Math.round(nw2)}×${Math.round(nh2)}` });
                          setPendingCapture(prev => prev ? { ...prev, auto: { ...prev.auto, resize: desc } } : null);
                          pushDraftStep({ kind: 'gesture', key: 'resize', label: t('undo.resize') });
                        }
                      }
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                  }}
                />
              );
            })}
          </div>
        );
      })()}

      {/* ── Pencil sketches — live while drawing, then kept until the note is sent ── */}
      {isOpen && (
        <SketchLayer
          drawing={drawMode}
          penColor={penColor}
          strokes={drawMode ? strokes : [
            ...(pendingCapture?.sketch ?? []),
            ...(markersVisible ? annotations.filter(a => a.status === 'pending').flatMap(a => a.sketch ?? []) : []),
          ]}
          onStroke={addStroke}
        />
      )}

      {/* ── Property panel — docked right, open while an element is selected ── */}
      {pendingCapture && !panelClosed && !pendingCapture.sketch && pendingCapture.capture.styles && Object.keys(pendingCapture.capture.styles).length > 0 && (
        <PropertyPanel
          onClose={() => setPanelClosed(true)}
          onDuplicate={!pendingCapture.insert && pendingCapture.markerType === 'element'
            // A card with work in it (a note, an edit) isn't thrown away for a copy
            && !(pendingCapture.note.trim() || hasAuto(pendingCapture.auto) || pendingCapture.styleChanges?.length || pendingCapture.propEdit)
            // Free: anything is copied on screen and explained to the agent. Pro: a component's
            // root is written again with its props (variant swap, no AI), like a catalog drop
            ? (proCatalog && componentHit ? duplicateSelected : duplicateElement) : undefined}
          key={panelEpoch}
          tab={panelTab}
          onTab={(tab) => { setPanelTab(tab); if (tab === 'catalog') loadCatalog(); }}
          catalog={<CatalogPanel {...libraryProps} selected={componentHit?.item.id} />}
          componentSection={componentHit ? (
            <ComponentSection
              hit={componentHit}
              changes={pendingCapture.propEdit?.changes ?? []}
              onChange={setComponentProp}
              note={pendingCapture.insert
                ? (!catalog?.snapshots[pendingCapture.insert.item.id]?.some(sn => sameVariant(pendingCapture.insert!.item, sn.variant, variantKey(pendingCapture.insert!.item, pendingCapture.insert!.props))) ? t('catalog.noVariantCopy') : undefined)
                : variantMissing ? t('catalog.noLivePreview') : undefined}
            />
          ) : undefined}
          historyRef={panelHistoryRef}
          onRemove={pendingCapture.markerType === 'element' ? removeSelected : undefined}
          removed={!!pendingCapture.auto?.remove}
          textEdit={pendingCapture.textEdit}
          mirrorAll={pendingCapture.scope?.choice === 'all'}
          onTextChange={(edit) => setPendingCapture(prev => prev?.insert ? (() => {
            // A draft's text is the text it will be written with — not an edit of existing code
            const insert: InsertDraft = { ...prev.insert, text: edit ? edit.to : prev.insert.text };
            return { ...prev, insert, auto: { ...prev.auto, ...insertCommand(insert) } };
          })() : prev ? {
            ...prev,
            textEdit: edit,
            auto: { ...prev.auto, ...textCommand(edit) },
          } : null)}
          onStep={() => pushDraftStep({ kind: 'panel' })}
          styles={pendingCapture.capture.styles}
          targetId={pendingCapture.pixelTargetId}
          textSelection={pendingCapture.markerType === 'text'}
          contextLabel={pendingCapture.contextLabel}
          committedRef={stylePreviewCommitted}
          onPickerOpen={setPickingColor}
          onChange={(changes) => setPendingCapture(prev => prev ? {
            ...prev,
            styleChanges: changes,
            auto: { ...prev.auto, style: formatStyleNote(changes) || undefined },
          } : null)}
        />
      )}

      {/* ── A catalog component clicked: where it is on this page ── */}
      {spot && (spot.none
        ? <div data-ilse-toolbar style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 100003, padding: '6px 10px', borderRadius: 8, background: '#171717', color: '#fff', fontSize: 11, fontFamily: font.sans, pointerEvents: 'none' }}>{t('catalog.notHere')}</div>
        : spot.rects.map((r, i) => (
          <div key={i} data-ilse-toolbar style={{
            position: 'fixed', left: r.left - 3, top: r.top - 3, width: r.width + 6, height: r.height + 6, zIndex: 100002, pointerEvents: 'none',
            outline: `2px solid ${ilse.brand}`, borderRadius: 6, background: 'rgba(255,108,3,0.08)', transition: 'opacity 0.2s',
          }} />
        )))}

      {/* ── A component being dragged from the catalog: its copy under the pointer, where it would land ── */}
      {catalogDrag && (
        <>
          <div data-ilse-toolbar data-ilse-ghost style={{
            position: 'fixed', pointerEvents: 'none', zIndex: 100005, left: catalogDrag.x + 12, top: catalogDrag.y - 26,
            padding: '3px 7px', borderRadius: 6, background: '#171717', color: '#fff', fontSize: 10, fontFamily: font.sans, whiteSpace: 'nowrap',
          }}>
            {catalogDrag.active ? t('catalog.dragHint') : t('catalog.dragCancel')}
          </div>
          {/* Until it's over somewhere it can land, a small copy rides with the pointer */}
          {!catalogDrag.active && (
            <div data-ilse-toolbar data-ilse-ghost style={{
              position: 'fixed', pointerEvents: 'none', zIndex: 100004, left: catalogDrag.x + 10, top: catalogDrag.y + 10, opacity: 0.6,
              transform: `scale(${Math.min(1, 240 / (catalogDrag.snap?.w ?? 120))})`, transformOrigin: 'top left',
            }}
              dangerouslySetInnerHTML={{ __html: catalogDrag.snap?.html ?? placeholderHtml(catalogDrag.item.name) }}
            />
          )}
        </>
      )}

      {/* ── Catalog with nothing selected — the panel's spot, only the catalog ── */}
      {isOpen && catalogOpen && !(pendingCapture && !pendingCapture.sketch && pendingCapture.capture.styles && Object.keys(pendingCapture.capture.styles).length > 0) && (
        <CatalogWindow onClose={() => setCatalogOpen(false)}>
          <CatalogPanel {...libraryProps} />
        </CatalogWindow>
      )}

      {dsViewer && (
        <DsViewer data={dsViewer.data} justWritten={dsViewer.justWritten} onClose={() => setDsViewer(null)} onExport={() => exportDs()} onLinkAgents={() => send({ type: 'ds_agents' })}
          check={dsCheck} onCheck={() => { setDsCheck({ status: 'running' }); send({ type: 'ds_check' }); }}
          onAddRule={(rule) => send({ type: 'ds_rule', rule })} />
      )}

      {/* ── Annotation popover — out of the way while the element is being dragged,
           back next to where it landed ── */}
      {pendingCapture && !liveDragging && (
        <AnnotationPopover
          context={pendingCapture.context}
          contextLabel={pendingCapture.contextLabel}
          rect={pendingCapture.rect}
          note={pendingCapture.note}
          hasContext={hasAuto(pendingCapture.auto)}
          summary={autoSummary(pendingCapture.auto)}
          scope={pendingCapture.scope}
          onScope={(choice) => setPendingCapture(prev => prev?.scope ? { ...prev, scope: { ...prev.scope, choice } } : prev)}
          onRemoveSummary={takeBack}
          {...(() => {
            const pc = pendingCapture;
            const el = pc.markerType === 'element' && pc.pixelTargetId
              ? document.querySelector(`[data-ilse-pixel-target="${pc.pixelTargetId}"]`)
              : null;
            if (!el) return {};
            // Same rule as clicking another element: only while nothing has been changed yet
            const touched = !!(pc.note.trim() || hasAuto(pc.auto) || pc.styleChanges?.length || pc.imageRefs?.length || pc.sketch);
            const moveTo = touched ? undefined : (target: Element) => { settleElement(el); selectElement(target, true); };
            const parent = selectableParent(el);
            return {
              treeTarget: el,
              onSelectElement: moveTo,
              onSelectParent: moveTo && parent ? () => moveTo(parent) : undefined,
            };
          })()}
          styles={pendingCapture.capture.styles}
          grepPattern={pendingCapture.capture.grepPattern}
          hasElement={pendingCapture.markerType === 'area' ? (pendingCapture.areaElementCount ?? 0) > 0 : !!pendingCapture.capture.element}
          suggestions={pendingCapture.suggestions}
          imageRefs={pendingCapture.imageRefs}
          onAddImage={(dataUrl, filename) => setPendingCapture(prev => prev ? {
            ...prev,
            imageRefs: [...(prev.imageRefs ?? []), dataUrl],
            imageFilenames: [...(prev.imageFilenames ?? []), filename ?? ''],
          } : null)}
          onPickComponent={proCatalog ? () => { if (!catalogFullRef.current) loadCatalog(); setPickingComponent(p => !p); } : undefined}
          picker={pickingComponent ? (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${color.border}`, maxHeight: 260, overflowY: 'auto' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: color.foreground, marginBottom: 6 }}>{t('card.pickComponent')}</div>
              <CatalogPanel
                items={catalog?.items ?? null}
                snapshots={catalog?.snapshots ?? {}}
                onPage={catalogOnPage}
                onPick={(item) => {
                  setPickingComponent(false);
                  setPendingCapture(prev => prev ? { ...prev, auto: { ...prev.auto, ...componentCommand(item) } } : null);
                }}
              />
            </div>
          ) : undefined}
          onRemoveImage={(i) => setPendingCapture(prev => prev ? {
            ...prev,
            imageRefs: (prev.imageRefs ?? []).filter((_, j) => j !== i),
            imageFilenames: (prev.imageFilenames ?? []).filter((_, j) => j !== i),
          } : null)}
          onApplySuggestion={(text) => {
            setPendingCapture(prev => prev ? { ...prev, note: prev.note ? `${prev.note}\n${text}` : text } : null);
          }}
          onRequestAnalysis={() => {
            if (!isConnected()) return;
            const findings = pendingCapture.suggestions ?? [];
            const findingsText = findings.length > 0
              ? findings.map(s => `- [${s.severity}] ${s.message}${s.detail ? ` (${s.detail})` : ''}`).join('\n')
              : 'No static issues found. Analyze this element for design consistency, reuse, and DS token compliance.';
            const env = captureEnvironment();
            send({
              type: 'annotate',
              note: findingsText,
              element: pendingCapture.capture.element,
              component: pendingCapture.capture.component,
              styles: pendingCapture.capture.styles,
              grepPattern: pendingCapture.capture.grepPattern,
              componentStack: pendingCapture.capture.componentStack,
              environment: env,
              intent: 'analyze',
              severity: 'suggestion',
            });
          }}
          onNoteChange={(note) => setPendingCapture(prev => prev ? { ...prev, note } : null)}
          onAdd={confirmCapture}
          onCancel={cancelCapture}
        />
      )}

      {/* ── Editing overlay (pixel flicker — content-aware) ── */}
      {/* Always visible — even when toolbar is minimized to pill */}
      {annotations.map((ann, i) => {
        // Show during 'sent' (active editing) and fade out during 'resolved'
        if (ann.status !== 'sent' && ann.status !== 'resolved') return null;
        const scrollX = ann.capture._scrollX ?? 0;
        const scrollY = ann.capture._scrollY ?? 0;
        const fallbackRect = {
          top: ann.capture.rect.top + scrollY,
          left: ann.capture.rect.left + scrollX,
          width: ann.capture.rect.width,
          height: ann.capture.rect.height,
        };
        // "Apply to: all" changes every instance — show the edit landing on each of them
        const selected = ann.scope?.choice === 'all' && ann.pixelTargetId
          ? document.querySelector(`[data-ilse-pixel-target="${ann.pixelTargetId}"]`)
          : null;
        const twins = selected ? scopeTwins(selected) : [];
        return (
          <Fragment key={`editing-${i}`}>
            <PixelOverlay
              targetId={ann.pixelTargetId}
              selector={ann.capture.element}
              fallbackRect={fallbackRect}
              fadeOut={ann.status === 'resolved'}
            />
            {twins.map((twin, j) => (
              <PixelOverlay
                key={j}
                element={twin}
                selector={ann.capture.element}
                fallbackRect={fallbackRect}
                fadeOut={ann.status === 'resolved'}
              />
            ))}
          </Fragment>
        );
      })}

      {/* ── Page markers — only pending ones, renumbered from 1 ── */}
      {isOpen && markersVisible && (() => {
        // Only show pending annotations, numbered from 1 based on visible index
        const pendingList = annotations
          .map((ann, i) => ({ ann, originalIndex: i }))
          .filter(({ ann }) => ann.status === 'pending' && inMode(ann));
        return pendingList.map(({ ann, originalIndex }, visibleIndex) => {
          const r = ann.capture.rect;
          const at = anchorOf(ann);
          if (!at.visible) return null; // scrolled out of its list or panel
          // A finding with nothing to point at (a console error) is listed under Run, not pinned
          if (!ann.capture.element && !r.width && !r.height) return null;
          const isArea = ann.markerType === 'area';
          const markerColor = ann.testFinding ? modeAccent('test').hex : ann.intent === 'create' ? '#22c55e' : '#FF6C03';
          return (
            <div
              key={originalIndex}
              data-ilse-toolbar
              title={t('toolbar.markerTitle')}
              onMouseEnter={() => setMoveHoverIndex(originalIndex)}
              onMouseLeave={() => setMoveHoverIndex(null)}
              onMouseDown={(e) => startMarkerDrag(originalIndex, e)}
              style={{
                position: 'absolute',
                top: isArea ? at.top - 6 : at.top + r.height / 2 - 11,
                left: at.left - 6,
                width: 22, height: 22,
                borderRadius: 7,
                backgroundColor: markerColor,
                color: 'white', fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 99997, cursor: annotating ? 'pointer' : 'grab',
                boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
                fontFamily: '-apple-system, sans-serif',
                outline: activeMarker === originalIndex ? '2px solid white' : 'none',
                outlineOffset: 1,
              }}
            >
              {visibleIndex + 1}
            </div>
          );
        });
      })()}

      {/* ── Move zones — outline of a pending annotation, shown while its badge is
           hovered or dragged. Visual only: the page underneath stays clickable,
           otherwise every annotated element would be dead until the note is sent. */}
      {isOpen && markersVisible && !annotating && annotations.map((ann, i) => {
        if (ann.status !== 'pending' || !inMode(ann) || i === activeMarker || moveHoverIndex !== i) return null;
        const r = ann.capture.rect;
        const at = anchorOf(ann);
        if (!at.visible) return null;
        const off = markerDragOffset(ann);
        const isCreate = ann.intent === 'create';
        const zone = ann.testFinding ? modeAccent('test') : null;
        return (
          <div
            key={`move-${i}`}
            style={{
              position: 'absolute', top: at.top + off.dy, left: at.left + off.dx,
              width: r.width, height: r.height,
              border: `2px dashed ${zone ? zone.hex : isCreate ? '#22c55e' : '#FF6C03'}`,
              backgroundColor: zone ? `rgba(${zone.rgb},0.06)` : isCreate ? 'rgba(34,197,94,0.06)' : 'rgba(255,108,3,0.06)',
              borderRadius: 4, zIndex: 99995, boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
          />
        );
      })}

      {/* ── Marker mini card ── */}
      {activeMarker !== null && annotations[activeMarker] && (() => {
        const ann = annotations[activeMarker];
        const r = ann.capture.rect;
        const { top: absTop, left: absLeft } = anchorOf(ann);
        const cardWidth = 280;
        let cardTop = absTop - 90;
        let cardLeft = absLeft;
        if (cardTop < window.scrollY + 8) cardTop = absTop + r.height + 8;
        if (cardLeft + cardWidth > window.scrollX + window.innerWidth - 8) cardLeft = window.scrollX + window.innerWidth - cardWidth - 8;
        if (cardLeft < window.scrollX + 8) cardLeft = window.scrollX + 8;

        // A test finding is titled by what the test found; otherwise the component name > tag name > selector
        const finding = ann.testFinding ? testFindings.find(f => f.id === ann.testFinding!.id) : undefined;
        const simpleTitle = finding?.title || ann.capture.component
          || humanizeSelector(ann.capture.element).split(/[.#\[:]/)[0]
          || 'element';
        const fullSelector = humanizeSelector(ann.capture.element);
        const styles = ann.capture.styles;
        const styleEntries = Object.entries(styles).filter(([, v]) => v);
        const intent = ann.intent ?? inferDraftIntent(ann.note, !!ann.capture.element);
        const isPending = ann.status === 'pending';

        const finalTop = markerCardPos ? markerCardPos.top : cardTop;
        const finalLeft = markerCardPos ? markerCardPos.left : cardLeft;

        return (
          <div
            data-ilse-toolbar
            onMouseDown={(e) => {
              const tag = (e.target as HTMLElement).tagName;
              const editable = (e.target as HTMLElement).contentEditable === 'true';
              if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
              e.preventDefault();
              markerDragRef.current = { startX: e.clientX, startY: e.clientY, origTop: finalTop, origLeft: finalLeft };
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: finalTop, left: finalLeft,
              width: cardWidth, backgroundColor: color.popover,
              border: `1px solid ${color.border}`, borderRadius: radius.xl, padding: 14,
              zIndex: 99998, boxShadow: shadow.xl,
              fontFamily: font.sans,
            }}
          >
            {/* Header: title + close */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div title={fullSelector} style={{ fontSize: 12, color: color.mutedForeground, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {simpleTitle}
              </div>
              {!isPending && (
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: radius.sm, marginLeft: 6, flexShrink: 0,
                  backgroundColor: ann.status === 'sent' ? ilse.orangePale : '#dcfce7',
                  color: ann.status === 'sent' ? ilse.orange : '#16a34a',
                }}>
                  {ann.status === 'sent' ? 'corrigindo...' : 'corrigido'}
                </span>
              )}
              <button
                onClick={() => setActiveMarker(null)}
                style={{ background: 'none', border: 'none', color: color.mutedForeground, cursor: 'pointer', padding: '0 0 0 6px', lineHeight: 1 }}
              >
                <IconX size={14} stroke={1.5} />
              </button>
            </div>

            {/* CSS Properties — collapsible */}
            {styleEntries.length > 0 && (
              <CSSPropertiesSection entries={styleEntries} />
            )}

            {/* Suggestions — auto-detected issues */}
            {ann.suggestions && ann.suggestions.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <SuggestionsSection
                  items={ann.suggestions}
                  onApply={isPending ? (text) => {
                    updateNote(activeMarker, ann.note ? `${ann.note}\n${text}` : text);
                  } : undefined}
                  onRequestAnalysis={isConnected() && ann.suggestions.length > 0 ? () => {
                    const findingsText = ann.suggestions!.map(s => `- [${s.severity}] ${s.message}`).join('\n');
                    const env = captureEnvironment();
                    send({
                      type: 'annotate',
                      note: findingsText,
                      element: ann.capture.element,
                      component: ann.capture.component,
                      styles: ann.capture.styles,
                      grepPattern: ann.capture.grepPattern,
                      componentStack: ann.capture.componentStack,
                      environment: env,
                      intent: 'analyze',
                      severity: 'suggestion',
                    });
                  } : undefined}
                />
              </div>
            )}

            {/* Pending: editable note + send */}
            {isPending && (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
                  <div
                    ref={(el) => {
                      if (el && !el.dataset.init) {
                        el.textContent = ann.note;
                        el.dataset.init = '1';
                      }
                    }}
                    contentEditable
                    role="textbox"
                    suppressContentEditableWarning
                    onInput={(e) => updateNote(activeMarker, (e.target as HTMLDivElement).textContent ?? '')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendAnnotation(activeMarker); setActiveMarker(null); }
                    }}
                    data-placeholder={t('toolbar.placeholder.describe')}
                    style={{
                      flex: 1, minHeight: 40, padding: '8px 10px',
                      backgroundColor: color.background, border: `1px solid ${color.border}`,
                      borderRadius: radius.lg, color: color.foreground,
                      fontSize: 13, fontFamily: font.sans,
                      outline: 'none', boxSizing: 'border-box',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      textAlign: 'left',
                      WebkitUserModify: 'read-write-plaintext-only' as unknown as undefined,
                    }}
                  />
                  {!ann.testFinding && <button
                    onClick={() => { sendAnnotation(activeMarker); setActiveMarker(null); }}
                    style={{
                      width: 34, height: 34, borderRadius: '50%',
                      backgroundColor: ann.note.trim() || hasAuto(ann.auto) ? color.primary : color.border,
                      border: 'none', cursor: ann.note.trim() || hasAuto(ann.auto) ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, transition: 'background-color 0.15s',
                    }}
                  >
                    <IconArrowUp size={16} stroke={2} color="#fff" />
                  </button>}
                </div>
                {ann.testFinding && (
                  // A finding's card answers like its row in the report
                  <FindingActions
                    busy={false}
                    onSkip={() => { skipFinding(ann.testFinding!); setActiveMarker(null); }}
                    onIgnore={() => { ignoreFinding(activeMarker); setActiveMarker(null); }}
                    onFix={() => { sendAnnotation(activeMarker); setActiveMarker(null); }}
                  />
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  {ann.testFinding ? null : (
                  <button
                    onClick={() => removeAnnotation(activeMarker)}
                    style={{ background: 'none', border: 'none', color: color.destructive, cursor: 'pointer', fontSize: 11, padding: '2px 4px' }}
                  >
                    remover
                  </button>
                  )}
                </div>
              </>
            )}

            {/* Sent/Resolved: read-only view */}
            {!isPending && (
              <>
                {ann.note && (
                  <div style={{ fontSize: 13, color: color.foreground, marginTop: 8, lineHeight: 1.4 }}>{ann.note}</div>
                )}
                {ann.status === 'resolved' && ann.resolvedSummary && (
                  <div style={{ fontSize: 12, color: '#16a34a', marginTop: 8, lineHeight: 1.4 }}>{ann.resolvedSummary}</div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button
                    onClick={() => removeAnnotation(activeMarker)}
                    style={{ background: 'none', border: 'none', color: color.destructive, cursor: 'pointer', fontSize: 11, padding: '2px 4px' }}
                  >
                    remover
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ── Rearrange drag overlay — shown when annotation is active + pending ── */}
      {activeMarker !== null && annotations[activeMarker]?.status === 'pending' && (() => {
        const ann = annotations[activeMarker];
        const r = ann.capture.rect;
        const at = anchorOf(ann);
        const dragOffset = ann.rearrangeData
          ? { dx: ann.rearrangeData.currentRect.x - ann.rearrangeData.originalRect.x, dy: ann.rearrangeData.currentRect.y - ann.rearrangeData.originalRect.y }
          : { dx: 0, dy: 0 };
        const top = at.top + dragOffset.dy;
        const left = at.left + dragOffset.dx;
        return (
          <div
            data-ilse-toolbar
            title={t('toolbar.drag')}
            style={{
              position: 'absolute', top, left,
              width: r.width, height: r.height,
              border: '2px dashed #FF6C03',
              backgroundColor: 'rgba(255,108,3,0.06)',
              borderRadius: 4, cursor: 'grab',
              zIndex: 99996, boxSizing: 'border-box',
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const startX = e.clientX;
              const startY = e.clientY;
              const origDx = dragOffset.dx;
              const origDy = dragOffset.dy;
              snapRectsRef.current = collectSnapRects();
      contentRectsRef.current = collectContentRects();
              const onMove = (mv: MouseEvent) => {
                const dx = origDx + snapToGrid(mv.clientX - startX);
                const dy = origDy + snapToGrid(mv.clientY - startY);
                const movedRect = { top: r.top + scrollY + dy, left: r.left + scrollX + dx, width: r.width, height: r.height };
                const viewportRect3 = { top: movedRect.top - window.scrollY, left: movedRect.left - window.scrollX, width: r.width, height: r.height };
                const axis3: 'x' | 'y' | null = Math.abs(dy) > Math.abs(dx) ? 'y' : Math.abs(dx) > Math.abs(dy) ? 'x' : null;
                setGuides(computeGuides(viewportRect3, snapRectsRef.current));
                setSpacings(computeSpacings(viewportRect3, contentRectsRef.current, axis3));
                updateRearrange(activeMarker, {
                  originalRect: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height },
                  currentRect:  { x: r.left + scrollX + dx, y: r.top + scrollY + dy, width: r.width, height: r.height },
                });
              };
              const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                setGuides([]);
                setSpacings([]);
              };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          />
        );
      })()}

      {/* ── Full scan report modal ── */}
      {scanReportOpen && (() => {
        const categories = ['a11y', 'contrast', 'typography', 'spacing', 'component'] as const;
        const CATEGORY_LABELS: Record<string, string> = { a11y: 'Accessibility', contrast: 'Contrast', typography: 'Typography', spacing: 'Spacing', component: 'Components' };
        const byCategory: Record<string, PageIssue[]> = {};
        for (const issue of pageIssues) {
          (byCategory[issue.category] ??= []).push(issue);
        }
        const activeCategories = categories.filter(c => byCategory[c]?.length);
        const errors = pageIssues.filter(i => i.severity === 'error').length;
        const warnings = pageIssues.filter(i => i.severity === 'warning').length;
        const infos = pageIssues.filter(i => i.severity === 'info').length;
        const filtered = scanCategory ? (byCategory[scanCategory] ?? []) : pageIssues;

        return (
          <>
            {/* Backdrop */}
            <div
              data-ilse-toolbar
              onClick={() => setScanReportOpen(false)}
              style={{
                position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
                backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
                zIndex: 100001,
              }}
            />
            {/* Modal */}
            <div
              data-ilse-toolbar
              className="ilse-hidden-scroll"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                width: Math.min(520, window.innerWidth - 40),
                maxHeight: '70vh', overflowY: 'auto',
                backgroundColor: color.popover, border: `1px solid ${color.border}`,
                borderRadius: radius.xl, padding: 20,
                boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
                zIndex: 100002,
                fontFamily: font.sans,
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <IconEyeglass2 size={18} stroke={1.75} color={ilse.orange} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: color.foreground }}>Design Report</span>
                </div>
                <button
                  title={t('toolbar.closeReport')}
                  onClick={() => setScanReportOpen(false)}
                  style={{ background: 'none', border: 'none', color: color.mutedForeground, cursor: 'pointer', padding: 4 }}
                >
                  <IconX size={16} stroke={1.75} />
                </button>
              </div>

              {/* Summary row */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <div style={{ flex: 1, padding: '10px 12px', backgroundColor: color.muted, borderRadius: radius.md, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: errors > 0 ? '#ef4444' : warnings > 0 ? '#f59e0b' : '#16a34a' }}>
                    {pageIssues.length}
                  </div>
                  <div style={{ fontSize: 10, color: color.mutedForeground }}>Total issues</div>
                </div>
                {errors > 0 && (
                  <div style={{ flex: 1, padding: '10px 12px', backgroundColor: 'rgba(239,68,68,0.05)', borderRadius: radius.md, textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>{errors}</div>
                    <div style={{ fontSize: 10, color: '#ef4444' }}>Errors</div>
                  </div>
                )}
                {warnings > 0 && (
                  <div style={{ flex: 1, padding: '10px 12px', backgroundColor: 'rgba(245,158,11,0.05)', borderRadius: radius.md, textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>{warnings}</div>
                    <div style={{ fontSize: 10, color: '#f59e0b' }}>Warnings</div>
                  </div>
                )}
                {infos > 0 && (
                  <div style={{ flex: 1, padding: '10px 12px', backgroundColor: 'rgba(99,102,241,0.05)', borderRadius: radius.md, textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#6366f1' }}>{infos}</div>
                    <div style={{ fontSize: 10, color: '#6366f1' }}>Info</div>
                  </div>
                )}
              </div>

              {/* AI Summary */}
              {scanAiSummary && (
                <div style={{
                  fontSize: 12, color: color.mutedForeground, lineHeight: 1.5,
                  padding: '8px 10px', backgroundColor: color.muted,
                  borderRadius: radius.md, marginBottom: 16,
                  whiteSpace: 'pre-wrap',
                }}>
                  <span style={{ display: 'inline-block', width: 5, height: 5, backgroundColor: ilse.orange, marginRight: 6, verticalAlign: 'middle' }} />
                  {scanAiSummary}
                </div>
              )}

              {/* Category tabs */}
              {activeCategories.length > 1 && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setScanCategory(null)}
                    style={{
                      background: !scanCategory ? 'rgba(255,108,3,0.1)' : color.muted,
                      border: 'none', borderRadius: 8, padding: '5px 12px',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      color: !scanCategory ? ilse.orange : color.mutedForeground,
                      fontFamily: font.sans,
                    }}
                  >
                    All ({pageIssues.length})
                  </button>
                  {activeCategories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setScanCategory(scanCategory === cat ? null : cat)}
                      style={{
                        background: scanCategory === cat ? 'rgba(255,108,3,0.1)' : color.muted,
                        border: 'none', borderRadius: 8, padding: '5px 12px',
                        fontSize: 11, fontWeight: 500, cursor: 'pointer',
                        color: scanCategory === cat ? ilse.orange : color.mutedForeground,
                        fontFamily: font.sans,
                      }}
                    >
                      {CATEGORY_LABELS[cat] ?? cat} ({byCategory[cat].length})
                    </button>
                  ))}
                </div>
              )}

              {/* Issues list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {filtered.map((issue, i) => (
                  <div
                    key={`${issue.id}-${i}`}
                    style={{
                      display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer',
                      padding: '6px 8px', borderRadius: radius.md,
                      transition: 'background-color 0.15s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = color.muted; setScanHighlight(issue.rect); }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; setScanHighlight(null); }}
                    onClick={() => {
                      const capture = captureElement(issue.element);
                      const rect = issue.element.getBoundingClientRect();
                      const pixelTargetId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                      issue.element.setAttribute('data-ilse-pixel-target', pixelTargetId);
                      const sug = analyzeElement(issue.element, capture.styles);
                      setPendingCapture({
                        capture, context: capture.element, contextLabel: buildContextLabel(issue.element),
                        rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
                        originalRect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
                        note: issue.message, markerType: 'element', pixelTargetId, suggestions: sug,
                      });
                      setScanReportOpen(false); setScanHighlight(null);
                    }}
                  >
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 6,
                      backgroundColor: SEVERITY_COLORS[issue.severity] ?? color.mutedForeground,
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: color.foreground, lineHeight: 1.3 }}>{issue.message}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                        <span style={{ fontSize: 10, color: color.mutedForeground }}>{issue.selector}</span>
                        {issue.detail && <span style={{ fontSize: 10, color: color.mutedForeground, opacity: 0.7 }}>{issue.detail}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Main toolbar ── */}
      <div data-ilse-toolbar style={{ display: EMBEDDED ? 'none' : undefined, position: 'fixed', zIndex: screens ? 100001 : 99999, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', ['--ilse-accent-rgb' as string]: accent.rgb }}>

        {/* Minimized circle button (draggable, animated border) */}
        {!isOpen && (
          <div
            style={{ position: 'fixed', top: toolbarPos.y, left: toolbarPos.x }}
            onMouseDown={handleToolbarMouseDown}
          >
            <IlsePixelButton
              mode={toolbarMode}
              onClick={openToolbar}
              badge={processingCount > 0 ? processingCount : pendingCount > 0 ? pendingCount : undefined}
              processing={processingCount > 0}
            />

            {/* Streaming log — visible near pill while agent is running */}
            {toolbarMode === 'test' && testStream(12, 11, 280)}
            {thinkingMessages.length > 0 && processingCount > 0 && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 12px)',
                  right: 0,
                  display: 'flex',
                  flexDirection: 'column-reverse',
                  alignItems: 'flex-end',
                  gap: 4,
                  pointerEvents: 'none',
                }}
              >
                {thinkingMessages.slice().reverse().map((m, idxFromBottom) => {
                  // Newest at the bottom, bold, with the pulsing square; older lines fade
                  return (
                    <div key={m.id} style={{ fontSize: 11, fontFamily: font.sans, maxWidth: 280, ...reasoningLine(idxFromBottom) }}>
                      {idxFromBottom === 0 && <ReasoningDot mode={toolbarMode} />}
                      {m.text}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Full pill toolbar */}
        {isOpen && (() => {
          // Flip direction if too close to left edge — extend rightward instead of leftward.
          const flipThreshold = 250; // approx pill width
          const extendsRight = toolbarPos.x < flipThreshold;
          const act = (a: ScreensAction) => screensActRef.current?.(a);
          const pendingCount = sv ? sv.pending : host.pendingCount;
          const processingCount = sv ? sv.processing : host.processingCount;
          const undo = sv ? { count: sv.undo } as typeof host.undo : host.undo;
          const annotating = sv ? sv.selecting : host.annotating;
          const drawMode = sv ? sv.drawing : host.drawMode;
          const paused = sv ? sv.paused : host.paused;
          const markersVisible = sv ? sv.markers : host.markersVisible;
          const clearConfirm = sv ? sv.clearConfirm : host.clearConfirm;
          const noteCount = sv ? sv.notes : annotations.length;
          const catalogActive = sv ? sv.catalog : catalogOpen || (!!pendingCapture && !panelClosed && panelTab === 'catalog');
          const sendAll = sv ? () => act('run') : host.sendAll;
          const stopExecution = sv ? () => act('stop') : host.stopExecution;
          const undoLast = sv ? () => act('undo') : host.undoLast;
          const toggleSelect = sv ? () => act('select') : host.toggleSelect;
          const togglePencil = sv ? () => act('pencil') : host.togglePencil;
          const toggleCatalog = sv ? () => act('catalog') : host.toggleCatalog;
          const togglePause = sv ? () => act('pause') : host.togglePause;
          const handleClear = sv ? () => act('clear') : host.handleClear;
          const setMarkersVisible = sv ? ((() => act('markers')) as typeof host.setMarkersVisible) : host.setMarkersVisible;
          // Close leaves Screens first, like Esc
          const closeToolbar = sv || screens ? closeScreens : host.closeToolbar;
          return (
          <div style={{
            position: 'fixed',
            top: toolbarPos.y,
            left: extendsRight ? toolbarPos.x : toolbarPos.x + PILL_W,
            transform: extendsRight ? 'none' : 'translateX(-100%)',
          }}>

            {/* Settings panel — absolutely above the pill */}
            {showSettings && (
              <div data-ilse-above="" style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', ...(extendsRight ? { left: 0 } : { right: 0 }),
                backgroundColor: color.popover, border: `1px solid ${color.border}`,
                borderRadius: 10, padding: 12,
                width: connectOpen ? 340 : 240, boxShadow: shadow.lg,
                color: color.foreground, fontSize: 12, fontFamily: font.sans,
              }}>
                {/* Ilse's plan, and the bridge: dot + port, the status in the tooltip */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Ilse</span>
                  <span
                    role={owner ? 'button' : undefined}
                    tabIndex={owner ? 0 : undefined}
                    onClick={owner ? () => send({ type: 'view_as_free', free: !owner.viewAsFree }) : undefined}
                    title={owner
                      ? t('settings.ownerSwitchHint', { other: owner.viewAsFree ? 'Pro' : 'Free' })
                      : proTest ? t('settings.planProHint') : t('settings.planFreeHint')}
                    style={{
                      fontSize: 10, fontWeight: 600, lineHeight: 1, padding: '3px 6px', borderRadius: radius.full,
                      backgroundColor: color.muted, color: color.mutedForeground,
                      ...(owner ? { cursor: 'pointer', outline: `1px dashed ${proTest ? ilse.brand : color.mutedForeground}`, outlineOffset: 1 } : {}),
                    }}
                  >
                    {proTest ? <span style={proText}>Pro</span> : 'Free'}{owner ? ' ⇄' : ''}
                  </span>
                  <span
                    title={connected ? t('settings.wsConnectedHint', { port: String(wsPort ?? '') }) : t('settings.wsOfflineHint')}
                    style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, cursor: 'default' }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: connected ? '#22c55e' : '#ef4444', display: 'inline-block' }} />
                    <span style={{ color: connected ? '#a1a1a1' : '#ef4444', fontSize: 10, fontFamily: font.mono }}>
                      {connected && wsPort ? `:${wsPort}` : t('settings.offline')}
                    </span>
                  </span>
                </div>
                {/* Who runs the changes: the agent, its plan, its account, this session's model runs */}
                {agentInfo?.name && (
                  <div title={t('settings.accountHint')} style={{ marginBottom: 10, fontSize: 11, lineHeight: 1.45, color: color.mutedForeground, minWidth: 0 }}>
                    <div style={{ color: color.foreground, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {agentInfo.name}{agentInfo.plan ? <span style={{ color: color.mutedForeground, fontWeight: 400 }}> · {agentInfo.plan}</span> : null}
                    </div>
                    {agentInfo.email && <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agentInfo.email}</div>}
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {agentInfo.model ?? t('settings.defaultModel')} · {t('settings.modelCalls', { count: agentInfo.calls ?? 0 })}
                    </div>
                  </div>
                )}
                {!agentInfo?.name && agentAccount && (
                  <div title={t('settings.accountHint')} style={{ fontSize: 11, color: color.mutedForeground, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {agentAccount}
                  </div>
                )}
                {annotations.length === 0 ? (
                  <div style={{ color: color.mutedForeground, textAlign: 'center', padding: '8px 0' }}>{t('settings.noAnnotations')}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {[
                      { label: t('settings.pending'), count: annotations.filter(a => a.status === 'pending').length, color: '#b45309' },
                      { label: t('settings.sent'), count: annotations.filter(a => a.status === 'sent').length, color: '#2563eb' },
                      { label: t('settings.resolved'), count: annotations.filter(a => a.status === 'resolved').length, color: '#15803d' },
                    ].filter(s => s.count > 0).map(s => (
                      <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: color.mutedForeground }}>{s.label}</span>
                        <span style={{ color: s.color, fontWeight: 600 }}>{s.count}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* DS Tokens */}
                <div style={{ borderTop: `1px solid ${color.border}`, marginTop: 8, paddingTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ color: color.mutedForeground, fontSize: 11, fontWeight: 600 }}>{t('settings.designSystem')}</span>
                    {dsTokensLoaded && (
                      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 6, backgroundColor: 'rgba(21,128,61,0.1)', color: '#15803d' }}>
                        {getDSTokens().length} tokens
                      </span>
                    )}
                  </div>
                  {!dsTokensLoaded ? (
                    <>
                      <textarea
                        value={dsTokensInput}
                        onChange={(e) => setDsTokensInput(e.target.value)}
                        placeholder='Paste tokens.json (W3C format)&#10;&#10;{"color":{"primary":{"$value":"#6366f1"}}}'
                        style={{
                          width: '100%', height: 60, padding: 6,
                          backgroundColor: color.muted, border: `1px solid ${color.border}`,
                          borderRadius: 6, color: color.foreground, fontSize: 10,
                          fontFamily: 'ui-monospace, monospace', resize: 'vertical',
                          outline: 'none', boxSizing: 'border-box',
                        }}
                      />
                      <button
                        onClick={() => handleLoadTokens(dsTokensInput)}
                        disabled={!dsTokensInput.trim()}
                        style={{
                          width: '100%', marginTop: 4, padding: '4px 0',
                          backgroundColor: dsTokensInput.trim() ? 'rgba(255,108,3,0.15)' : color.muted,
                          border: 'none', borderRadius: 6,
                          color: dsTokensInput.trim() ? '#FF6C03' : color.mutedForeground,
                          fontSize: 10, fontWeight: 600, cursor: dsTokensInput.trim() ? 'pointer' : 'default',
                        }}
                      >
                        {t('settings.loadTokens')}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setDSTokens([]);
                        setDsTokensLoaded(false);
                        setDsTokensInput('');
                        localStorage.removeItem(getStorageKey('ilse-ds-tokens'));
                      }}
                      style={{
                        background: 'none', border: 'none', color: color.mutedForeground,
                        fontSize: 10, cursor: 'pointer', padding: 0,
                      }}
                    >
                      {t('settings.removeTokens')}
                    </button>
                  )}
                </div>

                {/* Grid snap */}
                <div style={{ borderTop: `1px solid ${color.border}`, marginTop: 8, paddingTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: color.mutedForeground, fontSize: 11 }}>{t('settings.snapToGrid')}</span>
                    <button
                      onClick={toggleSnap}
                      style={{
                        width: 28, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer',
                        backgroundColor: snapEnabled ? ilse.orange : '#d4d4d4',
                        position: 'relative', transition: 'background-color 0.15s',
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 2, left: snapEnabled ? 14 : 2,
                        width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff',
                        transition: 'left 0.15s',
                      }} />
                    </button>
                  </div>
                  {snapEnabled && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 6 }}>
                      <button
                        onClick={() => updateSnapSize(snapSize - 1)}
                        style={{ background: 'none', border: `1px solid ${color.border}`, borderRadius: 4, color: color.mutedForeground, cursor: 'pointer', width: 20, height: 20, fontSize: 11, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        −
                      </button>
                      <span style={{ color: color.foreground, fontSize: 11, fontWeight: 600, minWidth: 24, textAlign: 'center', fontFamily: 'ui-monospace, monospace' }}>
                        {snapSize}
                      </span>
                      <button
                        onClick={() => updateSnapSize(snapSize + 1)}
                        style={{ background: 'none', border: `1px solid ${color.border}`, borderRadius: 4, color: color.mutedForeground, cursor: 'pointer', width: 20, height: 20, fontSize: 11, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        +
                      </button>
                      <span style={{ color: '#a1a1a1', fontSize: 10 }}>px</span>
                    </div>
                  )}
                </div>

                {/* Connect agent — MCP endpoint + token, ready to paste */}
                {mcpInfo && (
                  <div style={{ borderTop: `1px solid ${color.border}`, marginTop: 8, paddingTop: 8 }}>
                    <button
                      onClick={() => setConnectOpen(v => !v)}
                      style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', color: color.mutedForeground, fontSize: 11, cursor: 'pointer', padding: 0 }}
                    >
                      <span>{t('settings.connectAgent')}</span>
                      <span>{connectOpen ? '−' : '+'}</span>
                    </button>
                    {connectOpen && (() => {
                      const snippet = connectTarget === 'claude-code'
                        ? `claude mcp add --transport http ilse ${mcpInfo.url} --header "Authorization: Bearer ${mcpInfo.token}"`
                        : connectTarget === 'desktop'
                          ? JSON.stringify({ mcpServers: { ilse: { command: 'npx', args: ['-y', '-p', 'ilse-design@latest', 'ilse-mcp'] } } }, null, 2)
                          : JSON.stringify({ mcpServers: { ilse: { url: mcpInfo.url, headers: { Authorization: `Bearer ${mcpInfo.token}` } } } }, null, 2);
                      return (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ display: 'flex', gap: 2, backgroundColor: '#d4d4d4', borderRadius: 6, padding: 2, marginBottom: 6 }}>
                            {([['claude-code', 'Claude Code'], ['desktop', 'Claude Desktop'], ['json', 'Cursor / JSON']] as const).map(([key, label]) => (
                              <button
                                key={key}
                                onClick={() => { setConnectTarget(key); setCopied(false); }}
                                style={{
                                  flex: 1, padding: '3px 4px', border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                  backgroundColor: connectTarget === key ? ilse.orange : 'transparent',
                                  color: connectTarget === key ? '#fff' : color.mutedForeground,
                                }}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <pre style={{
                            margin: 0, padding: 8, borderRadius: 6, backgroundColor: '#0f0f1e', color: '#cbd5e1',
                            fontSize: 10, lineHeight: 1.4, fontFamily: 'ui-monospace, monospace',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflow: 'auto',
                          }}>{snippet}</pre>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8 }}>
                            <span style={{ color: color.mutedForeground, fontSize: 10, lineHeight: 1.3 }}>{t('settings.connectHint')}</span>
                            <button
                              onClick={() => { void navigator.clipboard?.writeText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
                              style={{ flexShrink: 0, padding: '4px 10px', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', backgroundColor: ilse.orange, color: '#fff' }}
                            >
                              {copied ? t('settings.copied') : t('settings.copy')}
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Logs — journal export, for tuning Ilse's experience */}
                {connected && (
                  <div style={{ borderTop: `1px solid ${color.border}`, marginTop: 8, paddingTop: 8 }}>
                    <button
                      onClick={() => { const next = !logsOpen; setLogsOpen(next); if (next) send({ type: 'logs' }); }}
                      style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', color: color.mutedForeground, fontSize: 11, cursor: 'pointer', padding: 0 }}
                    >
                      <span>Logs</span>
                      <span>{logsOpen ? '−' : '+'}</span>
                    </button>
                    {logsOpen && (() => {
                      const summary = (logs?.json as { summary?: { annotations?: number; medianResolveMs?: { all?: number }; tokens?: { costUsd?: number } } } | null)?.summary;
                      const secs = summary?.medianResolveMs?.all;
                      return (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ color: color.mutedForeground, fontSize: 10, marginBottom: 6, lineHeight: 1.4 }}>
                            {summary
                              ? `${summary.annotations ?? 0} ${t('settings.logsAnnotations')} · ${secs !== undefined ? `${(secs / 1000).toFixed(1)}s` : '—'} ${t('settings.logsMedian')} · $${(summary.tokens?.costUsd ?? 0).toFixed(3)}`
                              : t('settings.logsHint')}
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: 2, backgroundColor: '#d4d4d4', borderRadius: 6, padding: 2, flex: 1 }}>
                              {(['markdown', 'json'] as const).map(fmt => (
                                <button
                                  key={fmt}
                                  onClick={() => setLogsFormat(fmt)}
                                  style={{
                                    flex: 1, padding: '3px 4px', border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                    backgroundColor: logsFormat === fmt ? ilse.orange : 'transparent',
                                    color: logsFormat === fmt ? '#fff' : color.mutedForeground,
                                  }}
                                >
                                  {fmt === 'json' ? 'JSON' : 'Markdown'}
                                </button>
                              ))}
                            </div>
                            <button
                              onClick={() => { copyLogsOnArrival.current = logsFormat; send({ type: 'logs' }); }}
                              style={{ flexShrink: 0, padding: '4px 10px', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', backgroundColor: ilse.orange, color: '#fff' }}
                            >
                              {logsCopied ? t('settings.copied') : t('settings.copy')}
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Project memory: what Ilse remembers here, and what the agent reads */}
                <div style={{ borderTop: `1px solid ${color.border}`, marginTop: 8, paddingTop: 8 }}>
                  <button
                    onClick={openMemory}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', color: color.mutedForeground, fontSize: 11, cursor: 'pointer', padding: 0 }}
                  >
                    <span style={{ whiteSpace: 'nowrap' }}>{t('memory.open')}</span>
                    <span aria-hidden>›</span>
                  </button>
                </div>

                {/* Keyboard shortcuts */}
                <div style={{ borderTop: `1px solid ${color.border}`, marginTop: 8, paddingTop: 8 }}>
                  <button
                    onClick={() => setShortcutsOpen(true)}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', color: color.mutedForeground, fontSize: 11, cursor: 'pointer', padding: 0 }}
                  >
                    <span style={{ whiteSpace: 'nowrap' }}>{t('shortcuts.title')}</span>
                    <span aria-hidden>›</span>
                  </button>
                </div>

                {/* Language */}
                <div style={{ borderTop: `1px solid ${color.border}`, marginTop: 8, paddingTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: color.mutedForeground, fontSize: 11 }}>{t('settings.language')}</span>
                    <div style={{ display: 'flex', gap: 2, backgroundColor: '#d4d4d4', borderRadius: 6, padding: 2 }}>
                      {(['pt', 'en'] as Locale[]).map(loc => (
                        <button
                          key={loc}
                          onClick={() => { setLocale(loc); setLangKey(k => k + 1); }}
                          style={{
                            padding: '2px 8px', border: 'none', borderRadius: 4,
                            fontSize: 10, fontWeight: 600, cursor: 'pointer',
                            backgroundColor: getLocale() === loc ? ilse.orange : 'transparent',
                            color: getLocale() === loc ? '#fff' : color.mutedForeground,
                            transition: 'all 0.15s',
                          }}
                        >
                          {loc.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Test mode, hovering Run: the findings on this page's markers, and what is elsewhere */}
            {runListOpen && toolbarMode === 'test' && !scanOpen && (() => {
              const items = annotations
                .map((ann, i) => ({ ann, i }))
                .filter(({ ann }) => ann.status === 'pending' && ann.testFinding);
              const elsewhere = testFindings.length - pageFindings.length;
              const targetOf = (ann: AnnotationDraft) => ann.pixelTargetId ? document.querySelector(`[data-ilse-pixel-target="${ann.pixelTargetId}"]`) : null;
              return (
                <div data-ilse-above=""
                  data-ilse-toolbar
                  className="ilse-hidden-scroll"
                  onMouseEnter={() => holdRunList(true)}
                  onMouseLeave={() => holdRunList(false)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute', bottom: 'calc(100% + 8px)',
                    ...(extendsRight ? { left: 0 } : { right: 0 }),
                    backgroundColor: color.popover, border: `1px solid ${color.border}`, borderRadius: radius.xl,
                    padding: 14, width: 300, boxShadow: shadow.xl, maxHeight: 420, overflowY: 'auto', fontFamily: font.sans,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: color.foreground, marginBottom: 8 }}>
                    {t('toolbar.runFixes')}{items.length > 0 ? ` · ${items.length}` : ''}
                  </div>
                  {items.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '0 -6px' }}>
                      {items.slice(0, 12).map(({ ann, i }) => {
                        const f = testFindings.find(x => x.id === ann.testFinding!.id);
                        const severity = f?.severity ?? 'low';
                        return (
                          <div
                            key={ann.testFinding!.id}
                            title={f?.detail}
                            style={{ display: 'flex', gap: 6, alignItems: 'flex-start', cursor: 'pointer', padding: '5px 6px', borderRadius: radius.md, transition: 'background-color 0.15s' }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLDivElement).style.backgroundColor = color.muted;
                              const r = targetOf(ann)?.getBoundingClientRect();
                              setScanHighlight(r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
                            }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; setScanHighlight(null); }}
                            onClick={() => {
                              // Open its marker's card, where the note can be changed or the test ignored
                              targetOf(ann)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                              setRunListOpen(false); setScanHighlight(null);
                              setActiveMarker(i);
                            }}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 5, backgroundColor: severity === 'high' ? '#ef4444' : severity === 'medium' ? '#f59e0b' : color.mutedForeground }} />
                            <div style={{ flex: 1, minWidth: 0, fontSize: 11, color: color.foreground, lineHeight: 1.35 }}>
                              {f?.title ?? ann.note}
                              {f?.status === 'returned' && (
                                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#ef4444', whiteSpace: 'nowrap' }}>{t('toolbar.testCameBack')}</span>
                              )}
                            </div>
                            <button
                              title={t('toolbar.testDiscard')}
                              aria-label={t('toolbar.testDiscard')}
                              onClick={(e) => { e.stopPropagation(); ignoreFinding(i); setScanHighlight(null); }}
                              style={{ background: 'none', border: 'none', color: color.mutedForeground, cursor: 'pointer', padding: 2, borderRadius: 4, lineHeight: 1, display: 'flex', flexShrink: 0 }}
                            >
                              <IconX size={12} stroke={2} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {items.length === 0 && (
                    <div style={{ fontSize: 11, color: color.mutedForeground, lineHeight: 1.45 }}>{t('toolbar.testNoneHere')}</div>
                  )}
                  {elsewhere > 0 && (
                    <div style={{ fontSize: 11, color: color.mutedForeground, lineHeight: 1.45, marginTop: 8 }}>{t('toolbar.testElsewhere', { count: elsewhere })}</div>
                  )}
                </div>
              );
            })()}

            {/* Agent tester — the CLI walks the app in a real browser; the findings come back here */}
            {scanOpen && (() => {
              const phase = testRun?.phase;
              const working = phase === 'checking' || phase === 'running';
              const elsewhere = testFindings.length - pageFindings.length;
              // While Ilse talks (steps, login questions) her words float over the page, no card
              const speaking = working || phase === 'login-ask' || phase === 'login-open';
              const btn = (primary: boolean): React.CSSProperties => ({
                flex: 1, padding: '7px 10px', borderRadius: radius.md, fontSize: 12, fontWeight: 600, fontFamily: font.sans, cursor: 'pointer',
                border: primary ? 'none' : `1px solid ${color.border}`,
                background: primary ? accent.hex : 'none', color: primary ? '#fff' : color.foreground,
              });
              const text = (body: string, tone: 'muted' | 'error' = 'muted') => (
                <div style={{ fontSize: 11, color: tone === 'error' ? '#ef4444' : color.mutedForeground, lineHeight: 1.45, marginBottom: 10 }}>{body}</div>
              );
              return (
              <div data-ilse-above=""
                data-ilse-toolbar
                className="ilse-hidden-scroll"
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute', bottom: 'calc(100% + 8px)',
                  ...(extendsRight ? { left: 0 } : { right: 0 }),
                  ...(speaking
                    ? { padding: '0 4px', width: 340 }
                    : { backgroundColor: color.popover, border: `1px solid ${color.border}`, borderRadius: radius.xl, padding: 14, width: 300, boxShadow: shadow.xl }),
                  // The setup list is the tallest: room for every toggle and the button, short of the page's top
                  maxHeight: phase === 'setup' ? 'min(600px, calc(100vh - 100px))' : 420, overflowY: 'auto',
                  fontFamily: font.sans,
                }}
              >
                {!speaking && <div style={{ fontSize: 12, fontWeight: 600, color: color.foreground, marginBottom: phase === 'setup' ? 12 : 8 }}>{t(phase === 'setup' ? 'test.setupTitle' : 'toolbar.scan')}</div>}

                {/* Before the run: what to test and on which screens */}
                {phase === 'setup' && (
                  <TestSetup
                    offer={testOffer}
                    onRun={(groups, sizes) => {
                      setTestSteps([]); setTestRun({ phase: 'checking' }); setScanOpen(false);
                      testAction('run', { groups, sizes });
                    }}
                  />
                )}

                {/* Running: Ilse's thinking stack — the newest step bold with the pulsing square, older ones fading */}
                {working && (
                  <div>
                    {/* The lines carry their own blend, so the words box doesn't add one */}
                    <SpeechBubble mode="test" state="working" mascotSize={34} textStyle={{ color: undefined, mixBlendMode: 'normal', opacity: 1 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {testSteps.slice(-3).map((step, i, shown) => {
                          const fromBottom = shown.length - 1 - i;
                          return (
                            <div key={`${testSteps.length - fromBottom}-${step}`} style={{ fontSize: 12, ...reasoningLine(fromBottom) }}>
                              {fromBottom === 0 && <ReasoningDot mode="test" />}
                              {step}
                            </div>
                          );
                        })}
                      </div>
                    </SpeechBubble>
                  </div>
                )}

                {phase === 'login-ask' && (
                  <SpeechBubble mode="test" mascotSize={46} actions={<>
                    <button style={speechButton('test', true)} onClick={() => testAction('login')}>{t('toolbar.testLoginYes')}</button>
                    <button style={speechButton('test', false)} onClick={() => { setTestRun({ phase: 'running' }); testAction('run-anon'); }}>{t('toolbar.testLoginNo')}</button>
                  </>}>
                    {testRun?.expired ? t('toolbar.testLoginExpired') : t('toolbar.testLoginAsk')}
                  </SpeechBubble>
                )}

                {phase === 'login-open' && (
                  <SpeechBubble mode="test" mascotSize={46} actions={<>
                    <button style={speechButton('test', true)} onClick={() => testAction('login-done')}>{t('toolbar.testLoginDone')}</button>
                    <button style={speechButton('test', false)} onClick={() => testAction('login-cancel')}>{t('toolbar.testLoginCancel')}</button>
                  </>}>
                    {t('toolbar.testLoginOpen')}
                  </SpeechBubble>
                )}

                {/* The run failed: why, and try again (findings live on the markers, listed under Run) */}
                {phase === 'error' && (
                  <>
                    {text(testRun?.error ?? '', 'error')}
                    <button
                      style={{ ...btn(true), width: '100%' }}
                      onClick={() => { setTestSteps([]); setTestRun({ phase: 'checking' }); testAction('run'); setScanOpen(false); }}
                    >
                      {t('toolbar.testRunAgain')}
                    </button>
                  </>
                )}
              </div>
              );
            })()}

            {/* The test report (Pro): above the toolbar, or docked on the side while the dev browses */}
            {reportOpen && toolbarMode === 'test' && (
              <TestReport
                findings={testFindings}
                run={testRunMeta}
                focusId={reportFocus}
                ignoredNow={ignoredNow}
                testing={testing}
                fixing={(id) => annotations.some(a => a.testFinding?.id === id && a.status === 'sent')}
                onFocus={setReportFocus}
                onGoTo={(f) => {
                  // Another page: the report reopens there, on this finding
                  try { sessionStorage.setItem(REPORT_FOCUS_KEY, JSON.stringify({ id: f.id })); } catch { /* the report just won't reopen */ }
                  location.href = f.page;
                }}
                onFix={(f) => fixFindings([f])}
                onFixAll={fixFindings}
                onRunAgain={openTestSetup}
                onSkip={skipFinding}
                onIgnoreAlways={(f) => {
                  dropFindingMarker(f.id);
                  decideTestFinding(f, 'discarded');
                  if (reportFocus === f.id) setReportFocus(null);
                }}
                onIgnoreAll={(list) => {
                  for (const f of list) { dropFindingMarker(f.id); decideTestFinding(f, 'discarded'); }
                  setReportFocus(null);
                }}
                onShowIgnored={() => {
                  for (const id of ignoredNow) clearedFindings.current.delete(id);
                  setIgnoredNow(new Set());
                  setFindingRetry(0);
                }}
                onClose={() => { setReportOpen(false); setReportFocus(null); }}
                tab={reportTab}
                onTab={setReportTab}
                journeys={proJourneys ? journeys : []}
                journeyId={reportJourney}
                journeyReport={journeyReport}
                journeyRunning={!!journeyLive && !journeyLive.done}
                onJourney={(id) => { setReportJourney(id); if (!id) setJourneyReport(null); }}
                onRunJourney={(id) => { setJourneyError(null); setJourneyLive(null); journeyAction({ action: 'run', id }); }}
                onFixJourney={(report, i) => { const f = journeyFinding(report, report.runs[i]); if (f) fixFindings([f]); }}
              />
            )}

            {/* Journeys (Pro) — what a person does in the app, recorded once, replayed with no AI */}
            {journeysOpen && toolbarMode === 'test' && (
              <JourneysPanel
                journeys={journeys}
                recording={journeyRecording}
                live={journeyLive}
                error={journeyError}
                extendsRight={extendsRight}
                // Starts on the page the dev is looking at
                suggestions={journeySuggestions}
                suggesting={journeySuggesting}
                onAdd={(goal, start) => {
                  setJourneyError(null); setJourneyLive(null);
                  setJourneySuggestions(prev => prev ? prev.filter(x => x.goal !== goal) : prev);
                  journeyAction({ action: 'add', goal, start: start ?? location.pathname + location.search });
                }}
                onSuggest={() => { setJourneyError(null); setJourneySuggestions(null); setJourneySuggesting(true); journeyAction({ action: 'suggest' }); }}
                onShare={(id, on) => journeyAction({ action: 'share', id, on })}
                onReport={openJourneyReport}
                onRun={(id) => { setJourneyError(null); setJourneyLive(null); journeyAction({ action: 'run', id }); }}
                onRemove={(id) => journeyAction({ action: 'remove', id })}
                onConfirm={(ok) => { journeyAction({ action: 'confirm', ok }); setJourneyLive(prev => prev ? { ...prev, confirm: undefined } : prev); }}
                onFocus={() => journeyAction({ action: 'focus' })}
                onClose={() => setJourneysOpen(false)}
              />
            )}

            {/* Chat panel — blocks interaction behind it */}
            {chatOpen && (
              <>
                {/* Invisible overlay to block mouse behind chat */}
                <div
                  data-ilse-toolbar
                  style={{
                    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
                    zIndex: -1,
                  }}
                  onClick={() => setChatOpen(false)}
                />
                <div data-ilse-above=""
                  data-ilse-toolbar
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 12px)',
                    ...(extendsRight ? { left: 0 } : { right: 0 }),
                    width: 320,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {/* Messages */}
                  <div
                    ref={chatScrollRef}
                    className="ilse-hidden-scroll"
                    style={{
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      maxHeight: 220,
                      alignItems: 'flex-end',
                    }}
                  >
                    {chatHistory.length === 0 && (
                      <div style={{
                        fontSize: 11, color: '#BABABA', mixBlendMode: 'luminosity',
                        padding: '4px 0',
                        fontFamily: font.sans,
                      }}>
                        Peça qualquer coisa sem selecionar
                      </div>
                    )}
                    {chatHistory.map((m, i) => (
                      <div
                        key={i}
                        style={{
                          maxWidth: '90%',
                          alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                          animation: i === chatHistory.length - 1 ? 'ilse-thinking-in 0.3s ease-out' : undefined,
                          fontSize: 12,
                          fontFamily: font.sans,
                          fontWeight: m.role === 'user' ? 600 : 500,
                          color: m.role === 'user' ? color.foreground : color.mutedForeground,
                          mixBlendMode: m.role === 'user' ? ('normal' as const) : ('luminosity' as const),
                          lineHeight: 1.4,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          opacity: !m.ts ? 0.5 : 1,
                          ...(m.role === 'user' ? {
                            backgroundColor: ilse.orangePale,
                            padding: '5px 12px',
                            borderRadius: 12,
                          } : {
                            backdropFilter: 'blur(8px)',
                            WebkitBackdropFilter: 'blur(8px)',
                            backgroundColor: 'rgba(128,128,128,0.08)',
                            padding: '5px 10px',
                            borderRadius: 10,
                          }),
                        }}
                      >
                        {m.role === 'agent' && (
                          <span style={{
                            display: 'inline-block', width: 5, height: 5,
                            background: ilse.orange, marginRight: 6, verticalAlign: 'middle',
                            animation: !m.ts ? 'ilse-thinking-dot 1.2s ease-in-out infinite' : undefined,
                          }} />
                        )}
                        {m.text}
                      </div>
                    ))}
                  </div>

                  {/* Input — white pill like the toolbar */}
                  <div style={{
                    display: 'flex', gap: 6, alignItems: 'center',
                    backgroundColor: '#ffffff',
                    borderRadius: 22, padding: '4px 4px 4px 14px',
                    boxShadow: '0 0 24px rgba(250,105,0,0.18), 0 0 8px rgba(250,105,0,0.1), 0 4px 12px rgba(0,0,0,0.04)',
                  }}>
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
                        if (e.key === 'Escape') { e.preventDefault(); setChatOpen(false); }
                      }}
                      placeholder={t('toolbar.placeholder.chat')}
                      maxLength={500}
                      autoFocus
                      style={{
                        flex: 1, padding: '6px 0',
                        backgroundColor: 'transparent',
                        border: 'none',
                        color: color.foreground,
                        fontSize: 13, fontFamily: font.sans,
                        outline: 'none',
                      }}
                    />
                    <button
                      onClick={sendChatMessage}
                      style={{
                        width: 32, height: 32, borderRadius: '50%',
                        backgroundColor: chatInput.trim() ? color.primary : color.border,
                        border: 'none',
                        cursor: chatInput.trim() ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, transition: 'background-color 0.15s',
                      }}
                    >
                      <IconArrowUp size={15} stroke={2} color="#fff" />
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Thinking stack — chat-like history above the pill.
                Uses #BABABA + mix-blend-mode: luminosity so the text auto-adapts
                to any backdrop (white, cream, dark, image). Figma-tested combo. */}
            <div ref={liftRef} aria-hidden style={{ position: 'absolute', bottom: '100%', width: 0, height: 0 }} />
            {toolbarMode === 'test' && !scanOpen && testStream(`calc(100% + ${feedLift}px)`, 12, 360)}
            {thinkingMessages.length > 0 && !chatOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: `calc(100% + ${feedLift}px)`,
                  transition: 'bottom 0.2s ease',
                  right: 0,
                  display: 'flex',
                  flexDirection: 'column-reverse',
                  alignItems: 'flex-end',
                  gap: 4,
                  pointerEvents: 'none',
                }}
              >
                {thinkingMessages.slice().reverse().map((m, idxFromBottom) => {
                  // Newest at the bottom, bold, with the pulsing square; older lines fade
                  return (
                    <div key={m.id} style={{ fontSize: 12, fontFamily: font.sans, maxWidth: 360, ...reasoningLine(idxFromBottom) }}>
                      {idxFromBottom === 0 && <ReasoningDot mode={toolbarMode} />}
                      {m.text}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pill */}
            <div
              onMouseDown={handleToolbarMouseDown}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                backgroundColor: '#ffffff',
                border: 'none',
                borderRadius: 17, padding: '8px 14px',
                boxShadow: sendFeedback || processingCount > 0
                  ? `0 0 32px rgba(${accent.rgb},0.35), 0 0 12px rgba(${accent.rgb},0.2), 0 4px 12px rgba(0,0,0,0.05)`
                  : `0 0 24px rgba(${accent.rgb},0.18), 0 0 8px rgba(${accent.rgb},0.1), 0 4px 12px rgba(0,0,0,0.04)`,
                cursor: 'grab', userSelect: 'none',
                transition: 'box-shadow 0.3s ease',
                animation: (sendFeedback || processingCount > 0) ? 'ilse-pulse 1s ease-in-out infinite' : undefined,
              }}
            >
              {/* Run / Stop — primary action in the pill */}
              {processingCount > 0 ? (
                <PillBtn accent={accent}
                  title={t('toolbar.stop')}
                  onClick={stopExecution}
                  danger
                >
                  {/* Stop square icon */}
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="3" y="3" width="10" height="10" rx="2" />
                  </svg>
                </PillBtn>
              ) : toolbarMode === 'test' ? (
                // Test mode's own action: run the test. Fixing lives in the report and on each finding's card
                <PillBtn accent={accent}
                  title={t('test.runTest')}
                  active={testing}
                  pulsing={testing}
                  disabled={testing}
                  onClick={() => {
                    if (scanOpen && testRun?.phase === 'setup') { setScanOpen(false); setTestRun(null); return; }
                    openTestSetup();
                  }}
                >
                  <IconEyeglass2 size={18} stroke={1.75} />
                </PillBtn>
              ) : (
                <PillBtn accent={accent}
                  title={t('toolbar.run')}
                  onClick={() => { setRunListOpen(false); setScanHighlight(null); sendAll(); }}
                  disabled={pendingCount === 0}
                  badge={pendingCount > 0 ? pendingCount : undefined}
                >
                  <IconBolt size={18} stroke={1.75} />
                </PillBtn>
              )}

              {/* Undo — restores the files of the last batch, no LLM involved */}
              <PillBtn accent={accent}
                title={`${t('undo.button')} (${isMac ? '⌘Z' : 'Ctrl+Z'})${undo.label ? ` — ${undo.label}` : ''}${undo.redoCount ? `\n${t('redo.hint', { keys: isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z' })}${undo.redoLabel ? ` — ${undo.redoLabel}` : ''}` : ''}`}
                onClick={undoLast}
                disabled={undo.count === 0 || processingCount > 0}
              >
                <IconArrowBackUp size={18} stroke={1.75} />
              </PillBtn>

              {/* Separator */}
              <div style={{ width: 1, height: 18, backgroundColor: '#e0e0e0', margin: '0 6px' }} />

              {toolbarMode === 'design' && (<>
              {/* Annotate / Select toggle */}
              <PillBtn accent={accent}
                title={withShortcut(annotating ? t('toolbar.selectMode') : t('toolbar.annotateMode'), 'V')}
                active={annotating}
                onClick={toggleSelect}
              >
                {annotating ? <IconCrosshair size={18} stroke={1.75} /> : <IconPointer size={18} stroke={1.75} />}
              </PillBtn>

              {/* Pencil — draw on the page; its pen control sits on the button */}
              <span style={{ position: 'relative', display: 'inline-flex' }}>
              <PillBtn accent={accent}
                title={t('toolbar.pencil')}
                active={drawMode}
                onClick={togglePencil}
              >
                <IconPencil size={18} stroke={1.75} />
              </PillBtn>
              {drawMode && !sv && (
                <PencilControl
                  penColor={penColor}
                  strokeCount={strokes.length}
                  onColor={setPenColor}
                  onUndo={() => setSketch(strokesRef.current.slice(0, -1))}
                  onClear={() => setSketch([])}
                  onDone={() => finishSketch(strokesRef.current)}
                  onHover={(over) => { barHovered.current = over; armSketchIdle(); }}
                />
              )}
              </span>

              {/* Catalog — the product's components, from the code */}
              <PillBtn accent={accent}
                title={t('catalog.open')}
                active={catalogActive}
                onClick={toggleCatalog}
              >
                <IconComponents size={18} stroke={1.75} />
              </PillBtn>

              {/* Screens — the page at a phone, tablet or desktop width, with rulers */}
              <span style={{ position: 'relative', display: 'inline-flex' }} onMouseDown={(e) => { if (screensMenuOpen) e.stopPropagation(); }}>
                <PillBtn accent={accent}
                  title={t('screens.open')}
                  active={screensMenuOpen || !!screens}
                  onClick={() => { if (screens) { closeScreens(); return; } setScreensMenuOpen(o => !o); setShowSettings(false); }}
                >
                  <IconDevices size={18} stroke={1.75} />
                </PillBtn>
                {screensMenuOpen && <ScreensMenu align={extendsRight ? 'left' : 'right'} onOpen={openScreens} />}
              </span>

              {/* Pause */}
              <PillBtn accent={accent}
                title={paused ? t('toolbar.resumeAnimations') : t('toolbar.pauseAnimations')}
                active={paused}
                onClick={togglePause}
              >
                {paused ? <IconPlayerPlay size={18} stroke={1.75} /> : <IconPlayerPause size={18} stroke={1.75} />}
              </PillBtn>

              {/* Visibility */}
              <PillBtn accent={accent}
                title={markersVisible ? t('toolbar.hideMarkers') : t('toolbar.showMarkers')}
                active={!markersVisible}
                onClick={() => setMarkersVisible(v => !v)}
              >
                {markersVisible ? <IconEye size={18} stroke={1.75} /> : <IconEyeOff size={18} stroke={1.75} />}
              </PillBtn>

              {/* Chat — experimental, hidden unless localStorage['ilse-experimental'] === '1' */}
              {experimental && (
                <PillBtn accent={accent}
                  title={t('toolbar.chat')}
                  active={chatOpen}
                  onClick={() => {
                    const opening = !chatOpen;
                    setChatOpen(opening);
                    if (opening) { setShowSettings(false); setScanOpen(false); setAnnotating(false); }
                  }}
                >
                  <IconMessage size={18} stroke={1.75} />
                </PillBtn>
              )}

              </>)}

              {/* Test mode: test the app again; the findings land on their markers */}
              {toolbarMode === 'test' && (() => {
                return (<>
                  <PillBtn accent={accent}
                    title={t('report.open')}
                    active={reportOpen}
                    onClick={() => {
                      const opening = !reportOpen;
                      setReportOpen(opening);
                      if (opening) { setShowSettings(false); setJourneysOpen(false); setRunListOpen(false); if (testRun?.phase === 'setup') { setScanOpen(false); setTestRun(null); } send({ type: 'findings' }); }
                      else setReportFocus(null);
                    }}
                  >
                    <IconListDetails size={18} stroke={1.75} />
                  </PillBtn>
                  {proJourneys && (
                    <PillBtn accent={accent}
                      title={t('journeys.open')}
                      active={journeysOpen}
                      pulsing={!!journeyLive && !journeyLive.done}
                      onClick={() => {
                        const opening = !journeysOpen;
                        setJourneysOpen(opening);
                        if (opening) { setShowSettings(false); setScanOpen(false); setRunListOpen(false); if (!reportDocked) setReportOpen(false); journeyAction({ action: 'list' }); }
                      }}
                    >
                      <IconRoute size={18} stroke={1.75} />
                    </PillBtn>
                  )}
                  <PillBtn accent={accent}
                    title={markersVisible ? t('toolbar.hideMarkers') : t('toolbar.showMarkers')}
                    active={!markersVisible}
                    onClick={() => setMarkersVisible(v => !v)}
                  >
                    {markersVisible ? <IconEye size={18} stroke={1.75} /> : <IconEyeOff size={18} stroke={1.75} />}
                  </PillBtn>
                </>);
              })()}

              {/* Separator */}
              <div style={{ width: 1, height: 18, backgroundColor: '#e0e0e0', margin: '0 6px' }} />

              {/* Clear — far from Run, near danger zone */}
              <PillBtn accent={accent}
                title={clearConfirm ? t('toolbar.clearConfirm') : t('toolbar.clearAnnotations')}
                active={clearConfirm}
                danger={clearConfirm}
                onClick={handleClear}
                disabled={noteCount === 0}
              >
                <IconTrash size={18} stroke={1.75} />
              </PillBtn>

              {/* Settings */}
              <PillBtn accent={accent}
                title={t('toolbar.settings')}
                active={showSettings}
                onClick={() => { setShowSettings(v => !v); if (!showSettings) { setChatOpen(false); setScanOpen(false); setJourneysOpen(false); if (!reportDocked) setReportOpen(false); } }}
              >
                <IconSettings size={18} stroke={1.75} />
              </PillBtn>

              {/* Mode switch — at the end, by Close: it changes which actions come before it */}
              <div
                role="radiogroup"
                aria-label={t('toolbar.mode')}
                onMouseDown={(e) => e.stopPropagation()}
                style={{ display: 'inline-flex', background: '#f2f2f2', borderRadius: 10, padding: 2, margin: '0 4px' }}
              >
                {(['design', 'test'] as const).map(mode => {
                  const on = toolbarMode === mode;
                  // Ilse is working: the agent applying notes, or the test running
                  const busy = mode === 'design' ? processingCount > 0 : testRun?.phase === 'checking' || testRun?.phase === 'running';
                  const locked = mode === 'test' && !proTest;
                  return (
                    <button
                      key={mode}
                      role="radio"
                      aria-checked={on}
                      aria-disabled={locked || undefined}
                      title={t(locked ? 'toolbar.testLocked' : mode === 'design' ? 'toolbar.modeDesignHint' : 'toolbar.modeTestHint')}
                      aria-label={t(locked ? 'toolbar.testLocked' : mode === 'design' ? 'toolbar.modeDesignHint' : 'toolbar.modeTestHint')}
                      onClick={() => {
                        if (on) return;
                        if (locked) { setProPitch(true); return; }
                        if (screens) closeScreens();
                        setToolbarMode(mode);
                        setShowSettings(false); setChatOpen(false); setActiveMarker(null); setRunListOpen(false);
                        if (mode === 'test') {
                          // Nothing to point at while testing: leave capture and drawing; the findings come as markers
                          if (drawMode) exitDrawMode();
                          if (pendingCaptureRef.current) cancelCapture();
                          setAnnotating(false);
                          send({ type: 'findings' });
                        } else {
                          setScanOpen(false); setScanHighlight(null); setJourneysOpen(false); setReportOpen(false);
                        }
                      }}
                      style={{
                        border: 'none', cursor: 'pointer', borderRadius: 8, padding: '3px 5px', lineHeight: 0,
                        opacity: locked ? 0.55 : 1,
                        background: on ? '#ffffff' : 'transparent',
                        boxShadow: on ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
                        transition: 'background 0.15s, color 0.15s',
                      }}
                    >
                      <IlseMascot
                        mode={mode} muted={!on} size={21}
                        state={on ? (busy ? 'working' : celebrating === mode ? 'done' : 'idle') : 'asleep'}
                        grow={on && (busy || celebrating === mode)}
                        activity={agentActivity}
                        focus={mode === 'design' ? annotations.find(a => a.status === 'sent' && a.capture.element)?.capture.element : undefined}
                      />
                    </button>
                  );
                })}
              </div>

              {/* Close */}
              <PillBtn accent={accent} title={withShortcut(t('toolbar.close'), 'Esc')} onClick={closeToolbar}>
                <IconX size={18} stroke={1.75} />
              </PillBtn>
            </div>

          </div>
          );
        })()}

        {screens && !EMBEDDED && (
          <ScreensView initialDevice={screens.device} initialRulers={screens.rulers}
            onState={setEmbedState} actRef={screensActRef} onClose={closeScreens} />
        )}

        {/* Ilse-styled tooltips for every titled control in Ilse's UI */}
        <TooltipLayer />

        {/* ── Toast — Sonner-like, in the toolbar's own look, just above the toolbar ── */}
        {memoryOpen && (
          <MemoryPanel
            data={memoryData}
            onClose={() => setMemoryOpen(false)}
            onUndoDecision={(id) => send({ type: 'memory_undo_decision', id })}
            onForgetTest={() => send({ type: 'memory_forget_test' })}
            onOpenPage={(page) => { setMemoryOpen(false); if (page !== location.pathname) location.assign(page); }}
          />
        )}

        {shortcutsOpen && (
          <div
            data-ilse-toolbar
            role="dialog"
            aria-modal="true"
            aria-label={t('shortcuts.title')}
            onMouseDown={(e) => { if (e.target === e.currentTarget) setShortcutsOpen(false); }}
            style={{
              position: 'fixed', inset: 0, zIndex: 100001, backgroundColor: 'rgba(0,0,0,0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
              fontFamily: font.sans,
            }}
          >
            <div data-ilse-toolbar style={{
              width: 'min(420px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
              backgroundColor: color.background, color: color.foreground, borderRadius: radius.xl,
              border: `1px solid ${color.border}`, boxShadow: shadow.lg, padding: '18px 20px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t('shortcuts.title')}</span>
                <button
                  onClick={() => setShortcutsOpen(false)}
                  title={withShortcut(t('toolbar.close'), 'Esc')}
                  aria-label={t('toolbar.close')}
                  style={{ width: 24, height: 24, border: 'none', borderRadius: radius.sm, background: 'none', cursor: 'pointer', color: color.mutedForeground, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <IconX size={14} stroke={1.75} />
                </button>
              </div>
              {SHORTCUT_GROUPS.map((group, gi) => {
                const open = shortcutGroupsOpen.has(group.title);
                return (
                <div key={group.title} style={{ marginTop: gi === 0 ? 4 : 0, borderTop: gi === 0 ? 'none' : `1px solid ${color.border}` }}>
                  <button
                    onClick={() => setShortcutGroupsOpen(prev => {
                      const next = new Set(prev);
                      if (next.has(group.title)) next.delete(group.title); else next.add(group.title);
                      return next;
                    })}
                    aria-expanded={open}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: 'none', border: 'none', cursor: 'pointer', padding: '14px 0',
                      fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: color.mutedForeground,
                      fontFamily: font.sans,
                    }}
                  >
                    <span>{t(group.title)} <span style={{ fontWeight: 400, letterSpacing: 0 }}>· {group.items.length}</span></span>
                    <IconChevronRight size={12} stroke={2} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                  </button>
                  {open && <div style={{ paddingBottom: 12 }}>{group.items.map(item => (
                    <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 12 }}>
                      <span>{t(item.label)}</span>
                      <kbd style={{
                        flexShrink: 0, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 11,
                        padding: '2px 6px', borderRadius: 5, border: `1px solid ${color.border}`,
                        backgroundColor: color.muted, color: color.foreground, whiteSpace: 'nowrap',
                      }}>
                        {mod(item.keys)}
                      </kbd>
                    </div>
                  ))}</div>}
                </div>
                );
              })}
            </div>
          </div>
        )}

        {pageError && !offPage && !clipboardToast && (() => {
          const above = isOpen && toolbarPos.y > 90;
          const growsRight = toolbarPos.x < 250;
          const edge = above
            ? (growsRight ? { left: Math.max(12, toolbarPos.x) } : { right: Math.max(12, window.innerWidth - (toolbarPos.x + PILL_W)) })
            : { left: window.innerWidth / 2 };
          const first = pageError.errors[0];
          const shown = first.length > 220 ? first.slice(0, 219) + '…' : first;
          const more = pageError.errors.length > 1 ? ' ' + t('toolbar.pageError.more', { count: pageError.errors.length - 1 }) : '';
          const askFix = () => {
            const list = pageError.errors.slice(0, 3).map(e => `- ${e.slice(0, 600)}`).join('\n');
            send({
              type: 'annotate',
              note: `Depois da última mudança (${pageError.files.join(', ')}), a página mostrou ${pageError.errors.length > 1 ? 'estes erros' : 'este erro'} no console do navegador:\n${list}\nCorrija a causa no código que essa mudança tocou, mantendo o que ela pediu. Não esconda o erro (sem try/catch vazio, sem silenciar o console).`,
              element: '', styles: {}, intent: 'fix', severity: 'important',
              environment: captureEnvironment(),
            });
            setPageError(null);
          };
          return (
            <div data-ilse-above=""
              data-ilse-toolbar
              role="alert"
              style={{
                position: 'fixed', zIndex: 100000, ...edge,
                ...(above ? { top: toolbarPos.y - 12, transform: 'translateY(-100%)' } : { bottom: 80, transform: 'translateX(-50%)' }),
                maxWidth: 420,
              }}
            >
              <SpeechBubble mode={toolbarMode} reaction="say" mascotSize={24} textStyle={STALE_TEXT} actions={<>
                <button style={speechButton(toolbarMode, true)} onClick={askFix}>{t('toolbar.pageError.fix')}</button>
                <button style={speechButton(toolbarMode, false)} onClick={() => { send({ type: 'undo', changeSetId: pageError.changeSetId }); setPageError(null); }}>{t('toolbar.pageError.undo')}</button>
                <button style={speechButton(toolbarMode, false)} onClick={() => setPageError(null)}>{t('toolbar.pageError.later')}</button>
              </>}>
                {t('toolbar.pageError.text', { files: pageError.files.join(', ') || '—', error: shown }) + more}
              </SpeechBubble>
            </div>
          );
        })()}

        {stalePage && !pageError && !offPage && !clipboardToast && (() => {
          const above = isOpen && toolbarPos.y > 90;
          const growsRight = toolbarPos.x < 250;
          const edge = above
            ? (growsRight ? { left: Math.max(12, toolbarPos.x) } : { right: Math.max(12, window.innerWidth - (toolbarPos.x + PILL_W)) })
            : { left: window.innerWidth / 2 };
          return (
            <div data-ilse-above=""
              data-ilse-toolbar
              role="alert"
              style={{
                position: 'fixed', zIndex: 100000, ...edge,
                ...(above ? { top: toolbarPos.y - 12, transform: 'translateY(-100%)' } : { bottom: 80, transform: 'translateX(-50%)' }),
                maxWidth: 380,
              }}
            >
              <SpeechBubble mode={toolbarMode} reaction="say" mascotSize={24} textStyle={STALE_TEXT} actions={<>
                <button style={speechButton(toolbarMode, true)} onClick={() => window.location.reload()}>{t('toolbar.stale.reload')}</button>
                <button style={speechButton(toolbarMode, false)} onClick={() => setStalePage(null)}>{t('toolbar.stale.later')}</button>
              </>}>
                {t('toolbar.stale.text', { files: stalePage.join(', ') || '—' })}
              </SpeechBubble>
            </div>
          );
        })()}

        {proPitch && !offPage && !clipboardToast && (() => {
          const above = isOpen && toolbarPos.y > 90;
          const growsRight = toolbarPos.x < 250;
          const edge = above
            ? (growsRight ? { left: Math.max(12, toolbarPos.x) } : { right: Math.max(12, window.innerWidth - (toolbarPos.x + PILL_W)) })
            : { left: window.innerWidth / 2 };
          return (
            <div data-ilse-above=""
              data-ilse-toolbar
              role="dialog"
              aria-label={t('toolbar.proPitch.title')}
              style={{
                position: 'fixed', zIndex: 100000, ...edge,
                ...(above ? { top: toolbarPos.y - 12, transform: 'translateY(-100%)' } : { bottom: 80, transform: 'translateX(-50%)' }),
                maxWidth: 380,
              }}
            >
              <SpeechBubble mode="test" reaction="say" mascotSize={24} actions={<>
                <button style={speechButton('test', true)} onClick={() => { window.open('https://ilse.design/#pro', '_blank', 'noopener'); setProPitch(false); }}>{t('toolbar.proPitch.cta')}</button>
                <button style={speechButton('test', false)} onClick={() => setProPitch(false)}>{t('toolbar.proPitch.later')}</button>
              </>}>
                <strong style={{ display: 'block', fontWeight: 600 }}>{t('toolbar.proPitch.title')}</strong>
                {t('toolbar.proPitch.text')}
              </SpeechBubble>
            </div>
          );
        })()}

        {offPage && !clipboardToast && (() => {
          const above = isOpen && toolbarPos.y > 90;
          const growsRight = toolbarPos.x < 250;
          const edge = above
            ? (growsRight ? { left: Math.max(12, toolbarPos.x) } : { right: Math.max(12, window.innerWidth - (toolbarPos.x + PILL_W)) })
            : { left: window.innerWidth / 2 };
          const files = offPage.files.map(f => f.split('/').pop()).join(', ');
          return (
            <div data-ilse-above=""
              data-ilse-toolbar
              role="alert"
              style={{
                position: 'fixed', zIndex: 100000, ...edge,
                ...(above ? { top: toolbarPos.y - 12, transform: 'translateY(-100%)' } : { bottom: 80, transform: 'translateX(-50%)' }),
                maxWidth: 380,
              }}
            >
              <SpeechBubble mode={toolbarMode} reaction="oops" mascotSize={24} actions={<>
                <button style={speechButton(toolbarMode, true)} onClick={() => { send({ type: 'redo-here', changeSetId: offPage.changeSetId }); setOffPage(null); }}>{t('toolbar.offPage.redoHere')}</button>
                <button style={speechButton(toolbarMode, false)} onClick={() => { send({ type: 'undo', changeSetId: offPage.changeSetId }); setOffPage(null); }}>{t('toolbar.offPage.undo')}</button>
                <button style={speechButton(toolbarMode, false)} onClick={() => setOffPage(null)}>{t('toolbar.offPage.keep')}</button>
              </>}>
                {t('toolbar.offPage.text', { files })}
                {offPage.routes.length > 0 && ` ${t('toolbar.offPage.usedIn', { routes: offPage.routes.join(', ') })}`}
              </SpeechBubble>
            </div>
          );
        })()}

        {checkFailed && !offPage && !clipboardToast && (() => {
          const above = isOpen && toolbarPos.y > 90;
          const growsRight = toolbarPos.x < 250;
          const edge = above
            ? (growsRight ? { left: Math.max(12, toolbarPos.x) } : { right: Math.max(12, window.innerWidth - (toolbarPos.x + PILL_W)) })
            : { left: window.innerWidth / 2 };
          return (
            <div data-ilse-above=""
              data-ilse-toolbar
              role="alert"
              style={{
                position: 'fixed', zIndex: 100000, ...edge,
                ...(above ? { top: toolbarPos.y - 12, transform: 'translateY(-100%)' } : { bottom: 80, transform: 'translateX(-50%)' }),
                maxWidth: 380,
              }}
            >
              <SpeechBubble mode={toolbarMode} reaction="oops" mascotSize={24} actions={<>
                <button style={speechButton(toolbarMode, true)} onClick={() => { send({ type: 'undo', changeSetId: checkFailed.changeSetId }); setCheckFailed(null); }}>{t('toolbar.offPage.undo')}</button>
                <button style={speechButton(toolbarMode, false)} onClick={() => setCheckFailed(null)}>{t('toolbar.checkFailed.keep')}</button>
              </>}>
                {t('toolbar.checkFailed.text', { count: String(checkFailed.count), first: checkFailed.problems[0] ?? '' })}
              </SpeechBubble>
            </div>
          );
        })()}

        {clipboardToast && (() => {
          // Above the toolbar, aligned with the edge it grows from (it opens left or
          // right of the pill); centred at the bottom when the toolbar is closed
          const above = isOpen && toolbarPos.y > 90;
          const growsRight = toolbarPos.x < 250;
          const edge = above
            ? (growsRight ? { left: Math.max(12, toolbarPos.x) } : { right: Math.max(12, window.innerWidth - (toolbarPos.x + PILL_W)) })
            : { left: window.innerWidth / 2 };
          return (
            <div data-ilse-above=""
              data-ilse-toolbar
              role="status"
              aria-live="polite"
              style={{
                position: 'fixed', zIndex: 100000, ...edge,
                ...(above ? { top: toolbarPos.y - 12, transform: 'translateY(-100%)' } : { bottom: 80, transform: 'translateX(-50%)' }),
                maxWidth: 380,
                animation: 'ilse-toast-in 180ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <style>{'@keyframes ilse-toast-in{from{opacity:0;margin-top:6px}to{opacity:1;margin-top:0}}'}</style>
              <SpeechBubble mode={toolbarMode} reaction={clipboardToast.reaction} mascotSize={24} textStyle={{ fontWeight: 500 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clipboardToast.text}</span>
              </SpeechBubble>
            </div>
          );
        })()}
      </div>
    </>
  );
}

// ─── PillBtn helper ───────────────────────────────────────────────────────────

// ─── Pixel pill button (closed state) ────────────────────────────────────────

const PILL_COLORS = ['#FFFFFF', '#F6F6F6', '#FFECDE', '#FFC194', '#FF6C03', '#D9D9D9'];

// Seeded pseudo-random for deterministic grid
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Opacity per color index — lighter colors are more transparent
const COLOR_OPACITY = [0.22, 0.25, 0.35, 0.55, 1.0, 0.20]; // #FFF, #F6F6, #FFECDE, #FFC194, #FF6C03, #D9D9

function generatePixelGrid(cols: number, rows: number) {
  const rand = seededRandom(42);
  const grid: Array<{ x: number; y: number; color: string; size: number; delay: number; duration: number; brightness: number; glow: boolean }> = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const distFromCenter = Math.sqrt(
        Math.pow((x - cols / 2) / (cols / 2), 2) +
        Math.pow((y - rows / 2) / (rows / 2), 2)
      );

      // Radial soft edge — outer pixels excluded progressively (organic shape)
      const r0 = rand();
      if (distFromCenter > 1.0) continue;
      if (distFromCenter > 0.85 && r0 < 0.55) continue;
      if (distFromCenter > 0.70 && r0 < 0.20) continue;
      // Small random holes in the dense core (~10%)
      if (distFromCenter < 0.70 && r0 < 0.10) continue;

      // More orange in center, lighter at edges
      const r = rand();
      let colorIdx: number;
      if (distFromCenter < 0.5) {
        colorIdx = r < 0.5 ? 4 : r < 0.75 ? 3 : r < 0.9 ? 2 : 0;
      } else {
        colorIdx = r < 0.25 ? 4 : r < 0.5 ? 3 : r < 0.7 ? 2 : r < 0.85 ? 0 : 1;
      }
      const isOrange = colorIdx === 4;

      // Radial brightness falloff — edges fade out smoothly
      const radialFade = Math.max(0.3, 1 - distFromCenter * 0.5);
      const baseBrightness = COLOR_OPACITY[colorIdx] ?? 0.3;

      grid.push({
        x, y,
        color: PILL_COLORS[colorIdx],
        size: 2 + Math.floor(rand() * 3),
        delay: rand() * 5,
        duration: 1.8 + rand() * 3,
        brightness: baseBrightness * radialFade,
        glow: isOrange,
      });
    }
  }
  return grid;
}

const PILL_W = 52;
const PILL_H = 44;
const CELL = 4;
const PIXEL_DATA = generatePixelGrid(Math.floor(PILL_W / CELL), Math.floor(PILL_H / CELL));


// Test mode's avatar: the same field, in blue tints, with round pixels
const TEST_COLORS: Record<string, string> = { '#FFECDE': ilse.testPale, '#FFC194': ilse.testLight, '#FF6C03': ilse.test };

function IlsePixelButton({ onClick, badge, processing, mode = 'design' }: { onClick: () => void; badge?: number; processing?: boolean; mode?: 'design' | 'test' }) {
  const test = mode === 'test';
  const acc = modeAccent(mode);
  return (
    <button
      onClick={onClick}
      style={{
        width: PILL_W, height: PILL_H,
        position: 'relative',
        background: 'none',
        border: 'none',
        cursor: 'grab', userSelect: 'none',
        padding: 0, display: 'block',
      }}
    >
      {/* Pixel field */}
      {PIXEL_DATA.map((p, i) => (
        <div key={i} style={{
          position: 'absolute',
          top: p.y * CELL + (CELL - p.size) / 2,
          left: p.x * CELL + (CELL - p.size) / 2,
          width: p.size,
          height: p.size,
          backgroundColor: test ? (TEST_COLORS[p.color] ?? p.color) : p.color,
          borderRadius: test ? '50%' : 0,
          opacity: p.brightness,
          animation: `ilse-pixel ${p.duration.toFixed(1)}s ease-in-out ${p.delay.toFixed(1)}s infinite`,
          boxShadow: p.glow ? `0 0 6px rgba(${acc.rgb},0.5), 0 0 12px rgba(${acc.rgb},0.2)` : 'none',
        }} />
      ))}
      {badge !== undefined && (
        <span style={{
          position: 'absolute', top: -4, right: -4,
          backgroundColor: acc.hex, color: 'white',
          fontSize: 9, borderRadius: 7, minWidth: 16, height: 16,
          padding: '0 3px', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
          zIndex: 1,
          animation: processing ? 'ilse-run-pulse 1.2s ease-in-out infinite' : undefined,
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── PillBtn helper ───────────────────────────────────────────────────────────

// ─── PixelOverlay — white flickering pixels during edit ──────────────────────

/**
 * Magical pixel overlay — sparse, organic, non-patterned.
 *
 * Strategy: fixed small number of pixels (25 total) randomly distributed
 * across the element's content rects (text boxes from Range.getClientRects).
 * Uses true Math.random() so there's zero deterministic pattern.
 * Memoized once on mount via useState initializer — doesn't regenerate on re-render.
 *
 * Colors: white, light gray, orange — so pixels are visible on any background.
 * Renders via portal to body so coordinates are document-absolute.
 */
type PixelCell = {
  id: number; // unique id for animation reset when recycled
  top: number;
  left: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
  glow: boolean;
};

type PageRect = { top: number; left: number; width: number; height: number };

// A change applied without AI lands in milliseconds: hold the flicker this long
// first, so the designer sees where it landed before it dissolves.
const MIN_EDIT_FLICKER_MS = 1600;

function PixelOverlay({ targetId, element, selector, fallbackRect, fadeOut }: { targetId?: string; element?: Element; selector: string; fallbackRect: PageRect; fadeOut?: boolean }) {
  const [cells, setCells] = useState<PixelCell[] | null>(null);
  const [visible, setVisible] = useState(true);
  const [dissolving, setDissolving] = useState(false);
  const mountedAt = useRef(Date.now());

  // When fadeOut triggers (after the minimum flicker), start dissolve then unmount
  useEffect(() => {
    if (!fadeOut) return;
    const hold = Math.max(0, MIN_EDIT_FLICKER_MS - (Date.now() - mountedAt.current));
    const dissolve = setTimeout(() => setDissolving(true), hold);
    const unmount = setTimeout(() => setVisible(false), hold + 2000);
    return () => { clearTimeout(dissolve); clearTimeout(unmount); };
  }, [fadeOut]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    // Compute rects once per layout
    const computeRects = (): Array<{ top: number; left: number; width: number; height: number }> => {
      let rects: Array<{ top: number; left: number; width: number; height: number }> = [];
      try {
        // Prefer the unique data-attribute tag (always resolves to the exact
        // clicked element). Fall back to the generated selector if the tag
        // was lost (e.g. element re-rendered after HMR).
        const el = (element?.isConnected ? element : null)
          || (targetId && document.querySelector(`[data-ilse-pixel-target="${targetId}"]`))
          || document.querySelector(selector);
        if (el) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rawRects = Array.from(range.getClientRects()).filter(r => r.width > 2 && r.height > 2);
          if (rawRects.length > 0) {
            rects = rawRects.map(r => ({
              top: r.top + window.scrollY,
              left: r.left + window.scrollX,
              width: r.width,
              height: r.height,
            }));
          } else {
            const bb = el.getBoundingClientRect();
            rects = [{ top: bb.top + window.scrollY, left: bb.left + window.scrollX, width: bb.width, height: bb.height }];
          }
        }
      } catch { /* invalid selector — ignored */ }
      return rects.length > 0 ? rects : [fallbackRect];
    };

    let rects = computeRects();
    let nextId = 0;

    // Make a single new cell at a random position within one of the rects
    const makeCell = (): PixelCell => {
      const weights = rects.map(r => r.width * r.height);
      const totalWeight = weights.reduce((s, w) => s + w, 0);

      const pickRect = () => {
        if (totalWeight === 0) return rects[0];
        const roll = Math.random() * totalWeight;
        let acc = 0;
        for (let i = 0; i < rects.length; i++) {
          acc += weights[i];
          if (roll < acc) return rects[i];
        }
        return rects[rects.length - 1];
      };

      const r = pickRect();
      const size = 3 + Math.floor(Math.random() * 3);
      // Inside the page: a pixel past the right/bottom edge grows the document and
      // flashes a scrollbar (target as wide as the page, e.g. a full-width section)
      const doc = document.documentElement;
      const top = Math.min(r.top + Math.random() * r.height, doc.scrollHeight - size - 1);
      const left = Math.min(r.left + Math.random() * r.width, doc.clientWidth + window.scrollX - size - 1);

      // Color variety: orange (20%), light gray (25%), white (55%)
      const roll = Math.random();
      const color = roll < 0.2 ? '#FF6C03' : roll < 0.45 ? '#D9D9D9' : '#FFFFFF';

      return {
        id: nextId++,
        top,
        left,
        size,
        color,
        delay: Math.random() * 0.8,
        duration: 1.2 + Math.random() * 1.5,
        glow: color === '#FF6C03',
      };
    };

    const generateAll = (): PixelCell[] => {
      const totalArea = rects.reduce((sum, r) => sum + r.width * r.height, 0);
      const count = Math.max(15, Math.min(50, Math.round(Math.sqrt(totalArea) / 8)));
      return Array.from({ length: count }, () => makeCell());
    };

    setCells(generateAll());

    // Recycling: every ~1s, replace ~25% of pixels with new ones at new positions.
    // This gives the "walking" effect — particles appear and disappear across the area.
    const recycleInterval = setInterval(() => {
      setCells(current => {
        if (!current || current.length === 0) return current;
        const toReplace = Math.max(1, Math.floor(current.length * 0.25));
        const next = [...current];
        for (let i = 0; i < toReplace; i++) {
          const idx = Math.floor(Math.random() * next.length);
          next[idx] = makeCell();
        }
        return next;
      });
    }, 1000);

    // Regenerate on resize
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        rects = computeRects();
        setCells(generateAll());
      }, 200);
    };
    window.addEventListener('resize', onResize);

    return () => {
      clearInterval(recycleInterval);
      window.removeEventListener('resize', onResize);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [targetId, element, selector, fallbackRect]);

  if (!cells || cells.length === 0 || typeof document === 'undefined') return null;
  if (!visible) return null;

  return createPortal(
    <div
      data-ilse-pixel-overlay
      style={{
        // No dissolve on the layer itself: scaling it from the page's corner pushed the
        // pixels near the right edge past the page and flashed a horizontal scrollbar.
        // Each pixel dissolves on its own (below).
        position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 99995,
      }}
    >
      {cells.map((c) => (
        <div
          key={c.id}
          style={{
            position: 'absolute',
            top: c.top,
            left: c.left,
            width: c.size,
            height: c.size,
            backgroundColor: c.color,
            animation: dissolving
              ? `ilse-pixel-flicker ${c.duration.toFixed(2)}s ease-in-out ${c.delay.toFixed(2)}s infinite, ilse-pixel-dissolve ${(1 + Math.random() * 1.5).toFixed(2)}s ease-out forwards`
              : `ilse-pixel-flicker ${c.duration.toFixed(2)}s ease-in-out ${c.delay.toFixed(2)}s infinite`,
            boxShadow: c.glow ? '0 0 6px rgba(255,108,3,0.7), 0 0 2px rgba(255,108,3,0.9)' : undefined,
          }}
        />
      ))}
    </div>,
    document.body
  );
}
