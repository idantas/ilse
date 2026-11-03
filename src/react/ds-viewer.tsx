/**
 * The DS window: what Create DS / Export gave the user, on screen.
 *
 * One tab per file in .ilse/ds, each saying who reads it and how to use it. DESIGN.md is drawn
 * as a design system (swatches, scales, components and their variants) with the file a click
 * away; tokens.json and registry.json show the file. Without Pro those two show a blurred
 * sample of what they'd hold, so the person sees what Pro adds instead of just a lock.
 * Laid out like the expanded test report: centered over a dimmed page, the same size.
 */

import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from '@tabler/icons-react';
import { color, font, ilse, proText, radius, shadow } from './tokens.js';
import { t } from '../i18n/index.js';

/** The bridge's `ds_view` (ds-export.ts DsView) */
export interface DsViewData {
  dir: string;
  files: Array<{ name: string; content: string }>;
  tokens: Array<{ name: string; value: string; type: string }>;
  components: Array<{ name: string; uses: number; layer?: string; feature?: string; props: Array<{ name: string; values?: string[] }>; whenToUse?: string; avoid?: string }>;
  formats: boolean;
  agents: { linked: string | null; target: string };
  rules?: string[];
  /** Pro's tokens file per theme (`tokens.dark.json`) */
  modes?: Array<{ name: string; content: string }>;
  themes?: Array<{ name: string; values: Record<string, string> }>;
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

/** Asks where to save (Chrome/Edge's save dialog); browsers without it download to the usual folder */
async function save(name: string, content: string) {
  const json = name.endsWith('.json');
  const blob = new Blob([content], { type: json ? 'application/json' : 'text/markdown' });
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name, types: [json
        ? { description: 'JSON', accept: { 'application/json': ['.json'] } }
        : { description: 'Markdown', accept: { 'text/markdown': ['.md'] } }] });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // closed the dialog: nothing saved, on purpose
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CopyButton({ text, children, style }: { text: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }); }}
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

const group = (name: string) => name.split('.')[0];

/** DESIGN.md drawn as a DS: the tokens as swatches and scales, the components with their variants */
function Visual({ data }: { data: DsViewData }) {
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
  const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: color.foreground };
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
        <span style={{ fontSize: 11, fontWeight: 600, color: color.foreground, minWidth: 110 }}>{c.name}</span>
        <span style={{ ...value, width: 30 }}>{t('dsv.uses', { n: c.uses })}</span>
        <span style={{ flex: 1, fontSize: 10.5, color: color.mutedForeground, lineHeight: 1.5 }}>
          {c.props.filter(p => p.values?.length).slice(0, 4).map(p => (
            <span key={p.name} style={{ marginRight: 10 }}>{p.name}: <span style={{ fontFamily: font.mono }}>{p.values!.slice(0, 5).join(' | ')}</span></span>
          ))}
        </span>
      </div>
      {/* Pro: what the agent reads before picking it */}
      {c.whenToUse && (
        <div style={{ fontSize: 10.5, lineHeight: 1.45, color: color.foreground, margin: '2px 0 0 118px' }}>
          <span style={{ color: color.mutedForeground }}>{t('dsv.whenToUse')}: </span>{c.whenToUse}
          {c.avoid && <><br /><span style={{ color: color.mutedForeground }}>{t('dsv.avoid')}: </span>{c.avoid}</>}
        </div>
      )}
    </div>
  );

  return (
    <div>
      {colors.length > 0 && section(t('dsv.colors'), (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
          {colors.map(tk => (
            <span key={tk.name} style={chip}>
              <span style={{ width: 18, height: 18, borderRadius: radius.sm, background: tk.value, border: `1px solid ${color.border}`, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{short(tk.name)} <span style={value}>{tk.value}</span></span>
            </span>
          ))}
        </div>
      ))}
      {spacing.length > 0 && section(t('dsv.spacing'), (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'flex-end' }}>
          {spacing.map(tk => (
            <span key={tk.name} style={{ ...chip, flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
              <span style={{ height: 6, width: `min(${tk.value}, 64px)`, minWidth: 2, background: ilse.brand, borderRadius: 2, opacity: 0.7 }} />
              <span>{short(tk.name)} <span style={value}>{tk.value}</span></span>
            </span>
          ))}
        </div>
      ))}
      {radii.length > 0 && section(t('dsv.radius'), (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
          {radii.map(tk => (
            <span key={tk.name} style={chip}>
              <span style={{ width: 18, height: 18, border: `1.5px solid ${color.foreground}`, borderRadius: tk.value, flexShrink: 0 }} />
              {short(tk.name)} <span style={value}>{tk.value}</span>
            </span>
          ))}
        </div>
      ))}
      {type.length > 0 && section(t('dsv.type'), (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {type.map(tk => (
            <span key={tk.name} style={{ ...chip, gap: 10 }}>
              <span style={{ fontSize: `min(${tk.value}, 28px)`, lineHeight: 1.2 }}>Aa</span>
              {short(tk.name)} <span style={value}>{tk.value}</span>
            </span>
          ))}
        </div>
      ))}
      {fonts.length > 0 && section(t('dsv.fonts'), (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {fonts.map(tk => (
            <span key={tk.name} style={{ ...chip, gap: 10 }}>
              {/* next/font renames the family on the page; its variable still points at it */}
              <span style={{ fontSize: 16, lineHeight: 1.2, fontFamily: `"${tk.value}", var(--font-${short(tk.name)}), inherit` }}>Aa</span>
              {short(tk.name)} <span style={value}>{tk.value}</span>
            </span>
          ))}
        </div>
      ))}
      {(data.themes ?? []).map(m => <Fragment key={m.name}>{section(t('dsv.theme', { name: m.name }), (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
          {Object.entries(m.values).map(([k, v]) => (
            <span key={k} style={chip}>
              {group(k) === 'color' && <span style={{ width: 18, height: 18, borderRadius: radius.sm, background: v, border: `1px solid ${color.border}`, flexShrink: 0 }} />}
              {short(k)} <span style={value}>{v}</span>
            </span>
          ))}
        </div>
      ))}</Fragment>)}
      {other.length > 0 && section(t('dsv.otherTokens'), (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
          {other.map(tk => <span key={tk.name} style={chip}>{tk.name} <span style={value}>{tk.value}</span></span>)}
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

export function DsViewer({ data, justWritten, onClose, onExport, onLinkAgents, check, onCheck, onAddRule }: {
  data: DsViewData; justWritten: boolean; onClose: () => void; onExport: () => void; onLinkAgents: () => void;
  /** Pro: the fresh-agent test */
  check: DsCheckState | null; onCheck: () => void; onAddRule: (rules: string[]) => void;
}) {
  const [tab, setTab] = useState<Tab>('DESIGN.md');
  const [raw, setRaw] = useState(false);
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
  const agentsAction = linked
    ? <span style={{ color: ilse.brand, fontWeight: 600, whiteSpace: 'nowrap' }}>✓ {t('dsv.linked', { file: linked })}</span>
    : (
      <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <CopyButton text={t('dsv.agentsLine')} style={{ border: 'none', background: 'none', color: color.mutedForeground }}>{t('dsv.copyLine')}</CopyButton>
        <button onClick={onLinkAgents} style={primary}>{t('dsv.link', { file: target })}</button>
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
      <div role="dialog" aria-label={t('dsv.title')} style={{
        width: 'min(720px, calc(100vw - 32px))', height: 'min(720px, calc(100vh - 64px))', display: 'flex', flexDirection: 'column',
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
              <Visual data={data} />
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
            <button onClick={() => save(file.name, file.content)} style={primary}>{t('dsv.download')}</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
