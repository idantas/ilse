/**
 * The Consistency tab (Pro): what on this screen is off the project's standard.
 * Ilse's rules answer at once (consistency.ts); the user's agent's review arrives a bit
 * later and joins the same list, with the look-alikes. The top line says what was
 * checked, so an empty list is never just "all good".
 */

import React, { useEffect, useMemo, useState } from 'react';
import { t, type MessageKey } from '../i18n/index.js';
import { color, font, radius, ilse } from './tokens.js';
import { Thumb, primaryButton, secondaryButton, sectionLabel } from './catalog-panel.js';
import { lock } from './property-panel.js';
import type { LookAlikeView } from './look-alike.js';
import { fixNote, previewable, ticksLit, type ConsistencyFinding, type Swap } from './consistency.js';
import { snapshotOf, writtenIn, type CatalogSnapshot } from './catalog-snapshot.js';

/** A finding of the agent's review, its piece numbers turned back into elements */
export interface AgentFinding { title: string; detail: string; fix: string; file?: string; line?: number; els: HTMLElement[] }

export type ReviewState = { status: 'running'; since: number } | { status: 'done'; findings: AgentFinding[] } | { status: 'off' };

export interface ConsistencyState {
  findings: ConsistencyFinding[];
  checked: { pieces: number; standards: number; colors: number };
}

/** A button on an open row: its note says exactly what the row's plan said */
export interface RowAction {
  label: string; note: string; primary?: boolean;
  /** Token swaps the page previews at once and Ilse writes without AI, like a panel edit */
  swaps?: Swap[];
  /** Classes the page takes off each piece at once, to show the fix; the agent writes it */
  drop?: Array<[HTMLElement, string[]]>;
}

/** One row, whoever found it. `plan`: what Fix will do, said before it's clicked */
export interface ConsistencyRow { key: string; title: string; detail: string; by: 'rules' | 'agent'; els: HTMLElement[]; plan: string[]; actions: RowAction[] }

const propName = (p: string) => p.startsWith('#') ? p : t(`consistency.prop.${p}` as MessageKey);
const words = (el: HTMLElement) => (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30);
const named = (el: HTMLElement) => { const o = writtenIn(el); return `"${words(el)}"${o ? ` in <${o}>` : ''}`; };

export function ruleRow(f: ConsistencyFinding): ConsistencyRow {
  const where = [f.text ? `“${f.text}”` : '', f.owner ? `<${f.owner}>` : ''].filter(Boolean).join(' · ');
  const title = f.type === 'override' ? t('consistency.override', { c: f.standard ?? '' })
    : f.type === 'copy' ? t('consistency.copy', { c: f.standard ?? '' })
    : f.type === 'off-font' ? t('consistency.offFont', { v: f.props.join(', ') })
    : f.type === 'off-size' ? t('consistency.offSize', { v: f.props.join(', ') })
    : t('consistency.offToken', { v: f.props.join(', ') });
  const detail = f.type === 'override' ? `${t('consistency.changes', { p: f.props.map(propName).join(', ') })} · ${where}` : where;
  const fix = { label: t('consistency.fix'), note: fixNote(f), primary: true };
  let plan: string[];
  let actions: RowAction[] = [fix];
  if (f.type === 'override') {
    // Back to the standard (the look changes) or the look kept as a variant (nothing changes)
    plan = [t('consistency.plan.override', { p: f.props.map(propName).join(', '), c: f.standard ?? '' }), t('consistency.plan.overrideVariant', { c: f.standard?.split(' ')[0] ?? '' })];
    actions = [
      { label: t('consistency.useStandard'), note: fixNote(f), primary: true, ...(f.drop?.length ? { drop: f.drop } : {}) },
      { label: t('consistency.makeVariant'), note: fixNote(f, 'variant') },
    ];
  }
  else if (f.type === 'copy') plan = [t('consistency.plan.copy', { c: f.standard ?? '' })];
  else {
    plan = (f.swaps ?? []).map(w => t(w.contrast === undefined ? 'consistency.plan.swap' : !w.ok ? 'consistency.plan.swapLow' : w.far ? 'consistency.plan.swapFar' : 'consistency.plan.swapOk', { from: w.from, token: w.token, value: w.value, r: w.contrast ?? 0 }));
    const token = f.swaps?.length === 1 ? f.swaps[0].token : undefined;
    actions = [
      { label: token ? t('consistency.useToken', { token }) : t('consistency.useTokens'), note: fixNote(f), primary: true, ...(previewable(f.swaps) ? { swaps: f.swaps } : {}) },
      { label: t('consistency.addToDs'), note: fixNote(f, 'add') },
    ];
    if (previewable(f.swaps)) plan.push(t('consistency.plan.preview'));
    plan.push(t('consistency.plan.add'));
  }
  if (f.els.length > 1) plan.splice(f.type.startsWith('off-') ? (f.swaps ?? []).length : plan.length, 0, t('consistency.plan.pieces', { n: f.els.length, list: f.pieces.map(x => x.replace(/ in <.*>$/, '').replace(/^"|"$/g, '')).slice(0, 6).join(' · ') }));
  return { key: f.id, title, detail: f.els.length > 1 ? `${detail} · ${f.els.length}×` : detail, by: 'rules', els: f.els, plan, actions };
}

