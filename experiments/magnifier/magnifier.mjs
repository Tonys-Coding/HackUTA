/**
 * Low-vision magnifier for FaceTime outbound video.
 *
 * Strategy (works for menus, labels, mail, products, dials — not menus only):
 * 1. While Argo is speaking → SPOTLIGHT: 1–2 huge lines, frozen, safe band only.
 * 2. After speech → OVERVIEW: structured list if we parsed pairs; else a short
 *    multi-line card. Always inside a FaceTime-safe vertical band.
 */
import { WIDTH, HEIGHT } from '../avatar/face.mjs';

export { WIDTH, HEIGHT };

/** @typedef {'white-on-black' | 'yellow-on-black' | 'black-on-white'} MagnifierTheme */

const THEMES = {
  'white-on-black': {
    fg: [255, 255, 255],
    accent: [255, 220, 60],
    bg: [6, 6, 6],
    card: [16, 16, 16],
    muted: [130, 130, 130],
  },
  'yellow-on-black': {
    fg: [255, 220, 40],
    accent: [255, 255, 255],
    bg: [6, 6, 6],
    card: [18, 16, 8],
    muted: [140, 120, 50],
  },
  'black-on-white': {
    fg: [12, 12, 12],
    accent: [140, 90, 0],
    bg: [248, 248, 248],
    card: [255, 255, 255],
    muted: [100, 100, 100],
  },
};

// FaceTime phone UI often crops top/bottom of 16:9 — keep content here.
const SAFE = {
  top: Math.round(HEIGHT * 0.16),
  bottom: Math.round(HEIGHT * 0.84),
};

const GLYPH_W = 5;
const GLYPH_H = 7;

const G = {
  ' ': '00000000000000000000000000000000000',
  A: '01110100011000111111100011000110001',
  B: '11110010011000111100100011000111110',
  C: '01111100001000010000100001000001111',
  D: '11110010011000110001100011000111110',
  E: '11111100001000011110100001000011111',
  F: '11111100001000011110100001000010000',
  G: '01111100001000010111100011000101111',
  H: '10001100011000111111100011000110001',
  I: '11111001000010000100001000010011111',
  J: '00111000100001000010000110001011110',
  K: '10001100101010011000101001001010001',
  L: '10000100001000010000100001000011111',
  M: '10001110111010110001100011000110001',
  N: '10001110011010110011100011000110001',
  O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101',
  R: '11110100011000111110101001001010001',
  S: '01111100001000001110000011000111110',
  T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100',
  W: '10001100011000110001101011010110001',
  X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100',
  Z: '11111000010001000100010001000011111',
  0: '01110100011000110001100011000101110',
  1: '00100011000010000100001000010011111',
  2: '01110100010000100110010001000011111',
  3: '11110000010000101110000011000111110',
  4: '10001100011000111111000010000100001',
  5: '11111100001111000001000011000101110',
  6: '01110100001000011110100011000101110',
  7: '11111000010001000100010000100001000',
  8: '01110100011000101110100011000101110',
  9: '01110100011000101111000011000101110',
  '.': '00000000000000000000000000011000110',
  ',': '00000000000000000000000110001000100',
  '!': '00100001000010000100001000000000100',
  '?': '01110100010000100100001000000000100',
  "'": '00100001000010000000000000000000000',
  '"': '01010010100000000000000000000000000',
  '-': '00000000000000011111000000000000000',
  ':': '00000001100011000000001100011000000',
  ';': '00000001100011000000001100010001000',
  $: '00100111111010001110000101111100100',
  '%': '11001110010001000100010001001110011',
  '/': '00001000010001000100010001000010000',
  '(': '00100010000100001000010000100000100',
  ')': '00100000100001000010000100001000100',
  '&': '01100100100101001100010100101001101',
  '+': '00000001000010011111001000010000000',
  '=': '00000000001111100000111110000000000',
};

const SPOTLIGHT_HOLD_MS = Number(process.env.MAGNIFIER_PAGE_MS) || 10_000;
const OVERVIEW_HOLD_MS = 14_000;

