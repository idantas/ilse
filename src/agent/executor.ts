import { isolatedEnv, projectInstructions, DISALLOWED_TOOLS } from './agent-profile.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Annotation } from '../types.js';
import { augmentAnnotation } from '../bridge/augment.js';

// ── Image temp file management ─────────────────────────────────────────────

const ILSE_TMP_DIR = join(tmpdir(), 'ilse-images');

function ensureTmpDir(): void {
  if (!existsSync(ILSE_TMP_DIR)) {
    mkdirSync(ILSE_TMP_DIR, { recursive: true });
  }
}

/**
 * Save base64 data URL images to temp files and return their paths.
 * Returns array of file paths.
 */
function saveImagesToTmp(images: string[], annotationId: string, filenames?: string[]): string[] {
  ensureTmpDir();
  const paths: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const dataUrl = images[i];
    // Match image/* content types including svg+xml
    const match = dataUrl.match(/^data:image\/([^;]+);base64,(.+)$/);
    if (!match) continue;
    const mimeSubtype = match[1]; // e.g. "png", "jpeg", "svg+xml"
    const ext = mimeSubtype === 'jpeg' ? 'jpg' : mimeSubtype === 'svg+xml' ? 'svg' : mimeSubtype;
    const buffer = Buffer.from(match[2], 'base64');
    // Use original filename if available, otherwise generate one
    const originalName = filenames?.[i];
    const fileName = originalName
      ? originalName.replace(/[^a-zA-Z0-9._-]/g, '-')
      : `${annotationId}-${i}.${ext}`;
    const filePath = join(ILSE_TMP_DIR, fileName);
    writeFileSync(filePath, buffer);
    paths.push(filePath);
  }
  return paths;
}

