/**
 * The panel's Component section, at the top of Properties — like Figma's.
 *
 * When the selected element is a catalog component (the `<Button>` the app
 * wrote), it shows which one, where it comes from, and its props as controls:
 * a select for each variant-like prop with the values the code already uses
 * or the type allows, and a field for the plain-text props this instance sets.
 * Nothing invented: no value appears here that the code doesn't have.
 */
import React, { useEffect, useState } from 'react';
import { color, font, radius } from './tokens.js';
import { t } from '../i18n/index.js';
import type { ComponentHit } from './catalog-snapshot.js';

export interface PropChange { prop: string; from?: string; to: string }
/** The instance's JSX where it's written, with the picked props in (`propSource` on the CLI) */
export interface PropSourceView { file: string; line: number; code: string; reason?: string }

const label: React.CSSProperties = { width: 60, flexShrink: 0, color: color.mutedForeground, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const control: React.CSSProperties = {
  flex: 1, minWidth: 0, height: 22, fontSize: 11, fontFamily: font.sans, padding: '0 4px', boxSizing: 'border-box',
  borderRadius: radius.sm, border: `1px solid ${color.border}`, background: color.background, color: color.foreground, outline: 'none',
};
const dot = <span title={t('panel.edited')} style={{ width: 5, height: 5, flexShrink: 0, borderRadius: '50%', backgroundColor: '#E8A33D' }} />;

/** `@mui/material` stays; a project file shows its name: `button.tsx` */
export function originLabel(source: string): string {
  return /\.(tsx|jsx|ts|js)$/.test(source) ? source.split('/').pop()! : source;
}

function TextProp({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      style={control}
    />
  );
}

/**
 * A few short choices side by side, like Figma's — one click, and every value
 * in sight. Longer lists stay a select.
 */
export function fitsSegments(options: string[]): boolean {
  return options.length >= 2 && options.length <= 4 && options.reduce((n, o) => n + Math.max(o.length, 1), 0) <= 24;
}

function Segments({ value, options, labels, titles, onChange, name }: { value: string; options: string[]; labels: string[]; titles: string[]; onChange: (v: string) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} style={{ flex: 1, minWidth: 0, display: 'flex', height: 22, padding: 2, gap: 2, boxSizing: 'border-box', borderRadius: radius.sm, background: color.muted }}>
      {options.map((v, i) => {
        const on = v === value;
        return (
          <button
            key={v || '∅'}
            type="button"
            role="radio"
            aria-checked={on}
            title={titles[i]}
            onClick={() => { if (!on) onChange(v); }}
            style={{
              flex: 1, minWidth: 0, padding: '0 3px', border: 'none', borderRadius: 3, cursor: on ? 'default' : 'pointer',
              fontSize: 10, fontFamily: font.sans, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              background: on ? color.background : 'transparent', color: on ? color.foreground : color.mutedForeground,
              boxShadow: on ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            }}
          >{labels[i]}</button>
        );
      })}
    </div>
  );
}

/** Where this instance is written and how it will read — the proof that the panel edits code */
function SourceBlock({ source }: { source: PropSourceView }) {
  const [open, setOpen] = useState(true);
  const file = source.file.split('/').pop();
  return (
    <div style={{ marginTop: 8, border: `1px solid ${color.border}`, borderRadius: radius.sm, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={`${source.file}:${source.line}`}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', padding: '4px 6px', border: 'none', background: color.muted, cursor: 'pointer', fontSize: 10, fontFamily: font.mono, color: color.foreground, textAlign: 'left' }}
      >
        <span style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', color: color.mutedForeground }}>›</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{file}:{source.line}</span>
        <span style={{ color: color.mutedForeground }}>JSX</span>
      </button>
      {open && (
        <pre style={{ margin: 0, padding: '6px 8px', fontSize: 10, lineHeight: 1.45, fontFamily: font.mono, color: color.foreground, background: color.background, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 140, overflow: 'auto' }}>
          {source.code}
        </pre>
      )}
      {source.reason && (
        <div style={{ padding: '4px 8px', fontSize: 10, lineHeight: 1.35, color: color.mutedForeground, borderTop: `1px solid ${color.border}` }}>
          {t('panel.component.viaAgent')}
        </div>
      )}
    </div>
  );
}

export function ComponentSection({ hit, changes, onChange, note, source }: {
  hit: ComponentHit;
  /** Where it's written, once the CLI found it — null: not found, nothing shown */
  source?: PropSourceView | null;
  /** A line under the props (a dropped draft whose picked variant has no copy yet) */
  note?: string;
  changes: PropChange[];
  onChange: (prop: string, value: string) => void;
}) {
  const now = (prop: string) => changes.find(c => c.prop === prop)?.to ?? (hit.props[prop] !== undefined ? String(hit.props[prop]) : '');
  const rows = hit.item.props.filter(p =>
    ((p.kind === 'enum' || p.kind === 'boolean') && (p.values.length > 0 || p.kind === 'boolean'))
    // Plain text the instance sets literally (label="Chamados abertos"): editable in place
    || (p.kind !== 'other' && typeof hit.props[p.name] === 'string' && !/^on[A-Z]/.test(p.name)),
  ).slice(0, 10);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: color.mutedForeground, marginBottom: 6 }}>
        {t('panel.component')}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: rows.length ? 8 : 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: color.foreground }}>{hit.item.name}</span>
        <span title={hit.item.source} style={{ fontSize: 10, color: color.mutedForeground, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ◇ {originLabel(hit.item.source)}
        </span>
      </div>
      {rows.map(p => {
        const value = now(p.name);
        const edited = changes.some(c => c.prop === p.name);
        const isChoice = p.kind === 'enum' || p.kind === 'boolean';
        const options = p.kind === 'boolean' ? ['true', 'false'] : p.values;
        return (
          <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
            <span style={label} title={p.name}>{p.name}</span>
            {isChoice && (() => {
              // The "not set" choice first, as the select has it
              const seg = [...((value === '' || !p.required) ? [''] : []), ...(!options.includes(value) && value !== '' ? [value] : []), ...options];
              const short = seg.map(v => v === '' ? (p.default ?? '—') : v);
              if (!fitsSegments(short)) return null;
              const titles = seg.map(v => v === '' ? (p.default !== undefined ? t('panel.component.default', { value: p.default }) : '—') : v);
              return <Segments name={p.name} value={value} options={seg} labels={short} titles={titles} onChange={(v) => onChange(p.name, v)} />;
            })() || (isChoice ? (
              <select value={value} onChange={(e) => onChange(p.name, e.target.value)} style={control} aria-label={p.name}>
                {/* Not set where it's written: the component's own default, named when the code says it */}
                {(value === '' || !p.required) && <option value="">{p.default !== undefined ? t('panel.component.default', { value: p.default }) : '—'}</option>}
                {!options.includes(value) && value !== '' && <option value={value}>{value}</option>}
                {options.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <TextProp value={value} onCommit={(v) => onChange(p.name, v)} />
            ))}
            {edited ? dot : <span style={{ width: 5, flexShrink: 0 }} />}
          </div>
        );
      })}
      {source && <SourceBlock source={source} />}
      {note && <div style={{ fontSize: 10, color: color.mutedForeground, lineHeight: 1.35, marginTop: 2 }}>{note}</div>}
    </div>
  );
}
