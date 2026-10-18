import type { Annotation, AnnotationIntent } from '../types.js';
import { testsCovering } from '../context/covering-tests.js';
import { t } from '../i18n/index.js';
import { historyFor, formatHistory } from '../git/ledger.js';
import { componentCard, type ComponentCard } from '../context/locate.js';
import { findDesignMd } from '../setup/design-md.js';

export interface AugmentedAnnotation {
  note: string;
  element: string;
  component?: string;
  grepPattern?: string;
  componentStack?: string[];
  parent?: string;
  relevantStyles: Record<string, string>;
  imageRef?: string;
  imageRefs?: string[];
  environment?: Annotation['environment'];
  timestamp: string;
  context: string;  // markdown-formatted summary for the agent
}

// ── Annotation intent inference (what the designer wants the agent to do) ────

/**
 * Infers AnnotationIntent from note text and gesture context.
 * ask / approve are intentionally excluded — they require Thread UI (roadmap Phase 2).
 */
export function inferAnnotationIntent(
  note: string,
  hasElement: boolean,
  isDragging: boolean,
): AnnotationIntent {
  if (isDragging) return 'move';
  const lower = note.toLowerCase();
  const creationVerbs = /\b(cria|crie|adiciona|adicione|coloca|coloque|insert|add|create|new|novo|nova)\b/;
  if (!hasElement && creationVerbs.test(lower)) return 'create';
  const changeVerbs = /\b(e se|muda|troca|altera|tenta|experimenta|change|try|what if|talvez|seria|poderia)\b/;
  if (changeVerbs.test(lower)) return 'change';
  return 'fix';
}

// ── Intent detection from user note (style category) ─────────────────────────

type Intent = 'layout' | 'color' | 'spacing' | 'typography' | 'general';

const INTENT_KEYWORDS: Partial<Record<Intent, string[]>> = {
  layout: ['alinhar', 'alinhamento', 'linha', 'coluna', 'flex', 'grid', 'lado', 'posição', 'posicao', 'torto', 'desalinhado', 'centraliz', 'center', 'wrap', 'overflow', 'responsiv', 'direction', 'row', 'column', 'align', 'justify'],
  color: ['cor', 'color', 'fundo', 'background', 'bg', 'escur', 'clar', 'contrast', 'branco', 'preto', 'laranja', 'azul', 'vermelho', 'verde', 'tema', 'theme', 'dark', 'light'],
  spacing: ['espaç', 'spac', 'padding', 'margin', 'gap', 'distância', 'distancia', 'perto', 'longe', 'apert', 'folga', 'respir'],
  typography: ['font', 'texto', 'tamanho', 'size', 'bold', 'peso', 'weight', 'itálic', 'italic', 'line-height', 'letter', 'maiúscul', 'minúscul', 'uppercase', 'truncat'],
};

function detectIntent(note: string): Intent[] {
  if (!note) return ['general'];
  const lower = note.toLowerCase();
  const intents: Intent[] = [];
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      intents.push(intent as Intent);
    }
  }
  return intents.length > 0 ? intents : ['general'];
}

// ── Style filtering by intent ───────────────────────────────────────────────

const STYLE_GROUPS: Record<Intent, string[]> = {
  layout: ['display', 'flexDirection', 'alignItems', 'justifyContent', 'gap', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'maxWidth', 'minWidth', 'overflow', 'zIndex'],
  color: ['color', 'backgroundColor', 'borderColor', 'opacity'],
  spacing: ['padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap'],
  typography: ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color'],
  general: ['display', 'flexDirection', 'alignItems', 'justifyContent', 'gap', 'padding', 'margin', 'width', 'height', 'color', 'backgroundColor', 'fontSize', 'fontWeight', 'borderRadius'],
};

