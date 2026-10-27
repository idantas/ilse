/**
 * i18n — locale detection + translation helper.
 *
 * Browser: reads navigator.language
 * CLI: reads process.env.LANG or Intl fallback
 * User override: saved in ~/.ilse/config.json as `locale`
 *
 * No external deps.
 */

import messages, { type Locale, type MessageKey } from './messages.js';

let currentLocale: Locale = 'en';

/** Detect locale from environment. Call once at startup. */
export function detectLocale(): Locale {
  let raw = '';

  if (typeof navigator !== 'undefined' && navigator.language) {
    // Browser
    raw = navigator.language;
  } else if (typeof process !== 'undefined') {
    // Node/CLI
    raw = process.env.LANG
      || process.env.LC_ALL
      || process.env.LC_MESSAGES
      || Intl.DateTimeFormat().resolvedOptions().locale
      || '';
  }

  return raw.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

/** Get the active locale. */
export function getLocale(): Locale {
  return currentLocale;
}

/** Set locale explicitly (e.g. from user config). */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

/**
 * Translate a message key.
 * Supports interpolation: t('cli.invoking', { agent: 'claude', count: '3' })
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const entry = messages[key];
  if (!entry) return key;

  let text: string = entry[currentLocale] ?? entry.en;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }

  return text;
}

export type { Locale, MessageKey };
