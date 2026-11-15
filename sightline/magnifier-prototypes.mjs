/**
 * Render current magnifier + layout alternatives as PNGs for visual review.
 * Usage: node sightline/magnifier-prototypes.mjs
 *
 * FaceTime often crops the top/bottom of 16:9 agent video on a phone UI.
 * Alternatives keep content inside a safer vertical band.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMagnifier, formatForDisplay, WIDTH, HEIGHT } from './magnifier.mjs';

const SAMPLE =
  'This is a menu for Rimberio Coffeeshop showing an Iced Coffee section. It lists Iced Americano for 4 dollars, Iced Latte for 5 dollars, and Iced Mocha for 5 dollars and 50 cents. Caramel Macchiato is 5 dollars and 50 cents, and Cold Brew is 4 dollars and 50 cents.';

const SHORT =
  'Iced Americano 4 dollars. Cold Brew 4.50. Iced Latte 5 dollars.';

// Assumed FaceTime phone crop: keep middle ~58% of frame (tunable).
const SAFE = { top: Math.round(HEIGHT * 0.18), bottom: Math.round(HEIGHT * 0.82) };

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
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(rgba, w, h) {
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
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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
  '-': '00000000000000011111000000000000000',
  '/': '00001000010001000100010001000010000',
  $: '00100111111010001110000101111100100',
  '?': '01110100010000100100001000000000100',
};

function fill(px, rgb) {
  for (let i = 0; i < px.length; i += 4) {
    px[i] = rgb[0];
    px[i + 1] = rgb[1];
    px[i + 2] = rgb[2];
    px[i + 3] = 255;
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
          const x = Math.round(x0 + col * scale + dx);
          const y = Math.round(y0 + row * scale + dy);
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

function blitCentered(px, y, str, fg, scale, gap = 2) {
  const cw = GLYPH_W * scale + gap;
  const w = str.length * cw;
  let x = Math.floor((WIDTH - w) / 2);
  for (const ch of str) {
    blitChar(px, x, y, ch, fg, scale);
    x += cw;
  }
}

function wrap(text, maxChars) {
  const words = String(text).toUpperCase().replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) line = next;
    else {
      if (line) lines.push(line);
      line = word.length <= maxChars ? word : word.slice(0, maxChars);
    }
  }
  if (line) lines.push(line);
  return lines;
}

function dimOutsideSafe(px) {
  for (let y = 0; y < HEIGHT; y++) {
    if (y >= SAFE.top && y < SAFE.bottom) continue;
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      px[i] = Math.round(px[i] * 0.25);
      px[i + 1] = Math.round(px[i + 1] * 0.25);
      px[i + 2] = Math.round(px[i + 2] * 0.35);
    }
  }
  // Safe-zone border
  for (let x = 0; x < WIDTH; x++) {
    for (const y of [SAFE.top, SAFE.bottom - 1]) {
      const i = (y * WIDTH + x) * 4;
      px[i] = 255;
      px[i + 1] = 80;
      px[i + 2] = 80;
    }
  }
}

function labelBanner(px, title) {
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      px[i] = 30;
      px[i + 1] = 30;
      px[i + 2] = 30;
    }
  }
  blitCentered(px, 4, title, [255, 200, 80], 2, 1);
}

/** A — current production magnifier */
function protoCurrent(showCrop) {
  const m = createMagnifier();
  m.show(SAMPLE);
  const px = m.draw(0);
  if (showCrop) dimOutsideSafe(px);
  labelBanner(px, showCrop ? 'A CURRENT + CROP' : 'A CURRENT');
  return px;
}

/** B — content locked inside FaceTime-safe band; page dots in-band */
function protoSafeBand() {
  const px = new Uint8Array(WIDTH * HEIGHT * 4);
  fill(px, [8, 8, 8]);
  const lines = formatForDisplay(SAMPLE);
  const scale = 4;
  const gap = 3;
  const cw = GLYPH_W * scale + gap;
  const maxChars = Math.floor((WIDTH - 48) / cw) - 1;
  const wrapped = [];
  for (const L of lines) wrapped.push(...wrap(L, maxChars));

  const lineH = GLYPH_H * scale + 12;
  const bandH = SAFE.bottom - SAFE.top - 36;
  const rows = Math.max(2, Math.floor(bandH / lineH));
  const pageLines = wrapped.slice(0, rows);

  let y = SAFE.top + 10;
  for (const line of pageLines) {
    const w = line.length * cw;
    let x = Math.floor((WIDTH - w) / 2);
    for (const ch of line) {
      blitChar(px, x, y, ch, [255, 255, 255], scale);
      x += cw;
    }
    y += lineH;
  }
  // Dots inside safe band bottom
  const pages = Math.ceil(wrapped.length / rows) || 1;
  const dotY = SAFE.bottom - 22;
  const totalW = pages * 14;
  let dx = Math.floor((WIDTH - totalW) / 2);
  for (let p = 0; p < pages; p++) {
    const on = p === 0;
    for (let yy = 0; yy < 8; yy++) {
      for (let xx = 0; xx < 8; xx++) {
        const x = dx + xx;
        const y2 = dotY + yy;
        const i = (y2 * WIDTH + x) * 4;
        const v = on ? 255 : 90;
        px[i] = v;
        px[i + 1] = v;
        px[i + 2] = v;
        px[i + 3] = 255;
      }
    }
    dx += 14;
  }
  dimOutsideSafe(px);
  labelBanner(px, 'B SAFE BAND + DOTS');
  return px;
}

