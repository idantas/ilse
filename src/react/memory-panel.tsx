/**
 * The project memory, in the toolbar: what Ilse remembers of this project and
 * what the agent reads from it. Two parts —
 *
 * - Design: the changes Ilse made here (the ledger in .git/ilse). Free. The
 *   agent gets the last ones of a file whenever it works on that file.
 * - Test: what test mode remembers (runs, findings fixed or back, what the dev
 *   asked to ignore). Ilse Pro; without it, a short line on what it would hold.
 *
 * Nothing here is remembered out of sight: whatever Ilse uses, this shows.
 */

import { useState } from 'react';
import { IconX, IconChevronRight } from '@tabler/icons-react';
import { radius, color, shadow, font, ilse } from './tokens.js';
import { t } from '../i18n/index.js';
import { withShortcut } from './shortcuts.js';

export interface DesignMemory {
  total: number;
  pending: number;
  recent: { id: string; at: string; path: string; text: string; files: string[]; pending: boolean }[];
}

export interface TestMemory {
  runs: number;
  lastRunAt: string | null;
  open: number;
  fixed: number;
  returned: { id: string; title: string; page: string }[];
  approved: number;
  ignored: { id: string; title: string; page?: string; at: string }[];
  byCategory: { category: string; approved: number; discarded: number }[];
}

export interface MemoryData {
  design?: DesignMemory;
  /** Pro can run test mode */
  pro?: boolean;
  /** Null when Pro is absent or older than this screen */
  test?: TestMemory | null;
}