export function agentRow(f: AgentFinding): ConsistencyRow {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '';
  const pieces = f.els.map(words).filter(Boolean);
  const note = fixNote({ type: 'agent', text: pieces[0] ?? f.title, detail: `${f.title}. ${f.detail}`, fix: f.fix, file: f.file, line: f.line, props: [], pieces: f.els.map(named) });
  return {
    key: `agent:${f.title}`, title: f.title, detail: [f.detail, where].filter(Boolean).join(' '), by: 'agent', els: f.els,
    plan: [f.fix ? `→ ${f.fix}` : '', pieces.length > 1 ? t('consistency.plan.pieces', { n: pieces.length, list: pieces.join(' · ') }) : ''].filter(Boolean),
    actions: [{ label: t('consistency.fix'), note, primary: true }],
  };
}

const TICKS = 24;

/** The agent's review on its way: the Pro area's meter, filled by the usual time of a review here */
function ReviewMeter({ since, expect }: { since: number; expect: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, []);
  const elapsed = now - since;
  const { lit, slow } = ticksLit(elapsed, expect, TICKS);
  const s = Math.round(elapsed / 1000);
  return (
    <div style={{ margin: '10px 0 4px', padding: '0 6px' }}>
      <div role="meter" aria-label={t('consistency.reviewing')} aria-valuemin={0} aria-valuemax={TICKS} aria-valuenow={lit} style={{ display: 'flex', justifyContent: 'space-between', gap: 2, height: 16, margin: '0 0 5px' }}>
        {Array.from({ length: TICKS }, (_, i) => (
          <span
            key={i}
            aria-hidden
            style={{
              width: 3, borderRadius: radius.full, background: i < lit ? ilse.brand : 'rgba(0,0,0,0.1)',
              ...(slow && i === lit ? { background: ilse.brand, animation: 'ilse-pulse 1.6s ease-in-out infinite' } : {}),
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 10, color: color.mutedForeground }}>{t(slow ? 'consistency.reviewSlow' : 'consistency.reviewTime', { s, r: Math.max(1, Math.round((expect - elapsed) / 1000)) })}</div>
    </div>
  );
}

const check = (size: number) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>;

/** One list: the rules', the agent's and the look-alikes, the ones on most pieces first */
type Item = { key: string; size: number; row?: ConsistencyRow; look?: LookAlikeView };

const lookMembers = (v: LookAlikeView) => [...v.family.variants.flatMap(x => x.members), ...v.family.nearMisses.map(n => n.member)].map(m => m.ref);

export function ConsistencyPanel({ state, rows, queued, open, onOpen, review, expectMs, lookAlikes, onSpot, onFix, onIgnore, onRefresh, onMakeLook, onIgnoreLook }: {
  state: ConsistencyState | null;
  rows: ConsistencyRow[];
  /** Rows (and look-alikes) already on a note: Fix was clicked */
  queued: Set<string>;
  /** The open row (kept by the toolbar) and opening one: its pieces stay outlined */
  open: string | null;
  onOpen: (key: string | null, els: HTMLElement[]) => void;
  review: ReviewState;
  /** The usual time of a review here, for its meter */
  expectMs: number;
  lookAlikes: LookAlikeView[] | null;
  onSpot: (els: HTMLElement[]) => void;
  onFix: (row: ConsistencyRow, action: RowAction) => void;
  /** Stops showing it on every screen; Memory brings it back */
  onIgnore: (row: ConsistencyRow) => void;
  /** Read the screen again and ask the agent again */
  onRefresh: () => void;
  onMakeLook: (v: LookAlikeView) => void;
  onIgnoreLook: (v: LookAlikeView) => void;
}) {
  const [variant, setVariant] = useState<number | null>(null);
  useEffect(() => setVariant(null), [open]);
  // Each piece's copy, taken once per read of the screen (a fix restyles it: the next read takes it again)
  const copies = useMemo(() => new Map<HTMLElement, CatalogSnapshot | undefined>(), [rows, lookAlikes]);
  const copyOf = (el?: HTMLElement) => {
    if (!el) return undefined;
    if (!copies.has(el)) { let c: CatalogSnapshot | undefined; try { c = el.isConnected ? snapshotOf(el) ?? undefined : undefined; } catch { /* no copy */ } copies.set(el, c); }
    return copies.get(el);
  };
  if (!state) return <div style={{ fontSize: 11, color: color.mutedForeground, padding: '12px 0' }}>{t('consistency.reading')}</div>;
  const running = review.status === 'running';
  const items: Item[] = [
    ...rows.map(r => ({ key: r.key, size: r.els.length, row: r })),
    ...(lookAlikes ?? []).map(v => ({ key: `look:${v.id}`, size: lookMembers(v).length, look: v })),
  ].sort((a, b) => b.size - a.size);
  const reviewLong = running ? t('consistency.agentRunning')
    : review.status === 'done' ? t(review.findings.length ? 'consistency.agentDone' : 'consistency.agentNone', { n: review.findings.length })
    : t('consistency.agentOff');
  const checked = t('consistency.checked', { p: state.checked.pieces, s: state.checked.standards, c: state.checked.colors });

  const tag = (label: string, hint: string, strong: boolean) => (
    <span title={hint} style={{ alignSelf: 'flex-start', flexShrink: 0, fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: radius.full, fontFamily: font.sans, background: strong ? ilse.orangePale : color.muted, color: strong ? '#8A4B12' : color.mutedForeground }}>{label}</span>
  );
  const done = (
    <span title={t('consistency.onNoteHint')} aria-label={t('consistency.onNote')} style={{ alignSelf: 'flex-start', flexShrink: 0, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, background: ilse.brand, color: '#fff' }}>{check(9)}</span>
  );
  const ignoreButton = (onClick: () => void) => (
    <button onClick={onClick} title={t('catalog.look.ignoreHint')} style={{ ...secondaryButton, border: 'none', background: 'transparent', color: color.mutedForeground, fontWeight: 500 }}>{t('catalog.look.ignore')}</button>
  );
  const planBox = (lines: string[], muteLast = false) => lines.length > 0 && (
    <div style={{ margin: '0 0 8px', padding: '6px 8px', borderRadius: radius.sm, background: color.background, fontSize: 10, lineHeight: 1.45, color: color.foreground }}>
      <div style={{ ...sectionLabel, marginBottom: 3 }}>{t('consistency.plan')}</div>
      {lines.map((line, i) => <div key={i} style={{ marginTop: i ? 3 : 0, color: muteLast && i && i === lines.length - 1 ? color.mutedForeground : undefined }}>{line}</div>)}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div title={`${checked}\n${reviewLong}`} style={{ flex: 1, minWidth: 0, fontSize: 10, color: color.mutedForeground, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {/* Empty: the state below says what was checked; the line would only repeat it */}
          {items.length > 0 && [
            t('consistency.checkedShort', { p: state.checked.pieces }),
            t(items.length === 1 ? 'consistency.foundOne' : 'consistency.foundMany', { n: items.length }),
            ...(review.status === 'done' ? [t('consistency.agentChecked')] : []),
          ].join(' · ')}
        </div>
        <button
          onClick={onRefresh}
          aria-label={t('consistency.refresh')}
          title={t('consistency.refresh')}
          disabled={running}
          style={{ border: 'none', background: 'none', cursor: running ? 'default' : 'pointer', color: color.mutedForeground, padding: '2px 4px', display: 'flex', opacity: running ? 0.4 : 1 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
        </button>
      </div>

      {!items.length && (
        <div title={t('consistency.visibleOnly')} style={{ textAlign: 'center', padding: '14px 8px 6px' }}>
          <div style={{ width: 24, height: 24, margin: '0 auto 6px', borderRadius: radius.full, display: 'flex', alignItems: 'center', justifyContent: 'center', background: color.muted, color: color.foreground }}>{check(12)}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: color.foreground }}>{t(review.status === 'done' ? 'consistency.cleanTitle' : 'consistency.emptyTitle')}</div>
          {review.status === 'done' && <div style={{ fontSize: 10, color: color.mutedForeground, marginTop: 2 }}>{t('consistency.cleanBoth')}</div>}
          {review.status === 'off' && <div style={{ fontSize: 10, color: color.mutedForeground, marginTop: 2 }}>{t('consistency.agentOffShort')}</div>}
          <div style={{ fontSize: 10, color: color.mutedForeground, marginTop: 2 }}>{t('consistency.emptyChecked', { p: state.checked.pieces, s: state.checked.standards, c: state.checked.colors })}</div>
        </div>
      )}

      <div>
        {items.map(it => {
          const isOpen = open === it.key;
          const onNote = queued.has(it.row ? it.row.key : it.look!.id);
          const els = it.row ? it.row.els : lookMembers(it.look!);
          let title: string, detail: string, badge: React.ReactNode;
          if (it.row) {
            title = it.row.title;
            detail = it.row.detail;
            badge = it.row.by === 'agent' ? tag(t('consistency.byAgent'), t('consistency.byAgentHint'), true) : tag(t('consistency.byRules'), t('consistency.byRulesHint'), false);
          } else {
            const v = it.look!;
            title = t('consistency.lookTitle', { kind: t(`catalog.look.kind.${v.kind}` as MessageKey), text: v.text ? ` “${v.text}”` : '', n: els.length });
            detail = [v.family.variants.length > 1 ? t('catalog.look.variants', { n: v.family.variants.length }) : '', v.places > 1 ? t('catalog.look.places', { n: v.places }) : ''].filter(Boolean).join(' · ') || t('consistency.lookDetail');
            badge = tag(t('consistency.byLooks'), t('catalog.look.hint'), false);
          }
          return (
            <div key={it.key} style={{ borderRadius: radius.sm, background: isOpen ? color.muted : undefined, marginBottom: isOpen ? 4 : 0 }}>
              <div
                className="ilse-catalog-row"
                role="button"
                aria-expanded={isOpen}
                onClick={() => onOpen(isOpen ? null : it.key, els)}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 6px', borderRadius: radius.sm, cursor: 'pointer' }}
              >
                {/* What the row is about, seen: the piece itself, before any words */}
                <Thumb snap={it.look ? it.look.snap : copyOf(els[0])} w={48} h={32} empty="" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: onNote ? color.mutedForeground : color.foreground, lineHeight: 1.35 }}>{title}</div>
                  <div style={{ fontSize: 10, color: color.mutedForeground, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', ...(isOpen ? {} : { whiteSpace: 'nowrap' }) }}>{detail}</div>
                </div>
                {onNote ? done : badge}
              </div>
              {isOpen && it.row && (() => {
                const r = it.row;
                return (
                  <div style={{ padding: '2px 6px 8px' }}>
                    {/* Fix is for all of them: each piece, seen */}
                    {r.els.length > 1 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {r.els.slice(0, 6).map((el, j) => (
                          <button
                            key={j}
                            onClick={() => { setVariant(j); onSpot([el]); }}
                            title={words(el)}
                            aria-pressed={variant === j}
                            style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', outline: 'none' }}
                          >
                            <div style={{ borderRadius: radius.sm + 2, padding: 1, boxShadow: variant === j ? `0 0 0 1.5px ${ilse.brand}` : undefined }}>
                              <Thumb snap={copyOf(el)} w={52} h={32} empty="" />
                            </div>
                          </button>
                        ))}
                        {r.els.length > 6 && <span style={{ alignSelf: 'center', fontSize: 9, color: color.mutedForeground }}>+{r.els.length - 6}</span>}
                      </div>
                    )}
                    {planBox(r.plan, r.by === 'rules' && r.actions.length > 1)}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {r.actions.map(a => (
                        <button key={a.label} onClick={() => onFix(r, a)} title={t(a.swaps || a.drop ? 'consistency.fixHintPreview' : 'consistency.fixHint')} style={{ ...secondaryButton, flex: a.primary && r.actions.length > 1 ? '1 1 100%' : a.primary ? 1 : undefined, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.primary && onNote ? t('consistency.fixAgain') : a.label}
                        </button>
                      ))}
                      {ignoreButton(() => onIgnore(r))}
                    </div>
                  </div>
                );
              })()}
              {isOpen && it.look && (() => {
                const v = it.look;
                const variants = v.family.variants.length;
                return (
                  <div style={{ padding: '2px 6px 8px' }}>
                    {variants > 1 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {v.family.variants.slice(0, 6).map((x, j) => (
                          <button
                            key={j}
                            onClick={() => { setVariant(j); onSpot(x.members.map(m => m.ref)); }}
                            title={t('catalog.look.showVariant')}
                            aria-pressed={variant === j}
                            style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontFamily: font.sans, outline: 'none' }}
                          >
                            <div style={{ borderRadius: radius.sm + 2, padding: 1, boxShadow: variant === j ? `0 0 0 1.5px ${ilse.brand}` : undefined }}>
                              <Thumb snap={v.variantSnaps[j]} w={52} h={32} />
                            </div>
                            <span style={{ fontSize: 9, color: color.mutedForeground }}>{x.members.length}×</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {planBox([t(variants > 1 ? 'consistency.plan.lookVariants' : 'consistency.plan.look', { n: els.length, v: variants })])}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => onMakeLook(v)} title={t(variants > 1 ? 'catalog.look.makeHintVariants' : 'catalog.look.makeHint', { n: els.length, v: variants })} style={{ ...secondaryButton, flex: 1 }}>
                        {onNote ? t('consistency.fixAgain') : t('catalog.look.make')}
                      </button>
                      {ignoreButton(() => onIgnoreLook(v))}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {running && <ReviewMeter since={review.since} expect={expectMs} />}
    </div>
  );
}

/** Free: the tab is there, locked — what it does and the way to Pro, nothing read on the page */
export function ConsistencyLocked() {
  return (
    <div style={{ textAlign: 'center', padding: '16px 8px 8px' }}>
      <div style={{ width: 28, height: 28, margin: '0 auto 8px', borderRadius: radius.full, display: 'flex', alignItems: 'center', justifyContent: 'center', background: color.muted, color: color.foreground }}>{lock(13)}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: color.foreground }}>{t('consistency.lockedTitle')}</div>
      <div style={{ fontSize: 10, color: color.mutedForeground, lineHeight: 1.45, margin: '4px 0 12px' }}>{t('consistency.lockedBody')}</div>
      <a href="https://ilse.design/#pro" target="_blank" rel="noreferrer" style={{ ...primaryButton, display: 'inline-block', textDecoration: 'none' }}>{t('catalog.lockedLink')} →</a>
    </div>
  );
}
