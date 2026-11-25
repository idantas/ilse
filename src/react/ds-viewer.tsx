/**
 * The DS window: what Create DS / Export gave the user, on screen.
 *
 * One tab per file in .ilse/ds, each saying who reads it and how to use it. DESIGN.md is drawn
 * as a design system (swatches, scales, components and their variants) with the file a click
 * away; tokens.json and registry.json show the file. Without Pro those two show a blurred
 * sample of what they'd hold, so the person sees what Pro adds instead of just a lock.
 * Laid out like the expanded test report: centered over a dimmed page, the same size.
 */

import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from '@tabler/icons-react';
import { color, font, ilse, proText, radius, shadow } from './tokens.js';
import { t, type MessageKey } from '../i18n/index.js';
import { groupColors, type ColorGroup } from './color-groups.js';

/** The bridge's `ds_view` (ds-export.ts DsView) */
export interface DsViewData {
  dir: string;
  files: Array<{ name: string; content: string }>;
  tokens: Array<{ name: string; value: string; type: string; description?: string }>;
  components: Array<{ name: string; uses: number; layer?: string; feature?: string; props: Array<{ name: string; values?: string[] }>; whenToUse?: string; avoid?: string; edited?: boolean }>;
  formats: boolean;
  agents: { linked: string | null; target: string };
  rules?: string[];
  /** Pro's tokens file per theme (`tokens.dark.json`) */
  modes?: Array<{ name: string; content: string }>;
  themes?: Array<{ name: string; values: Record<string, string> }>;
  /** The copy published for people without Ilse */
  /** `path`: where the copy really is ("spine.ds" alone doesn't say), home shown as ~ */
  publish?: { to: string | null; suggested: string; path?: string };
  /** Why the last publish didn't happen (publishProblem's code) */
  publishError?: string;
}

/** The fresh-agent test's state in the toolbar (Pro) */
export type DsCheckState =
  | { status: 'running' }
  | { status: 'failed' }
  | { status: 'done'; tasks: Array<{ task: string; code: string; problems: string[] }>; rules: string[] };

