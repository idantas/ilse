/**
 * A journey's report (Pro sends it as journey_report): its last runs, each
 * screen's steps — done, the one that broke, the ones never reached. Here: the
 * log the dev copies for an agent, the file they download, and the finding a
 * stuck run becomes when it's sent to the agent from the report.
 */

import type { TestFinding } from './test-findings.js';

export type Outcome = 'recorded' | 'passed' | 'flaky' | 'repaired' | 'stuck';
export type StepState = 'ok' | 'fail' | 'skipped';

export interface ReportStep { text: { pt: string; en: string }; state: StepState; ms?: number }

export interface ReportView {
  outcome: Outcome;
  reason?: string;
  why?: string;
  page?: string;
  step?: number;
  /** repaired: the saved step that broke before the agent found another way */
  failed?: { pt: string; en: string };
  steps: ReportStep[];
  /** data:image/jpeg of the page where it got stuck */
  shot?: string;
}

export interface ReportRun { at: string; ms: number; verdict: Outcome; desktop: ReportView; mobile?: ReportView }

export interface JourneyReport { id: string; goal: string; start: string; runs: ReportRun[] }

export function parseReport(v: unknown): JourneyReport | null {
  const r = v as JourneyReport | null;
  return r && typeof r.id === 'string' && typeof r.goal === 'string' && Array.isArray(r.runs) ? r : null;
}

/** Playwright's bare "Timeout 5000ms exceeded." means the element never showed: say so */
export const isTimeout = (reason?: string) => !!reason && /^Timeout \d+ms exceeded\.?$/.test(reason.trim());

/** 0.4 s, 12 s */
export const seconds = (ms: number) => ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;

const views = (run: ReportRun) => [['desktop', run.desktop], ...(run.mobile ? [['mobile', run.mobile]] : [])] as Array<['desktop' | 'mobile', ReportView]>;

const MARK: Record<StepState, string> = { ok: '✓', fail: '✗', skipped: '·' };

/** For an agent (or a teammate): plain text, English, what it did and where it broke */
export function journeyLog(report: JourneyReport, run: ReportRun, origin = ''): string {
  const out = [`Journey: ${report.goal}`, `Starts at: ${origin}${report.start}`, `Run: ${run.at} (${seconds(run.ms)}) — ${run.verdict}`];
  for (const [viewport, v] of views(run)) {
    out.push('', `${viewport === 'mobile' ? 'Phone' : 'Desktop'}: ${v.outcome}${v.step ? ` at step ${v.step}` : ''}`);
    v.steps.forEach((s, i) => out.push(`  ${MARK[s.state]} ${i + 1}. ${s.text.en}${s.ms !== undefined ? ` (${seconds(s.ms)})` : ''}`));
    if (v.outcome === 'stuck' && !v.steps.some(s => s.state === 'fail')) out.push(`  ✗ ${v.steps.length + 1}. no next step found`);
    if (v.outcome === 'repaired' && v.failed) out.push(`  Repaired: step ${v.step ?? '?'} (${v.failed.en}) broke, the agent found another way`);
    if (v.reason && v.outcome !== 'passed') out.push(`  ${v.outcome === 'stuck' ? 'Why' : 'Broke once'}: ${v.reason}`);
    if (v.page && v.outcome !== 'passed') out.push(`  Page: ${origin}${v.page}`);
  }
  return out.join('\n');
}

/** The screen that broke, desktop first */
export const stuckView = (run: ReportRun) => views(run).find(([, v]) => v.outcome === 'stuck');

/** A stuck run as the finding the "Fix" path already knows: a note on the page where it stopped, sent to the agent */
export function journeyFinding(report: JourneyReport, run: ReportRun): TestFinding | null {
  const hit = stuckView(run);
  if (!hit) return null;
  const [viewport, v] = hit;
  return {
    id: `journey-${report.id}-${viewport}`, category: 'journey', severity: 'high', page: v.page ?? report.start, viewport,
    title: `Journey "${report.goal}" got stuck at step ${v.step ?? '?'}`,
    detail: `${v.reason ?? ''}\n\n${journeyLog(report, run)}`.trim(),
    rule: `journey-${report.id}`, occurrences: 1,
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** One self-contained page (the screenshots inside), to keep or send to someone */
export function journeyHtml(report: JourneyReport, run: ReportRun, label: { desktop: string; mobile: string; why: string }, lang: 'pt' | 'en' = 'en'): string {
  const col = (name: string, v: ReportView) => `
    <section><h2>${esc(name)} · ${esc(v.outcome)}</h2><ol>${v.steps.map(s => `
      <li class="${s.state}"><span>${MARK[s.state]}</span> ${esc(s.text[lang])}${s.ms !== undefined ? ` <small>${seconds(s.ms)}</small>` : ''}</li>`).join('')}
    </ol>${v.reason && v.outcome !== 'passed' ? `<p class="why"><b>${esc(label.why)}:</b> ${esc(v.reason)}${v.page ? ` — <code>${esc(v.page)}</code>` : ''}</p>` : ''}${v.shot?.startsWith('data:image/jpeg;base64,') ? `<img src="${v.shot}" alt="">` : ''}</section>`;
  return `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.goal)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:24px auto;max-width:960px;padding:0 16px;color:#171717;background:#fff}
h1{font-size:20px;margin:0}header p{color:#737373;margin:4px 0 20px}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}
h2{font-size:14px;margin:0 0 8px}ol{list-style:none;padding:0;margin:0}li{padding:4px 0;border-bottom:1px solid #f0f0f0}
li span{display:inline-block;width:16px}.ok span{color:#16a34a}.fail{color:#b91c1c;font-weight:600}.skipped{color:#a3a3a3}
small{color:#737373;float:right}.why{color:#b91c1c}img{max-width:100%;border:1px solid #e5e5e5;border-radius:8px;margin-top:8px}
@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#ededed}li{border-color:#262626}img{border-color:#262626}}
</style>
<header><h1>${esc(report.goal)}</h1><p>${esc(report.start)} · ${esc(run.at)} · ${seconds(run.ms)} · ${esc(run.verdict)}</p></header>
<main>${col(label.desktop, run.desktop)}${run.mobile ? col(label.mobile, run.mobile) : ''}</main>
</html>`;
}