function charPitch(scale, gap) {
  return GLYPH_W * scale + gap;
}

function maxCharsFor(scale, gap, padX = 40) {
  return Math.max(8, Math.floor((WIDTH - padX * 2) / charPitch(scale, gap)) - 1);
}

/**
 * @param {Uint8Array} px
 * @param {number[]} rgb
 */
function fill(px, rgb) {
  for (let i = 0; i < px.length; i += 4) {
    px[i] = rgb[0];
    px[i + 1] = rgb[1];
    px[i + 2] = rgb[2];
    px[i + 3] = 255;
  }
}

/**
 * @param {Uint8Array} px
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number[]} rgb
 */
function fillRect(px, x0, y0, x1, y1, rgb) {
  for (let y = y0; y < y1; y++) {
    if (y < 0 || y >= HEIGHT) continue;
    for (let x = x0; x < x1; x++) {
      if (x < 0 || x >= WIDTH) continue;
      const i = (y * WIDTH + x) * 4;
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
      px[i + 3] = 255;
    }
  }
}

function blitChar(px, x0, y0, ch, fg, scale) {
  const key = G[ch] ? ch : G[ch.toUpperCase()] ? ch.toUpperCase() : '?';
  const bits = G[key] || G['?'];
  for (let row = 0; row < GLYPH_H; row++) {
    for (let col = 0; col < GLYPH_W; col++) {
      if (bits[row * GLYPH_W + col] !== '1') continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = Math.round(x0) + col * scale + dx;
          const y = Math.round(y0) + row * scale + dy;
          if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) continue;
          const i = (y * WIDTH + x) * 4;
          px[i] = fg[0];
          px[i + 1] = fg[1];
          px[i + 2] = fg[2];
          px[i + 3] = 255;
        }
      }
    }
  }
}

function blitLeft(px, x, y, str, fg, scale, gap = 3) {
  let cx = x;
  const pitch = charPitch(scale, gap);
  for (const ch of str) {
    if (cx + GLYPH_W * scale > WIDTH - 28) break;
    blitChar(px, cx, y, ch, fg, scale);
    cx += pitch;
  }
  return cx;
}

function blitCentered(px, y, str, fg, scale, gap = 3) {
  const pitch = charPitch(scale, gap);
  const w = String(str).length * pitch;
  const x = Math.floor((WIDTH - w) / 2);
  blitLeft(px, Math.max(28, x), y, str, fg, scale, gap);
}

function blitRight(px, rightX, y, str, fg, scale, gap = 3) {
  const pitch = charPitch(scale, gap);
  const w = String(str).length * pitch;
  blitLeft(px, rightX - w, y, str, fg, scale, gap);
}

