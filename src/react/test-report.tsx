/**
 * Test mode's report (Pro): a summary per group tested, then each group's
 * findings. It opens above the toolbar after a run; opened on the side it
 * stays while the dev browses the app — a click on an item goes to its page,
 * scrolls to the element and outlines it (every copy, for something repeated).
 *
 * Compact on the side after a run (groups closed, one click opens one), or
 * expanded to the middle of the page. Both end with the same two actions:
 * Run again and Fix all. Per item: skip (back on the next test), ignore
 * always (test memory; undone in Project memory) or fix (to the agent now).
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconArrowsMaximize, IconArrowsMinimize, IconDots, IconX, IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { color, font, ilse, radius, shadow } from './tokens.js';
import { t } from '../i18n/index.js';
import { ago } from './memory-panel.js';
import { GROUP_ORDER, type TestGroup } from './test-setup.js';
import type { TestFinding, TestRunMeta } from './test-findings.js';

type Key = Parameters<typeof t>[0];

const GROUP_OF: Record<string, TestGroup> = {
  journey: 'journeys', accessibility: 'accessibility', agent: 'accessibility',
  console: 'errors', network: 'errors', link: 'errors', layout: 'layout', consistency: 'consistency',
};
export const groupOf = (f: Pick<TestFinding, 'category'>): TestGroup => GROUP_OF[f.category] ?? 'errors';

/** An error breaks something (high); everything else is an improvement */
export const isError = (f: Pick<TestFinding, 'severity'>) => f.severity === 'high';

export interface ReportSummary {
  journeys?: { ok: number; total: number };
  errors: number;
  improvements: number;
  repeated: number;
  since?: { new: number; returned: number; fixed: number };
}

/** Which element a finding is, in a few words: its text on this page, else the selector's last part */
export function whereOf(f: Pick<TestFinding, 'selector'>): string {
  if (!f.selector) return '';
  let el: Element | null = null;
  try { el = document.querySelector(f.selector); } catch { /* not a selector this page understands */ }
  const text = el?.textContent?.replace(/\s+/g, ' ').trim();
  if (text) return `“${text.length > 32 ? `${text.slice(0, 31)}…` : text}”`;
  const last = f.selector.split(/\s*>\s*|\s+/).pop() ?? f.selector;
  return last.replace(/\\(.)/g, '$1').replace(/:nth-[\w-]+\(\d+\)/g, '').slice(0, 40);
}

export function summarize(findings: TestFinding[], run: TestRunMeta | null): ReportSummary {
  const page = findings.filter(f => f.category !== 'consistency');
  const fresh = findings.filter(f => !f.carried);
  const before = fresh.some(f => f.status === 'known' || f.status === 'returned') || !!run?.fixed;
  return {
    ...(run?.journeys?.total ? { journeys: { ok: run.journeys.passed + run.journeys.flaky, total: run.journeys.total } } : {}),
    errors: page.filter(isError).length,
    improvements: page.filter(f => !isError(f)).length,
    repeated: findings.filter(f => f.category === 'consistency').length,
    ...(before ? { since: { new: fresh.filter(f => f.status === 'new').length, returned: fresh.filter(f => f.status === 'returned').length, fixed: run?.fixed ?? 0 } } : {}),
  };
}

/** The groups to show: the ones tested, then any that only have findings carried from the run before */
export function shownGroups(findings: TestFinding[], run: TestRunMeta | null): TestGroup[] {
  const tested = run ? run.groups : [...new Set(findings.map(groupOf))];
  const carried = findings.filter(f => f.carried).map(groupOf);
  return GROUP_ORDER.filter(g => tested.includes(g) || carried.includes(g));
}

const rank = { high: 3, medium: 2, low: 1 } as const;
const dot = (s: TestFinding['severity']) => s === 'high' ? '#ef4444' : s === 'medium' ? '#f59e0b' : color.mutedForeground;

