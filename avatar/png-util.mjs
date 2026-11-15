// Minimal RGBA PNG read/write (8-bit, non-interlaced) for avatar layers. No deps.
import { deflateSync, inflateSync } from 'node:zlib';

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
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param {Buffer|Uint8Array} buf
 * @returns {{ width: number, height: number, rgba: Uint8Array }}
 */
export function decodePng(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('not a PNG');
  }
  let o = 8;
  let width = 0;
  let height = 0;
  /** @type {Buffer[]} */
  const idats = [];
  while (o + 8 <= b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString('ascii', o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('PNG must be 8-bit RGBA');
    } else if (type === 'IDAT') {
      idats.push(Buffer.from(data));
    } else if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idats));
  const stride = width * 4 + 1;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    const row = raw.subarray(y * stride + 1, y * stride + 1 + width * 4);
    const dest = y * width * 4;
    if (filter === 0) {
      rgba.set(row, dest);
    } else if (filter === 1) {
      for (let i = 0; i < width * 4; i++) {
        const left = i >= 4 ? rgba[dest + i - 4] : 0;
        rgba[dest + i] = (row[i] + left) & 255;
      }
    } else if (filter === 2) {
      for (let i = 0; i < width * 4; i++) {
        const up = y > 0 ? rgba[dest - width * 4 + i] : 0;
        rgba[dest + i] = (row[i] + up) & 255;
      }
    } else if (filter === 4) {
      for (let i = 0; i < width * 4; i++) {
        const left = i >= 4 ? rgba[dest + i - 4] : 0;
        const up = y > 0 ? rgba[dest - width * 4 + i] : 0;
        const upLeft = y > 0 && i >= 4 ? rgba[dest - width * 4 + i - 4] : 0;
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        rgba[dest + i] = (row[i] + pr) & 255;
      }
    } else {
      throw new Error(`unsupported PNG filter ${filter}`);
    }
  }
  return { width, height, rgba };
}
