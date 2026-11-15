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

/** Spoken after "change theme" — short, then the four picks. */
export const THEME_OPTIONS_SPOKEN =
  'For the large text image, say cream, yellow, white, or dark.';

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
  // Avoid "that" alone — "change that" / "text me that" should not force a look.
  return /\b(?:read|look|see|camera|label|menu|bottle|box|sign|show)\b/.test(u);
}

/**
 * Bare cream / yellow / white / dark (after we asked them to pick).
 * @param {string} u lowercased
 * @returns {string | null} theme id
 */
export function bareThemePick(u) {
  const t = String(u || '')
    .trim()
    .toLowerCase()
    .replace(/[?.!,]+$/g, '');
  // Allow short replies: "yellow", "yellow please", "go with cream", "the dark one"
  const words = t.match(/[a-z]+/g) || [];
  if (words.length === 0 || words.length > 6) return null;

  if (/\byellow\s+on\s+black\b/.test(t)) return 'yellow-on-black';
  if (/\bwhite\s+on\s+black\b/.test(t)) return 'white-on-black';
  if (/\bblack\s+on\s+yellow\b/.test(t)) return 'black-on-yellow';
  if (/\bblack\s+on\s+white\b/.test(t)) return 'black-on-white';
  if (/\bblack\s+on\s+cream\b/.test(t)) return 'dark-on-cream';

  // Single named option (ignore filler).
  const hit = words.find(w => ['cream', 'ivory', 'yellow', 'white', 'dark', 'black'].includes(w));
  if (!hit) return null;
  if (hit === 'cream' || hit === 'ivory') return 'dark-on-cream';
  if (hit === 'yellow') return 'black-on-yellow';
  if (hit === 'white') return 'black-on-white';
  if (hit === 'dark' || hit === 'black') return 'white-on-black';
  return null;
}

/**
 * Parse a caller utterance for a theme switch (or a request to list options).
 * @param {string} userBits
 * @param {{ awaitingPick?: boolean }} [opts] true right after we listed options
 * @returns {{ kind: 'set', theme: string, spoken: string } | { kind: 'list' } | null}
 */
export function parseThemeRequest(userBits, opts = {}) {
  const u = String(userBits || '').trim().toLowerCase();
  if (!u) return null;

  // Echo of our own options line — not a real pick.
  if (
    /\bsay\b/.test(u) &&
    /\bcream\b/.test(u) &&
    /\byellow\b/.test(u) &&
    /\bwhite\b/.test(u) &&
    /\bdark\b/.test(u)
  ) {
    return null;
  }

  // 1) Explicit set (including "change theme to yellow").
  /** @type {Array<[RegExp, string]>} */
  const setRules = [
    [/\byellow\s+on\s+black\b/, 'yellow-on-black'],
    [/\bblack\s+on\s+yellow\b/, 'black-on-yellow'],
    [/\bblack\s+on\s+white\b/, 'black-on-white'],
    [/\bwhite\s+on\s+black\b/, 'white-on-black'],
    [/\bblack\s+on\s+cream\b/, 'dark-on-cream'],
    // "change theme to yellow" / "switch it to cream" / "set contrast to dark"
    [
      /\b(?:change|switch|set|make|use|using|prefer|want)\b[\s\w']{0,40}\b(?:to\s+)?yellow\b/,
      'black-on-yellow',
    ],
    [
      /\b(?:change|switch|set|make|use|using|prefer|want)\b[\s\w']{0,40}\b(?:to\s+)?(?:cream|ivory)\b/,
      'dark-on-cream',
    ],
    [
      /\b(?:change|switch|set|make|use|using|prefer|want)\b[\s\w']{0,40}\b(?:to\s+)?white\b/,
      'black-on-white',
    ],
    [
      /\b(?:change|switch|set|make|use|using|prefer|want)\b[\s\w']{0,40}\b(?:to\s+)?dark\b/,
      'white-on-black',
    ],
    [
      /\b(?:yellow\s+(?:background|contrast|theme)|(?:use|using|make\s+it)\s+yellow|high\s+contrast|hot\s+contrast)\b/,
      'black-on-yellow',
    ],
    [/\b(?:white\s+background|(?:use|using)\s+white|plain\s+white)\b/, 'black-on-white'],
    [
      /\b(?:dark\s+(?:mode|background|theme)|(?:use|using|make\s+it)\s+dark)\b/,
      'white-on-black',
    ],
    [/\b(?:cream|ivory)\s+(?:background|theme|contrast)?\b|(?:use|using)\s+cream\b|\bpaper\b/, 'dark-on-cream'],
    [/\bmake\s+(?:the\s+)?(?:text|png|image|handout)\s+yellow\b/, 'black-on-yellow'],
  ];

  for (const [re, theme] of setRules) {
    if (re.test(u)) {
      return { kind: 'set', theme, spoken: spokenThemeLabel(theme) };
    }
  }

  // 2) Short pick after we asked, or a 1–2 word color reply.
  const wordCount = (u.match(/[a-z]+/g) || []).length;
  if (opts.awaitingPick || wordCount <= 4) {
    const bare = bareThemePick(u);
    // Only use bare picks when awaiting, or the utterance is basically just the color.
    if (bare && (opts.awaitingPick || wordCount <= 3)) {
      // Avoid treating "change theme" as a bare pick (no color word).
      if (!/\b(?:theme|contrast|colors?|colours?)\b/.test(u) || opts.awaitingPick) {
        if (/\b(?:cream|ivory|yellow|white|dark|black)\b/.test(u)) {
          return { kind: 'set', theme: bare, spoken: spokenThemeLabel(bare) };
        }
      }
    }
  }

  // 3) List options ("change theme", "contrast options", …).
  if (
    /\b(?:change|switch|different|new|pick|choose)\s+(?:the\s+)?(?:theme|contrast|colors?|colours?)\b/.test(
      u,
    ) ||
    /\b(?:theme|contrast)\s+(?:options?|please|again)\b/.test(u) ||
    /\b(?:can you |please )?(?:change|switch)\s+(?:the\s+)?(?:theme|contrast|colors?)\b/.test(u) ||
    /\bi want to (?:change|switch)\s+(?:the\s+)?(?:theme|contrast)\b/.test(u) ||
    /^(?:theme|contrast|colors?|colours?)\??$/.test(u)
  ) {
    return { kind: 'list' };
  }

  return null;
}
