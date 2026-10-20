/**
 * Client-side design analysis engine.
 * Runs on captured computed styles + DOM element — no API, no AI, no setup.
 *
 * Checks: contrast ratio (WCAG), font size, line height, touch targets,
 * accessibility attributes, semantic HTML.
 */

export type SuggestionSeverity = 'error' | 'warning' | 'info';

export interface Suggestion {
  id: string;
  message: string;
  severity: SuggestionSeverity;
  category: 'contrast' | 'typography' | 'spacing' | 'a11y' | 'component';
  detail?: string;  // extra context (e.g. "Ratio: 2.1:1, AA requires 4.5:1")
}

// ── Color utilities ────────────────────────────────────────────────────────

function parseColor(raw: string): [number, number, number] | null {
  if (!raw || raw === 'transparent' || raw === 'rgba(0, 0, 0, 0)') return null;

  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) return [+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]];

  // #hex
  const hex = raw.replace('#', '');
  if (hex.length === 3) {
    return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
  }
  if (hex.length >= 6) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return null;
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Walk up the DOM to find the effective background color.
 * Handles transparent/unset backgrounds by checking parents.
 */
function getEffectiveBackgroundColor(el: Element): [number, number, number] | null {
  let current: Element | null = el;
  while (current) {
    const bg = getComputedStyle(current).backgroundColor;
    const parsed = parseColor(bg);
    if (parsed) return parsed;
    current = current.parentElement;
  }
  // Default: white
  return [255, 255, 255];
}

// ── Analysis functions ─────────────────────────────────────────────────────

function checkContrast(el: Element, styles: Record<string, string>): Suggestion | null {
  const fg = parseColor(styles.color);
  if (!fg) return null;

  const bg = getEffectiveBackgroundColor(el);
  if (!bg) return null;

  const ratio = contrastRatio(fg, bg);
  const fontSize = parseFloat(styles.fontSize || '16');
  const fontWeight = parseInt(styles.fontWeight || '400');
  const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);

  const aaThreshold = isLargeText ? 3 : 4.5;
  const aaaThreshold = isLargeText ? 4.5 : 7;

  if (ratio < aaThreshold) {
    return {
      id: 'contrast-aa',
      message: `Contrast ratio ${ratio.toFixed(1)}:1 fails WCAG AA`,
      severity: 'error',
      category: 'contrast',
      detail: `Requires ${aaThreshold}:1 for ${isLargeText ? 'large' : 'normal'} text`,
    };
  }
  if (ratio < aaaThreshold) {
    return {
      id: 'contrast-aaa',
      message: `Contrast ratio ${ratio.toFixed(1)}:1 passes AA but fails AAA`,
      severity: 'info',
      category: 'contrast',
      detail: `AAA requires ${aaaThreshold}:1`,
    };
  }
  return null;
}

function checkFontSize(styles: Record<string, string>): Suggestion | null {
  const size = parseFloat(styles.fontSize || '16');
  if (size < 12) {
    return {
      id: 'font-size-min',
      message: `Font size ${size}px is below minimum legibility (12px)`,
      severity: 'warning',
      category: 'typography',
      detail: 'Small text is hard to read on most screens',
    };
  }
  return null;
}

function checkLineHeight(styles: Record<string, string>): Suggestion | null {
  const lineHeight = styles.lineHeight;
  const fontSize = parseFloat(styles.fontSize || '16');
  if (!lineHeight || lineHeight === 'normal') return null;

  const lh = parseFloat(lineHeight);
  // lineHeight can be px or unitless ratio
  const ratio = lh > 4 ? lh / fontSize : lh;

  if (ratio < 1.2) {
    return {
      id: 'line-height',
      message: `Line height ${ratio.toFixed(2)} is too tight`,
      severity: 'warning',
      category: 'typography',
      detail: 'WCAG recommends at least 1.5 for body text',
    };
  }
  return null;
}

function checkTouchTarget(el: Element, styles: Record<string, string>): Suggestion | null {
  const tag = el.tagName;
  const isInteractive = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ||
    tag === 'SELECT' || tag === 'TEXTAREA' ||
    el.getAttribute('role') === 'button' ||
    el.hasAttribute('onclick') || el.getAttribute('tabindex') === '0';

  if (!isInteractive) return null;

  const rect = el.getBoundingClientRect();
  const minSize = 44; // WCAG 2.5.8

  if (rect.width < minSize || rect.height < minSize) {
    const smaller = Math.min(rect.width, rect.height);
    return {
      id: 'touch-target',
      message: `Touch target ${Math.round(rect.width)}×${Math.round(rect.height)}px is too small`,
      severity: 'warning',
      category: 'a11y',
      detail: `Minimum recommended: ${minSize}×${minSize}px (WCAG 2.5.8)`,
    };
  }
  return null;
}