/** C — focus card: few huge lines, vertically centered in safe zone */
function protoFocusCard() {
  const px = new Uint8Array(WIDTH * HEIGHT * 4);
  fill(px, [5, 5, 5]);
  // Soft card
  const cardTop = SAFE.top + 8;
  const cardBot = SAFE.bottom - 8;
  for (let y = cardTop; y < cardBot; y++) {
    for (let x = 36; x < WIDTH - 36; x++) {
      const i = (y * WIDTH + x) * 4;
      px[i] = 18;
      px[i + 1] = 18;
      px[i + 2] = 18;
    }
  }
  const items = ['ICED AMERICANO', '$4.00', 'COLD BREW', '$4.50', 'ICED LATTE', '$5.00'];
  const scale = 5;
  const lineH = GLYPH_H * scale + 10;
  const blockH = items.length * lineH;
  let y = Math.floor((cardTop + cardBot - blockH) / 2);
  for (let i = 0; i < items.length; i++) {
    const fg = i % 2 === 1 ? [255, 220, 60] : [255, 255, 255];
    blitCentered(px, y, items[i], fg, scale, 3);
    y += lineH;
  }
  dimOutsideSafe(px);
  labelBanner(px, 'C FOCUS CARD');
  return px;
}

/** D — single spotlight line (best for low vision during speech) */
function protoSpotlight() {
  const px = new Uint8Array(WIDTH * HEIGHT * 4);
  fill(px, [0, 0, 0]);
  const lines = ['ICED AMERICANO', '4 DOLLARS'];
  const scale = 7;
  const lineH = GLYPH_H * scale + 18;
  let y = Math.floor((SAFE.top + SAFE.bottom - lines.length * lineH) / 2);
  for (const line of lines) {
    blitCentered(px, y, line, [255, 255, 255], scale, 4);
    y += lineH;
  }
  blitCentered(px, SAFE.bottom - 28, '1 OF 5', [140, 140, 140], 3, 2);
  dimOutsideSafe(px);
  labelBanner(px, 'D SPOTLIGHT');
  return px;
}

/** E — yellow-on-black list, left-aligned in safe band, clear hierarchy */
function protoYellowList() {
  const px = new Uint8Array(WIDTH * HEIGHT * 4);
  fill(px, [10, 10, 10]);
  blitCentered(px, SAFE.top + 8, 'ICED COFFEE', [255, 210, 40], 4, 2);
  const rows = [
    ['AMERICANO', '4.00'],
    ['COLD BREW', '4.50'],
    ['LATTE', '5.00'],
    ['MOCHA', '5.50'],
  ];
  let y = SAFE.top + 48;
  const scale = 4;
  for (const [name, price] of rows) {
    blitChar(px, 48, y, name[0], [255, 255, 255], scale); // start
    let x = 48;
    for (const ch of name) {
      blitChar(px, x, y, ch, [255, 255, 255], scale);
      x += GLYPH_W * scale + 3;
    }
    const pw = price.length * (GLYPH_W * scale + 3);
    let px0 = WIDTH - 48 - pw;
    for (const ch of price) {
      blitChar(px, px0, y, ch, [255, 210, 40], scale);
      px0 += GLYPH_W * scale + 3;
    }
    y += GLYPH_H * scale + 16;
  }
  blitCentered(px, SAFE.bottom - 26, 'PAGE 1 / 1', [120, 120, 120], 2, 1);
  dimOutsideSafe(px);
  labelBanner(px, 'E MENU LIST');
  return px;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'magnifier-preview');
mkdirSync(outDir, { recursive: true });

const frames = {
  'a-current': protoCurrent(false),
  'a-current-with-crop': protoCurrent(true),
  'b-safe-band': protoSafeBand(),
  'c-focus-card': protoFocusCard(),
  'd-spotlight': protoSpotlight(),
  'e-menu-list': protoYellowList(),
};

for (const [name, rgba] of Object.entries(frames)) {
  writeFileSync(join(outDir, `${name}.png`), png(rgba, WIDTH, HEIGHT));
}
console.log(`wrote ${Object.keys(frames).join(', ')} -> ${outDir}`);
console.log(`safe band y=${SAFE.top}..${SAFE.bottom} (dimmed = likely FaceTime crop)`);
void SHORT;