/** Every element the finding points at on this page: its selector, and each class list a repeated structure is written with */
export function findingTargets(f: TestFinding, doc: Document = document): Element[] {
  const out: Element[] = [];
  const add = (el: Element | null) => { if (el && !out.includes(el) && !el.closest('[data-ilse-toolbar]')) out.push(el); };
  if (f.selector) { try { add(doc.querySelector(f.selector)); } catch { /* a selector the browser can't parse */ } }
  for (const cls of f.classes ?? []) {
    const norm = cls.trim().split(/\s+/).sort().join(' ');
    for (const el of doc.querySelectorAll('[class]')) {
      if (out.length >= 24) break;
      const c = (el.getAttribute('class') ?? '').trim().split(/\s+/).sort().join(' ');
      if (c === norm) add(el);
    }
  }
  return out;
}

const onThisPage = (f: TestFinding) => {
  if (!f.page) return false;
  const [path, query] = f.page.split('?');
  return path === location.pathname && (!query || `?${query}` === location.search);
};

function Outlines({ targets }: { targets: Element[] }) {
  const [, tick] = useState(0);
  useEffect(() => {
    let frame = 0;
    const redraw = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => tick(n => n + 1)); };
    window.addEventListener('scroll', redraw, true);
    window.addEventListener('resize', redraw);
    return () => { window.removeEventListener('scroll', redraw, true); window.removeEventListener('resize', redraw); cancelAnimationFrame(frame); };
  }, []);
  return createPortal(
    <>
      {targets.map((el, i) => {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return null;
        return (
          <div key={i} data-ilse-toolbar style={{
            position: 'fixed', top: r.top - 3, left: r.left - 3, width: r.width + 6, height: r.height + 6, pointerEvents: 'none',
            border: `2px solid ${ilse.test}`, borderRadius: 6, boxShadow: `0 0 0 4px rgba(47,107,255,0.15)`, zIndex: 99996,
            animation: i === 0 ? 'ilse-thinking-in 0.3s ease-out' : undefined,
          }} />
        );
      })}
    </>,
    document.body,
  );
}