/** Pro: an agent that knows only DESIGN.md does a few tasks; its mistakes become rules the person can add */
function CheckSection({ state, rules, onRun, onAddRule }: { state: DsCheckState | null; rules: string[]; onRun: () => void; onAddRule: (rules: string[]) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const done = state?.status === 'done' ? state : null;
  if (!done) {
    return (
      <div style={{ paddingBottom: 10, borderBottom: `1px solid ${color.border}`, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span title={t('dsv.checkHint')} style={{ flex: 1, minWidth: 0, fontSize: 11, color: color.mutedForeground }}>{t('dsv.check')}</span>
          {state?.status !== 'running' && <button onClick={onRun} title={t('dsv.checkHint')} style={button}>{t('dsv.checkRun')}</button>}
        </div>
        {state?.status === 'running' && <div style={{ fontSize: 11, color: ilse.brand, marginTop: 8 }}>{t('dsv.checkRunning')}</div>}
        {state?.status === 'failed' && <div style={{ fontSize: 11, color: color.mutedForeground, marginTop: 8 }}>{t('dsv.checkFailed')}</div>}
      </div>
    );
  }
  // The result is the proof the DS works (or where it doesn't), so it gets the stage: a score, then what the DS is missing
  const ok = done.tasks.filter(task => !task.problems.length).length;
  const isIn = (r: string) => rules.includes(r.trim().replace(/^[-*]\s*/, ''));
  const pending = done.rules.filter(r => !isIn(r));
  return (
    <div style={{ padding: 14, borderRadius: radius.md, background: ilse.orangePale, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={label}>{t('dsv.check')}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: color.foreground, fontVariantNumeric: 'tabular-nums' }}>{t('dsv.checkScore', { ok, n: done.tasks.length })}</span>
            <span style={{ fontSize: 12, color: color.foreground }}>{t('dsv.checkScoreLabel')}</span>
          </div>
          <div style={{ fontSize: 11, color: color.mutedForeground, marginTop: 2 }}>{t('dsv.checkWho', { n: done.tasks.length })}</div>
        </div>
        <button onClick={onRun} style={button}>{t('dsv.checkAgain')}</button>
      </div>
      <div style={{ marginTop: 10, borderRadius: radius.sm, background: color.background, padding: '2px 10px' }}>
        {done.tasks.map((task, i) => (
          <div key={i} style={{ padding: '6px 0', borderTop: i ? `1px solid ${color.border}` : 'none', fontSize: 11 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ width: 12, color: task.problems.length ? '#ef4444' : '#16a34a' }}>{task.problems.length ? '✗' : '✓'}</span>
              <span style={{ flex: 1, color: color.foreground }}>{task.task}</span>
              {task.code && <button onClick={() => setOpen(open === i ? null : i)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 10, color: color.mutedForeground, textDecoration: 'underline' }}>{t('dsv.checkCode')}</button>}
            </div>
            {task.problems.map(p => <div key={p} style={{ marginLeft: 18, fontSize: 10.5, color: color.mutedForeground, fontFamily: font.mono }}>{p}</div>)}
            {open === i && <pre style={{ ...pre, marginTop: 6, maxHeight: 220, overflow: 'auto' }}>{task.code}</pre>}
          </div>
        ))}
      </div>
      {done.tasks.length > 0 && ok === done.tasks.length && (
        <div style={{ fontSize: 11, color: '#16a34a', marginTop: 8 }}>{t('dsv.checkAllGood')}</div>
      )}
      {done.rules.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: color.foreground }}>{t('dsv.rules')}</span>
            {pending.length > 1 && <button onClick={() => onAddRule(pending)} style={primary}>{t('dsv.addAll', { n: pending.length })}</button>}
          </div>
          {done.rules.map(r => (
            <div key={r} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', marginTop: 4, borderRadius: radius.sm, background: color.background, fontSize: 11, lineHeight: 1.45, color: color.foreground }}>
              <span style={{ flex: 1 }}>{r}</span>
              {isIn(r)
                ? <span style={{ fontSize: 10.5, color: ilse.brand, fontWeight: 600, whiteSpace: 'nowrap' }}>✓ {t('dsv.ruleAdded')}</span>
                : <button onClick={() => onAddRule([r])} style={pending.length > 1 ? button : primary}>{t('dsv.addRule')}</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = 'DESIGN.md' | 'tokens.json' | 'registry.json';

const button: React.CSSProperties = {
  border: `1px solid ${color.border}`, borderRadius: radius.sm, background: color.background, color: color.foreground, cursor: 'pointer',
  fontSize: 11, fontFamily: font.sans, padding: '5px 10px', whiteSpace: 'nowrap',
};
const primary: React.CSSProperties = { ...button, border: 'none', background: ilse.brand, color: '#fff', fontWeight: 600 };
const label: React.CSSProperties = { fontSize: 9, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: color.mutedForeground };
const pre: React.CSSProperties = {
  margin: 0, padding: 10, borderRadius: radius.md, background: color.muted, color: color.foreground,
  fontFamily: font.mono, fontSize: 10.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
};

type SavePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) =>
  Promise<{ createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> }>;

type Saved = 'saved' | 'downloaded' | 'cancelled';

const PICKER_TYPES: Record<string, { description: string; accept: Record<string, string[]> }> = {
  json: { description: 'JSON', accept: { 'application/json': ['.json'] } },
  md: { description: 'Markdown', accept: { 'text/markdown': ['.md'] } },
  zip: { description: 'ZIP', accept: { 'application/zip': ['.zip'] } },
};

/** Asks where to save (Chrome/Edge's save dialog); browsers without it download to the usual folder */
async function save(name: string, content: string | Blob): Promise<Saved> {
  const ext = name.split('.').pop() ?? 'md';
  const blob = typeof content === 'string' ? new Blob([content], { type: ext === 'json' ? 'application/json' : 'text/markdown' }) : content;
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name, types: [PICKER_TYPES[ext] ?? PICKER_TYPES.md] });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return 'saved';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled'; // closed the dialog: nothing saved, on purpose
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

/** One Download, two ways: the file for a tool (DESIGN.md for Claude Design, v0, an agent) or everything as a .zip */
function DownloadMenu({ options }: { options: Array<{ label: string; hint: string; run: () => Promise<Saved | 'failed'> }> }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'busy' | Saved | 'failed'>('idle');
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  const run = async (o: typeof options[number]) => {
    setOpen(false);
    setState('busy');
    const out = await o.run().catch(() => 'failed' as const);
    setState(out === 'cancelled' ? 'idle' : out);
    if (out !== 'cancelled') setTimeout(() => setState('idle'), 4000);
  };
  const label = state === 'busy' ? '…' : state === 'saved' ? `✓ ${t('dsv.saved')}` : state === 'downloaded' ? `✓ ${t('dsv.downloaded')}` : state === 'failed' ? t('dsv.saveFailed') : `${t('dsv.download')} ▾`;
  return (
    <span ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => { if (state !== 'busy') setOpen(v => !v); }} aria-haspopup="menu" aria-expanded={open} aria-live="polite" style={{ ...primary, whiteSpace: 'nowrap' }}>{label}</button>
      {open && (
        <span role="menu" style={{
          position: 'absolute', right: 0, bottom: 'calc(100% + 6px)', width: 280, padding: 4, display: 'flex', flexDirection: 'column',
          background: color.popover, border: `1px solid ${color.border}`, borderRadius: radius.md, boxShadow: shadow.lg, zIndex: 3,
        }}>
          {options.map(o => (
            <button key={o.label} role="menuitem" onClick={() => void run(o)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '6px 8px', border: 'none', borderRadius: radius.sm,
              background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: font.sans,
            }}
              onMouseEnter={e => { e.currentTarget.style.background = color.muted; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: color.foreground }}>{o.label}</span>
              <span style={{ fontSize: 10.5, lineHeight: 1.4, color: color.mutedForeground }}>{o.hint}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function CopyButton({ text, children, style, title }: { text: string; children: React.ReactNode; style?: React.CSSProperties; title?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }); }}
      title={title}
      style={{ ...button, ...style }}
    >{done ? `✓ ${t('dsv.copied')}` : children}</button>
  );
}

/** Who reads the file and how it gets there */
function ForWhom({ who, how, action, quiet }: { who: string; how: string; action?: React.ReactNode; quiet?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 10, marginBottom: 12, borderBottom: `1px solid ${color.border}`, fontSize: 11, lineHeight: 1.45 }}>
      <div title={quiet ? how : undefined} style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: color.foreground }}>{who}</div>
        {/* The steps matter where the file goes to another tool; for agents one line is enough */}
        {!quiet && <div style={{ color: color.mutedForeground, marginTop: 2 }}>{how}</div>}
      </div>
      {action}
    </div>
  );
}

/** A copy of the DS, with a README, in a folder the person names: for teammates and tools without Ilse */
function PublishRow({ publish, error, onPublish, onReveal }: { publish: NonNullable<DsViewData['publish']>; error?: string; onPublish: (to: string | null) => void; onReveal?: () => void }) {
  const [editing, setEditing] = useState(!publish.to);
  const [to, setTo] = useState(publish.to ?? '');
  useEffect(() => { if (publish.to && !error) setEditing(false); }, [publish.to, error]);
  const go = () => onPublish(to.trim() || publish.suggested);
  return (
    <div style={{ paddingBottom: 10, marginBottom: 12, borderBottom: `1px solid ${color.border}`, fontSize: 11, lineHeight: 1.45 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: color.foreground }}>{t('dsv.publishWho')}</div>
          <div style={{ color: color.mutedForeground, marginTop: 2 }}>
            {publish.to && !editing ? t('dsv.publishedHow', { folder: publish.path ?? publish.to }) : t('dsv.publishHow')}
          </div>
        </div>
        {publish.to && !editing ? (
          <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
            <span title={publish.path} style={{ color: ilse.brand, fontWeight: 600, whiteSpace: 'nowrap' }}>✓ {publish.to}</span>
            {onReveal && <button onClick={onReveal} style={button}>{t('dsv.publishOpen')}</button>}
            <button onClick={() => { setTo(publish.to ?? ''); setEditing(true); }} style={button}>{t('dsv.publishChange')}</button>
            <button onClick={() => onPublish(null)} style={{ ...button, border: 'none', background: 'none', color: color.mutedForeground }}>{t('dsv.publishStop')}</button>
          </span>
        ) : (
          <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder={publish.suggested}
              onKeyDown={e => { if (e.key === 'Enter') go(); if (e.key === 'Escape' && publish.to) { e.stopPropagation(); setEditing(false); } }}
              aria-label={t('dsv.publishFolder')} title={t('dsv.publishFolderHint')}
              style={{ ...field, width: 170, padding: '4px 6px', fontFamily: font.mono }} />
            <button onClick={go} style={primary}>{t('dsv.publish')}</button>
          </span>
        )}
      </div>
      {error && <div role="alert" style={{ color: color.destructive, marginTop: 6 }}>{t(`cli.dsPublish.${error}` as Parameters<typeof t>[0], { folder: to.trim() || publish.suggested })}</div>}
    </div>
  );
}

const group = (name: string) => name.split('.')[0];

/** DESIGN.md drawn as a DS: the tokens as swatches and scales, the components with their variants */
/** What the person can change in the DS from here: the reasoning (written at once, no AI) and the name (the agent renames it in the code) */
export interface DsEditing {
  onEdit: (kind: 'component' | 'token', name: string, fields: { whenToUse?: string; avoid?: string; description?: string }) => void;
  onRename: (kind: 'component' | 'token', name: string, to: string) => void;
  /** Pro: the agent drafts a component's reasoning; undefined without Pro */
  onSuggest?: (name: string) => void;
  /** The draft that came back (or 'loading' / null when the agent had nothing) */
  suggestion?: { name: string; note: { whenToUse: string; avoid?: string } | null | 'loading' } | null;
  /** Pro's agent is writing the missing notes right now: an empty one says so instead of asking */
  describing?: boolean;
}

export const field: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontFamily: font.sans, fontSize: 11, lineHeight: 1.45, color: color.foreground,
  padding: '5px 7px', border: `1px solid ${color.border}`, borderRadius: radius.sm, background: color.background, resize: 'vertical',
};
export const linkBtn: React.CSSProperties = { border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: font.sans, fontSize: 10.5, fontWeight: 600, color: ilse.brand };
export const saveBtn: React.CSSProperties = { border: 'none', borderRadius: radius.sm, padding: '4px 10px', cursor: 'pointer', fontFamily: font.sans, fontSize: 10.5, fontWeight: 600, color: '#fff', background: ilse.brand };

/** A name with a pencil: Enter asks the agent to rename it everywhere in the code */
function RenameName({ name, kind, editing, children }: { name: string; kind: 'component' | 'token'; editing?: DsEditing; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(name);
  if (!editing) return <>{children}</>;
  if (open) {
    const done = () => { setOpen(false); const v = to.trim(); if (v && v !== name) editing.onRename(kind, name, v); };
    return (
      <input autoFocus value={to} onChange={e => setTo(e.target.value)} onBlur={() => setOpen(false)}
        onKeyDown={e => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
        aria-label={t('dsv.renameLabel', { name })} title={t('dsv.renameHint')}
        style={{ ...field, width: 150, padding: '2px 5px', fontFamily: kind === 'token' ? font.mono : font.sans }} />
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {children}
      <button onClick={() => { setTo(name); setOpen(true); }} title={t('dsv.rename')} aria-label={t('dsv.renameLabel', { name })}
        style={{ ...linkBtn, color: color.mutedForeground, fontWeight: 400, fontSize: 10 }}>✎</button>
    </span>
  );
}

/** A component's reasoning: read, edit, or have the agent draft it (the person keeps it or not) */
function ComponentNote({ c, editing, indent }: { c: DsViewData['components'][number]; editing?: DsEditing; indent: number }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(c.whenToUse ?? '');
  const [avoid, setAvoid] = useState(c.avoid ?? '');
  const sug = editing?.suggestion?.name === c.name ? editing.suggestion.note : undefined;
  // A draft arrived: open it to be read and kept, never written on its own
  useEffect(() => {
    if (sug && sug !== 'loading') { setWhen(sug.whenToUse); if (sug.avoid) setAvoid(sug.avoid); setOpen(true); }
  }, [sug]);
  const box: React.CSSProperties = { fontSize: 10.5, lineHeight: 1.45, color: color.foreground, margin: `2px 0 0 ${indent}px` };
  if (open && editing) {
    return (
      <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: 5, padding: '4px 0 6px' }}>
        <label style={{ color: color.mutedForeground }}>{t('dsv.whenToUse')}
          <textarea rows={2} value={when} onChange={e => setWhen(e.target.value)} placeholder={t('dsv.whenPlaceholder')} style={field} />
        </label>
        <label style={{ color: color.mutedForeground }}>{t('dsv.avoid')}
          <textarea rows={1} value={avoid} onChange={e => setAvoid(e.target.value)} placeholder={t('dsv.avoidPlaceholder')} style={field} />
        </label>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={saveBtn} onClick={() => { editing.onEdit('component', c.name, { whenToUse: when, avoid }); setOpen(false); }}>{t('dsv.save')}</button>
          <button style={{ ...linkBtn, color: color.mutedForeground }} onClick={() => { setWhen(c.whenToUse ?? ''); setAvoid(c.avoid ?? ''); setOpen(false); }}>{t('dsv.cancel')}</button>
          {sug && sug !== 'loading' && <span style={{ color: color.mutedForeground }}>{t('dsv.drafted')}</span>}
        </span>
      </div>
    );
  }
  if (c.whenToUse) {
    return (
      <div style={box}>
        <span style={{ color: color.mutedForeground }}>{t('dsv.whenToUse')}: </span>{c.whenToUse}
        {c.avoid && <><br /><span style={{ color: color.mutedForeground }}>{t('dsv.avoid')}: </span>{c.avoid}</>}
        {editing && <> <button style={linkBtn} onClick={() => setOpen(true)}>{t('dsv.edit')}</button></>}
        {c.edited && <span style={{ color: color.mutedForeground }}> · {t('dsv.byYou')}</span>}
      </div>
    );
  }
  if (!editing) return null;
  if (editing.describing && sug === undefined) return <div style={{ ...box, color: color.mutedForeground }}>{t('dsv.describing')}</div>;
  // No reasoning yet: the DS asks for one — every component says why it exists
  return (
    <div style={{ ...box, display: 'flex', gap: 10, alignItems: 'center', color: color.mutedForeground }}>
      <span>{t('dsv.noNote')}</span>
      <button style={linkBtn} onClick={() => setOpen(true)}>{t('dsv.write')}</button>
      {editing.onSuggest && (sug === 'loading'
        ? <span>{t('dsv.drafting')}</span>
        : <button style={linkBtn} onClick={() => editing.onSuggest!(c.name)}>{t(sug === null ? 'dsv.suggestAgain' : 'dsv.suggest')}</button>)}
    </div>
  );
}

/** The token picked in the swatches: its reasoning and its name */
function TokenNote({ tk, editing, onClose }: { tk: DsViewData['tokens'][number]; editing: DsEditing; onClose: () => void }) {
  const [text, setText] = useState(tk.description ?? '');
  useEffect(() => setText(tk.description ?? ''), [tk.name, tk.description]);
  return (
    <div style={{ margin: '0 0 14px', padding: 8, border: `1px solid ${color.border}`, borderRadius: radius.md, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
        {tk.type === 'color' && <span style={{ width: 14, height: 14, borderRadius: radius.sm, background: tk.value, border: `1px solid ${color.border}` }} />}
        <RenameName name={tk.name} kind="token" editing={editing}><b style={{ fontFamily: font.mono }}>{tk.name}</b></RenameName>
        <span style={{ fontFamily: font.mono, fontSize: 10, color: color.mutedForeground }}>{tk.value}</span>
        <button onClick={onClose} aria-label={t('dsv.cancel')} style={{ ...linkBtn, marginLeft: 'auto', color: color.mutedForeground }}>✕</button>
      </span>
      <textarea rows={2} value={text} onChange={e => setText(e.target.value)} placeholder={t('dsv.tokenPlaceholder')} style={field} />
      <span><button style={saveBtn} onClick={() => { editing.onEdit('token', tk.name, { description: text }); onClose(); }}>{t('dsv.save')}</button></span>
    </div>
  );
}

// ── Colours: by role, per theme ───────────────────────────────────────────

/** A colour as a person reads it: #RRGGBB (and its opacity), whatever the CSS wrote (oklch, rgb()) */
const hexCache = new Map<string, string>();
function hexOf(value: string): string {
  const hit = hexCache.get(value);
  if (hit !== undefined) return hit;
  let out = value;
  try {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.fillStyle = '#010203';
      ctx.fillStyle = value;
      // The browser kept the probe: not a colour it can draw
      if (ctx.fillStyle !== '#010203' || value.trim().toLowerCase() === '#010203') {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        out = '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase() + (a < 255 ? ` ${Math.round(a / 2.55)}%` : '');
      }
    }
  } catch { /* no canvas: the authored value */ }
  hexCache.set(value, out);
  return out;
}

// See-through colours over a checkerboard, so 4% black reads as "barely there", not white
const CHECKER = 'repeating-conic-gradient(#d4d4d4 0% 25%, #fff 0% 50%) 0 0 / 8px 8px';

function Swatch({ value, on, size }: { value: string; on?: string; size: number }) {
  return (
    <span style={{ width: size, height: size, flexShrink: 0, borderRadius: radius.md, border: `1px solid ${color.border}`, background: CHECKER, overflow: 'hidden', display: 'flex' }}>
      <span style={{ flex: 1, background: value, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size > 26 ? 12 : 10, fontWeight: 600, color: on }}>
        {on ? 'Aa' : null}
      </span>
    </span>
  );
}

const THEME_KEY = 'ilse-ds-theme';

// ── The window's size: the person's, per browser ──────────────────────────

const SIZE_KEY = 'ilse-ds-window';
const MIN = { w: 480, h: 360 };

function readSize(): { w: number; h: number } | null {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null') as { w?: unknown; h?: unknown } | null;
    return s && typeof s.w === 'number' && typeof s.h === 'number' ? { w: s.w, h: s.h } : null;
  } catch { return null; }
}

/**
 * Edges and corner that resize the window. It stays centred, so a drag grows it on both sides:
 * twice the drag, and the edge stays under the pointer.
 */
function ResizeHandles({ box, onSize }: { box: () => HTMLElement | null; onSize: (s: { w: number; h: number } | null) => void }) {
  const start = (e: React.PointerEvent, dx: 0 | 1, dy: 0 | 1) => {
    const el = box();
    if (!el || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    let last = { w: r.width, h: r.height };
    const move = (ev: PointerEvent) => {
      last = {
        w: Math.round(Math.min(Math.max(r.width + dx * 2 * (ev.clientX - x0), MIN.w), window.innerWidth - 16)),
        h: Math.round(Math.min(Math.max(r.height + dy * 2 * (ev.clientY - y0), MIN.h), window.innerHeight - 16)),
      };
      onSize(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      document.body.style.cursor = '';
      try { localStorage.setItem(SIZE_KEY, JSON.stringify(last)); } catch { /* not kept */ }
    };
    document.body.style.cursor = dx && dy ? 'nwse-resize' : dx ? 'ew-resize' : 'ns-resize';
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  };
  const reset = () => { onSize(null); try { localStorage.removeItem(SIZE_KEY); } catch { /* not kept */ } };
  const edge: React.CSSProperties = { position: 'absolute', zIndex: 2, touchAction: 'none' };
  return (
    <>
      <span aria-hidden onPointerDown={e => start(e, 1, 0)} onDoubleClick={reset} style={{ ...edge, top: 12, bottom: 12, right: 0, width: 6, cursor: 'ew-resize' }} />
      <span aria-hidden onPointerDown={e => start(e, 0, 1)} onDoubleClick={reset} style={{ ...edge, left: 12, right: 12, bottom: 0, height: 6, cursor: 'ns-resize' }} />
      <span role="separator" aria-label={t('dsv.resize')} title={t('dsv.resize')} onPointerDown={e => start(e, 1, 1)} onDoubleClick={reset}
        style={{ ...edge, right: 2, bottom: 2, width: 14, height: 14, cursor: 'nwse-resize', color: color.mutedForeground, display: 'flex' }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><path d="M12 6 6 12M12 10l-2 2" /></svg>
      </span>
    </>
  );
}
const roleTitle = (g: ColorGroup) => g.role === 'family' ? (g.family ?? '').replace(/^./, c => c.toUpperCase()) : t(`dsv.role.${g.role}` as MessageKey);

function ColorSection({ data, pick, editing }: {
  data: DsViewData;
  pick: (tk: { name: string; description?: string }) => Record<string, unknown>;
  editing?: DsEditing;
}) {
  const colors = data.tokens.filter(tk => group(tk.name) === 'color');
  const themes = (data.themes ?? []).filter(m => Object.keys(m.values).some(k => group(k) === 'color'));
  const tabs = themes.length ? ['base', ...themes.map(m => m.name), 'all'] : [];
  const [tab, setTab] = useState<string>(() => {
    try { const saved = localStorage.getItem(THEME_KEY); if (saved && tabs.includes(saved)) return saved; } catch { /* per-browser preference only */ }
    return 'base';
  });
  const choose = (id: string) => { setTab(id); try { localStorage.setItem(THEME_KEY, id); } catch { /* not kept */ } };
  const byName = new Map(colors.map(tk => [tk.name.slice(tk.name.indexOf('.') + 1), tk]));
  const groups = useMemo(() => groupColors([...byName.keys()]), [data.tokens]);
  const valueIn = (theme: string, name: string) => {
    const base = byName.get(name)?.value ?? '';
    return theme === 'base' ? base : themes.find(m => m.name === theme)?.values[`color.${name}`] ?? base;
  };
  const columns = tab === 'all' ? ['base', ...themes.map(m => m.name)] : [tab];
  const themeLabel = (id: string) => id === 'base' ? t('dsv.light') : id === 'dark' ? t('dsv.dark') : id === 'all' ? t('dsv.allThemes') : id;
  const all = tab === 'all';

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ ...label, flex: 1 }}>{t('dsv.colors')}</div>
        {tabs.length > 0 && (
          <div role="tablist" aria-label={t('dsv.themes')} style={{ display: 'flex', gap: 2, padding: 2, borderRadius: radius.sm, background: color.muted }}>
            {tabs.map(id => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => choose(id)} style={{
                fontSize: 10.5, fontFamily: font.sans, padding: '2px 10px', border: 'none', borderRadius: radius.sm - 2, cursor: 'pointer',
                background: tab === id ? color.background : 'transparent', color: tab === id ? color.foreground : color.mutedForeground,
                fontWeight: tab === id ? 600 : 400, boxShadow: tab === id ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}>{themeLabel(id)}</button>
            ))}
          </div>
        )}
      </div>
      {groups.map(g => (
        <div key={g.family ?? g.role} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, fontSize: 11, fontWeight: 600, color: color.foreground }}>
            {roleTitle(g)}
            {all && <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 400, color: color.mutedForeground }}>{columns.map(themeLabel).join(' · ')}</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${all ? 190 : 170}px, 1fr))`, gap: 8 }}>
            {g.items.map(it => {
              const tk = byName.get(it.name)!;
              const shown = columns.map(c => hexOf(valueIn(c, it.name)));
              return (
                <span key={it.name} {...pick(tk)} title={[tk.description, ...columns.map(c => `${themeLabel(c)}: ${valueIn(c, it.name)}`), it.on ? `on: ${it.on}` : ''].filter(Boolean).join('\n')}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, ...(editing ? { cursor: 'pointer' } : {}) }}>
                  <span style={{ display: 'flex', gap: 3 }}>
                    {columns.map(c => <Swatch key={c} value={valueIn(c, it.name)} on={it.on ? valueIn(c, it.on) : undefined} size={all ? 26 : 32} />)}
                  </span>
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 11, color: color.foreground, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                    <span style={{ fontFamily: font.mono, fontSize: 9.5, color: color.mutedForeground, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {all && shown.every(v => v === shown[0]) ? shown[0] : shown.join(' · ')}
                    </span>
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Visual({ data, editing }: { data: DsViewData; editing?: DsEditing }) {
  const [picked, setPicked] = useState<string | null>(null);
  const pickedToken = data.tokens.find(tk => tk.name === picked);
  const by = (...prefixes: string[]) => data.tokens.filter(tk => prefixes.includes(group(tk.name)));
  const short = (name: string) => name.split('.').slice(1).join('.') || name;
  const colors = by('color');
  const spacing = by('spacing');
  const radii = by('radius', 'rounded');
  const type = by('typography');
  const fonts = by('font');
  const other = data.tokens.filter(tk => !['color', 'spacing', 'radius', 'rounded', 'typography', 'font'].includes(group(tk.name)));
  const base = data.components.filter(c => c.layer === 'base');
  const product = data.components.filter(c => c.layer !== 'base');
  const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: color.foreground, ...(editing ? { cursor: 'pointer' } : {}) };
  // A token's chip: a click opens its reasoning and name; the reasoning shows on hover
  const pick = (tk: { name: string; description?: string }) => editing
    ? { onClick: () => setPicked(tk.name), title: tk.description || t('dsv.tokenHint'), role: 'button' as const, tabIndex: 0 }
    : { title: tk.description };
  const value: React.CSSProperties = { fontFamily: font.mono, fontSize: 10, color: color.mutedForeground };
  const section = (title: string, body: React.ReactNode) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ ...label, marginBottom: 6 }}>{title}</div>
      {body}
    </div>
  );
  const comp = (c: DsViewData['components'][number]) => (
    <div key={c.name} style={{ padding: '4px 0', borderBottom: `1px solid ${color.border}` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: color.foreground, minWidth: 110 }}><RenameName name={c.name} kind="component" editing={editing}>{c.name}</RenameName></span>
        <span style={{ ...value, width: 30 }}>{t('dsv.uses', { n: c.uses })}</span>
        <span style={{ flex: 1, fontSize: 10.5, color: color.mutedForeground, lineHeight: 1.5 }}>
          {c.props.filter(p => p.values?.length).slice(0, 4).map(p => (
            <span key={p.name} style={{ marginRight: 10 }}>{p.name}: <span style={{ fontFamily: font.mono }}>{p.values!.slice(0, 5).join(' | ')}</span></span>
          ))}
        </span>
      </div>
      {/* Why it exists — what the agent reads before picking it; the person's words win */}
      <ComponentNote c={c} editing={editing} indent={118} />
    </div>
  );

  return (
    <div>
      {editing && pickedToken && <TokenNote tk={pickedToken} editing={editing} onClose={() => setPicked(null)} />}
      {editing && !pickedToken && <div style={{ fontSize: 10.5, color: color.mutedForeground, margin: '0 0 10px' }}>{t('dsv.editHint')}</div>}
      {colors.length > 0 && <ColorSection data={data} pick={pick} editing={editing} />}
      {spacing.length > 0 && section(t('dsv.spacing'), (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'flex-end' }}>
          {spacing.map(tk => (
            <span key={tk.name} style={{ ...chip, flexDirection: 'column', alignItems: 'flex-start', gap: 3 }} {...pick(tk)}>
              <span style={{ height: 6, width: `min(${tk.value}, 64px)`, minWidth: 2, background: ilse.brand, borderRadius: 2, opacity: 0.7 }} />
              <span>{short(tk.name)} <span style={value}>{tk.value}</span></span>
            </span>
          ))}
        </div>
      ))}
      {radii.length > 0 && section(t('dsv.radius'), (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
          {radii.map(tk => (
            <span key={tk.name} style={chip} {...pick(tk)}>
              <span style={{ width: 18, height: 18, border: `1.5px solid ${color.foreground}`, borderRadius: tk.value, flexShrink: 0 }} />
              {short(tk.name)} <span style={value}>{tk.value}</span>
            </span>
          ))}
        </div>
      ))}
      {type.length > 0 && section(t('dsv.type'), (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {type.map(tk => (
            <span key={tk.name} style={{ ...chip, gap: 10 }} {...pick(tk)}>
              <span style={{ fontSize: `min(${tk.value}, 28px)`, lineHeight: 1.2 }}>Aa</span>
              {short(tk.name)} <span style={value}>{tk.value}</span>
            </span>
          ))}
        </div>
      ))}
      {fonts.length > 0 && section(t('dsv.fonts'), (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {fonts.map(tk => (
            <span key={tk.name} style={{ ...chip, gap: 10 }} {...pick(tk)}>
              {/* next/font renames the family on the page; its variable still points at it */}
              <span style={{ fontSize: 16, lineHeight: 1.2, fontFamily: tk.value.includes(',') ? tk.value : `"${tk.value}", var(--font-${short(tk.name)}), inherit` }}>Aa</span>
              {short(tk.name)} <span style={value}>{tk.value}</span>
            </span>
          ))}
        </div>
      ))}
      {/* Colours per theme are in the Colors tabs; what else a theme changes stays listed here */}
      {(data.themes ?? []).map(m => ({ name: m.name, values: Object.entries(m.values).filter(([k]) => group(k) !== 'color') })).filter(m => m.values.length).map(m => <Fragment key={m.name}>{section(t('dsv.theme', { name: m.name }), (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
          {m.values.map(([k, v]) => <span key={k} style={chip}>{short(k)} <span style={value}>{v}</span></span>)}
        </div>
      ))}</Fragment>)}
      {other.length > 0 && section(t('dsv.otherTokens'), (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
          {other.map(tk => <span key={tk.name} style={chip} {...pick(tk)}>{tk.name} <span style={value}>{tk.value}</span></span>)}
        </div>
      ))}
      {base.length > 0 && section(t('catalog.base'), base.map(comp))}
      {product.length > 0 && section(t('catalog.product'), product.map(comp))}
    </div>
  );
}

/** Without Pro: a few lines of what the file would hold, blurred — the person's own tokens and components */
function sample(tab: Tab, data: DsViewData): string {
  if (tab === 'tokens.json') {
    const lines = data.tokens.slice(0, 6).map(tk => `    "${tk.name.split('.').slice(1).join('.') || tk.name}": { "$type": "${tk.type === 'typography' ? 'dimension' : tk.type}", "$value": "${tk.value}" }`);
    return `{\n  "color": {\n${lines.join(',\n')}\n  }\n}`;
  }
  const items = data.components.slice(0, 3).map(c => `    { "name": "${c.name.toLowerCase()}", "type": "registry:ui", "files": [ … ] }`);
  return `{\n  "$schema": "https://ui.shadcn.com/schema/registry.json",\n  "items": [\n${items.join(',\n')}\n  ]\n}`;
}

/** The install command's names, from the registry as written (Pro names the namespace after the project) */
function shadcnExample(data: DsViewData): { ns: string; item: string } {
  try {
    const reg = JSON.parse(data.files.find(f => f.name === 'registry.json')?.content ?? '') as { name?: string; items?: Array<{ name: string; type: string }> };
    const ns = '@' + String(reg.name ?? 'ds').replace(/^@/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return { ns, item: reg.items?.find(i => i.type !== 'registry:theme')?.name ?? 'button' };
  } catch { return { ns: '@your-ds', item: 'button' }; }
}

export function DsViewer({ data, justWritten, onClose, onExport, onLinkAgents, onPublish, onReveal, onZip, check, onCheck, onAddRule, editing }: {
  data: DsViewData; justWritten: boolean; onClose: () => void; onExport: () => void; onLinkAgents: () => void; onPublish?: (to: string | null) => void;
  editing?: DsEditing;
  /** Opens the published copy's folder */
  onReveal?: () => void;
  /** The whole DS as a .zip (DESIGN.md, components/, tokens, registry, README) */
  onZip?: () => Promise<{ name: string; data: string } | null>;
  /** Pro: the fresh-agent test */
  check: DsCheckState | null; onCheck: () => void; onAddRule: (rules: string[]) => void;
}) {
  const [tab, setTab] = useState<Tab>('DESIGN.md');
  const [raw, setRaw] = useState(false);
  const [size, setSize] = useState(readSize);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);
  const file = useMemo(() => data.files.find(f => f.name === tab), [data, tab]);
  const locked = tab !== 'DESIGN.md' && !data.formats;
  const tabs: Array<{ id: Tab; pro: boolean }> = [{ id: 'DESIGN.md', pro: false }, { id: 'tokens.json', pro: true }, { id: 'registry.json', pro: true }];
  // Linked: any agent reads the DS on its own. Not yet: one click adds the block (or copy the line by hand)
  const linked = data.agents?.linked ?? null;
  const modes = data.formats ? data.modes ?? [] : [];
  const target = data.agents?.target ?? 'AGENTS.md';
  // The prompt works linked or not: it also gets an agent that's already running to start using the DS now
  const agentsAction = (
    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <CopyButton text={t('dsv.agentsPrompt', { file: linked ?? target })} title={t('dsv.copyPromptTip')} style={linked ? undefined : { border: 'none', background: 'none', color: color.mutedForeground }}>{t('dsv.copyPrompt')}</CopyButton>
      {linked
        ? <span style={{ color: ilse.brand, fontWeight: 600, whiteSpace: 'nowrap' }}>✓ {t('dsv.linked', { file: linked })}</span>
        : <button onClick={onLinkAgents} style={primary}>{t('dsv.link', { file: target })}</button>}
    </span>
  );
  const about: Record<Tab, { who: string; how: string; action?: React.ReactNode; quiet?: boolean }> = {
    'DESIGN.md': { who: t('dsv.agents'), how: linked ? t('dsv.agentsLinkedHow') : t('dsv.agentsHow', { file: target }), action: agentsAction, quiet: true },
    'tokens.json': { who: t('dsv.figma'), how: t('dsv.figmaHow'), action: modes.length > 0 && (
      <span title={t('dsv.modes')} style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {modes.map(m => <button key={m.name} onClick={() => save(m.name, m.content)} style={button}>{m.name} ↓</button>)}
      </span>
    ) },
    'registry.json': { who: t('dsv.shadcn'), how: t('dsv.shadcnHow', shadcnExample(data)) },
  };

  return createPortal(
    <div
      data-ilse-toolbar
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: 100010, background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: font.sans }}
    >
      <div ref={dialogRef} role="dialog" aria-label={t('dsv.title')} style={{
        width: `min(${size?.w ?? 720}px, calc(100vw - 16px))`, height: `min(${size?.h ?? 720}px, calc(100vh - 16px))`, display: 'flex', flexDirection: 'column', position: 'relative',
        background: color.popover, border: `1px solid ${color.border}`, borderRadius: radius.xl, boxShadow: shadow.xl, overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '12px 14px 8px', borderBottom: `1px solid ${color.border}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: color.foreground }}>{t('dsv.title')} <span style={{ fontWeight: 400, fontSize: 11, color: color.mutedForeground, fontFamily: font.mono }}>· {data.dir}</span></div>
            <div style={{ fontSize: 11, color: justWritten ? ilse.brand : color.mutedForeground, marginTop: 2 }}>
              {justWritten ? '✓ ' : ''}{t(justWritten ? 'dsv.written' : 'dsv.summary', { components: data.components.length, tokens: data.tokens.length })}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: color.mutedForeground, padding: 2, lineHeight: 0 }}><IconX size={16} stroke={1.75} /></button>
        </div>

        <div role="tablist" style={{ display: 'flex', gap: 2, padding: '8px 14px 0' }}>
          {tabs.map(tb => (
            <button
              key={tb.id}
              role="tab"
              aria-selected={tab === tb.id}
              onClick={() => { setTab(tb.id); setRaw(false); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer', fontFamily: font.mono, fontSize: 11,
                padding: '6px 10px', borderRadius: `${radius.sm}px ${radius.sm}px 0 0`,
                background: tab === tb.id ? color.muted : 'transparent', color: tab === tb.id ? color.foreground : color.mutedForeground,
              }}
            >
              {tb.id}
              {tb.pro && !data.formats && <span style={{ fontSize: 9, fontWeight: 600, fontFamily: font.sans, padding: '1px 6px', borderRadius: radius.full, background: color.background }}><span style={proText}>Pro</span></span>}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 14, borderTop: `1px solid ${color.border}` }}>
          <ForWhom {...about[tab]} />
          {tab === 'DESIGN.md' && file && data.publish && onPublish && <PublishRow publish={data.publish} error={data.publishError} onPublish={onPublish} onReveal={onReveal} />}
          {locked ? (
            <div style={{ position: 'relative' }}>
              <pre aria-hidden style={{ ...pre, filter: 'blur(3px)', userSelect: 'none' }}>{sample(tab, data)}</pre>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center', padding: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: color.foreground }}>{t('dsv.locked')}</span>
                <a href="https://ilse.design/#pro" target="_blank" rel="noreferrer" style={{ ...primary, textDecoration: 'none' }}>{t('catalog.lockedLink')} →</a>
              </div>
            </div>
          ) : !file ? (
            <div style={{ fontSize: 11, color: color.mutedForeground, display: 'flex', alignItems: 'center', gap: 10 }}>
              {t('dsv.missing')}
              <button onClick={onExport} style={primary}>{t('dsv.exportAgain')}</button>
            </div>
          ) : tab === 'DESIGN.md' && !raw ? (
            <>
              {data.formats && <CheckSection state={check} rules={data.rules ?? []} onRun={onCheck} onAddRule={onAddRule} />}
              <Visual data={data} editing={editing} />
            </>
          ) : (
            <pre style={pre}>{file.content}</pre>
          )}
        </div>

        {file && !locked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderTop: `1px solid ${color.border}` }}>
            {tab === 'DESIGN.md' && <button onClick={() => setRaw(r => !r)} style={button}>{raw ? t('dsv.visual') : t('dsv.raw')}</button>}
            <span style={{ flex: 1, fontSize: 10, color: color.mutedForeground, fontFamily: font.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.dir}/{file.name}</span>
            <CopyButton text={file.content}>{t('dsv.copy')}</CopyButton>
            <DownloadMenu options={[
              { label: file.name, hint: t(tab === 'DESIGN.md' ? 'dsv.downloadForTool' : tab === 'tokens.json' ? 'dsv.downloadForFigma' : 'dsv.downloadForShadcn'), run: () => save(file.name, file.content) },
              ...(onZip ? [{ label: t('dsv.downloadAll'), hint: t('dsv.downloadAllHint'), run: async (): Promise<Saved | 'failed'> => {
                const zip = await onZip();
                if (!zip) return 'failed';
                const bytes = Uint8Array.from(atob(zip.data), c => c.charCodeAt(0));
                return save(zip.name, new Blob([bytes], { type: 'application/zip' }));
              } }] : []),
            ]} />
          </div>
        )}
        <ResizeHandles box={() => dialogRef.current} onSize={setSize} />
      </div>
    </div>,
    document.body,
  );
}