function filterStyles(styles: Record<string, string>, intents: Intent[]): Record<string, string> {
  const allowedKeys = new Set<string>();
  for (const intent of intents) {
    for (const key of STYLE_GROUPS[intent]) {
      allowedKeys.add(key);
    }
  }
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(styles)) {
    if (allowedKeys.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

// ── Context builder (Standard format) ───────────────────────────────────────

/** `ilse · annotation a1f3 · Button · src/components/Button.tsx` */
export function historyRef(annotation: Annotation): string | undefined {
  if (!annotation.id) return undefined;
  const parts = ['ilse', `annotation ${annotation.id}`];
  const owner = annotation.source?.[0]?.owner ?? annotation.component;
  if (owner) parts.push(owner);
  if (annotation.source?.[0]) parts.push(annotation.source[0].file);
  return parts.join(' · ');
}

/**
 * Located source, when the CLI found it. Only the best hit carries code — the
 * rest are one-liners, so a wrong guess costs a few tokens, not a file.
 */
function formatSource(annotation: Annotation): string | undefined {
  const hits = annotation.source;
  if (!hits?.length) return undefined;
  const [best, ...rest] = hits;
  const ext = best.file.split('.').pop() ?? 'tsx';
  const where = (h: typeof best) =>
    `\`${h.file}:${h.line}\`${h.owner ? ` in ${h.owner}` : ''} — ${h.kind === 'usage' ? 'usage site' : 'element'}, matched ${h.reasons.join(', ')}`;
  const lines = [
    `**Source (located by Ilse — start here, search only if this is wrong):** ${where(best)}`,
    '```' + ext,
    best.snippet,
    '```',
    readHint(best),
  ];
  if (rest.length > 0) {
    lines.push('Other candidates:');
    for (const h of rest) lines.push(`- ${where(h)}`);
  }
  return lines.join('\n');
}

/**
 * The component the element is written in — where it lives, whether an instance
 * can take a className, who else uses it. What an agent would grep for, answered
 * in ~100 tokens. Only for reused components: a page used once needs no card.
 */
export function formatComponentCard(card: ComponentCard): string | undefined {
  if (!card.def || card.usages.length < 2) return undefined;
  const shown = card.usages.slice(0, 4).map(u => `\`${u.file}:${u.line}\``).join(', ');
  const more = card.usages.length > 4 ? `, +${card.usages.length - 4}` : '';
  return `**Component <${card.name}>:** defined in \`${card.def.file}:${card.def.line}\` · ${card.acceptsClassName ? 'accepts className from outside' : 'does NOT take a className prop'} · used ${card.usages.length}× — ${shown}${more}. Changing the definition changes every usage.`;
}

export function formatComponentFor(annotation: Annotation, cwd = process.cwd()): string | undefined {
  if (process.env.ILSE_COMPONENT_CARD === '0') return undefined;
  const owner = annotation.source?.[0]?.owner;
  if (!owner) return undefined;
  const card = componentCard(owner, { cwd });
  return card ? formatComponentCard(card) : undefined;
}

/** Does editing the element where it is written give the scope the designer chose? */
export function swapMatchesScope(annotation: Annotation): boolean {
  const scope = annotation.scope;
  if (!scope) return true;
  const insideComponent = annotation.source?.[0]?.owner === scope.component;
  return scope.choice === 'all' ? insideComponent : !insideComponent;
}

/** One instance or all of them — and how to get there in code */
export function formatScope(annotation: Annotation): string | undefined {
  const scope = annotation.scope;
  if (!scope) return undefined;
  const c = `<${scope.component}>`;
  if (scope.choice === 'all') {
    return `**Scope: ALL ${c}** (${scope.count} on this screen). The designer wants this on every ${c}: change the component's own definition so all instances get it — not just this usage.`;
  }
  const usage = annotation.source?.find(h => h.kind === 'usage');
  return [
    `**Scope: ONLY THIS ${c}** (1 of ${scope.count} on this screen). Do not change ${c}'s definition — the other instances must stay as they are.`,
    `Override at this usage${usage ? ` (\`${usage.file}:${usage.line}\`)` : ''}: pass a className (merged with cn/clsx) or a prop. If ${c} doesn't accept one, add an optional className/prop to ${c} that keeps today's look by default, and set it only here.`,
  ].join('\n');
}

/**
 * Ilse's own memory of the located file: its last few changes there, from the
 * ledger in .git/ilse. Off with ILSE_HISTORY=0 (to compare runs with and without).
 */
export function formatHistoryFor(annotation: Annotation, cwd = process.cwd()): string | undefined {
  if (process.env.ILSE_HISTORY === '0') return undefined;
  const file = annotation.source?.[0]?.file;
  return file ? formatHistory(file, historyFor(cwd, file)) : undefined;
}

/** Tests that cover the located file: the agent updates the ones that pin the old look */
export function formatTestsFor(annotation: Annotation, cwd = process.cwd()): string | undefined {
  const file = annotation.source?.[0]?.file;
  const tests = file ? testsCovering(file, cwd) : [];
  if (tests.length === 0) return undefined;
  return `**Tests:** ${tests.map(f => `\`${f}\``).join(', ')} cover this file. If your change alters what one of them checks about the look (text, class, colour, markup), update it to the new look in the same pass; never weaken or skip it.`;
}

export function historyCount(annotation: Annotation, cwd = process.cwd()): number {
  if (process.env.ILSE_HISTORY === '0') return 0;
  const file = annotation.source?.[0]?.file;
  return file ? historyFor(cwd, file).length : 0;
}

/**
 * Where to read, not what to read: the element plus some room around it. A
 * whole 900-line component is ~10k tokens, and it is re-sent on every turn.
 */
export function readHint(hit: { file: string; line: number; endLine?: number }): string {
  const offset = Math.max(1, hit.line - 40);
  const limit = Math.max(120, (hit.endLine ?? hit.line) - offset + 60);
  return `To see more, Read \`${hit.file}\` with offset ${offset} and limit ${limit} — not the whole file.`;
}

function formatStyles(styles: Record<string, string>): string {
  const entries = Object.entries(styles);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
}

/** The page's path and query, without the dev server's origin (it is the proxy's, not the app's) */
export function pagePath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return undefined;
  }
}

export function augmentAnnotation(annotation: Annotation): AugmentedAnnotation {
  // Analyze: element context + static findings — for AI design review
  if (annotation.intent === 'analyze') {
    const intents = detectIntent(annotation.note);
    const relevantStyles = filterStyles(annotation.styles, intents);
    const lines: string[] = [];
    lines.push(`## Design Analysis Request: ${annotation.element}${annotation.component ? ` (${annotation.component})` : ''}`);
    if (annotation.grepPattern) lines.push(`**Grep:** \`${annotation.grepPattern}\``);
    if (annotation.componentStack?.length) lines.push(`**Stack:** ${annotation.componentStack.join(' > ')}`);
    if (annotation.note) lines.push(`**Static findings:**\n${annotation.note}`);
    const styleStr = Object.entries(relevantStyles).map(([k, v]) => `${k}: ${v}`).join(', ');
    if (styleStr) lines.push(`**Styles:** ${styleStr}`);
    if (annotation.environment) lines.push(`**Page:** ${annotation.environment.url}`);
    return {
      note: annotation.note,
      element: annotation.element,
      component: annotation.component,
      grepPattern: annotation.grepPattern,
      componentStack: annotation.componentStack,
      relevantStyles,
      timestamp: annotation.timestamp,
      context: lines.join('\n'),
    };
  }

  // Chat annotations have no element — minimal context
  if (annotation.intent === 'chat') {
    const url = annotation.environment?.url ?? 'unknown';
    const sanitizedNote = annotation.note.replace(/[`*_~]/g, '').slice(0, 500);
    return {
      note: sanitizedNote,
      element: '',
      relevantStyles: {},
      timestamp: annotation.timestamp,
      context: `**Chat:** "${sanitizedNote}"\n**Page:** ${url}`,
    };
  }

  const intents = detectIntent(annotation.note);
  const relevantStyles = filterStyles(annotation.styles, intents);

  // Build Standard-format markdown context
  const lines: string[] = [];

  lines.push(`## Annotation: ${annotation.element}${annotation.component ? ` (${annotation.component})` : ''}`);

  // Stable, greppable marker: agent transcripts keep the prompt, so history
  // tools (ctx search, plain grep) can find every Ilse fix on a component/file
  const ref = historyRef(annotation);
  if (ref) lines.push(`**Ilse ref:** ${ref}`);

  // Intent + severity first — agent should know these before reading details
  if (annotation.intent)   lines.push(`**Intent:** ${annotation.intent}`);
  if (annotation.severity) lines.push(`**Severity:** ${annotation.severity}`);
  // Which screen of the app this is: without it, a request that names no element
  // gets matched to whichever screen its words describe
  const page = pagePath(annotation.environment?.url);
  if (page) lines.push(`**Page:** \`${page}\` — the change belongs on this screen`);

  const sourceBlock = formatSource(annotation);
  if (sourceBlock) lines.push(sourceBlock);
  const historyBlock = formatHistoryFor(annotation);
  if (historyBlock) lines.push(historyBlock);
  const testsBlock = formatTestsFor(annotation);
  if (testsBlock) lines.push(testsBlock);
  const componentBlock = formatComponentFor(annotation);
  if (componentBlock) lines.push(componentBlock);
  const scopeBlock = formatScope(annotation);
  if (scopeBlock) lines.push(scopeBlock);
  // With a confident location the grep hint is noise the agent would act on
  if (annotation.grepPattern && !sourceBlock) lines.push(`**Grep:** \`${annotation.grepPattern}\``);
  if (annotation.componentStack?.length) lines.push(`**Stack:** ${annotation.componentStack.join(' > ')}`);
  if (annotation.domPath) lines.push(`**DOM:** ${annotation.domPath}`);
  const designMd = findDesignMd(process.cwd());
  if (designMd) lines.push(`**Design contract:** \`${designMd}\` — its tokens and rules win over guesses; read the part you need.`);
  if (annotation.note) {
    const safeNote = annotation.note.replace(/[`*_~]/g, '').slice(0, 500);
    lines.push(`**Note (verbatim designer text):**\n<<<\n${safeNote}\n>>>`);
  }

  const styleStr = formatStyles(relevantStyles);
  if (styleStr) {
    const intentLabel = intents.filter(i => i !== 'general').join(', ') || 'relevant';
    lines.push(`**Styles (${intentLabel}):** ${styleStr}`);
  }

  if (annotation.parent) lines.push(`**Parent:** ${annotation.parent}`);
  if (annotation.nearbyElements?.length) lines.push(`**Nearby:** ${annotation.nearbyElements.join(', ')}`);

  if (annotation.position) {
    lines.push(`**Position:** x:${annotation.position.left}, y:${annotation.position.top} (${annotation.position.width}×${annotation.position.height}px)`);
  }

  if (annotation.environment) {
    lines.push(`**Env:** ${annotation.environment.viewport} · DPR ${annotation.environment.devicePixelRatio}`);
  }

  const imgCount = (annotation.imageRefs?.length ?? 0) + (annotation.imageRef ? 1 : 0);
  if (imgCount > 0) lines.push(`**Image references:** ${imgCount} attached (see temp file paths below)`);

  // Rearrange: show delta so agent knows exactly what to move and where
  if (annotation.rearrangeData) {
    const { selector, label, tagName, originalRect: o, currentRect: c } = annotation.rearrangeData;
    lines.push(`**Move:** \`${selector}\` (${label}, <${tagName}>) from x:${o.x} y:${o.y} → x:${c.x} y:${c.y} (Δx:${c.x - o.x} Δy:${c.y - o.y})`);
  }

  // Placement: show target coordinates and nearest container
  if (annotation.placementData) {
    const { x, y, scrollY, nearestSelector } = annotation.placementData;
    if (nearestSelector && nearestSelector === annotation.element) {
      // A sketch over empty space, anchored on the element that holds it (see drawnContainer)
      lines.push(`**Create inside:** \`${nearestSelector}\` — the element above${sourceBlock ? ', at the source shown' : ''}. The new UI goes in it, at x:${x} y:${y + scrollY} (page-absolute); leave the element itself as it is unless the note says otherwise.`);
    } else {
      lines.push(`**Create at:** x:${x} y:${y + scrollY} (page-absolute)${nearestSelector ? ` · nearest container: \`${nearestSelector}\`` : ''}`);
    }
  }

  // Style edits: exact values the designer picked in the property panel.
  // These are not a description to interpret — they are the decision itself.
  if (annotation.styleData && annotation.styleData.changes.length > 0) {
    const { selector, changes } = annotation.styleData;
    lines.push(`**Style changes on \`${selector}\`** — set by the designer in the property panel:`);
    for (const c of changes) {
      const prop = c.property.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
      const source = c.token
        ? ` (design token \`${c.token}\` — use the token, not the literal value)`
        : c.offToken
          ? ` (⚠ no design token matches this value — flag it if the project has one that should be used)`
          : '';
      lines.push(`- \`${prop}\`: \`${c.from}\` → \`${c.to}\`${source}`);
    }
    lines.push(`Apply these exact values in the source. Prefer the project's token or utility class over a hardcoded literal.`);
  }

  return {
    note: annotation.note,
    element: annotation.element,
    component: annotation.component,
    grepPattern: annotation.grepPattern,
    componentStack: annotation.componentStack,
    parent: annotation.parent,
    relevantStyles,
    imageRef: annotation.imageRef,
    imageRefs: annotation.imageRefs,
    environment: annotation.environment,
    timestamp: annotation.timestamp,
    context: lines.join('\n'),
  };
}

export function augmentBatch(annotations: Annotation[]): {
  annotations: AugmentedAnnotation[];
  summary: string;
} {
  const augmented = annotations.map(augmentAnnotation);

  const lines: string[] = [
    `# Page Feedback${annotations[0]?.environment?.url ? `: ${annotations[0].environment.url}` : ''}`,
    '',
    `**${annotations.length} annotation${annotations.length > 1 ? 's' : ''}**`,
    '',
  ];

  for (let i = 0; i < augmented.length; i++) {
    const a = augmented[i];
    const intent = annotations[i].intent;
    const label = intent === 'chat'
      ? '[chat]'
      : intent === 'analyze'
      ? `[analyze] ${a.element}`
      : `**${a.element}**${a.component ? ` (${a.component})` : ''}${a.grepPattern ? ` · \`${a.grepPattern}\`` : ''}`;
    // A property-panel edit often carries no prose at all — the values are the
    // message. Summarise the change instead of reporting an empty note.
    const styleChanges = annotations[i].styleData?.changes ?? [];
    const summary = a.note
      || (styleChanges.length > 0
        ? styleChanges.map(c => `${c.property.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)} → ${c.to}`).join(', ')
        : t('augment.noNote'));
    lines.push(`${i + 1}. ${label}: ${summary}`);
  }

  lines.push('');
  lines.push('Full context with filtered styles included per annotation.');

  return { annotations: augmented, summary: lines.join('\n') };
}
