/**
 * Shared types: annotations as the toolbar sends them and the CLI keeps them.
 */

import type { SourceHit } from './context/locate.js';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// Visual Feedback — Annotation types
export type AnnotationStatus = 'pending' | 'sent' | 'resolved';

// What the designer wants the agent to do
// ask / approve require Thread UI (roadmap Phase 2) — not yet active
export type AnnotationIntent = 'fix' | 'change' | 'ask' | 'approve' | 'create' | 'move' | 'resize' | 'chat' | 'analyze' | 'style';

// How critical the annotation is
export type AnnotationSeverity = 'blocking' | 'important' | 'suggestion';

export interface ThreadMessage {
  id: string;
  role: 'human' | 'agent';
  content: string;
  timestamp: number;
}

// Extra data when intent === 'create' (placement in empty space)
export interface PlacementData {
  x: number;
  y: number;
  scrollY: number;
  nearestSelector?: string;  // closest DOM container
}

// Extra data when intent === 'move' (drag to reposition)
export interface RearrangeData {
  selector: string;
  label: string;
  tagName: string;
  originalRect: { x: number; y: number; width: number; height: number };
  currentRect:  { x: number; y: number; width: number; height: number };
}

// Extra data when intent === 'style' (edited directly in the property panel)
//
// The panel offers the project's own design tokens as options, so a change made
// through it is on-standard by construction. `token` records which token the
// value came from; `offToken` marks a value typed by hand while tokens existed
// for that property — the one case the agent should question rather than apply.
export interface StyleChange {
  property: string;   // camelCase CSS property, e.g. "fontWeight"
  from: string;       // computed value before the edit
  to: string;         // value after the edit
  token?: string;     // design token name, when the value came from one
  offToken?: boolean; // true when tokens exist for this property but none matched
}

export interface StyleData {
  selector: string;
  changes: StyleChange[];
}

/** How the annotation came to be — feeds the journal (Settings → Logs) */
export interface AnnotationMeta {
  locateMs?: number;     // CLI time to resolve element → file:line
  composeMs?: number;    // designer time from capture to "add"
  captureMode?: string;  // click | text | area | …
}

export interface Annotation {
  id: string;
  note: string;
  /** Only the designer's own words (the note also carries Ilse's context blocks) */
  designerNote?: string;
  /** Element of a component repeated on the page: edit this instance, or all of them */
  scope?: { component: string; count: number; choice: 'one' | 'all' };
  /** Remove the element (structural: always the agent, never the quick path) */
  remove?: boolean;
  element: string;           // CSS selector (e.g. "button.cta-primary")
  component?: string;        // React component name
  styles: Record<string, string>;  // computed styles
  parent?: string;           // parent element context
  imageRef?: string;         // base64 image reference (single, legacy)
  imageRefs?: string[];      // base64 image references (multiple)
  imageFilenames?: string[]; // original filenames (parallel to imageRefs)
  grepPattern?: string;      // best grep string for finding in code
  componentStack?: string[]; // parent component hierarchy
  domPath?: string;          // full DOM path (body > main > div.container > ...)
  nearbyElements?: string[]; // sibling elements
  text?: string;             // element's own visible text (short) — helps locate the source
  source?: SourceHit[];      // file:line candidates located by the CLI before the agent runs
  meta?: AnnotationMeta;     // experience metadata for the journal — never the prompt text
  position?: { top: number; left: number; width: number; height: number };
  environment?: {
    viewport: string;
    url: string;
    userAgent: string;
    devicePixelRatio: number;
    timestamp: string;
  };
  status: AnnotationStatus;
  resolvedSummary?: string;  // summary from agent after resolving
  timestamp: string;
  // Schema rico (Agentation AFS v1.1)
  intent?:        AnnotationIntent;
  severity?:      AnnotationSeverity;
  session?:       string;
  sequence?:      number;
  thread?:        ThreadMessage[];
  placementData?: PlacementData;
  rearrangeData?: RearrangeData;
  styleData?:     StyleData;
}