function wrapToWidth(text, maxChars) {
  const words = String(text || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    if (word.length <= maxChars) line = word;
    else {
      for (let i = 0; i < word.length; i += maxChars) {
        const chunk = word.slice(i, i + maxChars);
        if (i + maxChars < word.length) lines.push(chunk);
        else line = chunk;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Pull "name + value" pairs from OCR (menus, labels with doses/prices, dials).
 * Falls back to empty if the scene isn't structured that way.
 * @param {string} text
 * @returns {{ title: string, rows: { left: string, right: string }[] }}
 */
export function extractPairs(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const rows = [];
  let title = '';

  // Title-ish opening: "This is a menu for X" / "This is a bottle of X"
  const titleMatch = raw.match(
    /^(?:this is (?:a |an )?(?:menu for |label (?:for|on) |bottle of |box of |sign (?:for|that says )?|letter(?: from)? )?([^.]+))\./i,
  );
  if (titleMatch) title = titleMatch[1].trim();

  /** @param {string} left */
  function cleanLeft(left) {
    let s = left
      .replace(/^(?:it |this |they |and |or )/i, '')
      .replace(/^(?:lists?|showing|section|says?|called|named|amount)\s+/i, '')
      .replace(/^(?:the|a|an)\s+/i, '')
      .trim();
    // Prefer the trailing product/name words if the capture ate a long clause.
    const words = s.split(/\s+/);
    if (words.length > 4) s = words.slice(-3).join(' ');
    return s.toUpperCase().slice(0, 20);
  }

  const moneyRes = [
    /([A-Za-z][A-Za-z0-9 &'/+-]{1,48}?)\s+for\s+(\d+(?:\.\d+)?)\s+dollars?(?:\s+and\s+(\d+)\s+cents?)?/gi,
    /([A-Za-z][A-Za-z0-9 &'/+-]{1,48}?)\s+is\s+(\d+(?:\.\d+)?)\s+dollars?(?:\s+and\s+(\d+)\s+cents?)?/gi,
    /([A-Za-z][A-Za-z0-9 &'/+-]{1,40}?)\s+(\$\d+(?:\.\d{1,2})?)/gi,
  ];
  const fieldRe =
    /([A-Za-z][A-Za-z0-9 &'/+-]{1,24}?)\s*[:=]\s*(\$?\d[\d./%-]*\s*[A-Za-z%]*)/gi;

  const seen = new Set();
  const push = (left, right) => {
    left = cleanLeft(left);
    right = String(right).replace(/\s+/g, ' ').trim().toUpperCase();
    if (left.length < 2) return;
    const key = `${left}|${right}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ left, right });
  };

  for (const re of moneyRes) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(raw))) {
      let right = m[2];
      if (m[3] != null && m[3] !== '') {
        right = `$${m[2]}.${String(m[3]).padStart(2, '0')}`;
      } else if (!String(right).startsWith('$')) {
        right = right.includes('.') ? `$${right}` : `$${right}`;
      }
      push(m[1], right);
    }
  }

  fieldRe.lastIndex = 0;
  let fm;
  while ((fm = fieldRe.exec(raw))) {
    // Keep units (mg, %, dates) — do not force a $ prefix.
    push(fm[1], fm[2]);
  }

  // "Expires 08/2027" without a colon
  const exp = raw.match(/expir(?:es|ation|y)?\s*[:=]?\s*([\d/.-]{4,10})/i);
  if (exp) push('EXPIRES', exp[1].replace(/[.\s]+$/, ''));

  return { title: title.toUpperCase().slice(0, 20), rows: rows.slice(0, 12) };
}

/**
 * Build spotlight pages (1–2 short lines each) for any content.
 * @param {string} text
 * @param {{ left: string, right: string }[]} pairs
 */
function buildSpotlightPages(text, pairs) {
  /** @type {{ lines: string[] }[]} */
  const pages = [];

  if (pairs.length >= 2) {
    for (const row of pairs) {
      pages.push({ lines: [row.left, row.right] });
    }
    return pages;
  }

  // Prose / labels / objects: split into short facts.
  const sentences = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  const maxChars = maxCharsFor(6, 3, 36);
  const chunks = [];
  for (const s of sentences.length ? sentences : [String(text || '').trim()]) {
    chunks.push(...wrapToWidth(s.replace(/[.!?]$/, ''), maxChars));
  }
  if (!chunks.length) chunks.push('NO TEXT');

  for (let i = 0; i < chunks.length; i += 2) {
    const lines = [chunks[i]];
    if (chunks[i + 1]) lines.push(chunks[i + 1]);
    pages.push({ lines });
  }
  return pages;
}

/**
 * Overview card lines when we don't have pairs (mail, object ID, short label).
 * @param {string} text
 */
function buildOverviewLines(text) {
  const maxChars = maxCharsFor(4, 3, 44);
  const sentences = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/);
  const lines = [];
  for (const s of sentences) {
    lines.push(...wrapToWidth(s, maxChars));
    if (lines.length >= 8) break;
  }
  return lines.slice(0, 6);
}

/**
 * @returns {ReturnType<typeof createMagnifierState>}
 */
export function createMagnifier(options = {}) {
  return createMagnifierState(options);
}

function createMagnifierState(options = {}) {
  /** @type {MagnifierTheme} */
  let themeName = options.theme || process.env.MAGNIFIER_THEME || 'white-on-black';
  let sourceText = '';
  let until = 0;
  let speaking = false;
  /** @type {{ lines: string[] }[]} */
  let spotlightPages = [];
  /** @type {{ title: string, rows: { left: string, right: string }[] } | null} */
  let listView = null;
  /** @type {string[]} */
  let overviewLines = [];
  let spotIndex = 0;
  let phaseStartedAt = 0;
  /** @type {'spotlight' | 'overview'} */
  let phase = 'spotlight';

  function theme() {
    return THEMES[themeName] || THEMES['white-on-black'];
  }

  function rebuild(text) {
    sourceText = String(text || '').trim();
    const extracted = extractPairs(sourceText);
    listView = extracted.rows.length >= 2 ? extracted : null;
    spotlightPages = buildSpotlightPages(sourceText, extracted.rows);
    overviewLines = listView
      ? []
      : buildOverviewLines(sourceText);
    spotIndex = 0;
    phase = 'spotlight';
    phaseStartedAt = Date.now();
  }

  function maybeAdvance() {
    if (speaking) return;
    const hold = phase === 'spotlight' ? SPOTLIGHT_HOLD_MS : OVERVIEW_HOLD_MS;
    if (Date.now() - phaseStartedAt < hold) return;

    if (phase === 'spotlight') {
      if (spotIndex < spotlightPages.length - 1) {
        spotIndex += 1;
        phaseStartedAt = Date.now();
        return;
      }
      // Finished spotlight tour → overview (list or prose card)
      phase = 'overview';
      phaseStartedAt = Date.now();
      return;
    }

    // overview idle: if list is long, page rows; else hold
    if (listView && listView.rows.length > 4) {
      // rotate overview window via spotIndex reuse
      spotIndex = (spotIndex + 1) % Math.ceil(listView.rows.length / 4);
      phaseStartedAt = Date.now();
    }
  }

  function drawSpotlight(px, t) {
    const page = spotlightPages[Math.min(spotIndex, spotlightPages.length - 1)] || {
      lines: ['…'],
    };
    const lines = page.lines.map(l => l.toUpperCase());
    const scale = lines.some(l => l.length > 14) ? 5 : 6;
    const gap = 3;
    const lineH = GLYPH_H * scale + 16;
    const blockH = lines.length * lineH;
    let y = Math.floor((SAFE.top + SAFE.bottom - blockH) / 2);
    for (let i = 0; i < lines.length; i++) {
      const fg = i === 1 && /^[$0-9]/.test(lines[i]) ? t.accent : t.fg;
      blitCentered(px, y, lines[i], fg, scale, gap);
      y += lineH;
    }
    const footer = `${spotIndex + 1} OF ${spotlightPages.length}`;
    blitCentered(px, SAFE.bottom - 26, footer, t.muted, 3, 2);
  }

  function drawOverviewList(px, t) {
    const pad = 40;
    fillRect(px, pad - 8, SAFE.top + 4, WIDTH - pad + 8, SAFE.bottom - 4, t.card);
    let y = SAFE.top + 14;
    if (listView.title) {
      blitCentered(px, y, listView.title.slice(0, 20), t.accent, 4, 2);
      y += 36;
    }
    const start = (spotIndex % Math.max(1, Math.ceil(listView.rows.length / 4))) * 4;
    const slice = listView.rows.slice(start, start + 4);
    const scale = 4;
    const rowH = GLYPH_H * scale + 14;
    for (const row of slice) {
      blitLeft(px, pad, y, row.left.slice(0, 16), t.fg, scale, 3);
      blitRight(px, WIDTH - pad, y, row.right.slice(0, 8), t.accent, scale, 3);
      y += rowH;
    }
    const pages = Math.max(1, Math.ceil(listView.rows.length / 4));
    const page = (start / 4) % pages;
    // dots
    const dotY = SAFE.bottom - 22;
    const totalW = pages * 12;
    let dx = Math.floor((WIDTH - totalW) / 2);
    for (let p = 0; p < pages; p++) {
      const on = p === page;
      fillRect(px, dx, dotY, dx + 7, dotY + 7, on ? t.fg : t.muted);
      dx += 12;
    }
  }

  function drawOverviewProse(px, t) {
    const pad = 40;
    fillRect(px, pad - 8, SAFE.top + 4, WIDTH - pad + 8, SAFE.bottom - 4, t.card);
    const scale = 4;
    const lineH = GLYPH_H * scale + 12;
    const maxRows = Math.max(2, Math.floor((SAFE.bottom - SAFE.top - 40) / lineH));
    const lines = overviewLines.slice(0, maxRows);
    let y = SAFE.top + 16;
    for (const line of lines) {
      blitCentered(px, y, line, t.fg, scale, 3);
      y += lineH;
    }
    blitCentered(px, SAFE.bottom - 24, 'ARGO', t.muted, 2, 1);
  }

  return {
    /**
     * @param {string} next
     * @param {number} [ms]
     */
    show(next, ms = Number(process.env.MAGNIFIER_MS) || 55_000) {
      rebuild(next);
      const tour =
        spotlightPages.length * SPOTLIGHT_HOLD_MS + OVERVIEW_HOLD_MS + 5_000;
      until = Date.now() + Math.max(ms, tour);
    },

    clear() {
      sourceText = '';
      until = 0;
      speaking = false;
      spotlightPages = [];
      listView = null;
      overviewLines = [];
      spotIndex = 0;
      phase = 'spotlight';
    },

    setSpeaking(isSpeaking) {
      if (isSpeaking && !speaking) {
        speaking = true;
        // Jump back to spotlight so the caller can match speech to huge text.
        phase = 'spotlight';
      } else if (!isSpeaking && speaking) {
        speaking = false;
        phaseStartedAt = Date.now();
      }
    },

    /** @param {MagnifierTheme} name */
    setTheme(name) {
      if (THEMES[name]) themeName = name;
    },

    isShowing() {
      return Boolean(sourceText) && Date.now() < until;
    },

    getText() {
      return sourceText;
    },

    /**
     * @param {number} [_tick]
     */
    draw(_tick = 0) {
      maybeAdvance();
      const t = theme();
      const px = new Uint8Array(WIDTH * HEIGHT * 4);
      fill(px, t.bg);

      // Thin safe-band guides (very subtle — not the prototype red)
      fillRect(px, 0, SAFE.top, WIDTH, SAFE.top + 2, t.muted.map(v => Math.round(v * 0.45)));
      fillRect(px, 0, SAFE.bottom - 2, WIDTH, SAFE.bottom, t.muted.map(v => Math.round(v * 0.45)));

      if (phase === 'spotlight' || speaking) {
        drawSpotlight(px, t);
      } else if (listView) {
        drawOverviewList(px, t);
      } else {
        drawOverviewProse(px, t);
      }
      return px;
    },
  };
}

/**
 * @param {string} userBits
 * @param {string} lastReadText
 */
export function wantsFreshLook(userBits, lastReadText) {
  if (!lastReadText) return true;
  const u = String(userBits || '').trim();
  if (!u) return true;
  if (
    /look again|read again|read (this|it|that)|what (do you|can you) see|what('s| is) (this|that|on)|new (menu|one|label)|hold (it |the )?(closer|steady)|try again/i.test(
      u,
    )
  ) {
    return true;
  }
  if (
    /how much|price|cost|total|any |vegetarian|vegan|peanut|allergen|gluten|under |cheapest|expensive|iced|latte|dose|expir|ingredient|what about|does it|is there|who|from|address/i.test(
      u,
    )
  ) {
    return false;
  }
  if (/read|see|look|camera|menu|label|sign|bottle|box|letter|mail|dial/i.test(u)) return true;
  return false;
}

/** @deprecated kept for previews / tests */
export function formatForDisplay(text) {
  return buildOverviewLines(text);
}
