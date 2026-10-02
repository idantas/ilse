export interface ElementCapture {
  element: string;      // CSS selector
  component?: string;   // data-component attr or React fiber
  styles: Record<string, string>;
  parent?: string;
  rect: { top: number; left: number; width: number; height: number };
  grepPattern?: string;        // best grep string for finding this in code
  componentStack?: string[];   // parent component hierarchy
  _scrollX?: number;           // window.scrollX at capture time (for absolute positioning)
  _scrollY?: number;           // window.scrollY at capture time
  domPath?: string;            // full DOM path (body > main > div.container > ...)
  nearbyElements?: string[];   // siblings / neighbors
  text?: string;               // own visible text, short — lets the CLI find the JSX node
  /** React 19 dev stacks: where this element's JSX runs, and where its component is used */
  frames?: ReactFrames;
}

export interface ReactFrame { fn: string; url: string }
export interface ReactFrames { element?: ReactFrame; owner?: ReactFrame }

/**
 * The first app frame of a React dev stack: "at MetricaDaSemana (webpack-internal:///…/metricas.tsx:160:96)".
 * React's own frames and node_modules are skipped. The line is the compiled one, so it isn't kept.
 */
export function firstAppFrame(stack: string | undefined): ReactFrame | undefined {
  let anonymousUrl: string | undefined;
  for (const line of (stack ?? '').split('\n')) {
    const m = /^\s*at\s+(?:Object\.)?([\w$.<>]+)\s+\((.+?)(?::\d+){1,2}\)\s*$/.exec(line);
    if (!m) continue;
    const [, rawFn, url] = m;
    if (/node_modules|react-stack|jsx-dev-runtime|react-dom|jsxDEV/.test(url + rawFn)) continue;
    const fn = rawFn.split('.').pop()!;
    // A component is Capitalized; eval/map callbacks (a .map() inside it) are not —
    // keep looking for the component in the same file
    if (/^[A-Z]/.test(fn) && (!anonymousUrl || anonymousUrl === url)) return { fn, url };
    anonymousUrl ??= url;
  }
  return undefined;
}

function reactFrames(el: Element): ReactFrames | undefined {
  const k = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  const fiber = k ? (el as unknown as Record<string, { _debugStack?: { stack?: string }; _debugOwner?: { _debugStack?: { stack?: string } } }>)[k] : undefined;
  if (!fiber) return undefined;
  const element = firstAppFrame(fiber._debugStack?.stack);
  const owner = firstAppFrame(fiber._debugOwner?._debugStack?.stack);
  return element || owner ? { element, owner } : undefined;
}

export interface PageEnvironment {
  viewport: string;
  url: string;
  userAgent: string;
  devicePixelRatio: number;
  timestamp: string;
}

export function captureEnvironment(): PageEnvironment {
  return {
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    url: window.location.href,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    timestamp: new Date().toISOString(),
  };
}

const STYLE_KEYS = [
  'display', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent', 'gap',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'width', 'height', 'maxWidth', 'minWidth',
  'color', 'backgroundColor', 'borderColor', 'borderRadius',
  'borderWidth', 'borderStyle', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
  'position', 'top', 'right', 'bottom', 'left',
  'opacity', 'overflow', 'zIndex',
] as const;

/**
 * CSS.escape polyfill — handles frameworks that generate class names with
 * special characters (Tailwind arbitrary values w-[200px], variants hover:,
 * groups /title, etc). Native CSS.escape() is widely supported.
 */
function escapeClass(cls: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(cls);
  // Fallback: escape anything that's not a letter, digit, -, _, or unicode
  return cls.replace(/([^\w-])/g, '\\$1');
}

/**
 * Strip CSS escape sequences for human-readable display. The escaped form
 * (`text-\[28px\]`) is required for `document.querySelector()` to work but
 * looks awful in UI. This produces the original Tailwind class name as
 * authored (`text-[28px]`).
 *
 * Use only for display — never for selectors that hit querySelector().
 */
export function humanizeSelector(selector: string): string {
  return selector.replace(/\\(.)/g, '$1');
}

function buildSelector(el: Element): string {
  if (el.id) return `#${escapeClass(el.id)}`;

  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .slice(0, 3)
    .map(escapeClass)
    .join('.');
  const selector = classes ? `${tag}.${classes}` : tag;

  // Disambiguate with nth-child if needed
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(el) + 1;
      return `${selector}:nth-child(${index})`;
    }
  }

  return selector;
}

function getRelevantStyles(el: Element): Record<string, string> {
  const computed = getComputedStyle(el);
  const styles: Record<string, string> = {};

  for (const key of STYLE_KEYS) {
    const value = computed.getPropertyValue(
      key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
    );
    if (value && value !== 'none' && value !== 'normal' && value !== 'auto' && value !== '0px') {
      styles[key] = value;
    }
  }

  return styles;
}