function cleanupTmpImages(paths: string[]): void {
  for (const p of paths) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

// Track running agent processes so they can be killed on SIGINT
const activeProcesses = new Set<ChildProcess>();

export function killAllActiveProcesses(): void {
  for (const proc of activeProcesses) {
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
  }
  activeProcesses.clear();
}

export type AgentKind = 'claude' | 'codex' | 'cursor-agent' | 'gemini' | 'none';

export interface AgentDetection {
  kind: AgentKind;
  command?: string;
  path?: string;
}

// ── Agent detection ─────────────────────────────────────────────────────────

const AGENT_CANDIDATES: Array<{ kind: AgentKind; command: string }> = [
  { kind: 'claude', command: 'claude' },
  { kind: 'codex', command: 'codex' },
  { kind: 'cursor-agent', command: 'cursor-agent' },
  { kind: 'gemini', command: 'gemini' },
];

function which(command: string): string | null {
  const paths = (process.env.PATH ?? '').split(':');
  for (const dir of paths) {
    if (!dir) continue;
    const full = `${dir}/${command}`;
    if (existsSync(full)) return full;
  }
  return null;
}

export function detectAgent(): AgentDetection {
  for (const { kind, command } of AGENT_CANDIDATES) {
    const path = which(command);
    if (path) return { kind, command, path };
  }
  return { kind: 'none' };
}

// ── Prompt formatting ───────────────────────────────────────────────────────

/**
 * Collect all image data URLs from an annotation.
 */
function collectImages(annotation: Annotation): string[] {
  const images: string[] = [];
  if (annotation.imageRef) images.push(annotation.imageRef);
  if (annotation.imageRefs?.length) images.push(...annotation.imageRefs);
  return images;
}

/**
 * Build image instruction block for the prompt.
 * - SVG files → asset to copy into the project (not a visual reference)
 * - Raster + note → visual context for the instruction
 * - Raster without note → "make it look like this"
 */
function buildImageBlock(imagePaths: string[], hasNote: boolean): string[] {
  if (imagePaths.length === 0) return [];
  const svgs = imagePaths.filter(p => p.endsWith('.svg'));
  const rasters = imagePaths.filter(p => !p.endsWith('.svg'));
  const lines: string[] = [''];

  if (svgs.length > 0) {
    lines.push('**SVG ASSET(S):** The designer attached SVG file(s). These are source files — COPY them into the project (e.g. public/images/) using the original filename and reference them directly. Do NOT recreate or rasterize.');
    lines.push('Read each SVG to inspect its content, then copy it with the Write tool:');
    for (const p of svgs) {
      const basename = p.split('/').pop() ?? p;
      lines.push(`  - ${p} (original: ${basename})`);
    }
  }

  if (rasters.length > 0) {
    if (hasNote) {
      lines.push('**REFERENCE IMAGE(S):** The designer attached image(s) as visual context for the instruction above.');
    } else {
      lines.push('**REFERENCE IMAGE(S):** The designer attached image(s) WITHOUT written instructions. This means: "make the element look like this image". Replicate the visual design shown.');
    }
    lines.push('Use the Read tool to view each image before making changes:');
    for (const p of rasters) {
      lines.push(`  - ${p}`);
    }
  }

  return lines;
}

function buildPrompt(annotation: Annotation, imagePaths: string[] = []): string {
  const augmented = augmentAnnotation(annotation);
  const isChat = annotation.intent === 'chat';
  const isMove = annotation.intent === 'move' && annotation.rearrangeData;
  const isCreate = annotation.intent === 'create';

  const hasNote = !!annotation.note?.trim() && !annotation.note.startsWith('No static issues');
  const imageBlock = buildImageBlock(imagePaths, hasNote);

  const instructions: string[] = [];

  const isAnalyze = annotation.intent === 'analyze';

  if (isAnalyze) {
    instructions.push(
      'Ilse detected issues on this element. Perform a design review.',
      '',
      'Element context:',
      augmented.context,
      '',
      'INSTRUCTIONS:',
      '1. Read the component source file (use the grep pattern or component name)',
      '2. Check REUSE: is there a reusable component in the project (e.g. components/ui/Button) that should be used instead of inline classes? List the path.',
      '3. Check CONSISTENCY: does this element follow the same pattern as similar ones? (font-weight, padding, colors)',
      '4. Check DS: if there are design tokens in the project (tailwind.config, tokens.json, theme), does the element use the correct tokens?',
      '5. List issues in 1-3 short, direct bullet points.',
      '6. Do NOT make edits. Only analyze and report.',
    );
  } else if (annotation.intent === 'resize') {
    const orig = annotation.rearrangeData?.originalRect;
    const curr = annotation.rearrangeData?.currentRect;
    instructions.push(
      'The designer RESIZED this element. You must change the size in the code.',
      '',
      ...(orig && curr ? [
        `Original size: ${orig.width}×${orig.height}px`,
        `Desired size: ${curr.width}×${curr.height}px`,
        `Delta: Δw=${curr.width - orig.width}px, Δh=${curr.height - orig.height}px`,
      ] : []),
      '',
      'HOW TO RESIZE:',
      '1. Find the element in the code using the grep pattern or selector',
      '2. Analyze how the size is defined (width/height, padding, min/max, flex)',
      '3. Apply the appropriate change for the context:',
      '   - If it has explicit width/height: adjust the values',
      '   - If padding/margin defines the size: adjust the padding',
      '   - If flex/grid: adjust flex-basis, min-width, or content',
      '4. Respect the existing layout — do not break responsiveness',
    );
  } else if (isChat) {
    instructions.push(
      'The designer sent a direct instruction. EXECUTE — do not analyze, do not ask, do not request confirmation.',
      '',
      'Instruction:',
      '"""',
      augmented.note,
      '"""',
      '',
      'RULES:',
      '- APPLY the requested change. Read the files, edit, save.',
      '- If it is a question: answer in 1-2 direct sentences.',
      '- Do NOT analyze. Do NOT ask "confirm?". Do NOT say "this annotation is of type X". Just do it.',
      '- Be surgical — edit only what is necessary.',
    );
  } else if (isMove) {
    const { originalRect: o, currentRect: c } = annotation.rearrangeData!;
    const dx = c.x - o.x;
    const dy = c.y - o.y;
    instructions.push(
      'The designer DRAGGED this element to a new position. You must move the element in the code.',
      '',
      `Movement direction: ${dx > 0 ? 'right' : dx < 0 ? 'left' : 'no horizontal displacement'} (${dx}px), ${dy > 0 ? 'down' : dy < 0 ? 'up' : 'no vertical displacement'} (${dy}px)`,
      '',
      'HOW TO MOVE:',
      '1. Find the element in the code using the grep pattern or selector',
      '2. Analyze the current layout (flex, grid, static, absolute)',
      '3. Apply the appropriate change for the context:',
      '   - Flexbox/Grid: change order, reorder the element in JSX, or adjust align-self/justify-self',
      '   - If you need to change ORDER among siblings: reorder elements in JSX/HTML',
      '   - Position absolute/fixed: adjust top/left/right/bottom',
      '   - Static: use margin or change position in DOM',
      '4. Do NOT add position:absolute just to move — respect the existing layout',
      '5. If delta is small (< 20px), it may be a margin/padding adjustment',
      '6. If delta is large, it may mean element reordering',
    );
  } else if (isCreate) {
    instructions.push(
      'The designer marked an EMPTY AREA where you should CREATE new content.',
      '',
      'HOW TO CREATE:',
      '1. Find the nearest container using the selector or parent',
      '2. Create the element described in the designer\'s note',
      '3. Position it inside the existing container, in the most logical spot',
      '4. Follow the visual and code patterns of neighboring components',
    );
  } else {
    instructions.push(
      '1. Analyze whether the issue is in the component DEFINITION or the specific INSTANCE',
      '2. If it is a default style issue, fix it in the base component',
      '3. If it is specific to this instance, fix only the usage',
      '4. If the same issue may exist in other occurrences, search with the grep pattern and fix all',
      '5. Be surgical — edit only what is necessary',
    );
  }

  return [
    'You received a visual annotation from the designer via Ilse (visual feedback tool).',
    '',
    'Element context:',
    augmented.context,
    ...imageBlock,
    '',
    'INSTRUCTIONS:',
    ...instructions,
    '',
    'After applying changes, respond in ONE line (max 15 words) describing what you changed.',
    'Example: "Adjusted align-items on Button in components/Button.tsx"',
  ].join('\n');
}

export function buildBatchPrompt(
  annotations: Annotation[],
  opts?: { isResume?: boolean },
  imagePathsMap?: Map<string, string[]>,
): string {
  const allImagePaths: string[] = [];

  const sections = annotations.map((ann, i) => {
    const augmented = augmentAnnotation(ann);
    const imagePaths = imagePathsMap?.get(ann.id) ?? [];
    allImagePaths.push(...imagePaths);

    let section = `### Annotation #${i + 1} (id: ${ann.id})\n${augmented.context}`;

    if (imagePaths.length > 0) {
      const svgs = imagePaths.filter(p => p.endsWith('.svg'));
      const rasters = imagePaths.filter(p => !p.endsWith('.svg'));
      const hasNote = !!ann.note?.trim() && !ann.note.startsWith('No static issues');

      if (svgs.length > 0) {
        section += `\n\n**SVG asset(s):** Copy into the project (e.g. public/images/) and use directly. Do NOT recreate.`;
        for (const p of svgs) section += `\n  - ${p}`;
      }
      if (rasters.length > 0) {
        section += hasNote
          ? `\n\n**Reference image(s):** Visual context. Read them:`
          : `\n\n**Reference image(s):** Replicate the visual design shown. Read them:`;
        for (const p of rasters) section += `\n  - ${p}`;
      }
    }

    return section;
  });

  // Resumed session: agent already has instructions, just send the new annotation(s)
  if (opts?.isResume) {
    const count = annotations.length;
    return [
      `New ${count === 1 ? 'annotation' : `${count} annotations`} from the designer. Same rules as before.`,
      '',
      ...sections,
    ].join('\n');
  }

  // First invocation: full instructions
  const hasMove = annotations.some(a => a.intent === 'move' && a.rearrangeData);
  const hasCreate = annotations.some(a => a.intent === 'create');
  const hasChat = annotations.some(a => a.intent === 'chat');
  const hasImages = allImagePaths.length > 0;
  const allChat = annotations.every(a => a.intent === 'chat');
  const allAnalyze = annotations.every(a => a.intent === 'analyze');

  const count = annotations.length;

  // Pure analyze batch — design review mode
  if (allAnalyze) {
    return [
      `Analyze ${count === 1 ? 'this element' : `these ${count} elements`} from a design perspective.`,
      '',
      'RULES:',
      '- Read the source code of each element (use grep pattern or component name)',
      '- Check REUSE: is there a reusable component (e.g. components/ui/Button) that should be used?',
      '- Check CONSISTENCY: does the element follow the same pattern as similar ones in the project?',
      '- Check DS: if there are tokens (tailwind.config, tokens.json, theme), does the element use the correct ones?',
      '- Do NOT make edits. Only analyze and report in short bullet points.',
      ...(hasImages ? [
        '- If annotations include reference images, use the Read tool to view each image file before analyzing.',
      ] : []),
      '',
      ...sections,
      '',
      'OUTPUT BEHAVIOR:',
      '- For each element, print one line:',
      '  #<id>: <analysis in max 20 words>',
    ].join('\n');
  }

  // Pure chat batch — simplified preamble
  if (allChat) {
    return [
      `Direct instruction from the designer. EXECUTE — do not analyze, do not ask for confirmation.`,
      '',
      'RULES:',
      '- APPLY the requested change. Read the files, edit, save.',
      '- If it is a question: answer in 1-2 direct sentences.',
      '- Do NOT analyze. Do NOT ask "confirm?". Just do it.',
      '- Be surgical — edit only what is necessary.',
      ...(hasImages ? [
        '- IMPORTANT: Annotations may include reference image files. Use the Read tool to view each image FIRST — the image shows the desired result. Replicate the design.',
      ] : []),
      '',
      ...sections,
      '',
      'OUTPUT BEHAVIOR:',
      '- Before each action, briefly state (1 short sentence) what you are doing.',
      '- After finishing EACH message individually, IMMEDIATELY print a line in this format:',
      '  #<id>: <what you did in max 15 words>',
    ].join('\n');
  }

  return [
    `You received ${count} visual ${count === 1 ? 'annotation' : 'annotations'} from the designer via Ilse (visual feedback tool).`,
    ...(count > 1 ? [
      'Fix ALL in a single pass. Analyze the set before acting:',
    ] : [
      'Fix this annotation:',
    ]),
    ...(annotations.some(a => a.source?.length) ? [
      '- When an annotation has a **Source** location, it is exact: Read only the range it gives (offset/limit), then change it with Edit. No exploring the codebase, unless the code shown does not match',
    ] : []),
    '- Do not re-read a file after editing it, and do not run builds or tests — the designer sees the result live',
    '- If two annotations are on the same element, consolidate',
    '- If the same pattern appears in several, fix it in the base component',
    '- If the same issue may exist in other occurrences outside the annotations, one Grep to find them, then fix all',
    '- Be surgical — edit only what is necessary',
    ...(hasImages ? [
      '- IMPORTANT: Some annotations include reference image files. Use the Read tool to view each image FIRST — the image shows the desired result. Replicate the design shown in the image.',
    ] : []),
    ...(hasMove ? [
      '',
      'MOVE ANNOTATIONS (intent: move):',
      '- The designer DRAGGED elements to new positions. The **Move** field shows the delta in pixels.',
      '- To move: analyze the layout (flex/grid/static) and apply the appropriate change:',
      '  flexbox/grid → change order, reorder JSX, or adjust align-self',
      '  position absolute → adjust top/left',
      '  static → adjust margin or reorder in DOM',
      '- Do NOT add position:absolute just to move — respect the existing layout',
      '- Small delta (< 20px) = margin/padding adjustment. Large delta = element reordering.',
    ] : []),
    ...(hasCreate ? [
      '',
      'CREATE ANNOTATIONS (intent: create):',
      '- The designer marked empty areas where new content is needed.',
      '- Create the element described in the note, inside the nearest container.',
      '- Follow the visual and code patterns of neighboring components.',
    ] : []),
    '',
    ...sections,
    '',
    'OUTPUT BEHAVIOR:',
    '- Before each action, briefly state (1 short sentence) what you are doing.',
    '  E.g.: "Reading the Header to understand the layout", "Searching for the Button component", "Adjusting alignment".',
    '- After finishing EACH annotation individually (not at the end), IMMEDIATELY print a line in this format:',
    '  #<id>: <what you did in max 15 words>',
    '- Do not accumulate summaries for the end. Report one by one, in order, as soon as you finish each edit.',
  ].join('\n');
}

// ── Agent execution ─────────────────────────────────────────────────────────

export interface ExecutionResult {
  ok: boolean;
  summary: string;
  rawOutput?: string;
  error?: string;
  durationMs: number;
}

/**
 * Why a run failed, in the agent's own words. Claude Code exits 1 with an empty
 * stderr and puts the reason in its final result line ("You've hit your session
 * limit · resets 7:30pm") — reporting only "Exit code 1" hid it.
 */
export function failureReason(stdout: string, stderr: string, code: number | null): string {
  const lines = stdout.trim().split('\n').reverse();
  for (const line of lines) {
    try {
      const ev = JSON.parse(line) as { type?: string; result?: unknown; is_error?: boolean };
      if (ev.type === 'result' && typeof ev.result === 'string' && ev.result.trim()) return ev.result.trim().slice(0, 300);
    } catch { /* not JSON */ }
  }
  const plain = stdout.trim().split('\n').pop()?.trim();
  return stderr.trim() || (plain && plain.length < 300 && !plain.startsWith('{') ? plain : '') || `Exit code ${code}`;
}

/** The agent's account is out of quota — every next run would fail the same way */
export function isLimitError(message: string | undefined): boolean {
  return !!message && /(session|usage|rate|weekly|5-hour)\s+limit|hit your .{0,20}limit|limit reached|quota|credit balance is too low/i.test(message);
}

/** "… resets 7:30pm" → that moment (today, or tomorrow if it already passed) */
export function limitResetsAt(message: string, now = new Date()): Date | undefined {
  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(message);
  if (!m) return undefined;
  let h = Number(m[1]) % 12;
  if ((m[3] ?? '').toLowerCase() === 'pm') h += 12;
  if (!m[3] && Number(m[1]) === 12) h = 12;
  const at = new Date(now);
  at.setHours(h, Number(m[2] ?? 0), 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  return at;
}

export async function executeAnnotation(
  annotation: Annotation,
  agent: AgentDetection,
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<ExecutionResult> {
  if (agent.kind === 'none' || !agent.command) {
    return { ok: false, summary: '', error: 'Nenhum agente CLI detectado', durationMs: 0 };
  }

  const start = Date.now();
  const images = collectImages(annotation);
  const tmpImagePaths = images.length > 0 ? saveImagesToTmp(images, annotation.id, annotation.imageFilenames) : [];
  const prompt = buildPrompt(annotation, tmpImagePaths);
  const cwd = options.cwd ?? process.cwd();
  const timeout = options.timeoutMs ?? 180_000;

  // Build args per agent
  const args = buildArgs(agent.kind, prompt, { projectInstructions: projectInstructions(options.cwd ?? process.cwd()) });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const proc = spawn(agent.command!, args, {
      cwd,
      env: agent.kind === 'claude' ? isolatedEnv() : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeProcesses.add(proc);

    // Activity-based timeout: reset on every stdout data.
    let timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeout);
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, timeout);
    };

    proc.stdout?.on('data', (chunk) => { resetTimer(); stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      activeProcesses.delete(proc);
      cleanupTmpImages(tmpImagePaths);
      const durationMs = Date.now() - start;

      if (timedOut) {
        resolve({ ok: false, summary: '', error: `Timeout (${timeout}ms)`, durationMs });
        return;
      }

      if (code !== 0) {
        resolve({
          ok: false,
          summary: '',
          error: failureReason(stdout, stderr, code),
          rawOutput: stdout,
          durationMs,
        });
        return;
      }

      // Extract summary: last non-empty line of stdout (agent's final response)
      const summary = extractSummary(stdout);
      resolve({ ok: true, summary, rawOutput: stdout, durationMs });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      activeProcesses.delete(proc);
      cleanupTmpImages(tmpImagePaths);
      resolve({
        ok: false,
        summary: '',
        error: err.message,
        durationMs: Date.now() - start,
      });
    });
  });
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  isResume: boolean;
}

