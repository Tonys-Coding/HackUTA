/**
 * Voice-first large-text theme preference for low-vision callers.
 * Persist per phone number; switch with short spoken phrases.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES } from './large-text-image.mjs';

const PREF_PATH = join(fileURLToPath(new URL('.', import.meta.url)), 'data', 'theme-prefs.json');

/** @type {Record<string, { theme: string, spoken: string }>} */
export const THEME_LABELS = {
  'dark-on-cream': { theme: 'dark-on-cream', spoken: 'black text on cream' },
  'black-on-yellow': { theme: 'black-on-yellow', spoken: 'black text on yellow' },
  'black-on-white': { theme: 'black-on-white', spoken: 'black text on white' },
  'yellow-on-black': { theme: 'yellow-on-black', spoken: 'yellow text on black' },
  'white-on-black': { theme: 'white-on-black', spoken: 'white text on black' },
};

const DEFAULT_THEME =
  process.env.MAGNIFIER_THEME && THEME_LABELS[process.env.MAGNIFIER_THEME]
    ? process.env.MAGNIFIER_THEME
    : 'dark-on-cream';

/** Sample text when the caller switches before any OCR. */
export const THEME_SAMPLE_TEXT =
  'Sample menu.\nIced Americano — $4.00\nCold Brew — $4.50\nIced Latte — $5.00';

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits || 'default';
}

function loadStore() {
  try {
    if (!existsSync(PREF_PATH)) return {};
    const raw = JSON.parse(readFileSync(PREF_PATH, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function saveStore(store) {
  mkdirSync(dirname(PREF_PATH), { recursive: true });
  writeFileSync(PREF_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

/**
 * @param {string} [phone]
 * @returns {keyof typeof THEMES}
 */
export function getThemePreference(phone) {
  const store = loadStore();
  const key = normalizePhone(phone || process.env.CHERT_IMESSAGE_TO);
  const saved = store[key]?.theme;
  if (saved && THEMES[saved]) return /** @type {keyof typeof THEMES} */ (saved);
  if (THEMES[DEFAULT_THEME]) return /** @type {keyof typeof THEMES} */ (DEFAULT_THEME);
  return 'dark-on-cream';
}

/**
 * @param {string} theme
 * @param {string} [phone]
 */
export function setThemePreference(theme, phone) {
  if (!THEMES[theme]) return getThemePreference(phone);
  const store = loadStore();
  const key = normalizePhone(phone || process.env.CHERT_IMESSAGE_TO);
  store[key] = { theme, updatedAt: new Date().toISOString() };
  saveStore(store);
  return theme;
}

/**
 * @param {string} theme
 * @returns {string}
 */
export function spokenThemeLabel(theme) {
  return THEME_LABELS[theme]?.spoken || theme;
}

/**
 * True when the caller also wants the camera/label read (not just a theme sample).
 * @param {string} userBits
 */
export function wantsReadWithTheme(userBits) {
  const u = String(userBits || '').toLowerCase();
  return /\b(?:read|send|look|see|this|that|camera|label|menu|can|bottle|box|sign)\b/.test(u);
}

/**
 * Parse a caller utterance for a theme switch (or a request to list options).
 * Tolerates messy STT ("yellow contrast", "using yellow", "hot contrast").
 * @param {string} userBits
 * @returns {{ kind: 'set', theme: string, spoken: string } | { kind: 'list' } | null}
 */
export function parseThemeRequest(userBits) {
  const u = String(userBits || '').trim().toLowerCase();
  if (!u) return null;

  // Ordered: more specific phrases first. Include common STT mangling.
  /** @type {Array<[RegExp, string]>} */
  const rules = [
    [
      /\b(?:black\s+on\s+yellow|yellow\s+(?:background|contrast)|(?:use|using|make\s+it)\s+yellow|yellow\s+theme|high\s+contrast|hot\s+contrast)\b/,
      'black-on-yellow',
    ],
    [/\b(?:yellow\s+on\s+black)\b/, 'yellow-on-black'],
    [/\b(?:black\s+on\s+white|white\s+background|(?:use|using)\s+white|plain\s+white)\b/, 'black-on-white'],
    [
      /\b(?:white\s+on\s+black|dark\s+(?:mode|background|theme)|(?:use|using|make\s+it)\s+dark)\b/,
      'white-on-black',
    ],
    [/\b(?:cream|ivory|(?:use|using)\s+cream|cream\s+background|paper)\b/, 'dark-on-cream'],
  ];

  for (const [re, theme] of rules) {
    if (re.test(u)) {
      return { kind: 'set', theme, spoken: spokenThemeLabel(theme) };
    }
  }

  if (
    /\b(?:change|switch|different|new)\s+(?:the\s+)?(?:theme|contrast|colors?|colours?)\b/.test(u) ||
    /\b(?:theme|contrast)\s+(?:options?|please|again)\b/.test(u) ||
    /^(?:theme|contrast|colors?|colours?)\??$/.test(u)
  ) {
    return { kind: 'list' };
  }

  return null;
}

export const THEME_OPTIONS_SPOKEN =
  'Say cream, yellow, white, or dark.';
