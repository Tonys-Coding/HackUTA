/** Shared CPU raster helpers for Argos avatar frames. */

export const mix = (a, b, k) => [0, 1, 2].map(j => Math.round(a[j] + (b[j] - a[j]) * k));

export const compose = (p, q) => ({
  a: p.a * q.a + p.c * q.b,
  b: p.b * q.a + p.d * q.b,
  c: p.a * q.c + p.c * q.d,
  d: p.b * q.c + p.d * q.d,
  e: p.a * q.e + p.c * q.f + p.e,
  f: p.b * q.e + p.d * q.f + p.f,
});

export const around = (px, py, k, theta) => {
  const a = k * Math.cos(theta);
  const b = k * Math.sin(theta);
  const c = -b;
  const d = a;
  return { a, b, c, d, e: px - a * px - c * py, f: py - b * px - d * py };
};

/**
 * @param {number} width
 * @param {number} height
 * @param {number} scale  pixels per logical unit (S)
 * @param {{ a:number,b:number,c:number,d:number,e:number,f:number }} baseT
 * @param {Uint8Array} [px]
 */
export function createRaster(width, height, scale, baseT, px = new Uint8Array(width * height * 4)) {
  let T = { ...baseT };
  const setPx = (x, y, c, a = 255) => {
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= width || yi >= height) return;
    const i = (yi * width + xi) * 4;
    if (a >= 255) {
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = 255;
      return;
    }
    if (a <= 0) return;
    const srcA = a / 255;
    const outA = srcA + (px[i + 3] / 255) * (1 - srcA);
    if (outA <= 0) return;
    const inv = 1 - srcA;
    px[i] = Math.round((c[0] * srcA + px[i] * (px[i + 3] / 255) * inv) / outA);
    px[i + 1] = Math.round((c[1] * srcA + px[i + 1] * (px[i + 3] / 255) * inv) / outA);
    px[i + 2] = Math.round((c[2] * srcA + px[i + 2] * (px[i + 3] / 255) * inv) / outA);
    px[i + 3] = Math.round(outA * 255);
  };

  const withT = (t, draw) => {
    const prev = T;
    T = compose(prev, t);
    draw();
    T = prev;
  };
  const toPx = (x, y) => [(T.a * x + T.c * y + T.e) * scale, (T.b * x + T.d * y + T.f) * scale];

  const poly = (lpts, c) => {
    const pts = lpts.map(([x, y]) => toPx(x, y));
    const ys = pts.map(p => p[1]);
    for (let y = Math.ceil(Math.min(...ys)); y <= Math.floor(Math.max(...ys)); y++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        if ((y >= y1 && y <= y2) || (y >= y2 && y <= y1)) {
          const x = y1 === y2 ? x1 : x1 + ((y - y1) / (y2 - y1)) * (x2 - x1);
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
        }
      }
      for (let x = Math.ceil(lo); x <= Math.floor(hi); x++) setPx(x, y, c);
    }
  };
  const rect = (x0, y0, w, h, c) =>
    poly(
      [
        [x0, y0],
        [x0 + w, y0],
        [x0 + w, y0 + h],
        [x0, y0 + h],
      ],
      c,
    );
  const dot = (x, y, c) => rect(Math.round(x), Math.round(y), 1, 1, c);
  const ellipse = (cx, cy, rx, ry, c, clip) => {
    const corners = [
      [cx - rx, cy - ry],
      [cx + rx, cy - ry],
      [cx + rx, cy + ry],
      [cx - rx, cy + ry],
    ].map(([x, y]) => toPx(x, y));
    const xs = corners.map(p => p[0]);
    const ys = corners.map(p => p[1]);
    const det = T.a * T.d - T.b * T.c;
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(height - 1, Math.ceil(Math.max(...ys))); y++) {
      const Y = (y + 0.5) / scale - T.f;
      for (
        let x = Math.max(0, Math.floor(Math.min(...xs)));
        x <= Math.min(width - 1, Math.ceil(Math.max(...xs)));
        x++
      ) {
        const X = (x + 0.5) / scale - T.e;
        const lx = (T.d * X - T.c * Y) / det;
        const ly = (-T.b * X + T.a * Y) / det;
        if (((lx - cx) / rx) ** 2 + ((ly - cy) / ry) ** 2 > 1) continue;
        if (clip && !clip(ly)) continue;
        setPx(x, y, c);
      }
    }
  };

  return { px, width, height, scale, setPx, withT, toPx, poly, rect, dot, ellipse, getT: () => T };
}