/** "há 5 min", "ontem", "12/10" — short, in the user's language */
export function ago(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60_000);
  if (min < 1) return t('memory.justNow');
  if (min < 60) return t('memory.minutesAgo', { count: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('memory.hoursAgo', { count: h });
  const d = Math.round(h / 24);
  if (d === 1) return t('memory.yesterday');
  if (d < 7) return t('memory.daysAgo', { count: d });
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const CATEGORY_KEYS: Record<string, string> = {
  accessibility: 'memory.category.accessibility', agent: 'memory.category.agent', console: 'memory.category.console',
  network: 'memory.category.network', link: 'memory.category.link', layout: 'memory.category.layout',
};
const categoryName = (c: string) => CATEGORY_KEYS[c] ? t(CATEGORY_KEYS[c] as Parameters<typeof t>[0]) : c;

export function MemoryPanel({ data, onClose, onUndoDecision, onForgetTest, onOpenPage }: {
  data: MemoryData | null;
  onClose: () => void;
  onUndoDecision: (id: string) => void;
  onForgetTest: () => void;
  /** Go to a page of the app (a finding that came back lives there) */
  onOpenPage: (page: string) => void;
}) {
  const [confirmForget, setConfirmForget] = useState(false);
  const [ignoredOpen, setIgnoredOpen] = useState(true);

  const heading: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
    color: color.mutedForeground, margin: '16px 0 8px',
  };
  const muted: React.CSSProperties = { fontSize: 11, color: color.mutedForeground, lineHeight: 1.45 };
  const row: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, padding: '3px 0' };
  const linkButton = (primary = false): React.CSSProperties => ({
    flexShrink: 0, border: primary ? 'none' : `1px solid ${color.border}`, background: primary ? color.destructive : color.background,
    color: primary ? '#fff' : color.foreground, borderRadius: radius.sm, padding: '3px 8px',
    fontSize: 11, fontWeight: 500, fontFamily: font.sans, cursor: 'pointer', whiteSpace: 'nowrap',
  });

  const design = data?.design;
  const test = data?.test;

  return (
    <div
      data-ilse-toolbar
      role="dialog"
      aria-modal="true"
      aria-label={t('memory.title')}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100001, backgroundColor: 'rgba(0,0,0,0.28)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: font.sans,
      }}
    >
      <div data-ilse-toolbar style={{
        width: 'min(440px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
        backgroundColor: color.background, color: color.foreground, borderRadius: radius.xl,
        border: `1px solid ${color.border}`, boxShadow: shadow.lg, padding: '18px 20px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t('memory.title')}</span>
          <button
            onClick={onClose}
            title={withShortcut(t('toolbar.close'), 'Esc')}
            aria-label={t('toolbar.close')}
            style={{ width: 24, height: 24, border: 'none', borderRadius: radius.sm, background: 'none', cursor: 'pointer', color: color.mutedForeground, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <IconX size={14} stroke={1.75} />
          </button>
        </div>
        <div style={{ ...muted, marginTop: 4 }}>{t('memory.intro')}</div>

        {!data && <div style={{ ...muted, marginTop: 16 }}>{t('memory.loading')}</div>}

        {/* ── Design: the changes Ilse made here ── */}
        {design && (
          <>
            <div style={heading}>{t('memory.design')}</div>
            {design.total === 0 ? (
              <div style={muted}>{t('memory.designEmpty')}</div>
            ) : (
              <>
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  {t('memory.designCount', { count: design.total })}
                  {design.pending > 0 && <span style={{ color: color.mutedForeground }}> · {t('memory.designPending', { count: design.pending })}</span>}
                </div>
                {design.recent.map(c => (
                  <div key={c.id} style={{ ...row, alignItems: 'flex-start' }} title={c.files.join('\n')}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 6, backgroundColor: c.pending ? ilse.orange : color.border }} />
                    <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.text || t('memory.noNote')}</span>
                      <span style={{ fontSize: 10, color: color.mutedForeground }}>
                        {c.files.map(f => f.split('/').pop()).slice(0, 2).join(', ')}{c.files.length > 2 ? ` +${c.files.length - 2}` : ''}
                      </span>
                    </span>
                    <span style={{ fontSize: 10, color: color.mutedForeground, flexShrink: 0 }}>{ago(c.at)}</span>
                  </div>
                ))}
                <div style={{ ...muted, marginTop: 8 }}>{t('memory.designAgent')}</div>
              </>
            )}
          </>
        )}

        {/* ── Test mode: Pro ── */}
        {data && (
          <>
            <div style={heading}>{t('memory.test')}</div>
            {!data.pro && <div style={muted}>{t('memory.testLocked')}</div>}
            {data.pro && !test && <div style={muted}>{t('memory.testUpdatePro')}</div>}
            {test && test.runs === 0 && test.ignored.length === 0 && <div style={muted}>{t('memory.testEmpty')}</div>}
            {test && (test.runs > 0 || test.ignored.length > 0) && (
              <>
                {test.lastRunAt && (
                  <div style={{ fontSize: 12, marginBottom: 6 }}>{t('memory.testRuns', { count: test.runs, when: ago(test.lastRunAt) })}</div>
                )}
                <div style={row}><span style={{ color: color.mutedForeground, width: 14 }}>●</span>{t('memory.testOpen', { count: test.open })}</div>
                <div style={row}><span style={{ color: '#16a34a', width: 14 }}>✓</span>{t('memory.testFixed', { count: test.fixed })}</div>
                <div style={row}><span style={{ color: color.destructive, width: 14 }}>↺</span>{t('memory.testReturned', { count: test.returned.length })}</div>
                {test.returned.slice(0, 5).map(f => (
                  <button
                    key={f.id}
                    onClick={() => onOpenPage(f.page)}
                    title={t('memory.openPage')}
                    style={{ ...row, width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '3px 0 3px 22px', fontFamily: font.sans, color: color.foreground }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</span>
                    <span style={{ fontSize: 10, color: color.mutedForeground, flexShrink: 0 }}>{f.page} →</span>
                  </button>
                ))}

                {/* What the dev asked to ignore, and the way back */}
                {test.ignored.length > 0 && (
                  <>
                    <button
                      onClick={() => setIgnoredOpen(o => !o)}
                      aria-expanded={ignoredOpen}
                      style={{ ...heading, width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: font.sans }}
                    >
                      <span>{t('memory.ignored', { count: test.ignored.length })}</span>
                      <IconChevronRight size={12} stroke={2} style={{ transform: ignoredOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                    </button>
                    {ignoredOpen && (
                      <>
                        <div style={{ ...muted, marginBottom: 6 }}>{t('memory.ignoredHint')}</div>
                        {test.ignored.map(f => (
                          <div key={f.id} style={{ ...row, alignItems: 'center' }}>
                            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>
                              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</span>
                              {f.page && <span style={{ fontSize: 10, color: color.mutedForeground }}>{f.page}</span>}
                            </span>
                            <button style={linkButton()} onClick={() => onUndoDecision(f.id)}>{t('memory.unignore')}</button>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}

                {/* Where the checks are right, and where they are noise */}
                {test.byCategory.length > 0 && (
                  <>
                    <div style={heading}>{t('memory.accuracy')}</div>
                    {test.byCategory.map(c => {
                      const total = c.approved + c.discarded;
                      const rate = total ? c.approved / total : 0;
                      return (
                        <div key={c.category} style={{ ...row, alignItems: 'center' }} title={t('memory.accuracyDetail', { approved: c.approved, total })}>
                          <span style={{ flex: 1, minWidth: 0 }}>{categoryName(c.category)}</span>
                          <span style={{ width: 90, height: 6, borderRadius: 3, backgroundColor: color.muted, overflow: 'hidden', flexShrink: 0 }}>
                            <span style={{ display: 'block', width: `${Math.round(rate * 100)}%`, height: '100%', backgroundColor: ilse.test }} />
                          </span>
                          <span style={{ width: 34, textAlign: 'right', fontSize: 11, color: color.mutedForeground, flexShrink: 0 }}>{Math.round(rate * 100)}%</span>
                        </div>
                      );
                    })}
                  </>
                )}

                <div style={{ ...muted, marginTop: 12 }}>{t('memory.testAgent')}</div>
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {!confirmForget ? (
                    <button style={linkButton()} onClick={() => setConfirmForget(true)}>{t('memory.forget')}</button>
                  ) : (
                    <>
                      <span style={{ fontSize: 11 }}>{t('memory.forgetAsk')}</span>
                      <button style={linkButton(true)} onClick={() => { onForgetTest(); setConfirmForget(false); }}>{t('memory.forgetYes')}</button>
                      <button style={linkButton()} onClick={() => setConfirmForget(false)}>{t('memory.forgetNo')}</button>
                    </>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