function checkImgAlt(el: Element): Suggestion | null {
  if (el.tagName !== 'IMG') return null;
  const alt = el.getAttribute('alt');
  if (alt === null) {
    return {
      id: 'img-alt',
      message: 'Image missing alt attribute',
      severity: 'error',
      category: 'a11y',
      detail: 'Screen readers cannot describe this image',
    };
  }
  if (alt === '') {
    // Empty alt is valid for decorative images — just info
    return {
      id: 'img-alt-empty',
      message: 'Image has empty alt (decorative)',
      severity: 'info',
      category: 'a11y',
      detail: 'Verify this image is purely decorative',
    };
  }
  return null;
}

function checkSemanticClick(el: Element): Suggestion | null {
  const tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT') return null;

  // Check for click handler indicators
  const hasClick = el.hasAttribute('onclick') ||
    el.getAttribute('role') === 'button' ||
    el.getAttribute('tabindex') === '0';

  // Also check React-attached handlers via __reactFiber
  const elAny = el as unknown as Record<string, unknown>;
  const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
  const hasReactClick = fiberKey ? !!elAny[fiberKey] &&
    Object.keys(elAny[fiberKey] as object || {}).some(k => k.includes('onClick')) : false;

  if (!hasClick && !hasReactClick) return null;

  const hasRole = el.hasAttribute('role');
  const hasTabIndex = el.hasAttribute('tabindex');

  if (!hasRole) {
    return {
      id: 'semantic-role',
      message: `<${tag.toLowerCase()}> with click handler needs role="button"`,
      severity: 'warning',
      category: 'a11y',
      detail: !hasTabIndex ? 'Also add tabindex="0" for keyboard access' : undefined,
    };
  }
  return null;
}

function checkButtonLabel(el: Element): Suggestion | null {
  if (el.tagName !== 'BUTTON') return null;

  const text = el.textContent?.trim();
  const ariaLabel = el.getAttribute('aria-label');
  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  const title = el.getAttribute('title');

  if (!text && !ariaLabel && !ariaLabelledBy && !title) {
    // Check for icon-only button (has SVG/img child)
    const hasIcon = el.querySelector('svg, img');
    return {
      id: 'button-label',
      message: hasIcon ? 'Icon-only button needs aria-label' : 'Button has no accessible label',
      severity: 'error',
      category: 'a11y',
      detail: 'Add aria-label="description" for screen readers',
    };
  }
  return null;
}

// ── Page scan (batch analysis) ─────────────────────────────────────────────

export interface PageIssue extends Suggestion {
  element: Element;
  selector: string;
  rect: { top: number; left: number; width: number; height: number };
}

/**
 * Scan visible page elements for design issues.
 * Uses TreeWalker for efficient traversal, capped at `limit` elements.
 */
export function scanPage(limit = 500): PageIssue[] {
  const issues: PageIssue[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      if (el.closest('[data-ilse-toolbar]')) return NodeFilter.FILTER_REJECT;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'BR') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let count = 0;
  while (walker.nextNode() && count < limit) {
    const el = walker.currentNode as Element;
    const rect = el.getBoundingClientRect();

    // Skip invisible or off-screen
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) continue;

    // Skip hidden elements (display:none, visibility:hidden, opacity:0, aria-hidden)
    const computed = getComputedStyle(el);
    if (computed.display === 'none' || computed.visibility === 'hidden' || computed.opacity === '0') continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    // Skip elements inside hidden parents (closest hidden ancestor)
    if (el.closest('[aria-hidden="true"], [hidden]')) continue;

    count++;
    const styles: Record<string, string> = {
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      lineHeight: computed.lineHeight,
    };

    const elementIssues = analyzeElement(el, styles);
    for (const issue of elementIssues) {
      // Build a simple selector for display
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const cls = !id && el.classList.length > 0 ? `.${el.classList[0]}` : '';
      issues.push({
        ...issue,
        element: el,
        selector: `${tag}${id}${cls}`,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      });
    }
  }

  return issues;
}

// ── Design System token matching ───────────────────────────────────────────

export interface DSToken {
  name: string;
  value: string;
  type: 'color' | 'spacing' | 'typography';
  /** How the panel lists it, when the name alone isn't how a designer reads it ("2 · 8px") */
  label?: string;
  /** What the dropdown shows beside the label (defaults to the value), e.g. the class `shadow-md` */
  hint?: string;
}

let loadedTokens: DSToken[] = [];