export function TestReport({ findings, run, focusId, ignoredNow, testing, fixing, onFocus, onGoTo, onFix, onFixAll, onRunAgain, onSkip, onIgnoreAlways, onIgnoreAll, onShowIgnored, onClose }: {
  findings: TestFinding[];
  run: TestRunMeta | null;
  focusId: string | null;
  ignoredNow: Set<string>;
  /** A test is running now */
  testing: boolean;
  /** Sent to the agent and not back yet */
  fixing: (id: string) => boolean;
  onFocus: (id: string | null) => void;
  /** The finding is on another page: go there (the report reopens on it) */
  onGoTo: (f: TestFinding) => void;
  onFix: (f: TestFinding) => void;
  onFixAll: (list: TestFinding[]) => void;
  onRunAgain: () => void;
  onSkip: (f: TestFinding) => void;
  onIgnoreAlways: (f: TestFinding) => void;
  onIgnoreAll: (list: TestFinding[]) => void;
  onShowIgnored: () => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'errors' | 'improvements'>('all');
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed');
  // Compact: every group starts closed; the one holding the focused finding opens
  const [opened, setOpened] = useState<Set<TestGroup>>(new Set());
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const drag = useRef<{ x: number; y: number; top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [targets, setTargets] = useState<Element[]>([]);

  const visible = findings.filter(f => !ignoredNow.has(f.id));
  const summary = useMemo(() => summarize(visible, run), [visible, run]);
  const groups = shownGroups(visible, run);
  const focused = visible.find(f => f.id === focusId) ?? null;

  // The focused finding on this page: outline it (every copy) and bring the first into view
  useLayoutEffect(() => {
    if (!focused || !onThisPage(focused)) { setTargets([]); return; }
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      const found = findingTargets(focused);
      setTargets(found);
      if (found[0]) found[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
      else if (++tries < 4) timer = setTimeout(look, 500); // the page may still be rendering
    };
    look();
    return () => clearTimeout(timer);
  }, [focused?.id]);

  useEffect(() => {
    const move = (e: MouseEvent) => { if (drag.current) setPos({ top: drag.current.top + e.clientY - drag.current.y, left: drag.current.left + e.clientX - drag.current.x }); };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  useEffect(() => { if (focused) setOpened(prev => prev.has(groupOf(focused)) ? prev : new Set(prev).add(groupOf(focused))); }, [focused?.id]);

  const pick = (f: TestFinding) => {
    if (focusId === f.id) { onFocus(null); return; }
    onFocus(f.id);
    if (f.page && !onThisPage(f)) onGoTo(f);
    else if (expanded) setExpanded(false); // to see it on the page, the report moves aside
  };
  const toFix = visible.filter(f => !fixing(f.id));
  const ghost: React.CSSProperties = { padding: '5px 10px', borderRadius: radius.sm, border: `1px solid ${color.border}`, background: color.background, fontSize: 11, fontWeight: 600, fontFamily: font.sans, cursor: 'pointer', color: color.foreground };
  const primary: React.CSSProperties = { padding: '5px 10px', borderRadius: radius.sm, border: 'none', background: ilse.test, color: '#fff', fontSize: 11, fontWeight: 600, fontFamily: font.sans, cursor: 'pointer' };

  const sizes = (run?.sizes ?? []).map(s => t(`test.size.${s}` as Key)).join(' · ');

  const chip = (text: string, tone: 'error' | 'ok' | 'muted' | 'test') => (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap',
      background: tone === 'error' ? '#fee2e2' : tone === 'ok' ? '#dcfce7' : tone === 'test' ? ilse.testPale : color.muted,
      color: tone === 'error' ? '#b91c1c' : tone === 'ok' ? '#15803d' : tone === 'test' ? '#1d4ed8' : color.mutedForeground,
    }}>{text}</span>
  );

  // Several findings with one title (axe's "All page content should be contained by landmarks", one per element): say which element each is
  const titleCount = new Map<string, number>();
  for (const f of visible) titleCount.set(f.title, (titleCount.get(f.title) ?? 0) + 1);

  const row = (f: TestFinding) => {
    const open = f.id === focusId;
    const busy = fixing(f.id);
    const tags = [
      (titleCount.get(f.title) ?? 0) > 1 ? whereOf(f) : '',
      f.page && !onThisPage(f) ? t('report.otherPage', { page: f.page }) : '',
      f.status === 'new' && summary.since ? t('report.new') : '',
      f.occurrences > 1 && f.category !== 'consistency' ? `×${f.occurrences}` : '',
    ].filter(Boolean);
    return (
      <div key={f.id} style={{ borderRadius: radius.md, background: open ? color.muted : 'transparent', margin: '0 -6px' }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => pick(f)}
          onKeyDown={(e) => { if (e.key === 'Enter') pick(f); }}
          style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px', cursor: 'pointer', borderRadius: radius.md }}
          onMouseEnter={(e) => { if (!open) (e.currentTarget as HTMLDivElement).style.background = color.muted; }}
          onMouseLeave={(e) => { if (!open) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 5, background: dot(f.severity) }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: color.foreground, lineHeight: 1.35, ...(open ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }) }}>
              {f.title}
              {f.status === 'returned' && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#ef4444' }}>{t('report.returned')}</span>}
            </div>
            {tags.length > 0 && <div style={{ fontSize: 10, color: color.mutedForeground, marginTop: 2 }}>{tags.join(' · ')}</div>}
          </div>
        </div>
        {open && (
          <div style={{ padding: '0 6px 10px 20px', fontSize: 11, color: color.mutedForeground, lineHeight: 1.45 }}>
            {f.detail && <div style={{ marginBottom: 6, color: color.foreground }}>{f.detail}</div>}
            {f.files && f.files.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('report.code')}</div>
                {f.files.slice(0, 6).map((x, i) => (
                  <div key={i} style={{ fontFamily: font.mono, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${x.file}:${x.line}`}>{x.file}:{x.line}</div>
                ))}
                {f.files.length > 6 && <div style={{ fontSize: 10 }}>+{f.files.length - 6}</div>}
              </div>
            )}
            {f.journeys && f.journeys.length > 0 && <div style={{ marginBottom: 6 }}>{t('report.inJourneys', { list: f.journeys.join('; ') })}</div>}
            {f.category === 'consistency' && !f.page && <div style={{ marginBottom: 6 }}>{t('report.notOnPage')}</div>}
            <FindingActions busy={busy} onSkip={() => onSkip(f)} onIgnore={() => onIgnoreAlways(f)} onFix={() => onFix(f)} />
          </div>
        )}
      </div>
    );
  };

  const journeyRow = (j: NonNullable<TestRunMeta['journeyList']>[number]) => {
    const rs = [j.desktop, j.mobile].filter((r): r is NonNullable<typeof r> => !!r);
    const stuck = rs.find(r => r.outcome === 'stuck');
    const flaky = rs.find(r => r.outcome === 'flaky');
    const repaired = rs.find(r => r.outcome === 'repaired');
    const finding = visible.find(f => f.category === 'journey' && f.rule.endsWith(j.id));
    const status = stuck ? t('report.journeyStuck', { step: stuck.step ?? '?' }) : flaky ? t('report.journeyFlaky') : repaired ? t('report.journeyRepaired') : t('report.journeyPassed');
    return (
      <div
        key={j.id}
        onClick={() => finding && pick(finding)}
        style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', cursor: finding ? 'pointer' : 'default' }}
      >
        <span style={{ fontSize: 11, width: 12, color: stuck ? '#ef4444' : flaky ? '#f59e0b' : '#16a34a' }}>{stuck ? '✗' : flaky ? '~' : '✓'}</span>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: color.foreground, lineHeight: 1.35 }}>
          {j.goal}
          <div style={{ fontSize: 10, color: stuck ? '#ef4444' : color.mutedForeground }}>{status}{stuck?.reason ? `: ${stuck.reason}` : ''}</div>
        </div>
      </div>
    );
  };

  const body = (
    <>
      {/* Header: what was tested, when; dock / undock; close */}
      <div
        onMouseDown={(e) => {
          if (expanded || (e.target as HTMLElement).closest('button')) return;
          const box = panelRef.current!.getBoundingClientRect();
          drag.current = { x: e.clientX, y: e.clientY, top: box.top, left: box.left };
          setPos({ top: box.top, left: box.left });
          e.preventDefault();
        }}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '12px 14px 8px', cursor: expanded ? 'default' : 'move', userSelect: 'none', position: 'relative' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: color.foreground }}>{t('report.title')}</div>
          {run && <div style={{ fontSize: 10, color: color.mutedForeground, marginTop: 2 }}>{t('report.testedOn', { when: ago(run.at), sizes })}</div>}
        </div>
        <button
          title={t(expanded ? 'report.collapse' : 'report.expand')} aria-label={t(expanded ? 'report.collapse' : 'report.expand')}
          onClick={() => { setPos(null); setExpanded(v => !v); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: color.mutedForeground, padding: 2, lineHeight: 0 }}
        >
          {expanded ? <IconArrowsMinimize size={16} stroke={1.75} /> : <IconArrowsMaximize size={16} stroke={1.75} />}
        </button>
        {visible.length > 0 && (
          <button
            title={t('report.more')} aria-label={t('report.more')}
            onClick={() => setMenu(m => m === 'closed' ? 'open' : 'closed')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: color.mutedForeground, padding: 2, lineHeight: 0 }}
          >
            <IconDots size={16} stroke={1.75} />
          </button>
        )}
        {menu !== 'closed' && (
          <div style={{ position: 'absolute', top: 36, right: 40, zIndex: 2, background: color.popover, border: `1px solid ${color.border}`, borderRadius: radius.md, boxShadow: shadow.lg, padding: 4, minWidth: 180 }}>
            {menu === 'open' ? (
              <button
                onClick={() => setMenu('confirm')}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '6px 8px', borderRadius: radius.sm, fontSize: 12, fontFamily: font.sans, cursor: 'pointer', color: color.foreground }}
              >
                {t('report.ignoreAll')}
              </button>
            ) : (
              <div style={{ padding: '6px 8px', fontSize: 12, color: color.foreground }}>
                {t('report.ignoreAllConfirm', { count: visible.length })}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                  <button style={ghost} onClick={() => setMenu('closed')}>{t('report.cancel')}</button>
                  <button style={{ ...primary, background: '#ef4444' }} onClick={() => { setMenu('closed'); onIgnoreAll(visible); }}>{t('report.ignoreAll')}</button>
                </div>
              </div>
            )}
          </div>
        )}
        <button
          title="Esc" aria-label="Close"
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: color.mutedForeground, padding: 2, lineHeight: 0 }}
        >
          <IconX size={16} stroke={1.75} />
        </button>
      </div>

      {/* Summary: one number per group tested, and what changed since the last test */}
      {(run || visible.length > 0) && (
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {summary.journeys && chip(t('report.journeysDone', summary.journeys), summary.journeys.ok === summary.journeys.total ? 'ok' : 'error')}
            {chip(t('report.errors', { count: summary.errors }), summary.errors ? 'error' : 'muted')}
            {chip(t('report.improvements', { count: summary.improvements }), 'muted')}
            {(run?.groups.includes('consistency') || summary.repeated > 0) && chip(t('report.repeated', { count: summary.repeated }), 'test')}
          </div>
          {summary.since && <div style={{ fontSize: 10, color: color.mutedForeground, marginTop: 6 }}>{t('report.since', summary.since)}</div>}
        </div>
      )}

      {visible.length > 0 && (
        <div style={{ display: 'flex', gap: 2, margin: '0 14px 6px', background: '#f2f2f2', borderRadius: 8, padding: 2 }}>
          {(['all', 'errors', 'improvements'] as const).map(k => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                flex: 1, padding: '3px 6px', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: font.sans, cursor: 'pointer',
                background: filter === k ? color.background : 'transparent', color: filter === k ? color.foreground : color.mutedForeground,
                boxShadow: filter === k ? shadow.xs : 'none',
              }}
            >
              {t(k === 'all' ? 'report.all' : k === 'errors' ? 'report.onlyErrors' : 'report.onlyImprovements')}
            </button>
          ))}
        </div>
      )}

      <div className="ilse-hidden-scroll" style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '0 14px 12px' }}>
        {!run && visible.length === 0 && <div style={{ fontSize: 12, color: color.mutedForeground }}>{t('report.none')}</div>}
        {run && visible.length === 0 && !run.journeyList?.length && <div style={{ fontSize: 12, color: color.mutedForeground }}>{t('report.empty')}</div>}
        {groups.map(g => {
          const items = visible
            .filter(f => groupOf(f) === g)
            .filter(f => filter === 'all' || (filter === 'errors') === isError(f))
            .sort((a, b) => rank[b.severity] - rank[a.severity]);
          const journeys = g === 'journeys' ? run?.journeyList ?? [] : [];
          const carried = items.length > 0 && items.every(f => f.carried);
          const isClosed = !expanded && !opened.has(g);
          const count = g === 'journeys' ? journeys.length || items.length : items.length;
          return (
            <div key={g} style={{ borderTop: `1px solid ${color.border}`, paddingTop: 8, marginTop: 4 }}>
              <button
                onClick={() => setOpened(prev => { const next = new Set(prev); if (next.has(g)) next.delete(g); else next.add(g); return next; })}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: '2px 0 6px', cursor: 'pointer', fontFamily: font.sans }}
              >
                {isClosed ? <IconChevronRight size={12} color={color.mutedForeground} /> : <IconChevronDown size={12} color={color.mutedForeground} />}
                <span style={{ fontSize: 12, fontWeight: 600, color: color.foreground }}>{t(`test.group.${g}` as Key)}</span>
                <span style={{ fontSize: 11, color: color.mutedForeground }}>{count}</span>
              </button>
              {!isClosed && (
                <>
                  {carried && <div style={{ fontSize: 10, color: color.mutedForeground, margin: '-2px 0 4px 16px' }}>{t('report.carried')}</div>}
                  {journeys.map(journeyRow)}
                  {items.filter(f => g !== 'journeys' || !journeys.length).map(row)}
                  {count === 0 && <div style={{ fontSize: 11, color: color.mutedForeground, paddingLeft: 16, paddingBottom: 4 }}>{t('report.groupEmpty')}</div>}
                </>
              )}
            </div>
          );
        })}
        {ignoredNow.size > 0 && (
          <div style={{ fontSize: 10, color: color.mutedForeground, marginTop: 10 }}>
            {t('report.ignoredNow', { count: ignoredNow.size })} ·{' '}
            <button onClick={onShowIgnored} style={{ background: 'none', border: 'none', padding: 0, color: ilse.test, fontSize: 10, cursor: 'pointer', fontFamily: font.sans }}>{t('report.showIgnored')}</button>
          </div>
        )}
      </div>

      {/* The report's two actions, compact or expanded: the secondary on the left, the main one on the right */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '10px 14px', borderTop: `1px solid ${color.border}` }}>
        <button style={{ ...ghost, opacity: testing ? 0.5 : 1, cursor: testing ? 'default' : 'pointer' }} disabled={testing} onClick={onRunAgain}>
          {testing ? t('report.testing') : t('report.runAgain')}
        </button>
        <button
          style={{ ...primary, opacity: toFix.length ? 1 : 0.5, cursor: toFix.length ? 'pointer' : 'default' }}
          disabled={!toFix.length}
          onClick={() => onFixAll(toFix)}
        >
          {t('report.fixAll', { count: toFix.length })}
        </button>
      </div>
    </>
  );

  const frame: React.CSSProperties = {
    backgroundColor: color.popover, border: `1px solid ${color.border}`, borderRadius: radius.xl, boxShadow: shadow.xl,
    fontFamily: font.sans, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };

  return (
    <>
      {targets.length > 0 && !expanded && <Outlines targets={targets} />}
      {createPortal(
        <>
          {/* Expanded, the report is the focus: over the toolbar and everything else */}
          {expanded && <div data-ilse-toolbar onClick={() => setExpanded(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 100010 }} />}
          <div
            ref={panelRef}
            data-ilse-toolbar
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              ...frame, position: 'fixed', zIndex: expanded ? 100011 : 99998,
              ...(expanded
                ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(720px, calc(100vw - 32px))', height: 'min(720px, calc(100vh - 64px))' }
                // On the side, always the same height: filtering never moves the buttons under the pointer
                : { width: 340, ...(pos ? { top: pos.top, left: pos.left, height: 'min(640px, calc(100vh - 32px))' } : { top: 16, left: 16, bottom: 16 }) }),
            }}
          >
            {body}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

/** A finding's three answers, the same on its card on the page and in the report */
export function FindingActions({ busy, onSkip, onIgnore, onFix }: { busy: boolean; onSkip: () => void; onIgnore: () => void; onFix: () => void }) {
  const ghost: React.CSSProperties = { padding: '5px 10px', borderRadius: radius.sm, border: `1px solid ${color.border}`, background: color.background, fontSize: 11, fontWeight: 600, fontFamily: font.sans, cursor: 'pointer', color: color.foreground };
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
      <button style={ghost} title={t('report.skipHint')} onClick={onSkip}>{t('report.skip')}</button>
      <button style={ghost} title={t('report.ignoreAlwaysHint')} onClick={onIgnore}>{t('report.ignoreAlways')}</button>
      <span style={{ flex: 1 }} />
      <button
        disabled={busy}
        onClick={onFix}
        style={{ padding: '5px 12px', borderRadius: radius.sm, border: 'none', fontSize: 11, fontWeight: 600, fontFamily: font.sans, cursor: busy ? 'default' : 'pointer', background: busy ? ilse.testPale : ilse.test, color: busy ? '#1d4ed8' : '#fff' }}
      >
        {busy ? t('report.fixing') : t('report.fix')}
      </button>
    </div>
  );
}
