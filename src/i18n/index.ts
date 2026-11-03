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

  // "1 findings" → "1 finding": the messages are written for the plural
  if (params?.count === 1 || params?.pages === 1) text = text.replace(ONE, (_, w: string) => `1 ${SINGULAR[w]}`);

  return text;
}

const SINGULAR: Record<string, string> = {
  findings: 'finding', pages: 'page', places: 'place', files: 'file', steps: 'step', changes: 'change',
  achados: 'achado', páginas: 'página', lugares: 'lugar', arquivos: 'arquivo', passos: 'passo', mudanças: 'mudança',
  corrigidos: 'corrigido', voltaram: 'voltou', novos: 'novo',
};
const ONE = new RegExp(`(?<![\\d.,])1 (${Object.keys(SINGULAR).join('|')})(?![\\p{L}])`, 'gu');

export type { Locale, MessageKey };

// The server names the agent's tool calls in Portuguese (executor.ts describeToolUse); in English, say them in English
const TOOL_WORDS: [RegExp, string][] = [
  [/^Lendo página$/, 'Reading a page'], [/^Lendo /, 'Reading '], [/^Procurando arquivos /, 'Looking for files '],
  [/^Procurando /, 'Searching '], [/^Editando (.+) \(múltiplas\)$/, 'Editing $1 (several)'], [/^Editando /, 'Editing '],
  [/^Criando /, 'Creating '], [/^Rodando comando$/, 'Running a command'], [/^Planejando próximos passos$/, 'Planning next steps'],
  [/^Pesquisando: /, 'Searching the web: '], [/^Usando /, 'Using '], [/^Corrigido$/, 'Fixed'],
];
export function toolActivity(text: string): string {
  if (getLocale() === 'pt') return text;
  for (const [from, to] of TOOL_WORDS) if (from.test(text)) return text.replace(from, to);
  return text;
}
