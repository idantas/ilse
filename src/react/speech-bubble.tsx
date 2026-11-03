/**
 * What Ilse says: the mascot on the left, her words floating beside her with
 * no card behind them (like the agent's reasoning above the toolbar). Answer
 * buttons go under the words, lined up with them.
 */
import React from 'react';
import { IlseMascot, type MascotMode, type MascotReaction, type MascotState } from './mascot.js';
import { color, radius, shadow, font, modeAccent } from './tokens.js';

/**
 * No card behind the words, so they adapt to the page instead: light grey in
 * `difference` reads dark on white and cream, light on dark pages and photos.
 * Half opacity keeps it quiet, like the agent's reasoning.
 */
export const legibleText: React.CSSProperties = {
  color: '#BABABA',
  mixBlendMode: 'difference',
  opacity: 0.5,
};

/**
 * The agent's answer in the chat: frosted glass over the page, so the words
 * read over busy text and photos too, without a solid card or a glow.
 */
export const chatBubble: React.CSSProperties = {
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  backgroundColor: 'rgba(128,128,128,0.08)',
  padding: '5px 10px',
  borderRadius: 10,
  color: color.mutedForeground,
  mixBlendMode: 'luminosity',
};

/**
 * Words read in full over the page (an error, a reload ask): the chat's frosted
 * bubble made opaque enough to read over grey, busy or dark pages (test 30/10:
 * the faint chat glass vanished on a dimmed app behind a drawer).
 */
export function floatingText(): React.CSSProperties {
  return {
    ...chatBubble,
    backdropFilter: 'blur(16px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
    backgroundColor: 'rgba(255,255,255,0.72)',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.06)',
    color: color.foreground,
    mixBlendMode: 'normal',
    opacity: 1, fontWeight: 500, padding: '8px 12px', justifySelf: 'start',
  };
}

/** One line of reasoning floating above the toolbar: the newest bold, older ones fading */
export function reasoningLine(fromBottom: number): React.CSSProperties {
  return {
    ...legibleText,
    fontWeight: fromBottom === 0 ? 600 : 500,
    // The newest line is read, not glimpsed: near full strength over any page (test 22/10); older ones fade
    opacity: fromBottom === 0 ? 0.9 : fromBottom === 1 ? 0.45 : 0.2,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    transition: 'opacity 0.4s ease',
    animation: fromBottom === 0 ? 'ilse-thinking-in 0.35s ease-out' : undefined,
  };
}

/** The pulsing square before the newest line of reasoning */
export function ReasoningDot({ mode }: { mode: MascotMode }) {
  return (
    <span style={{
      display: 'inline-block', width: 5, height: 5, marginRight: 6, verticalAlign: 'middle',
      background: modeAccent(mode).hex, animation: 'ilse-thinking-dot 1.2s ease-in-out infinite',
    }} />
  );
}

export function SpeechBubble({ mode, state, reaction, mascotSize = 34, children, actions, textStyle }: {
  mode: MascotMode;
  state?: MascotState;
  /** What the mascot does while saying it (toasts) */
  reaction?: MascotReaction;
  mascotSize?: number;
  children: React.ReactNode;
  actions?: React.ReactNode;
  textStyle?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 12, rowGap: 10, alignItems: 'center', fontFamily: font.sans }}>
      <div style={{ display: 'flex', lineHeight: 0 }}>
        <IlseMascot mode={mode} state={state} reaction={reaction} size={mascotSize} />
      </div>
      <div style={{ minWidth: 0, fontSize: 13, lineHeight: 1.45, ...legibleText, ...textStyle }}>
        {children}
      </div>
      {actions && <div style={{ gridColumn: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

/** Answer button under what Ilse says — solid in the mode's colour, or white; both readable over any page */
export function speechButton(mode: MascotMode, primary: boolean): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: radius.md, fontSize: 12, fontWeight: 600, fontFamily: font.sans,
    cursor: 'pointer', whiteSpace: 'nowrap',
    border: primary ? 'none' : `1px solid ${color.border}`,
    background: primary ? modeAccent(mode).hex : color.background,
    color: primary ? '#fff' : color.foreground,
    boxShadow: shadow.sm,
  };
}