export interface BatchExecutionResult {
  ok: boolean;
  summaries: Map<string, string>; // annotation id -> summary
  rawOutput?: string;
  error?: string;
  durationMs: number;
  sessionId?: string; // claude session id for resume in next call
  tokenUsage?: TokenUsage;
}

/**
 * Execute a batch of annotations with stream-json parsing.
 *
 * Uses Claude Code CLI stream-json output format to:
 * 1. Detect tool_use events (Edit/Write/MultiEdit) in real-time
 * 2. Call onProgress as each edit happens (enables per-item UI feedback)
 * 3. Extract session_id for future `--resume` calls (persistent context)
 *
 * Only Claude supports stream-json. Other agents fall back to text mode.
 */
export async function executeBatch(
  annotations: Annotation[],
  agent: AgentDetection,
  options: {
    cwd?: string;
    timeoutMs?: number;
    onProgress?: (id: string, summary: string) => void;
    onThinking?: (text: string) => void;  // emitted as claude streams reasoning/tool events
    onEvent?: (event: Record<string, unknown>) => void;  // every raw stream-json event (journal)
    sessionId?: string;
    /** Claude Code model alias or id; undefined = the user's default */
    model?: string;
    /** Send this instead of the batch prompt (a follow-up turn, e.g. a syntax repair) */
    prompt?: string;
  } = {}
): Promise<BatchExecutionResult> {
  if (agent.kind === 'none' || !agent.command) {
    return { ok: false, summaries: new Map(), error: 'Nenhum agente CLI detectado', durationMs: 0 };
  }
  if (annotations.length === 0) {
    return { ok: true, summaries: new Map(), durationMs: 0 };
  }

  const start = Date.now();

  // Save all images to temp files and build a map for the prompt
  const imagePathsMap = new Map<string, string[]>();
  const allTmpPaths: string[] = [];
  for (const ann of annotations) {
    const images = collectImages(ann);
    if (images.length > 0) {
      const paths = saveImagesToTmp(images, ann.id, ann.imageFilenames);
      imagePathsMap.set(ann.id, paths);
      allTmpPaths.push(...paths);
    }
  }

  const prompt = options.prompt ?? buildBatchPrompt(annotations, { isResume: !!options.sessionId }, imagePathsMap);
  const cwd = options.cwd ?? process.cwd();
  const timeout = options.timeoutMs ?? 300_000;
  const useStreamJson = agent.kind === 'claude';

  const args = buildArgs(agent.kind, prompt, {
    streamJson: useStreamJson,
    sessionId: options.sessionId,
    model: options.model,
    // Resumed sessions already carry the project's instructions
    projectInstructions: options.sessionId ? undefined : projectInstructions(cwd),
  });

  if (process.env.ILSE_DEBUG) {
    console.log(`  [debug] spawn: ${agent.command} ${args.map(a => a.length > 80 ? a.slice(0, 80) + '...' : a).join(' ')}`);
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let buffer = '';
    let timedOut = false;
    let sessionId: string | undefined;
    let tokenUsage: TokenUsage | undefined;
    const summaries = new Map<string, string>();
    let resolvedIndex = 0; // fallback: resolve by order when file_path matching fails
    const resolvedIds = new Set<string>(); // track which annotations have been resolved

    const proc = spawn(agent.command!, args, {
      cwd,
      env: agent.kind === 'claude' ? isolatedEnv() : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeProcesses.add(proc);

    // Activity-based timeout: reset on every stdout data.
    // Only kills after `timeout` ms of SILENCE, not total duration.
    let timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeout);
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, timeout);
    };

    proc.stdout?.on('data', (chunk) => {
      resetTimer();
      const text = chunk.toString();
      stdout += text;
      buffer += text;

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (useStreamJson) {
          // Parse stream-json events
          try {
            const event = JSON.parse(trimmed);
            options.onEvent?.(event);
            handleStreamEvent(
              event,
              annotations,
              summaries,
              (filePath?: string) => {
                // Try to match by file_path first
                let matched = false;
                if (filePath) {
                  const basename = filePath.split('/').pop() ?? '';
                  for (const ann of annotations) {
                    if (resolvedIds.has(ann.id)) continue;
                    // Match if grepPattern contains the filename or component name
                    const grep = ann.grepPattern ?? '';
                    const comp = ann.component ?? '';
                    if (
                      (grep && filePath.includes(grep.split(/[:\s]/)[0])) ||
                      (comp && basename.toLowerCase().includes(comp.toLowerCase())) ||
                      (basename && grep.toLowerCase().includes(basename.toLowerCase()))
                    ) {
                      resolvedIds.add(ann.id);
                      const summary = `Editando ${basename}`;
                      if (!summaries.has(ann.id)) {
                        summaries.set(ann.id, summary);
                        options.onProgress?.(ann.id, summary);
                      }
                      matched = true;
                      break;
                    }
                  }
                }
                // Fallback: resolve by order
                if (!matched) {
                  while (resolvedIndex < annotations.length && resolvedIds.has(annotations[resolvedIndex].id)) {
                    resolvedIndex++;
                  }
                  if (resolvedIndex < annotations.length) {
                    const ann = annotations[resolvedIndex++];
                    resolvedIds.add(ann.id);
                    const summary = `Editando ${ann.component ?? ann.element}`;
                    if (!summaries.has(ann.id)) {
                      summaries.set(ann.id, summary);
                      options.onProgress?.(ann.id, summary);
                    }
                  }
                }
              },
              (id) => { sessionId = id; },
              (thinking) => options.onThinking?.(thinking),
              (usage) => { tokenUsage = { ...usage, isResume: !!options.sessionId }; },
            );
          } catch { /* ignore non-JSON lines */ }
        } else {
          // Fallback: match "#<id>: summary" pattern
          const match = trimmed.match(/^#([a-z0-9]+):\s*(.+)$/i);
          if (match && !summaries.has(match[1])) {
            summaries.set(match[1], match[2].trim());
            options.onProgress?.(match[1], match[2].trim());
          }
        }
      }
    });
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      activeProcesses.delete(proc);
      cleanupTmpImages(allTmpPaths);
      const durationMs = Date.now() - start;

      if (timedOut) {
        resolve({ ok: false, summaries: new Map(), error: `Timeout (${timeout}ms)`, durationMs });
        return;
      }
      if (code !== 0) {
        resolve({
          ok: false,
          summaries: new Map(),
          error: failureReason(stdout, stderr, code),
          rawOutput: stdout,
          durationMs,
        });
        return;
      }

      // Final pass: extract summaries from any final text output (both formats)
      const finalSummaries = parseBatchSummaries(stdout, annotations);
      for (const [id, summary] of finalSummaries) {
        if (!summaries.has(id)) summaries.set(id, summary);
      }

      resolve({
        ok: true,
        summaries,
        rawOutput: stdout,
        durationMs,
        sessionId,
        tokenUsage,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      activeProcesses.delete(proc);
      cleanupTmpImages(allTmpPaths);
      resolve({
        ok: false,
        summaries: new Map(),
        error: err.message,
        durationMs: Date.now() - start,
      });
    });
  });
}

