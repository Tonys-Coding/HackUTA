/**
 * Large high-contrast text frames for low-vision callers.
 * Same contract as avatar: WIDTH x HEIGHT RGBA Uint8Array, no deps.
 * Default theme: white on black (most readable on FaceTime).
 */
import { WIDTH, HEIGHT } from '../avatar/face.mjs';

export { WIDTH, HEIGHT };

/** @typedef {'white-on-black' | 'yellow-on-black' | 'black-on-white'} MagnifierTheme */

const THEMES = {
  'white-on-black': { fg: [255, 255, 255], bg: [0, 0, 0] },
  'yellow-on-black': { fg: [255, 220, 40], bg: [0, 0, 0] },
  'black-on-white': { fg: [0, 0, 0], bg: [255, 255, 255] },
};

// 5x7 glyphs, rows top→bottom, 1 = ink. Covers A–Z, 0–9, and common punctuation.
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
  '$': '00100111111010001110000101111100100',
  '%': '11001110010001000100010001001110011',
  '/': '00001000010001000100010001000010000',
  '(': '00100010000100001000010000100000100',
  ')': '00100000100001000010000100001000100',
  '&': '01100100100101001100010100101001101',
  '+': '00000001000010011111001000010000000',
  '=': '00000000001111100000111110000000000',
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const SCALE = 5; // ~25×35 px per character — readable on FaceTime
const PAD_X = 16;
const PAD_Y = 12;
const LINE_GAP = 10;
const CHAR_GAP = 2;

/**
 * @param {string} text
 * @param {number} maxWidthPx
 */
function wrapLines(text, maxWidthPx) {
  const charW = GLYPH_W * SCALE + CHAR_GAP;
  const maxChars = Math.max(8, Math.floor((maxWidthPx - PAD_X * 2) / charW));
  const words = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!word) continue;
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    if (word.length <= maxChars) {
      line = word;
    } else {
      // Hard-break long tokens (prices stuck to words, etc.)
      for (let i = 0; i < word.length; i += maxChars) {
        const chunk = word.slice(i, i + maxChars);
        if (i + maxChars < word.length) lines.push(chunk);
        else line = chunk;
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['(no text)'];
}

/**
 * @param {Uint8Array} px
 * @param {number} x0
 * @param {number} y0
 * @param {string} ch
 * @param {number[]} fg
 */
function blitChar(px, x0, y0, ch, fg) {
  const key = G[ch] ? ch : G[ch.toUpperCase()] ? ch.toUpperCase() : '?';
  const bits = G[key] || G['?'];
  for (let row = 0; row < GLYPH_H; row++) {
    for (let col = 0; col < GLYPH_W; col++) {
      if (bits[row * GLYPH_W + col] !== '1') continue;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const x = x0 + col * SCALE + dx;
          const y = y0 + row * SCALE + dy;
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

/**
 * Stateful magnifier for the outbound FaceTime video track.
 */
export function createMagnifier(options = {}) {
  /** @type {MagnifierTheme} */
  let themeName = options.theme || process.env.MAGNIFIER_THEME || 'white-on-black';
  let text = '';
  let until = 0;
  let lines = [];

  const lineHeight = GLYPH_H * SCALE + LINE_GAP;
  const visibleRows = Math.max(1, Math.floor((HEIGHT - PAD_Y * 2) / lineHeight));

  return {
    /**
     * Show large text on the outbound camera for `ms` milliseconds.
     * @param {string} next
     * @param {number} [ms]
     */
    show(next, ms = Number(process.env.MAGNIFIER_MS) || 22_000) {
      text = String(next || '').trim();
      lines = wrapLines(text, WIDTH);
      until = Date.now() + Math.max(3_000, ms);
    },

    clear() {
      text = '';
      lines = [];
      until = 0;
    },

    /** @param {MagnifierTheme} name */
    setTheme(name) {
      if (THEMES[name]) themeName = name;
    },

    isShowing() {
      return Boolean(text) && Date.now() < until;
    },

    getText() {
      return text;
    },

    /**
     * One RGBA frame. Slow vertical scroll when there are more lines than fit.
     * @param {number} tick
     */
    draw(tick = 0) {
      const theme = THEMES[themeName] || THEMES['white-on-black'];
      const px = new Uint8Array(WIDTH * HEIGHT * 4);
      for (let i = 0; i < px.length; i += 4) {
        px[i] = theme.bg[0];
        px[i + 1] = theme.bg[1];
        px[i + 2] = theme.bg[2];
        px[i + 3] = 255;
      }

      const extra = Math.max(0, lines.length - visibleRows);
      // Advance ~1 row every ~1.2s at 15fps
      const scroll = extra ? Math.floor(tick / 18) % (extra + 1) : 0;
      const slice = lines.slice(scroll, scroll + visibleRows);

      let y = PAD_Y;
      for (const line of slice) {
        let x = PAD_X;
        for (const ch of line) {
          blitChar(px, x, y, ch, theme.fg);
          x += GLYPH_W * SCALE + CHAR_GAP;
          if (x > WIDTH - PAD_X - GLYPH_W * SCALE) break;
        }
        y += lineHeight;
      }
      return px;
    },
  };
}

/**
 * True when the caller wants a fresh camera look (vs a question about the last read).
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
  // Content questions about the last OCR — answer from memory.
  if (
    /how much|price|cost|total|any |vegetarian|vegan|peanut|allergen|gluten|under |cheapest|expensive|iced|latte|americano|what about|does it|is there/i.test(
      u,
    )
  ) {
    return false;
  }
  // Default: if they seem to be pointing at something new, look again.
  if (/read|see|look|camera|menu|label|sign|bottle|box/i.test(u)) return true;
  return false;
}
