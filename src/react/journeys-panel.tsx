/**
 * Test mode's Journeys panel (Pro), in the 0.3 chat's design: what the dev
 * asked as a pill on the right, Ilse's steps as bubbles on the left, the field
 * as a white pill above the toolbar. The field only creates journeys — a
 * question typed here is never turned into a design change.
 */
import React, { useEffect, useRef, useState } from 'react';
import { IconArrowUp, IconPlayerPlay, IconX, IconFolderPlus, IconFolderCheck, IconSparkles, IconSquare, IconSquareCheckFilled } from '@tabler/icons-react';
import { color, font, ilse } from './tokens.js';
import { speechButton } from './speech-bubble.js';
import { t } from '../i18n/index.js';

export interface ViewportResult { outcome: 'recorded' | 'passed' | 'flaky' | 'repaired' | 'stuck'; reason?: string; why?: string; page?: string; step?: number }

export interface JourneySummary {
  id: string;
  goal: string;
  start: string;
  steps: number;
  mobileVariant: boolean;
  last: { at: string; ms: number; desktop: ViewportResult; mobile?: ViewportResult } | null;
  /** In the project's .ilse/journeys.md: no, the same, or the project's copy is behind this machine's */
  project?: 'no' | 'saved' | 'behind';
}

/** A journey the agent found in the code, not created yet */
export interface JourneySuggestion { goal: string; start: string }

/** The journey running now, as the page heard it */
export interface JourneyLive {
  id: string;
  goal: string;
  lines: Array<{ viewport: 'desktop' | 'mobile'; text: string }>;
  /** A destructive click waiting for an OK */
  confirm?: string;
  /** Set when it finished: the bubbles stay until the next run */
  done?: JourneySummary;
}

/** One line for a viewport's result */
export function journeyStatus(r: ViewportResult | undefined, ms?: number): string {
  const s = Math.max(1, Math.round((ms ?? 0) / 1000));
  if (!r) return t('journeys.never');
  switch (r.outcome) {
    case 'recorded': return ms ? t('journeys.recorded', { s }) : t('journeys.recordedPlain');
    case 'passed': return ms ? t('journeys.passed', { s }) : t('journeys.passedPlain');
    case 'flaky': return t('journeys.flaky');
    case 'repaired': return t('journeys.repaired');
  }
  if (r.why === 'no-agent') return t('journeys.noAgent');
  if (r.why === 'needs-login') return t('journeys.needsLogin');
  if (r.why === 'safety') return t('journeys.safety', { name: r.reason ?? '' });
  return t('journeys.stuck', { step: r.step ?? '?', reason: r.reason ?? '' });
}

/** Both viewports: "no celular: travou no passo 1: … · no computador: passou" */
export function journeyLine(j: JourneySummary): { text: string; ok: boolean | null } {
  const last = j.last;
  if (!last) return { text: journeyStatus(undefined), ok: null };
  const ok = last.desktop.outcome !== 'stuck' && last.mobile?.outcome !== 'stuck';
  // Both screens said apart only when they differ: the one that broke first
  if (last.mobile && last.mobile.outcome !== last.desktop.outcome) {
    const desk = t('journeys.desktop', { status: journeyStatus(last.desktop) });
    const mob = t('journeys.mobile', { status: journeyStatus(last.mobile) });
    return { text: last.mobile.outcome === 'stuck' ? `${mob} · ${desk}` : `${desk} · ${mob}`, ok };
  }
  return { text: journeyStatus(last.desktop, last.ms), ok };
}

const userPill: React.CSSProperties = {
  alignSelf: 'flex-end', maxWidth: '90%', backgroundColor: ilse.testPale, color: '#171717',
  padding: '5px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600, lineHeight: 1.4, wordBreak: 'break-word',
};

const agentBubble: React.CSSProperties = {
  alignSelf: 'flex-start', maxWidth: '92%', color: '#525252', fontSize: 12, fontWeight: 500, lineHeight: 1.4,
  // Opaque enough to read over a chart or a photo; the blur keeps the page felt behind it
  backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', backgroundColor: 'rgba(245,245,245,0.92)',
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
  padding: '5px 10px', borderRadius: 10, wordBreak: 'break-word',
};

