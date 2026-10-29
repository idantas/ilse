/** A button in Ilse's pill — the toolbar's and the Screens bar's, so both look and behave alike. */

import { modeAccent } from './tokens.js';

export function PillBtn({
  children, title, onClick, active, danger, disabled, badge, pulsing, accent = modeAccent('design'),
}: {
  accent?: { hex: string; rgb: string };
  children: React.ReactNode;
  title?: string;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  badge?: number;
  pulsing?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      disabled={disabled}
      style={{
        background: pulsing
          ? `rgba(${accent.rgb},0.1)`
          : active ? (danger ? 'rgba(239,68,68,0.08)' : `rgba(${accent.rgb},0.1)`) : 'none',
        border: 'none',
        color: disabled ? '#c0c0c0' : pulsing ? accent.hex : danger ? '#ef4444' : active ? accent.hex : '#2D2D2D',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 16,
        padding: '6px 9px',
        borderRadius: 8,
        lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
        transition: 'color 0.15s, background 0.15s',
        animation: pulsing ? 'ilse-run-pulse 1.2s ease-in-out infinite' : undefined,
      }}
      onMouseEnter={(e) => { if (!disabled && !pulsing) (e.currentTarget as HTMLElement).style.background = danger ? 'rgba(239,68,68,0.08)' : `rgba(${accent.rgb},0.06)`; }}
      onMouseLeave={(e) => { if (!pulsing) (e.currentTarget as HTMLElement).style.background = active ? (danger ? 'rgba(239,68,68,0.08)' : `rgba(${accent.rgb},0.1)`) : 'none'; }}
    >
      {children}
      {badge !== undefined && (
        <span style={{
          position: 'absolute', top: -4, right: -4,
          backgroundColor: accent.hex, color: 'white',
          fontSize: 9, borderRadius: 7, minWidth: 14, height: 14,
          padding: '0 3px', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}
