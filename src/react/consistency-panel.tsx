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
import { fixNote, previewable, recommend, ticksLit, type Decision, type ConsistencyFinding, type Swap } from './consistency.js';
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
  /** It adds to the DS (a token, a variant): once it lands, the DS is written again */
  ds?: true;
}

/** A fix that landed: listed until undone, so the way back is where the fix was made */
export interface AppliedRow { key: string; title: string; detail: string; ids: string[]; cs: string[] }

/** One row, whoever found it. `plan`: what Fix will do, said before it's clicked */
export interface ConsistencyRow {
  key: string; title: string; detail: string; by: 'rules' | 'agent'; els: HTMLElement[]; plan: string[]; actions: RowAction[];
  /** The change, drawn: each value and what it becomes (`toDs`: it becomes a new DS token instead) */
  change?: { swaps: Swap[]; toDs: boolean; name?: string };
  /** Why the leading fix leads, when it isn't the plain one */
  why?: string;
  /** ready: the plain fix · ai: needed a decision, the agent made it · you: needs the person's */
  group: 'ready' | 'ai' | 'you';
}

/** One step of "Fix all": a row's leading fix, a look-alike made a component, or either ignored */
export interface FixAllItem { row?: ConsistencyRow; action?: RowAction; look?: LookAlikeView; ignore?: true }

const propName = (p: string) => p.startsWith('#') ? p : t(`consistency.prop.${p}` as MessageKey);
const words = (el: HTMLElement) => (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30);
const named = (el: HTMLElement) => { const o = writtenIn(el); return `"${words(el)}"${o ? ` in <${o}>` : ''}`; };

export function ruleRow(f: ConsistencyFinding, d?: Decision): ConsistencyRow {
  const where = [f.text ? `“${f.text}”` : '', f.owner ? `<${f.owner}>` : ''].filter(Boolean).join(' · ');
  const title = f.type === 'override' ? t('consistency.override', { c: f.standard ?? '' })
    : f.type === 'copy' ? t('consistency.copy', { c: f.standard ?? '' })
    : f.type === 'off-font' ? t('consistency.offFont', { v: f.props.join(', ') })
    : f.type === 'off-size' ? t('consistency.offSize', { v: f.props.join(', ') })
    : t('consistency.offToken', { v: f.props.join(', ') });
  const detail = f.type === 'override' ? `${t('consistency.changes', { p: f.props.map(propName).join(', ') })} · ${where}` : where;
  const fix = { label: t('consistency.fix'), note: fixNote(f), primary: true };
  // Needs a decision: the agent's call leads once it made one; until then (or unsure) the rules' guess does
  const needs = recommend(f) === 'ds';
  const decided = needs && !!d && (d.choice === 'fix' || d.choice === 'ds');
  const toDs = decided ? d!.choice === 'ds' : needs;
  const named = (note: string) => toDs && decided && d!.name ? `${note}\nName it \`${d!.name}\`.` : note;
  const group: ConsistencyRow['group'] = !needs ? 'ready' : decided ? 'ai' : 'you';
  let plan: string[];
  let actions: RowAction[] = [fix];
  let change: ConsistencyRow['change'];
  let why: string | undefined;
  if (f.type === 'override') {
    // Back to the standard (the look changes) or the look kept as a variant (nothing changes): repeated, it looks meant
    plan = [toDs ? t('consistency.plan.variant', { c: f.standard?.split(' ')[0] ?? '' }) : t('consistency.plan.override', { p: f.props.map(propName).join(', '), c: f.standard ?? '' })];
    actions = [
      { label: t('consistency.useStandard'), note: fixNote(f), primary: !toDs, ...(f.drop?.length ? { drop: f.drop } : {}) },
      { label: t('consistency.makeVariant'), note: named(fixNote(f, 'variant')), ds: true, primary: toDs },
    ];
    if (needs) why = t('consistency.why.variant', { n: f.els.length });
  }
  else if (f.type === 'copy') plan = [t('consistency.plan.copy', { c: f.standard ?? '' })];
  else {
    // The swaps are drawn (change); the plan only says what the leading button does
    change = { swaps: f.swaps ?? [], toDs, ...(toDs && decided && d!.name ? { name: d!.name } : {}) };
    plan = [toDs ? t('consistency.plan.addMain') : previewable(f.swaps) ? t('consistency.plan.preview') : t('consistency.plan.useTokens')];
    const token = f.swaps?.length === 1 ? f.swaps[0].token : undefined;
    actions = [
      { label: token ? t('consistency.useToken', { token }) : t('consistency.useTokens'), note: fixNote(f), primary: !toDs, ...(previewable(f.swaps) ? { swaps: f.swaps } : {}) },
      { label: t('consistency.addToDs'), note: named(fixNote(f, 'add')), ds: true, primary: toDs },
    ];
    if (needs) why = t((f.swaps ?? []).some(w => w.far) ? 'consistency.why.far' : 'consistency.why.unreadable', { n: f.els.length });
  }
  if (f.els.length > 1) plan.push(t('consistency.plan.pieces', { n: f.els.length, list: f.pieces.map(x => x.replace(/ in <.*>$/, '').replace(/^"|"$/g, '')).slice(0, 6).join(' · ') }));
  // The agent's reason replaces the rules' guess; unsure, it says what it couldn't tell
  if (needs && d) why = t(decided ? 'consistency.why.ai' : 'consistency.why.unsure', { why: d.why });
  return { key: f.id, title, detail: f.els.length > 1 ? `${detail} · ${f.els.length}×` : detail, by: 'rules', els: f.els, plan, actions, change, why, group };
}

