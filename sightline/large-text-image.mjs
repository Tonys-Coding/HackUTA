/**
 * High-contrast large-text PNG for iMessage (not FaceTime video).
 * Uses the sans-serif prototype (Arial Bold via PIL) matching
 * experiments/magnifier/preview/imessage-sans-*.png. Falls back to a bitmap font
 * if Python/PIL/fonts are unavailable.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SCRIPT = fileURLToPath(new URL('./large-text-image.py', import.meta.url));

export const IMG_W = 900;
const PAD_X = 48;
const PAD_Y = 56;
const SCALE = 6;
const GAP = 4;
const LINE_GAP = 18;
const MAX_H = 1600;

/** Themes tuned for WCAG luminance contrast + APH/Perkins low-vision palettes. */
export const THEMES = {
  'dark-on-cream': { fg: [0, 0, 0], bg: [255, 248, 220], accent: [0, 0, 0] },
  'black-on-yellow': { fg: [0, 0, 0], bg: [255, 255, 0], accent: [0, 0, 0] },
  'black-on-white': { fg: [0, 0, 0], bg: [255, 255, 255], accent: [0, 0, 0] },
  'yellow-on-black': { fg: [255, 235, 59], bg: [0, 0, 0], accent: [255, 235, 59] },
  'white-on-black': { fg: [255, 255, 255], bg: [0, 0, 0], accent: [255, 255, 255] },
  'white-on-soft-black': { fg: [255, 255, 255], bg: [0, 0, 0], accent: [255, 235, 59] },
};

const DEFAULT_THEME = 'dark-on-cream';

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
  '-': '00000000000000011111000000000000000',
  '—': '00000000000000011111000000000000000',
  ':': '00000001100011000000001100011000000',
  $: '00100111111010001110000101111100100',
  '/': '00001000010001000100010001000010000',
  '%': '11001110010001000100010001001110011',
  '(': '00100010000100001000010000100000100',
  ')': '00100000100001000010000100001000100',
};

function resolveTheme(name) {
  return THEMES[name] ? name : DEFAULT_THEME;
}

function pitch() {
  return GLYPH_W * SCALE + GAP;
}

function maxChars() {
  return Math.max(10, Math.floor((IMG_W - PAD_X * 2) / pitch()) - 1);
}

/** @param {string} text */
export function wrapLargeText(text) {
  const max = maxChars();
  const paragraphs = String(text || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n+/);
  const lines = [];
  for (const para of paragraphs.length ? paragraphs : [String(text || '')]) {
    const words = para.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length <= max) line = next;
      else {
        if (line) lines.push(line);
        if (word.length <= max) line = word;
        else {
          for (let i = 0; i < word.length; i += max) {
            const chunk = word.slice(i, i + max);
            if (i + max < word.length) lines.push(chunk);
            else line = chunk;
          }
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : ['(no text)'];
}

function blitChar(px, w, x0, y0, ch, fg) {
  const key = G[ch] ? ch : G[ch.toUpperCase()] ? ch.toUpperCase() : '?';
  const bits = G[key] || G['?'];
  for (let row = 0; row < GLYPH_H; row++) {
    for (let col = 0; col < GLYPH_W; col++) {
      if (bits[row * GLYPH_W + col] !== '1') continue;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const x = x0 + col * SCALE + dx;
          const y = y0 + row * SCALE + dy;
          if (x < 0 || y < 0 || x >= w) continue;
          const i = (y * w + x) * 4;
          if (i + 3 >= px.length) continue;
          px[i] = fg[0];
          px[i + 1] = fg[1];
          px[i + 2] = fg[2];
          px[i + 3] = 255;
        }
      }
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
};

/** @param {Uint8Array} rgba @param {number} w @param {number} h */
export function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Bitmap fallback (same contract) if Python/PIL is missing.
 * @param {string} text
 * @param {string} themeName
 */
function renderBitmapFallback(text, themeName) {
  const theme = THEMES[themeName] || THEMES[DEFAULT_THEME];
  const allLines = wrapLargeText(text);
  const lineH = GLYPH_H * SCALE + LINE_GAP;
  const headerH = 44;
  const needed = PAD_Y * 2 + headerH + allLines.length * lineH;
  const h = Math.min(MAX_H, Math.max(640, needed));
  const rowsFit = Math.max(1, Math.floor((h - PAD_Y * 2 - headerH) / lineH));
  const lines = allLines.slice(0, rowsFit);
  if (allLines.length > rowsFit) lines[lines.length - 1] = '… (more in next msg)';

  const px = new Uint8Array(IMG_W * h * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = theme.bg[0];
    px[i + 1] = theme.bg[1];
    px[i + 2] = theme.bg[2];
    px[i + 3] = 255;
  }
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < IMG_W; x++) {
      const i = (y * IMG_W + x) * 4;
      px[i] = theme.accent[0];
      px[i + 1] = theme.accent[1];
      px[i + 2] = theme.accent[2];
    }
  }
  let tx = PAD_X;
  for (const ch of 'ARGO READ') {
    blitChar(px, IMG_W, tx, 18, ch, theme.accent);
    tx += pitch();
  }
  let y = PAD_Y + headerH;
  for (const line of lines) {
    let x = PAD_X;
    for (const ch of line) {
      blitChar(px, IMG_W, x, y, ch, theme.fg);
      x += pitch();
      if (x > IMG_W - PAD_X - GLYPH_W * SCALE) break;
    }
    y += lineH;
  }
  return { png: encodePng(px, IMG_W, h), width: IMG_W, height: h, lines, engine: 'bitmap' };
}

/**
 * @param {string} text
 * @param {{ theme?: keyof typeof THEMES }} [opts]
 * @returns {{ png: Buffer, width: number, height: number, lines: string[], engine?: string }}
 */
export function renderLargeTextPng(text, opts = {}) {
  const themeName = resolveTheme(opts.theme || process.env.MAGNIFIER_THEME || DEFAULT_THEME);
  const lines = wrapLargeText(text);

  const dir = mkdtempSync(join(tmpdir(), 'argo-large-text-'));
  const out = join(dir, 'out.png');
  try {
    execFileSync('python3', [SCRIPT, '--theme', themeName, '--out', out], {
      input: String(text || ''),
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15_000,
    });
    const png = readFileSync(out);
    return { png, width: IMG_W, height: 0, lines, engine: 'sans' };
  } catch (error) {
    console.warn('[argo] sans large-text render failed, using bitmap fallback:', String(error?.message || error));
    return renderBitmapFallback(text, themeName);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** CLI helper for regenerating preview samples. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const theme = process.argv[2] || DEFAULT_THEME;
  const sample =
    process.argv.slice(3).join(' ') ||
    'Rimberio iced coffee menu.\nIced Americano — $4.00\nCold Brew — $4.50\nIced Latte — $5.00';
  const { png, engine } = renderLargeTextPng(sample, { theme });
  const dest = join(
    fileURLToPath(new URL('.', import.meta.url)),
    '../experiments/magnifier/preview',
    `imessage-live-${theme}.png`,
  );
  writeFileSync(dest, png);
  console.log('wrote', dest, png.length, 'engine=', engine);
}
