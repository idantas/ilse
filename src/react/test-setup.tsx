/**
 * Before a test run (Pro): what to test, as toggles, and on which screens.
 * Pro says what this project can run (journeys only once one is recorded,
 * consistency only with a core that reads the code) and the last choice; the
 * screens default from the app itself. When the code doesn't tell whether the
 * app is for phones, Ilse asks once, above the list.
 */
import React, { useEffect, useState } from 'react';
import { color, font, ilse, radius, shadow } from './tokens.js';
import { speechButton } from './speech-bubble.js';
import { t } from '../i18n/index.js';

export type TestGroup = 'journeys' | 'accessibility' | 'errors' | 'layout' | 'consistency';
export type ScreenSize = 'desktop' | 'tablet' | 'mobile';

export const GROUP_ORDER: TestGroup[] = ['journeys', 'accessibility', 'errors', 'layout', 'consistency'];
const SIZES: ScreenSize[] = ['desktop', 'tablet', 'mobile'];

/** What Pro offers (test_setup) */
export interface TestOffer {
  available: TestGroup[];
  groups: TestGroup[];
  sizes: ScreenSize[];
  askMobile: boolean;
  journeys: number;
  lastMs?: number;
}

export function parseOffer(msg: Record<string, unknown>): TestOffer {
  const list = <T extends string>(v: unknown, known: readonly T[]) => (Array.isArray(v) ? v.filter((x): x is T => known.includes(x as T)) : []);
  return {
    available: list(msg.available, GROUP_ORDER),
    groups: list(msg.groups, GROUP_ORDER),
    sizes: list(msg.sizes, SIZES),
    askMobile: msg.askMobile === true,
    journeys: typeof msg.journeys === 'number' ? msg.journeys : 0,
    ...(typeof msg.lastMs === 'number' ? { lastMs: msg.lastMs } : {}),
  };
}

/** "48 s", "2 min" */
export function duration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        width: 28, height: 16, borderRadius: 8, border: 'none', padding: 2, cursor: 'pointer', flexShrink: 0,
        background: on ? ilse.test : '#d4d4d4', transition: 'background 0.15s', display: 'flex',
        justifyContent: on ? 'flex-end' : 'flex-start',
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff', boxShadow: shadow.xs }} />
    </button>
  );
}

export function TestSetup({ offer, onRun }: {
  /** null while Pro answers */
  offer: TestOffer | null;
  onRun: (groups: TestGroup[], sizes: ScreenSize[]) => void;
}) {
  const [groups, setGroups] = useState<TestGroup[]>([]);
  const [sizes, setSizes] = useState<ScreenSize[]>(['desktop']);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!offer) return;
    setGroups(offer.groups);
    setSizes(offer.sizes.length ? offer.sizes : ['desktop']);
    setAsking(offer.askMobile);
  }, [offer]);

  if (!offer) return <div style={{ fontSize: 11, color: color.mutedForeground }}>…</div>;

  const toggleGroup = (g: TestGroup, on: boolean) => setGroups(prev => on ? GROUP_ORDER.filter(x => x === g || prev.includes(x)) : prev.filter(x => x !== g));
  const toggleSize = (v: ScreenSize) => setSizes(prev => {
    const next = prev.includes(v) ? prev.filter(x => x !== v) : SIZES.filter(x => x === v || prev.includes(x));
    return next.length ? next : prev; // one screen at least
  });
  const answerMobile = (yes: boolean) => {
    setSizes(prev => yes ? SIZES.filter(x => x === 'mobile' || prev.includes(x)) : prev.filter(x => x !== 'mobile').length ? prev.filter(x => x !== 'mobile') : ['desktop']);
    setAsking(false);
  };

  return (
    <div style={{ fontFamily: font.sans }}>
      {asking && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: radius.md, background: ilse.testPale }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#171717', marginBottom: 8 }}>{t('test.askMobile')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button style={speechButton('test', true)} onClick={() => answerMobile(true)}>{t('test.askMobileYes')}</button>
            <button style={speechButton('test', false)} onClick={() => answerMobile(false)}>{t('test.askMobileNo')}</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {GROUP_ORDER.filter(g => offer.available.includes(g)).map(g => (
          <label key={g} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: color.foreground }}>{t(`test.group.${g}` as Parameters<typeof t>[0])}</div>
              <div style={{ fontSize: 10, color: color.mutedForeground, lineHeight: 1.35 }}>
                {t(`test.groupHint.${g}` as Parameters<typeof t>[0], { count: offer.journeys })}
              </div>
            </div>
            <Toggle on={groups.includes(g)} onChange={(on) => toggleGroup(g, on)} label={t(`test.group.${g}` as Parameters<typeof t>[0])} />
          </label>
        ))}
      </div>

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${color.border}` }}>
        <div style={{ fontSize: 11, color: color.mutedForeground, marginBottom: 6 }}>{t('test.sizes')}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {SIZES.map(v => {
            const on = sizes.includes(v);
            return (
              <button
                key={v}
                aria-pressed={on}
                onClick={() => toggleSize(v)}
                style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, fontFamily: font.sans, cursor: 'pointer',
                  border: `1px solid ${on ? ilse.test : color.border}`, background: on ? ilse.testPale : 'transparent',
                  color: on ? '#1d4ed8' : color.mutedForeground,
                }}
              >
                {t(`test.size.${v}` as Parameters<typeof t>[0])}
              </button>
            );
          })}
        </div>
      </div>

      <button
        disabled={groups.length === 0}
        onClick={() => onRun(groups, sizes)}
        style={{
          width: '100%', marginTop: 14, padding: '8px 10px', borderRadius: radius.md, border: 'none', fontSize: 12, fontWeight: 600,
          fontFamily: font.sans, cursor: groups.length ? 'pointer' : 'default',
          background: groups.length ? ilse.test : '#e5e5e5', color: groups.length ? '#fff' : color.mutedForeground,
        }}
      >
        {groups.length ? t('test.start') : t('test.nothingPicked')}
      </button>
      {offer.lastMs && (
        <div style={{ fontSize: 10, color: color.mutedForeground, textAlign: 'center', marginTop: 6 }}>{t('test.lastTook', { time: duration(offer.lastMs) })}</div>
      )}
    </div>
  );
}