/** Box-filter downsample by integer factor SS (SS×SS → 1). */
export function downsampleBox(src, sw, sh, ss) {
  const dw = Math.floor(sw / ss);
  const dh = Math.floor(sh / ss);
  const dest = new Uint8Array(dw * dh * 4);
  const ss2 = ss * ss;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let oy = 0; oy < ss; oy++) {
        for (let ox = 0; ox < ss; ox++) {
          const i = ((y * ss + oy) * sw + (x * ss + ox)) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
        }
      }
      const o = (y * dw + x) * 4;
      dest[o] = (r / ss2 + 0.5) | 0;
      dest[o + 1] = (g / ss2 + 0.5) | 0;
      dest[o + 2] = (b / ss2 + 0.5) | 0;
      dest[o + 3] = (a / ss2 + 0.5) | 0;
    }
  }
  return { rgba: dest, width: dw, height: dh };
}

/** Alpha-over blit of src onto dest at integer top-left. */
export function blitOver(dest, dw, dh, src, sw, sh, dx, dy) {
  for (let y = 0; y < sh; y++) {
    const yy = dy + y;
    if (yy < 0 || yy >= dh) continue;
    for (let x = 0; x < sw; x++) {
      const xx = dx + x;
      if (xx < 0 || xx >= dw) continue;
      const si = (y * sw + x) * 4;
      const sa = src[si + 3];
      if (sa === 0) continue;
      const di = (yy * dw + xx) * 4;
      if (sa === 255) {
        dest[di] = src[si];
        dest[di + 1] = src[si + 1];
        dest[di + 2] = src[si + 2];
        dest[di + 3] = 255;
        continue;
      }
      const srcA = sa / 255;
      const dstA = dest[di + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      dest[di] = Math.round((src[si] * srcA + dest[di] * dstA * (1 - srcA)) / outA);
      dest[di + 1] = Math.round((src[si + 1] * srcA + dest[di + 1] * dstA * (1 - srcA)) / outA);
      dest[di + 2] = Math.round((src[si + 2] * srcA + dest[di + 2] * dstA * (1 - srcA)) / outA);
      dest[di + 3] = Math.round(outA * 255);
    }
  }
}

/**
 * Rotate+translate sprite around local pivot (px,py), place pivot at (dx,dy) on dest.
 * Nearest-neighbor for speed; layers are authored high-res so aliasing stays mild.
 */
export function blitRotated(dest, dw, dh, src, sw, sh, dx, dy, pivotX, pivotY, theta, scale = 1) {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Pivot may sit outside the sprite (head-tilt pivots for crest/helmet). Extent must
  // reach the farthest sprite corner from the pivot, not just hypot(w,h).
  const ext = Math.ceil(
    Math.hypot(Math.max(pivotX, sw - pivotX) * scale, Math.max(pivotY, sh - pivotY) * scale),
  ) + 2;
  const x0 = Math.floor(dx - ext);
  const y0 = Math.floor(dy - ext);
  const x1 = Math.ceil(dx + ext);
  const y1 = Math.ceil(dy + ext);
  for (let y = y0; y < y1; y++) {
    if (y < 0 || y >= dh) continue;
    for (let x = x0; x < x1; x++) {
      if (x < 0 || x >= dw) continue;
      const lx = x + 0.5 - dx;
      const ly = y + 0.5 - dy;
      const rx = (cos * lx + sin * ly) / scale + pivotX;
      const ry = (-sin * lx + cos * ly) / scale + pivotY;
      const sx = Math.floor(rx);
      const sy = Math.floor(ry);
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
      const si = (sy * sw + sx) * 4;
      const sa = src[si + 3];
      if (sa === 0) continue;
      const di = (y * dw + x) * 4;
      if (sa === 255 && dest[di + 3] === 0) {
        dest[di] = src[si];
        dest[di + 1] = src[si + 1];
        dest[di + 2] = src[si + 2];
        dest[di + 3] = 255;
        continue;
      }
      const srcA = sa / 255;
      const dstA = dest[di + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      if (outA <= 0) continue;
      dest[di] = Math.round((src[si] * srcA + dest[di] * dstA * (1 - srcA)) / outA);
      dest[di + 1] = Math.round((src[si + 1] * srcA + dest[di + 1] * dstA * (1 - srcA)) / outA);
      dest[di + 2] = Math.round((src[si + 2] * srcA + dest[di + 2] * dstA * (1 - srcA)) / outA);
      dest[di + 3] = Math.round(outA * 255);
    }
  }
}
