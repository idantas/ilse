/**
 * The report's Journeys tab (Pro): every journey with its last result and its
 * last runs as dots, and one journey's run step by step — done (with how long),
 * the one that broke (why, and the page at that moment), the ones never
 * reached; desktop and phone side by side when it ran on both.
 */
import React, { useEffect, useState } from 'react';
import { IconChevronLeft, IconCopy, IconDownload, IconPlayerPlay, IconCheck } from '@tabler/icons-react';
import { color, font, ilse, radius } from './tokens.js';
import { getLocale, t } from '../i18n/index.js';
import { ago } from './memory-panel.js';
import { journeyLine, type JourneySummary } from './journeys-panel.js';
import { isTimeout, journeyHtml, journeyLog, seconds, stuckView, type JourneyReport, type Outcome, type ReportView } from './journey-report.js';

type Key = Parameters<typeof t>[0];

const tone = (o: Outcome | undefined) => o === 'stuck' ? '#ef4444' : o === 'flaky' ? '#f59e0b' : o ? '#16a34a' : color.border;
const markOf = (o: Outcome | undefined) => o === 'stuck' ? '✗' : o === 'flaky' ? '~' : o ? '✓' : '·';

/** The last runs as small squares, oldest on the left: when did it start to break */
export function HistoryDots({ list, selected, onPick }: { list: Array<{ at: string; verdict: Outcome }>; selected?: number; onPick?: (i: number) => void }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {list.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => (
        <span
          key={i}
          role={onPick ? 'button' : undefined}
          title={`${ago(r.at)} · ${t(`journeys.verdict.${r.verdict}` as Key)}`}
          onClick={onPick ? (e) => { e.stopPropagation(); onPick(i); } : undefined}
          style={{
            width: 8, height: 8, borderRadius: 2, background: tone(r.verdict), cursor: onPick ? 'pointer' : 'default',
            outline: selected === i ? `2px solid ${ilse.test}` : 'none', outlineOffset: 1,
          }}
        />
      ))}
    </span>
  );
}

export function JourneysTab({ journeys, selected, report, running, wide, onSelect, onRun, onFix }: {
  journeys: JourneySummary[];
  selected: string | null;
  /** The selected journey's report, once Pro sent it */
  report: JourneyReport | null;
  /** A journey is running now */
  running: boolean;
  /** Expanded: desktop and phone side by side */
  wide: boolean;
  onSelect: (id: string | null) => void;
  onRun: (id: string) => void;
  onFix: (report: JourneyReport, runIndex: number) => void;
}) {
  if (selected) return <Detail key={selected} summary={journeys.find(j => j.id === selected)} report={report?.id === selected ? report : null} running={running} wide={wide} onBack={() => onSelect(null)} onRun={onRun} onFix={onFix} />;
  if (!journeys.length) return <div style={{ fontSize: 12, color: color.mutedForeground, padding: '4px 0' }}>{t('report.journeysNone')}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {journeys.map(j => {
        const line = journeyLine(j);
        const verdict = j.history?.[0]?.verdict;
        return (
          <div
            key={j.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(j.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect(j.id); }}
            style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 6px', margin: '0 -6px', borderRadius: radius.md, cursor: 'pointer' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = color.muted; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            <span style={{ fontSize: 11, width: 12, flexShrink: 0, color: tone(verdict) }}>{markOf(verdict)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: color.foreground, lineHeight: 1.35 }}>{j.goal}</div>
              <div style={{ fontSize: 10, color: line.ok === false ? '#ef4444' : color.mutedForeground, marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {line.text}{j.last ? ` · ${ago(j.last.at)}` : ''}
              </div>
            </div>
            {j.history && j.history.length > 0 && <span style={{ paddingTop: 4 }}><HistoryDots list={j.history} /></span>}
          </div>
        );
      })}
    </div>
  );
}

function Steps({ v, title }: { v: ReportView; title?: string }) {
  const lang = getLocale() === 'pt' ? 'pt' : 'en';
  const reason = isTimeout(v.reason) ? t('report.journeyTimeout') : v.reason ?? '';
  const noNext = v.outcome === 'stuck' && !v.steps.some(s => s.state === 'fail');
  return (
    <div style={{ minWidth: 0 }}>
      {title && <div style={{ fontSize: 11, fontWeight: 600, color: color.mutedForeground, margin: '2px 0 4px' }}>{title}</div>}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {v.steps.map((s, i) => (
          <li key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', padding: '3px 0', fontSize: 12, lineHeight: 1.35, color: s.state === 'skipped' ? color.mutedForeground : color.foreground, fontWeight: s.state === 'fail' ? 600 : 400 }}>
            <span style={{ width: 12, flexShrink: 0, fontSize: 11, color: s.state === 'ok' ? '#16a34a' : s.state === 'fail' ? '#ef4444' : color.border }}>{s.state === 'ok' ? '✓' : s.state === 'fail' ? '✗' : '○'}</span>
            <span style={{ fontSize: 10, color: color.mutedForeground, width: 14, flexShrink: 0 }}>{i + 1}</span>
            <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{s.text[lang]}</span>
            {s.ms !== undefined && <span style={{ fontSize: 10, color: color.mutedForeground, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{seconds(s.ms)}</span>}
          </li>
        ))}
        {noNext && (
          <li style={{ display: 'flex', gap: 6, padding: '3px 0', fontSize: 12, fontWeight: 600, color: color.foreground }}>
            <span style={{ width: 12, fontSize: 11, color: '#ef4444' }}>✗</span>
            <span style={{ fontSize: 10, color: color.mutedForeground, width: 14 }}>{Math.max(v.step ?? 0, v.steps.length + 1)}</span>
            <span>{t('report.journeyNoNext')}</span>
          </li>
        )}
      </ol>
      {v.outcome === 'stuck' && v.reason && (
        <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.45, color: '#b91c1c', wordBreak: 'break-word' }}>
          <b>{t('report.journeyWhy')}</b> {v.why === 'no-agent' ? t('journeys.noAgent') : v.why === 'needs-login' ? t('journeys.needsLogin') : reason}
          {v.page && <span style={{ color: color.mutedForeground, fontFamily: font.mono, fontSize: 10 }}> · {v.page}</span>}
        </div>
      )}
      {v.outcome === 'flaky' && <div style={{ marginTop: 6, fontSize: 11, color: '#b45309' }}>{t('report.journeyFlakyAt', { step: v.step ?? '?', reason })}</div>}
      {v.outcome === 'repaired' && v.step && <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.45, color: color.mutedForeground }}>{v.failed ? t('report.journeyRepairedAt', { step: v.step, what: v.failed[lang], reason }) : t('report.journeyRepairedPlain', { step: v.step, reason })}</div>}
      {v.shot && <img src={v.shot} alt={t('report.journeyShot')} style={{ display: 'block', width: '100%', marginTop: 8, borderRadius: radius.sm, border: `1px solid ${color.border}` }} />}
    </div>
  );
}