function getParentContext(el: Element): string | undefined {
  const parent = el.parentElement;
  if (!parent || parent === document.body) return undefined;

  const selector = buildSelector(parent);
  const computed = getComputedStyle(parent);
  const display = computed.display;
  const direction = computed.flexDirection;
  const gap = computed.gap;

  const parts = [selector];
  if (display.includes('flex')) parts.push(`flex`);
  if (direction && direction !== 'row') parts.push(direction);
  if (gap && gap !== 'normal') parts.push(`gap: ${gap}`);

  return parts.join(', ');
}

type DebugFiber = { _debugStack?: { stack?: string }; return?: DebugFiber | null };

/**
 * The app component that wrote this element's JSX: walk up the fibers to the first
 * one React created from app code, and name the component whose render created it.
 * Inside a library (a chart's <path>, a <Provider>), that is the app component that
 * used the library — RevenueChart, not Recharts' Provider. Undefined without a dev
 * stack (React 18 and older), so the caller falls back to the nearest component.
 */
export function appOwnerName(fiber: DebugFiber | null | undefined): string | undefined {
  for (let current = fiber, depth = 0; current && depth < 200; current = current.return, depth++) {
    const frame = firstAppFrame(current._debugStack?.stack);
    if (frame) return frame.fn;
  }
  return undefined;
}

function getComponentName(el: Element): string | undefined {
  // Check data-component attribute (common pattern)
  const dataComponent = el.getAttribute('data-component')
    || el.getAttribute('data-testid')
    || el.getAttribute('data-ilse-component');
  if (dataComponent) return dataComponent;

  // Try React fiber (works in dev mode)
  const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  if (fiberKey) {
    const fiber = (el as unknown as Record<string, unknown>)[fiberKey] as Record<string, unknown> | undefined;
    const owner = appOwnerName(fiber as DebugFiber | undefined);
    if (owner) return owner;
    if (fiber) {
      let current: Record<string, unknown> | undefined = fiber;
      while (current) {
        const type = current.type;
        if (typeof type === 'function') {
          const fn = type as Function & { displayName?: string };
          const name = fn.name || fn.displayName;
          if (name && typeof name === 'string' && name[0] === name[0].toUpperCase()) {
            return name;
          }
        }
        current = current.return as Record<string, unknown> | undefined;
      }
    }
  }

  return undefined;
}

export type CaptureMode = 'click' | 'text' | 'area';

// --- Smart Identification ---

// Framework internals that pollute the component stack — filter these out
const FRAMEWORK_INTERNALS = new Set([
  'SegmentViewNode', 'InnerLayoutRouter', 'RedirectErrorBoundary', 'RedirectBoundary',
  'HTTPAccessFallbackBoundary', 'NotFoundBoundary', 'LoadingBoundary', 'ErrorBoundary',
  'ClientSegmentRoot', 'OuterLayoutRouter', 'MetadataBoundary', 'Suspense',
  'HotReload', 'ReactDevOverlay', 'Router', 'AppRouter', 'ServerRoot',
  'PathnameContextProviderAdapter', 'HistoryUpdater',
]);

export function getComponentStack(el: Element): string[] {
  const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  if (!fiberKey) return [];

  const fiber = (el as unknown as Record<string, unknown>)[fiberKey] as Record<string, unknown> | undefined;
  if (!fiber) return [];

  const stack: string[] = [];
  let current: Record<string, unknown> | undefined = fiber;

  while (current && stack.length < 5) {
    const type = current.type;
    if (typeof type === 'function') {
      const fn = type as Function & { displayName?: string };
      const name = fn.name || fn.displayName;
      if (name && typeof name === 'string' && /^[A-Z]/.test(name) && !stack.includes(name) && !FRAMEWORK_INTERNALS.has(name)) {
        stack.push(name);
      }
    }
    current = current.return as Record<string, unknown> | undefined;
  }

  return stack;
}

const SAFE_PROP_KEYS = new Set([
  'className', 'id', 'variant', 'size', 'role', 'type', 'disabled',
  'aria-label', 'data-testid', 'href', 'name', 'placeholder',
]);

function getComponentProps(fiber: Record<string, unknown>): Record<string, unknown> {
  let current: Record<string, unknown> | undefined = fiber;
  while (current) {
    const type = current.type;
    if (typeof type === 'function') {
      // Try memoizedProps first, fall back to pendingProps
      const props = (current.memoizedProps ?? current.pendingProps) as Record<string, unknown> | undefined;
      if (props && Object.keys(props).length > 0) {
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) {
          if (SAFE_PROP_KEYS.has(k) && v !== undefined && v !== null && typeof v !== 'function') {
            safe[k] = v;
          }
        }
        if (Object.keys(safe).length > 0) return safe;
      }
    }
    current = current.return as Record<string, unknown> | undefined;
  }
  return {};
}