/**
 * Process a single stream-json event from Claude Code CLI.
 * Events shape: https://docs.claude.com/en/docs/claude-code/sdk#streaming-output-format
 */
function handleStreamEvent(
  event: Record<string, unknown>,
  annotations: Annotation[],
  summaries: Map<string, string>,
  onToolUse: (filePath?: string) => void,
  onSessionId: (id: string) => void,
  onThinking: (text: string) => void,
  onUsage?: (usage: TokenUsage) => void,
): void {
  // Capture token usage from result event
  if (event.type === 'result' && onUsage) {
    const usage = event.usage as Record<string, unknown> | undefined;
    if (usage) {
      onUsage({
        inputTokens: (usage.input_tokens as number) ?? 0,
        outputTokens: (usage.output_tokens as number) ?? 0,
        cacheReadTokens: (usage.cache_read_input_tokens as number) ?? 0,
        cacheCreationTokens: (usage.cache_creation_input_tokens as number) ?? 0,
        totalCostUsd: (event.total_cost_usd as number) ?? 0,
        isResume: false, // will be set by caller
      });
    }
    return;
  }
  // Capture session ID from init event
  if (event.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
    onSessionId(event.session_id);
    return;
  }

  // Assistant message may contain tool_use blocks and text (reasoning)
  if (event.type === 'assistant') {
    const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (block.type === 'tool_use') {
        const toolName = block.name as string | undefined;
        const input = block.input as Record<string, unknown> | undefined;

        // Emit a human-friendly "thinking" line per tool use
        const thinking = describeToolUse(toolName, input);
        if (thinking) onThinking(thinking);

        if (toolName && ['Edit', 'Write', 'MultiEdit', 'Update'].includes(toolName)) {
          const filePath = typeof input?.file_path === 'string' ? input.file_path : undefined;
          onToolUse(filePath);
        }
      }
      // Text blocks: emit as thinking (cleaned up), also parse "#<id>:" summary pattern
      if (block.type === 'text' && typeof block.text === 'string') {
        const text = block.text.trim();

        // Extract summary lines first
        const matches = text.matchAll(/^#([a-z0-9]+):\s*(.+)$/gim);
        for (const match of matches) {
          if (!summaries.has(match[1])) {
            summaries.set(match[1], match[2].trim());
          }
        }

        // Emit non-summary text as thinking (first line only, trimmed)
        const cleanText = text
          .split('\n')
          .filter(l => l.trim() && !/^#[a-z0-9]+:/i.test(l.trim()))
          .join(' ')
          .slice(0, 120);
        if (cleanText) onThinking(cleanText);
      }
    }
  }
}

/**
 * Turn a Claude tool_use event into a short, designer-friendly description.
 * Examples:
 *   Read /foo/bar.tsx  → "Lendo bar.tsx"
 *   Grep "useState"    → "Procurando useState"
 *   Edit Button.tsx    → "Editando Button.tsx"
 */
function describeToolUse(name: string | undefined, input: Record<string, unknown> | undefined): string | null {
  if (!name || !input) return null;

  const getBasename = (p: unknown): string => {
    if (typeof p !== 'string') return '';
    return p.split('/').pop() ?? p;
  };

  switch (name) {
    case 'Read':
      return `Lendo ${getBasename(input.file_path)}`;
    case 'Glob':
      return `Procurando arquivos ${input.pattern ?? ''}`.trim();
    case 'Grep':
      return `Procurando "${String(input.pattern ?? '').slice(0, 40)}"`;
    case 'Edit':
    case 'Update':
      return `Editando ${getBasename(input.file_path)}`;
    case 'MultiEdit':
      return `Editando ${getBasename(input.file_path)} (múltiplas)`;
    case 'Write':
      return `Criando ${getBasename(input.file_path)}`;
    case 'Bash':
      return `Rodando comando`;
    case 'TodoWrite':
      return `Planejando próximos passos`;
    case 'WebSearch':
      return `Pesquisando: ${String(input.query ?? '').slice(0, 40)}`;
    case 'WebFetch':
      return `Lendo página`;
    default:
      return `Usando ${name}`;
  }
}

function parseBatchSummaries(stdout: string, annotations: Annotation[]): Map<string, string> {
  const result = new Map<string, string>();
  const lines = stdout.trim().split('\n').filter(l => l.trim().length > 0);

  // Parse lines in format "#<id>: <summary>"
  for (const line of lines) {
    const match = line.trim().match(/^#([a-z0-9]+):\s*(.+)$/i);
    if (match) {
      result.set(match[1], match[2].trim());
    }
  }

  // Fill missing summaries with fallback (skip analyze — those should have real analysis)
  for (const ann of annotations) {
    if (!result.has(ann.id)) {
      result.set(ann.id, 'Corrigido');
    }
  }

  return result;
}

function buildArgs(
  kind: AgentKind,
  prompt: string,
  opts: { streamJson?: boolean; sessionId?: string; model?: string; projectInstructions?: string } = {}
): string[] {
  switch (kind) {
    case 'claude': {
      const args: string[] = [
        '-p',
        prompt,
        '--dangerously-skip-permissions',
        // Disable MCP servers for the spawned claude. Otherwise Claude
        // sees `ilse_*` MCP tools registered globally and tries to fetch
        // annotations from the MCP server's in-memory store — which is a
        // SEPARATE process from the CLI that actually holds the annotation.
        // Result: "annotation not found", no edits. With these flags Claude
        // ignores all MCP configs and relies only on the prompt.
        '--mcp-config',
        '{"mcpServers":{}}',
        '--strict-mcp-config',
        // Look with Read/Grep/Glob, change with Edit — the shell only re-does the locator's search
        '--disallowedTools', ...DISALLOWED_TOOLS,
      ];
      if (opts.model) args.push('--model', opts.model);
      // User-level CLAUDE.md and memory are switched off (isolatedEnv); the project's go back in
      if (opts.projectInstructions) args.push('--append-system-prompt', opts.projectInstructions);
      if (opts.streamJson) {
        // stream-json requires --verbose
        args.push('--output-format', 'stream-json', '--verbose');
      }
      if (opts.sessionId) {
        args.push('--resume', opts.sessionId);
      }
      return args;
    }
    case 'codex':
      return ['exec', ...(opts.model ? ['-m', opts.model] : []), prompt];
    case 'cursor-agent':
      return ['-p', prompt, ...(opts.model ? ['--model', opts.model] : [])];
    case 'gemini':
      return ['-p', prompt, ...(opts.model ? ['-m', opts.model] : [])];
    default:
      return [];
  }
}

function extractSummary(stdout: string): string {
  const lines = stdout.trim().split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return 'Corrigido';
  // Last line is usually the final response
  const last = lines[lines.length - 1].trim();
  // Strip markdown if present
  return last.replace(/^[*•\-#>]+\s*/, '').slice(0, 200);
}
