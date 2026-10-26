import { parseCode, walkAST } from './ast.js';
import type { Result } from '../types.js';

export interface ImplicitComponent {
  pattern: string;          // "div onClick" | "button icon-only" | "img container"
  signature: string;        // structural signature for grouping
  occurrences: number;
  files: Array<{ file: string; line: number }>;
  variants: string[];       // different className combinations found
  suggestedName?: string;   // AI will fill this later
}

interface ElementSignature {
  tag: string;
  hasOnClick: boolean;
  hasHref: boolean;
  childTags: string[];
  classPatterns: string[];  // normalized class groups
  file: string;
  line: number;
  rawClasses: string;
}

/**
 * Extract structural signature from className for grouping.
 * Strips specific values, keeps structure.
 * "flex items-center gap-2 p-3 rounded-lg bg-muted" → "flex layout rounded bg"
 */
function normalizeClassPattern(className: string): string {
  const classes = className.split(/\s+/).filter(Boolean);
  const patterns = new Set<string>();

  for (const cls of classes) {
    const base = cls.replace(/^(?:\w+:)+/, ''); // strip prefixes
    if (/^(flex|inline-flex|grid|block|inline)/.test(base)) patterns.add('layout');
    if (/^(items|justify|content|place)-/.test(base)) patterns.add('alignment');
    if (/^(gap|space)-/.test(base)) patterns.add('gap');
    if (/^(p|px|py|pt|pr|pb|pl)-/.test(base)) patterns.add('padding');
    if (/^(m|mx|my|mt|mr|mb|ml)-/.test(base)) patterns.add('margin');
    if (/^rounded/.test(base)) patterns.add('rounded');
    if (/^(bg|text|border)-/.test(base)) patterns.add('themed');
    if (/^(w|h|min-w|max-w|min-h|max-h|size)-/.test(base)) patterns.add('sized');
    if (/^(cursor|pointer|select)/.test(base)) patterns.add('interactive');
    if (/^(transition|duration|ease|animate)/.test(base)) patterns.add('animated');
    if (/^(hover|focus|active):/.test(cls)) patterns.add('has-states');
    if (/^(absolute|relative|fixed|sticky)/.test(base)) patterns.add('positioned');
    if (/^(overflow|truncate|line-clamp)/.test(base)) patterns.add('overflow');
  }

  return Array.from(patterns).sort().join('+');
}

/**
 * Get child element tags from a JSX element.
 */
function getChildTags(node: any): string[] {
  const tags: string[] = [];
  if (!node.children) return tags;

  for (const child of node.children) {
    if (child.type === 'JSXElement' && child.openingElement?.name?.type === 'JSXIdentifier') {
      tags.push(child.openingElement.name.name);
    } else if (child.type === 'JSXElement' && child.openingElement?.name?.type === 'JSXMemberExpression') {
      // e.g. Lucide.Icon
      tags.push('Icon');
    } else if (child.type === 'JSXText' && child.value?.trim()) {
      tags.push('text');
    } else if (child.type === 'JSXExpressionContainer') {
      tags.push('expr');
    }
  }

  return tags.sort();
}

/**
 * Scan files for repeated JSX patterns that could be extracted as components.
 */
export async function findPatterns(
  files: Array<{ path: string; code: string }>,
  minOccurrences = 3,
): Promise<Result<ImplicitComponent[]>> {
  const signatures: ElementSignature[] = [];

  for (const file of files) {
    const parseResult = parseCode(file.code, file.path);
    if (!parseResult.ok) continue;

    await walkAST(parseResult.value, {
      JSXOpeningElement(path) {
        const node = path.node;
        const parentNode = path.parent;

        // Only look at native HTML elements (div, button, span, a, img)
        if (node.name.type !== 'JSXIdentifier') return;
        const tag = node.name.name;
        if (tag[0] === tag[0].toUpperCase()) return; // Skip React components

        const line = node.loc?.start.line || 0;

        // Collect attributes
        let hasOnClick = false;
        let hasHref = false;
        let className = '';

        for (const attr of node.attributes) {
          if (attr.type !== 'JSXAttribute' || attr.name.type !== 'JSXIdentifier') continue;
          if (attr.name.name === 'onClick') hasOnClick = true;
          if (attr.name.name === 'href') hasHref = true;
          if (attr.name.name === 'className' || attr.name.name === 'class') {
            if (attr.value?.type === 'StringLiteral') {
              className = attr.value.value;
            } else if (
              attr.value?.type === 'JSXExpressionContainer' &&
              attr.value.expression.type === 'StringLiteral'
            ) {
              className = attr.value.expression.value;
            }
          }
        }

        // Only track interactive or styled elements
        if (!hasOnClick && !hasHref && !className) return;

        const childTags = parentNode?.type === 'JSXElement' ? getChildTags(parentNode) : [];
        const classPattern = normalizeClassPattern(className);

        signatures.push({
          tag,
          hasOnClick,
          hasHref,
          childTags,
          classPatterns: classPattern ? [classPattern] : [],
          file: file.path,
          line,
          rawClasses: className,
        });
      },
    });
  }

  // Group by structural similarity
  const groups = new Map<string, ElementSignature[]>();

  for (const sig of signatures) {
    // Build a grouping key: tag + interactivity + child structure + class pattern
    const key = [
      sig.tag,
      sig.hasOnClick ? 'onClick' : '',
      sig.hasHref ? 'href' : '',
      sig.childTags.join(','),
      sig.classPatterns.join(','),
    ].filter(Boolean).join('|');

    const existing = groups.get(key) || [];
    existing.push(sig);
    groups.set(key, existing);
  }

  // Convert to ImplicitComponent (only patterns that repeat often enough)
  const components: ImplicitComponent[] = [];

  for (const [key, sigs] of groups) {
    if (sigs.length < minOccurrences) continue;

    // Determine pattern name
    const firstSig = sigs[0];
    let pattern = firstSig.tag;
    if (firstSig.hasOnClick) pattern += ' onClick';
    if (firstSig.hasHref) pattern += ' link';
    if (firstSig.childTags.length > 0) {
      const hasIcon = firstSig.childTags.some((t) =>
        /icon|svg|chevron|arrow|x|check|plus|minus|star/i.test(t),
      );
      const hasText = firstSig.childTags.includes('text');
      if (hasIcon && !hasText) pattern += ' (icon-only)';
      if (hasIcon && hasText) pattern += ' (icon+text)';
    }

    // Collect unique className variants
    const variants = new Set<string>();
    for (const sig of sigs) {
      // Whole: test mode looks for these exact class lists on the rendered pages
      if (sig.rawClasses) variants.add(sig.rawClasses.trim().replace(/\s+/g, ' ').substring(0, 300));
    }

    // Unique files
    const fileLocations = sigs.map((s) => ({ file: s.file, line: s.line }));

    components.push({
      pattern,
      signature: key,
      occurrences: sigs.length,
      files: fileLocations,
      variants: Array.from(variants).slice(0, 8),
    });
  }

  // Sort by occurrences (most repeated first)
  components.sort((a, b) => b.occurrences - a.occurrences);

  return { ok: true, value: components };
}