function buildGrepPattern(el: Element, component?: string, props?: Record<string, unknown>): string {
  const testId = el.getAttribute('data-testid');
  if (testId) return `data-testid="${testId}"`;

  if (component) {
    const discriminating = ['variant', 'size', 'type', 'name', 'id', 'role']
      .find(k => props?.[k] !== undefined);
    if (discriminating) return `<${component} ${discriminating}="${props![discriminating]}"`;
    return `<${component}`;
  }

  if (el.id) return `id="${el.id}"`;
  return buildSelector(el);
}

// Shared helper: computes smart ID fields for any element
function getSmartID(el: Element): { grepPattern: string; componentStack?: string[] } {
  const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  const fiber = fiberKey ? (el as unknown as Record<string, unknown>)[fiberKey] as Record<string, unknown> : undefined;
  const component = getComponentName(el);
  const props = fiber ? getComponentProps(fiber) : {};
  const stack = getComponentStack(el);
  return {
    grepPattern: buildGrepPattern(el, component, props),
    componentStack: stack.length > 0 ? stack : undefined,
  };
}

export interface TextCapture {
  text: string;
  element: string;
  component?: string;
  styles: Record<string, string>;
  rect: { top: number; left: number; width: number; height: number };
  grepPattern?: string;
  componentStack?: string[];
}

export interface AreaCapture {
  elements: Array<{ selector: string; tag: string }>;
  region: { top: number; left: number; width: number; height: number };
  elementCount: number;
}

export function captureTextSelection(): TextCapture | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;

  const text = selection.toString().trim();
  if (!text) return null;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  // Get the parent element of the selection
  let container = range.commonAncestorContainer as Element;
  if (container.nodeType === Node.TEXT_NODE) {
    container = container.parentElement!;
  }

  const { grepPattern, componentStack } = getSmartID(container);

  return {
    text,
    element: buildSelector(container),
    component: getComponentName(container),
    styles: getRelevantStyles(container),
    rect: {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    grepPattern,
    componentStack,
  };
}

export function captureArea(region: { top: number; left: number; width: number; height: number }): AreaCapture {
  // Find all elements within the drawn rectangle
  const elements: Array<{ selector: string; tag: string }> = [];
  const seen = new Set<Element>();

  // Sample points in a grid within the region
  const stepX = Math.max(20, region.width / 10);
  const stepY = Math.max(20, region.height / 10);

  for (let x = region.left; x < region.left + region.width; x += stepX) {
    for (let y = region.top; y < region.top + region.height; y += stepY) {
      const el = document.elementFromPoint(x, y);
      if (el && !seen.has(el) && !el.closest('[data-ilse-toolbar]')) {
        seen.add(el);
        const rect = el.getBoundingClientRect();
        // Only include if element center is within region
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (
          cx >= region.left && cx <= region.left + region.width &&
          cy >= region.top && cy <= region.top + region.height
        ) {
          elements.push({
            selector: buildSelector(el),
            tag: el.tagName.toLowerCase(),
          });
        }
      }
    }
  }

  return {
    elements,
    region,
    elementCount: elements.length,
  };
}

function buildDomPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    const cls = current.classList.length > 0 ? `.${Array.from(current.classList).slice(0, 2).join('.')}` : '';
    const id = current.id ? `#${current.id}` : '';
    parts.unshift(`${tag}${id}${cls}`);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function getNearbyElements(el: Element): string[] {
  const parent = el.parentElement;
  if (!parent) return [];
  return Array.from(parent.children)
    .filter(c => c !== el)
    .slice(0, 4)
    .map(c => {
      const tag = c.tagName.toLowerCase();
      const cls = c.classList.length > 0 ? `.${c.classList[0]}` : '';
      return `${tag}${cls}`;
    });
}

/** Text written directly in this element (not in its children), capped. */
function getOwnText(el: Element): string | undefined {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 80) : undefined;
}

export function captureElement(el: Element): ElementCapture {
  const rect = el.getBoundingClientRect();
  const { grepPattern, componentStack } = getSmartID(el);

  const frames = reactFrames(el);
  return {
    frames,
    element: buildSelector(el),
    component: getComponentName(el),
    styles: getRelevantStyles(el),
    parent: getParentContext(el),
    rect: {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    grepPattern,
    componentStack,
    _scrollX: window.scrollX,
    _scrollY: window.scrollY,
    domPath: buildDomPath(el),
    nearbyElements: getNearbyElements(el),
    text: getOwnText(el),
  };
}