const isColor = (w: Swap) => w.role === 'fill' || w.role === 'text' || w.role === 'border';

/** One value as it looks: a colour's swatch, a size's or a font's "Aa" */
function Sample({ w, side }: { w: Swap; side: 'from' | 'to' }) {
  const v = side === 'from' ? w.from : w.value;
  if (isColor(w)) return <span aria-hidden style={{ flexShrink: 0, width: 12, height: 12, borderRadius: radius.full, background: v, boxShadow: `inset 0 0 0 1px ${color.border}` }} />;
  const px = parseFloat(v);
  return <span aria-hidden style={{ flexShrink: 0, lineHeight: 1, color: color.foreground, ...(w.role === 'size' && px ? { fontSize: Math.min(Math.max(px, 8), 18) } : { fontFamily: v, fontSize: 13 }) }}>Aa</span>;
}

/** The change as an object: each value → what it becomes, drawn; the contrast note under it */
function ChangeLines({ change }: { change: NonNullable<ConsistencyRow['change']> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {change.swaps.map((w, i) => (
        <div key={i}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: color.foreground, minWidth: 0 }}>
            <Sample w={w} side="from" />
            <span style={{ fontFamily: font.mono, fontSize: 10, whiteSpace: 'nowrap' }}>{w.from}</span>
            <span aria-hidden style={{ color: color.mutedForeground }}>→</span>
            {change.toDs ? (
              <span style={{ fontWeight: 600 }}>{change.name ? `${t('consistency.newToken')} ${change.name}` : t('consistency.newToken')}</span>
            ) : (
              <>
                <Sample w={w} side="to" />
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${w.token} (${w.value})`}>{w.token}</span>
              </>
            )}
          </div>
          {!change.toDs && w.contrast !== undefined && (
            <div style={{ fontSize: 9, marginTop: 2, color: w.ok ? color.mutedForeground : '#B42318' }}>
              {t(!w.ok ? 'consistency.contrastLow' : w.far ? 'consistency.contrastFar' : 'consistency.contrastOk', { r: w.contrast })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function agentRow(f: AgentFinding): ConsistencyRow {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '';
  const pieces = f.els.map(words).filter(Boolean);
  const note = fixNote({ type: 'agent', text: pieces[0] ?? f.title, detail: `${f.title}. ${f.detail}`, fix: f.fix, file: f.file, line: f.line, props: [], pieces: f.els.map(named) });
  return {
    key: `agent:${f.title}`, title: f.title, detail: [f.detail, where].filter(Boolean).join(' '), by: 'agent', els: f.els,
    plan: [f.fix ? `→ ${f.fix}` : '', pieces.length > 1 ? t('consistency.plan.pieces', { n: pieces.length, list: pieces.join(' · ') }) : ''].filter(Boolean),
    actions: [{ label: t('consistency.fix'), note, primary: true }],
    group: 'ready',
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
              // Done in the brand orange, the one on its way in yellow (warming up to orange), the rest empty
              width: 3, borderRadius: radius.full, transition: 'background-color 0.4s ease',
              backgroundColor: i < lit ? ilse.brand : i === lit ? ilse.yellow : 'rgba(0,0,0,0.1)',
              ...(slow && i === lit ? { animation: 'ilse-pulse 1.6s ease-in-out infinite' } : {}),
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
type Item = { key: string; size: number; row?: ConsistencyRow; look?: LookAlikeView; group: ConsistencyRow['group']; decision?: Decision;
  /** A look-alike on the same pieces as this finding: offered here as the other way to fix them */
  alsoLook?: LookAlikeView };

const lookMembers = (v: LookAlikeView) => [...v.family.variants.flatMap(x => x.members), ...v.family.nearMisses.map(n => n.member)].map(m => m.ref);

export function ConsistencyPanel({ state, rows, queued, applied, undoTop, open, onOpen, review, expectMs, lookAlikes, decisions, onSpot, onFix, onFixAll, onEdit, onUndo, onUndoAll, onIgnore, onRefresh, onMakeLook, onIgnoreLook }: {
  state: ConsistencyState | null;
  rows: ConsistencyRow[];
  /** Rows (and look-alikes) already on a note: Fix was clicked */
  queued: Set<string>;
  applied: AppliedRow[];
  /** The batch an undo takes back now: only a row written by it can be undone on its own */
  undoTop?: string;
  /** The open row (kept by the toolbar) and opening one: its pieces stay outlined */
  open: string | null;
  onOpen: (key: string | null, els: HTMLElement[]) => void;
  review: ReviewState;
  /** The usual time of a review here, for its meter */
  expectMs: number;
  lookAlikes: LookAlikeView[] | null;
  onSpot: (els: HTMLElement[]) => void;
  onFix: (row: ConsistencyRow, action: RowAction) => void;
  /** The agent's calls (keys: a rule row's, `look:<id>` for a look-alike) */
  decisions: Map<string, Decision>;
  /** Every ready fix and every decided one, as one batch */
  onFixAll: (items: FixAllItem[]) => void;
  /** The fix on a note, to add words before it goes */
  onEdit: (row: ConsistencyRow, action: RowAction) => void;
  onUndo: (key: string) => void;
  onUndoAll: () => void;
  /** Stops showing it on every screen; Memory brings it back */
  onIgnore: (row: ConsistencyRow) => void;
  /** Read the screen again and ask the agent again */
  onRefresh: () => void;
  /** `edit`: opens the note instead of sending it at once */
  onMakeLook: (v: LookAlikeView, edit?: boolean) => void;
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
  // A look-alike on pieces a finding is about (the agent's "category pills written by hand" on the
  // same 4 links) is one problem with two fixes: one row, the finding's fix first, "Make it a component"
  // beside it. Ignore the finding and the look-alike is listed on its own again
  const joined = new Map<ConsistencyRow, LookAlikeView>();
  const alone = (lookAlikes ?? []).filter(v => {
    const els = new Set(lookMembers(v));
    const row = rows.find(r => !joined.has(r) && r.els.some(el => els.has(el)));
    if (row) joined.set(row, v);
    return !row;
  });
  const items: Item[] = [
    ...rows.map(r => ({ key: r.key, size: r.els.length, row: r, group: r.group, alsoLook: joined.get(r) })),
    ...alone.map(v => {
      // A look-alike always needs a decision: one component, or fine as it is
      const d = decisions.get(`look:${v.id}`);
      const decision = d && (d.choice === 'ds' || d.choice === 'ignore') ? d : undefined;
      return { key: `look:${v.id}`, size: lookMembers(v).length, look: v, group: decision ? 'ai' as const : 'you' as const, decision: decision ?? d };
    }),
  ].sort((a, b) => b.size - a.size);
  const GROUPS = ['ready', 'ai', 'you'] as const;
  const byGroup = Object.fromEntries(GROUPS.map(g => [g, items.filter(it => it.group === g)])) as Record<Item['group'], Item[]>;
  const mainOf = (r: ConsistencyRow) => r.actions.find(a => a.primary) ?? r.actions[0];
  // "Fix all": what's ready and what the agent decided, not already on a note — once the agent has answered
  // A look-alike on pieces a row already fixes (the agent's "use the Button" on the same 4 chips) stays out: two fixes on one piece
  const taken = new Set<HTMLElement>();
  const fixable: FixAllItem[] = [...byGroup.ready, ...byGroup.ai].sort((a, b) => Number(!!a.look) - Number(!!b.look)).flatMap((it): FixAllItem[] => {
    if (queued.has(it.row ? it.row.key : it.look!.id) || (it.alsoLook && queued.has(it.alsoLook.id))) return [];
    if (it.row) { it.row.els.forEach(el => taken.add(el)); return [{ row: it.row, action: mainOf(it.row) }]; }
    if (lookMembers(it.look!).some(el => taken.has(el))) return [];
    return [it.decision?.choice === 'ignore' ? { look: it.look, ignore: true } : { look: it.look }];
  });
  const fixAllButton = !running && fixable.length > 1 && (
    <button onClick={() => onFixAll(fixable)} title={t('consistency.fixAllHint')} style={{ ...primaryButton, width: '100%' }}>
      {t('consistency.fixAll', { n: fixable.length })}
    </button>
  );
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
  // Every open row ends the same way: the recommended fix, white (only Fix all is orange); the other choices as text on one line, Ignore last
  // When Ignore is the recommended fix itself, it isn't repeated at the end
  const actionBlock = (main: { label: string; title: string; onClick: () => void }, alts: { label: string; title?: string; onClick: () => void }[], onIgnore?: () => void) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button onClick={main.onClick} title={main.title} style={{ ...secondaryButton, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{main.label}</button>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 12 }}>
        {alts.map(a => <button key={a.label} onClick={a.onClick} title={a.title} style={textButton}>{a.label}</button>)}
        {onIgnore && <button onClick={onIgnore} title={t('catalog.look.ignoreHint')} style={{ ...textButton, marginLeft: 'auto', color: color.mutedForeground, fontWeight: 400 }}>{t('catalog.look.ignore')}</button>}
      </div>
    </div>
  );
  const planBox = (lines: string[], change?: ConsistencyRow['change'], why?: string) => (lines.length > 0 || !!change?.swaps.length) && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 0 8px', padding: '8px 10px', borderRadius: radius.sm, background: color.background, fontSize: 10, lineHeight: 1.45, color: color.foreground }}>
      <div style={sectionLabel}>{t('consistency.plan')}</div>
      {!!change?.swaps.length && <ChangeLines change={change} />}
      {lines.map((line, i) => <div key={i}>{line}</div>)}
      {why && <div style={{ color: color.mutedForeground }}>{why}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Every block shares the rows' 6px inset, so text, thumbnails and buttons line up on one edge */}
      <div style={{ padding: '0 6px' }}>
        <div style={{ fontSize: 11, color: color.foreground, lineHeight: 1.4, marginBottom: 2 }}>{t('consistency.intro')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
      </div>

      {applied.length > 0 && (
        // A box of its own: what's done reads apart from what's left to do
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: radius.sm, border: `1px solid ${color.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ ...sectionLabel, flex: 1, margin: 0 }}>{t(applied.length === 1 ? 'consistency.appliedOne' : 'consistency.appliedMany', { n: applied.length })}</span>
            {applied.length > 1 && <button onClick={onUndoAll} title={t('consistency.undoAllHint')} style={linkButton}>{t('consistency.undoAll')}</button>}
          </div>
          {applied.map(r => {
            const last = r.cs[r.cs.length - 1];
            const can = !!last && last === undoTop;
            return (
              <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden style={{ flexShrink: 0, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, background: ilse.brand, color: '#fff' }}>{check(9)}</span>
                <div title={r.detail} style={{ flex: 1, minWidth: 0, fontSize: 11, color: color.mutedForeground, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                {last && (
                  <button onClick={() => onUndo(r.key)} disabled={!can} title={t(can ? 'consistency.undoHint' : 'consistency.undoLater')} style={{ ...linkButton, opacity: can ? 1 : 0.45, cursor: can ? 'pointer' : 'default' }}>
                    {t('consistency.undo')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!items.length && (
        <div title={t('consistency.visibleOnly')} style={{ textAlign: 'center', padding: '14px 8px 6px' }}>
          <div style={{ width: 24, height: 24, margin: '0 auto 6px', borderRadius: radius.full, display: 'flex', alignItems: 'center', justifyContent: 'center', background: color.muted, color: color.foreground }}>{check(12)}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: color.foreground }}>{t(review.status === 'done' ? 'consistency.cleanTitle' : 'consistency.emptyTitle')}</div>
          {review.status === 'done' && <div style={{ fontSize: 10, color: color.mutedForeground, marginTop: 2 }}>{t('consistency.cleanBoth')}</div>}
          {review.status === 'off' && <div style={{ fontSize: 10, color: color.mutedForeground, marginTop: 2 }}>{t('consistency.agentOffShort')}</div>}
          <div style={{ fontSize: 10, color: color.mutedForeground, marginTop: 2 }}>{t('consistency.emptyChecked', { p: state.checked.pieces, s: state.checked.standards, c: state.checked.colors })}</div>
        </div>
      )}

      {GROUPS.filter(g => byGroup[g].length).map(g => (
      <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ ...sectionLabel, margin: 0, padding: '0 6px' }}>{t(`consistency.group.${g}` as MessageKey, { n: byGroup[g].length })}</div>
        {byGroup[g].map(it => {
          const isOpen = open === it.key;
          const onNote = queued.has(it.row ? it.row.key : it.look!.id) || (!!it.alsoLook && queued.has(it.alsoLook.id));
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
            <div key={it.key} style={{ borderRadius: radius.sm, background: isOpen ? color.muted : undefined }}>
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
                    {(() => {
                      const main = r.actions.find(a => a.primary) ?? r.actions[0];
                      // Every Fix goes at once (the agent's too): it lands under applied, with Undo
                      const hint = (_a: RowAction) => t('consistency.fixHintNow');
                      return (
                        <>
                          {planBox(r.plan, r.change, r.why)}
                          {actionBlock(
                            { label: onNote ? t('consistency.fixAgain') : main.label, title: hint(main), onClick: () => onFix(r, main) },
                            [
                              ...r.actions.filter(a => a !== main).map(a => ({ label: a.label, title: hint(a), onClick: () => onFix(r, a) })),
                              ...(it.alsoLook && !onNote ? [{ label: t('consistency.makeJoined', { n: lookMembers(it.alsoLook).length }), title: t('catalog.look.makeHint', { n: lookMembers(it.alsoLook).length }), onClick: () => onMakeLook(it.alsoLook!) }] : []),
                              // Fix goes in at once; editing the request is the way to say more first
                              ...(!onNote ? [{ label: t('consistency.editRequest'), onClick: () => onEdit(r, main) }] : []),
                            ],
                            () => onIgnore(r),
                          )}
                        </>
                      );
                    })()}
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
                    {planBox([t(variants > 1 ? 'consistency.plan.lookVariants' : 'consistency.plan.look', { n: els.length, v: variants })], undefined, it.decision?.why ? t(it.group === 'ai' ? 'consistency.why.ai' : 'consistency.why.unsure', { why: it.decision.why }) : undefined)}
                    {it.decision?.choice === 'ignore' ? actionBlock(
                      { label: t('catalog.look.ignore'), title: t('catalog.look.ignoreHint'), onClick: () => onIgnoreLook(v) },
                      [{ label: t('catalog.look.make'), onClick: () => onMakeLook(v) }],
                    ) : actionBlock(
                      { label: onNote ? t('consistency.fixAgain') : t('catalog.look.make'), title: t(variants > 1 ? 'catalog.look.makeHintVariants' : 'catalog.look.makeHint', { n: els.length, v: variants }), onClick: () => onMakeLook(v) },
                      onNote ? [] : [{ label: t('consistency.editRequest'), onClick: () => onMakeLook(v, true) }],
                      () => onIgnoreLook(v),
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
        {/* After what it fixes: the ready ones, and what the agent decided when there's any */}
        {(g === 'ai' || (g === 'ready' && !byGroup.ai.length)) && fixAllButton}
      </div>
      ))}

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

// A choice next to the filled button: text, no box, so the recommended one leads
const textButton: React.CSSProperties = {
  border: 'none', background: 'none', padding: '4px 0', cursor: 'pointer', fontFamily: font.sans,
  fontSize: 11, fontWeight: 500, color: color.foreground, whiteSpace: 'nowrap',
};

const linkButton: React.CSSProperties = {
  border: 'none', background: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: font.sans,
  fontSize: 10, fontWeight: 500, color: color.foreground,
};