/** Load DS tokens for validation. Call once when tokens are configured. */
export function setDSTokens(tokens: DSToken[]) {
  loadedTokens = tokens;
}

export function getDSTokens(): DSToken[] {
  return loadedTokens;
}

/** Parse a W3C design tokens JSON (nested or flat) into DSToken[]. */
export function parseTokensJSON(json: Record<string, unknown>): DSToken[] {
  const tokens: DSToken[] = [];

  function walk(obj: Record<string, unknown>, path: string[]) {
    for (const [key, val] of Object.entries(obj)) {
      if (val && typeof val === 'object' && '$value' in (val as Record<string, unknown>)) {
        const v = val as Record<string, unknown>;
        const value = String(v.$value ?? '');
        const declaredType = String(v.$type ?? '');
        let type: DSToken['type'] = 'typography';
        if (declaredType === 'color' || /^#|^rgb|^hsl/.test(value)) type = 'color';
        else if (declaredType === 'dimension' || declaredType === 'spacing' || /^\d+(px|rem|em|%)$/.test(value)) type = 'spacing';
        tokens.push({ name: [...path, key].join('.'), value, type });
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        walk(val as Record<string, unknown>, [...path, key]);
      }
    }
  }

  walk(json, []);
  return tokens;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function checkColorToken(styles: Record<string, string>): Suggestion | null {
  if (loadedTokens.length === 0) return null;
  const colorTokens = loadedTokens.filter(t => t.type === 'color');
  if (colorTokens.length === 0) return null;

  const fg = parseColor(styles.color);
  if (!fg) return null;

  // Check if this color matches any token
  let closest: { name: string; distance: number } | null = null;
  for (const token of colorTokens) {
    const tokenRgb = parseColor(token.value);
    if (!tokenRgb) continue;
    const dist = colorDistance(fg, tokenRgb);
    if (dist < 5) return null; // exact match (within rounding)
    if (!closest || dist < closest.distance) {
      closest = { name: token.name, distance: dist };
    }
  }

  if (closest && closest.distance < 80) {
    return {
      id: 'ds-color',
      message: `Color not in DS tokens`,
      severity: 'warning',
      category: 'component',
      detail: `Closest: ${closest.name} (distance: ${Math.round(closest.distance)})`,
    };
  }
  return null;
}

function parseSize(value: string): number | null {
  const match = value.match(/^(\d+(?:\.\d+)?)(px|rem|em)?$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = match[2] ?? 'px';
  if (unit === 'rem' || unit === 'em') return num * 16;
  return num;
}

function checkSpacingToken(styles: Record<string, string>): Suggestion | null {
  if (loadedTokens.length === 0) return null;
  const spacingTokens = loadedTokens.filter(t => t.type === 'spacing');
  if (spacingTokens.length === 0) return null;

  // Check gap, padding, margin
  const propsToCheck = ['gap', 'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'];

  for (const prop of propsToCheck) {
    const val = styles[prop];
    if (!val || val === '0px' || val === 'auto' || val === 'normal') continue;
    const px = parseFloat(val);
    if (isNaN(px) || px === 0) continue;

    // Check if this spacing matches any token
    let matches = false;
    let closest: { name: string; distance: number } | null = null;
    for (const token of spacingTokens) {
      const tokenPx = parseSize(token.value);
      if (tokenPx === null) continue;
      const dist = Math.abs(px - tokenPx);
      if (dist < 1) { matches = true; break; }
      if (!closest || dist < closest.distance) {
        closest = { name: token.name, distance: dist };
      }
    }

    if (!matches && closest && closest.distance < 12) {
      return {
        id: 'ds-spacing',
        message: `${prop} ${Math.round(px)}px not in DS spacing scale`,
        severity: 'info',
        category: 'spacing',
        detail: `Closest: ${closest.name} (${closest.distance.toFixed(0)}px off)`,
      };
    }
  }
  return null;
}

// ── Main analysis entry point ──────────────────────────────────────────────

/**
 * Analyze a single element and return suggestions.
 * Designed to run at capture time — fast, synchronous, no side effects.
 */
export function analyzeElement(el: Element, styles: Record<string, string>): Suggestion[] {
  const suggestions: Suggestion[] = [];

  const push = (s: Suggestion | null) => { if (s) suggestions.push(s); };

  push(checkContrast(el, styles));
  push(checkFontSize(styles));
  push(checkLineHeight(styles));
  push(checkTouchTarget(el, styles));
  push(checkImgAlt(el));
  push(checkSemanticClick(el));
  push(checkButtonLabel(el));

  // DS token checks (only if tokens are loaded)
  push(checkColorToken(styles));
  push(checkSpacingToken(styles));

  return suggestions;
}