function Detail({ summary, report, running, wide, onBack, onRun, onFix }: {
  summary?: JourneySummary;
  report: JourneyReport | null;
  running: boolean;
  wide: boolean;
  onBack: () => void;
  onRun: (id: string) => void;
  onFix: (report: JourneyReport, runIndex: number) => void;
}) {
  const [runIndex, setRunIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  // An ilse started before this tab existed never answers: say so instead of loading forever
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (report) return;
    const timer = setTimeout(() => setLate(true), 5000);
    return () => clearTimeout(timer);
  }, [report]);
  // A new run arrived: show it
  useEffect(() => { setRunIndex(0); }, [report?.runs[0]?.at]);
  const run = report?.runs[runIndex];
  const goal = report?.goal ?? summary?.goal ?? '';
  const id = report?.id ?? summary?.id ?? '';

  const ghost: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: radius.sm, border: `1px solid ${color.border}`, background: color.background, fontSize: 11, fontWeight: 600, fontFamily: font.sans, cursor: 'pointer', color: color.foreground };
  const primary: React.CSSProperties = { ...ghost, border: 'none', background: ilse.test, color: '#fff' };

  const copy = () => {
    if (!report || !run) return;
    navigator.clipboard?.writeText(journeyLog(report, run, location.origin)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };
  const download = () => {
    if (!report || !run) return;
    const lang = getLocale() === 'pt' ? 'pt' : 'en';
    const html = journeyHtml(report, run, { desktop: t('test.size.desktop'), mobile: t('test.size.mobile'), why: t('report.journeyWhy').replace(/:$/, '') }, lang);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${goal.toLowerCase().replace(/[^a-z0-9à-ú]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50) || 'journey'}-${run.at.slice(0, 10)}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button onClick={onBack} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 2, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: ilse.test, fontFamily: font.sans }}>
        <IconChevronLeft size={12} stroke={2} />{t('report.journeysBack')}
      </button>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: color.foreground, lineHeight: 1.35 }}>{goal}</div>
        {run && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 10, color: color.mutedForeground }}>
            <span>{ago(run.at)} · {seconds(run.ms)} · {t(`journeys.verdict.${run.verdict}` as Key)}</span>
            {report.runs.length > 1 && <HistoryDots list={report.runs} selected={runIndex} onPick={setRunIndex} />}
          </div>
        )}
      </div>

      {!report && <div style={{ fontSize: 12, color: color.mutedForeground, lineHeight: 1.45 }}>{t(late ? 'report.journeyNoAnswer' : 'report.journeyLoading')}</div>}
      {report && !run && <div style={{ fontSize: 12, color: color.mutedForeground }}>{t('journeys.never')}</div>}
      {run && (
        run.mobile
          ? (
            <div style={{ display: 'grid', gridTemplateColumns: wide ? '1fr 1fr' : '1fr', gap: 14 }}>
              <Steps v={run.desktop} title={`🖥 ${t('test.size.desktop')}`} />
              <Steps v={run.mobile} title={`📱 ${t('test.size.mobile')}`} />
            </div>
          )
          : <Steps v={run.desktop} />
      )}

      {report && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', paddingTop: 8, borderTop: `1px solid ${color.border}`, marginTop: 4 }}>
          {run && <button style={ghost} onClick={copy} title={t('report.journeyCopyHint')} aria-label={t('report.journeyCopy')}>{copied ? <IconCheck size={12} stroke={2} /> : <IconCopy size={12} stroke={2} />}{wide || copied ? t(copied ? 'report.journeyCopied' : 'report.journeyCopy') : null}</button>}
          {run && <button style={ghost} onClick={download} title={t('report.journeyDownloadHint')} aria-label={t('report.journeyDownload')}><IconDownload size={12} stroke={2} />{wide ? t('report.journeyDownload') : null}</button>}
          <span style={{ flex: 1 }} />
          <button style={{ ...ghost, opacity: running ? 0.5 : 1, cursor: running ? 'default' : 'pointer' }} disabled={running} onClick={() => onRun(id)}>
            <IconPlayerPlay size={12} stroke={2} />{t(running ? 'report.testing' : 'report.journeyRunAgain')}
          </button>
          {run && stuckView(run) && <button style={primary} onClick={() => onFix(report, runIndex)} title={t('report.journeyFixHint')}>{t('report.fix')}</button>}
        </div>
      )}
    </div>
  );
}