function Square({ pulsing, tone }: { pulsing?: boolean; tone?: 'ok' | 'bad' }) {
  return (
    <span style={{
      display: 'inline-block', width: 5, height: 5, marginRight: 6, verticalAlign: 'middle',
      background: tone === 'bad' ? '#ef4444' : tone === 'ok' ? '#16a34a' : ilse.test,
      animation: pulsing ? 'ilse-thinking-dot 1.2s ease-in-out infinite' : undefined,
    }} />
  );
}

export function JourneysPanel({ journeys, recording, live, error, extendsRight, suggestions, suggesting, onAdd, onRun, onRemove, onConfirm, onSuggest, onShare, onClose }: {
  journeys: JourneySummary[];
  /** The core can ask the agent: new journeys can be recorded */
  recording: boolean;
  live: JourneyLive | null;
  error?: string | null;
  extendsRight: boolean;
  /** From the code: null before asking, [] when it found none */
  suggestions: JourneySuggestion[] | null;
  suggesting: boolean;
  /** start: where it begins — the page the dev is on, or the suggestion's */
  onAdd: (goal: string, start?: string) => void;
  onRun: (id?: string) => void;
  onRemove: (id: string) => void;
  onConfirm: (ok: boolean) => void;
  onSuggest: () => void;
  onShare: (id: string, on: boolean) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const running = !!live && !live.done;

  // Suggestions are picked first (any number), then one CTA records them, one after another
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [queue, setQueue] = useState<JourneySuggestion[]>([]);
  // The suggestion being recorded now (state: the list comes back when it clears)
  const [recordingGoal, setRecordingGoal] = useState<string | null>(null);
  const togglePick = (goal: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(goal)) next.delete(goal); else next.add(goal);
    return next;
  });
  const recordPicked = () => {
    if (!suggestions || running) return;
    setQueue(suggestions.filter(sg => picked.has(sg.goal)));
    setPicked(new Set());
  };
  // The next one starts when the one recording has finished — and Pro is free again: it says
  // "done" while it still closes the browser (an add then is dropped), and sends the list once free
  const listAtDone = useRef<JourneySummary[] | null>(null);
  useEffect(() => {
    if (recordingGoal) {
      if (live?.done && live.goal === recordingGoal) { listAtDone.current = journeys; setRecordingGoal(null); }
      return;
    }
    if (running || !queue.length) return;
    if (listAtDone.current && listAtDone.current === journeys) return;
    listAtDone.current = null;
    const [next, ...rest] = queue;
    setRecordingGoal(next.goal);
    setQueue(rest);
    onAdd(next.goal, next.start);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, live, running, recordingGoal, journeys]);
  // It couldn't start (an error, nothing running): stop the line instead of waiting forever
  useEffect(() => {
    if (error && recordingGoal && !running) { setRecordingGoal(null); setQueue([]); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
  const busy = running || queue.length > 0 || !!recordingGoal;
  // What's left to offer: not recorded yet, not waiting in line
  const offered = (suggestions ?? []).filter(sg => !journeys.some(j => j.goal === sg.goal) && !queue.some(q => q.goal === sg.goal) && sg.goal !== recordingGoal);

  // Newest bubble in view as steps arrive
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [live?.lines.length, live?.confirm, live?.done, journeys.length, suggestions, suggesting]);

  const submit = () => {
    const goal = input.trim();
    if (!goal || running) return;
    onAdd(goal);
    setInput('');
  };

  const liveLine = live?.done ? journeyLine(live.done) : null;

  // A journey's pill: hovering shows run, save to the project and remove
  const pill = (j: JourneySummary) => (
    <div
      style={{ ...userPill, display: 'flex', gap: 6, alignItems: 'center', cursor: running ? 'default' : 'pointer' }}
      title={running ? undefined : t('journeys.run')}
      onMouseEnter={() => setHover(j.id)}
      onMouseLeave={() => setHover(null)}
      onClick={() => { if (!running) onRun(j.id); }}
    >
      <span>{j.goal}</span>
      {hover === j.id && !running && (
        <>
          <IconPlayerPlay size={12} stroke={2} color={ilse.test} />
          {j.steps > 0 && (
            <button
              aria-label={t(j.project === 'saved' ? 'journeys.unsave' : 'journeys.save')} title={t(j.project === 'saved' ? 'journeys.unsave' : 'journeys.save')}
              onClick={(e) => { e.stopPropagation(); onShare(j.id, j.project !== 'saved'); }}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 0, color: j.project === 'saved' ? ilse.test : color.mutedForeground }}
            >
              {j.project === 'saved' ? <IconFolderCheck size={12} stroke={2} /> : <IconFolderPlus size={12} stroke={2} />}
            </button>
          )}
          <button
            aria-label={t('journeys.remove')} title={t('journeys.remove')}
            onClick={(e) => { e.stopPropagation(); onRemove(j.id); }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 0, color: color.mutedForeground }}
          >
            <IconX size={12} stroke={2} />
          </button>
        </>
      )}
    </div>
  );
  const projectNote = (j: JourneySummary) => (
    <>
      {j.project === 'saved' && <span style={{ color: '#8a8a8a' }}> · {t('journeys.inProject')}</span>}
      {j.project === 'behind' && (
        <button
          onClick={() => onShare(j.id, true)}
          style={{ background: 'none', border: 'none', padding: 0, marginLeft: 4, cursor: 'pointer', color: ilse.test, fontSize: 12, fontWeight: 600, fontFamily: font.sans }}
        >
          · {t('journeys.behind')}
        </button>
      )}
    </>
  );
  // Just finished: the list's own entry (it has the actions and knows if it's saved), else what the run said
  const finished = live?.done ? (journeys.find(j => j.id === live.id) ?? live.done) : null;


  return (
    <div
      data-ilse-toolbar
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', bottom: 'calc(100% + 12px)', ...(extendsRight ? { left: 0 } : { right: 0 }),
        width: 340, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: font.sans,
      }}
    >
      <div ref={scrollRef} className="ilse-hidden-scroll" style={{ overflowY: 'auto', maxHeight: 320, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {journeys.length === 0 && !live && (
          <div style={agentBubble}>
            <Square />{t('journeys.empty')}
            {recording && !suggestions && !suggesting && (
              <div style={{ marginTop: 8 }}>
                <button style={{ ...speechButton('test', true), display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={onSuggest}>
                  <IconSparkles size={13} stroke={2} />{t('journeys.suggest')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* The list: each journey as the dev's pill, its last result as Ilse's answer */}
        {journeys.filter(j => j.id !== live?.id).map(j => {
          const line = journeyLine(j);
          return (
            <React.Fragment key={j.id}>
              {pill(j)}
              <div style={agentBubble}>
                <Square tone={line.ok === true ? 'ok' : line.ok === false ? 'bad' : undefined} />{line.text}
                {projectNote(j)}
              </div>
            </React.Fragment>
          );
        })}
        {/* The one running (or just finished): one bubble per step */}
        {live && (
          <>
            {finished ? pill(finished) : <div style={userPill}>{live.goal}</div>}
            {live.lines.map((l, i) => (
              <div key={i} style={{ ...agentBubble, animation: i === live.lines.length - 1 ? 'ilse-thinking-in 0.3s ease-out' : undefined }}>
                <Square pulsing={running && !live.confirm && i === live.lines.length - 1} />
                {l.viewport === 'mobile' ? '📱 ' : ''}{l.text}
              </div>
            ))}
            {running && live.lines.length === 0 && <div style={agentBubble}><Square pulsing />{t('journeys.opening')}</div>}
            {live.confirm !== undefined && (
              <div style={{ ...agentBubble, color: '#171717' }}>
                <Square />{t('journeys.confirm', { name: live.confirm })}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button style={speechButton('test', true)} onClick={() => onConfirm(true)}>{t('journeys.confirmYes')}</button>
                  <button style={speechButton('test', false)} onClick={() => onConfirm(false)}>{t('journeys.confirmNo')}</button>
                </div>
              </div>
            )}
            {liveLine && (
              <div style={{ ...agentBubble, color: '#171717', fontWeight: 600 }}>
                <Square tone={liveLine.ok ? 'ok' : 'bad'} />{liveLine.text}
                {finished && projectNote(finished)}
              </div>
            )}
          </>
        )}

        {suggesting && <div style={agentBubble}><Square pulsing />{t('journeys.suggesting')}</div>}
        {queue.length > 0 && <div style={{ ...agentBubble, fontSize: 11 }}><Square />{t('journeys.queued', { count: queue.length })}</div>}
        {/* While recording, the rest of the suggestions wait; they come back when the line is done */}
        {suggestions && !suggesting && !busy && (
          suggestions.length === 0
            ? <div style={agentBubble}><Square />{t('journeys.noSuggestions')}</div>
            : offered.length > 0 && (
              <div style={agentBubble}>
                <Square />{t('journeys.suggested')}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                  {offered.map(sg => {
                    const on = picked.has(sg.goal);
                    return (
                      <button
                        key={sg.goal}
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => togglePick(sg.goal)}
                        title={sg.start}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left', padding: '5px 8px', borderRadius: 8,
                          border: `1px solid ${on ? ilse.test : ilse.testLight}`, background: on ? ilse.testPale : '#fff', cursor: 'pointer',
                          fontSize: 12, fontWeight: 600, color: '#171717', fontFamily: font.sans,
                        }}
                      >
                        {on
                          ? <IconSquareCheckFilled size={14} color={ilse.test} style={{ flexShrink: 0 }} />
                          : <IconSquare size={14} stroke={2} color={ilse.test} style={{ flexShrink: 0 }} />}
                        <span style={{ flex: 1, minWidth: 0 }}>{sg.goal}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button
                    disabled={picked.size === 0}
                    onClick={recordPicked}
                    style={{ ...speechButton('test', picked.size > 0), opacity: picked.size ? 1 : 0.45, cursor: picked.size ? 'pointer' : 'default' }}
                  >
                    {picked.size ? t('journeys.recordPicked', { count: picked.size }) : t('journeys.pickSome')}
                  </button>
                </div>
              </div>
            )
        )}
        {error && <div style={{ ...agentBubble, color: '#ef4444' }}><Square tone="bad" />{error}</div>}
        {!recording && <div style={{ ...agentBubble, fontSize: 11 }}>{t('journeys.noRecording')}</div>}
      </div>

      {journeys.length > 0 && !busy && (
        <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 12 }}>
          {recording && !suggesting && (
            <button
              onClick={onSuggest}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: ilse.test, fontFamily: font.sans }}
            >
              <IconSparkles size={12} stroke={2} />{t('journeys.suggestMore')}
            </button>
          )}
          {journeys.length > 1 && (
            <button
              onClick={() => onRun()}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: ilse.test, fontFamily: font.sans }}
            >
              {t('journeys.runAll')}
            </button>
          )}
        </div>
      )}

      {/* The field: a white pill with the test mode's blue glow */}
      <div style={{
        display: 'flex', gap: 6, alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 22, padding: '4px 4px 4px 14px',
        boxShadow: '0 0 24px rgba(47,107,255,0.18), 0 0 8px rgba(47,107,255,0.1), 0 4px 12px rgba(0,0,0,0.04)',
      }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
          placeholder={t('journeys.placeholder')}
          aria-label={t('journeys.placeholder')}
          maxLength={300}
          disabled={running || !recording}
          autoFocus
          style={{ flex: 1, padding: '6px 0', backgroundColor: 'transparent', border: 'none', color: '#171717', fontSize: 13, fontFamily: font.sans, outline: 'none' }}
        />
        <button
          onClick={submit}
          aria-label={t('journeys.add')}
          title={t('journeys.add')}
          style={{
            width: 32, height: 32, borderRadius: '50%', border: 'none', flexShrink: 0,
            backgroundColor: input.trim() && !running ? ilse.test : '#e5e5e5',
            cursor: input.trim() && !running ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background-color 0.15s',
          }}
        >
          <IconArrowUp size={15} stroke={2} color="#fff" />
        </button>
      </div>
    </div>
  );
}
