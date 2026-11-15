import { around, createRaster, mix } from './face-raster.mjs';

export const LW = 360;
export const LH = 780;
export const HORIZON = 440;
export const TERRACE = 568;
/** Mid zoom: scene still edge-to-edge, Argos sits comfortably (not a face close-up). */
export const VIEW = 0.78;
export const FOCUS_Y = 430;
export const DOG_SCALE = 1.18;
export const DY = 220;

/** Ithaca backdrop — Olympian ruin terrace, saturated cream + true navy. */
export const CREAM = [232, 208, 168];
export const CREAM_DOT = [210, 182, 140];
export const CREAM_DEEP = [214, 186, 142];
export const NAVY = [10, 28, 78];
export const NAVY_MID = [22, 48, 112];
export const NAVY_SOFT = [56, 92, 158];
export const SKY_TOP = [18, 42, 102];
export const SKY_MID = [92, 128, 178];
export const SKY_LOW = [236, 214, 176];
export const SUN = [255, 236, 198];
export const SUN_GLOW = [255, 220, 160];
export const CLOUD = [246, 232, 210];
export const CLOUD_SHADE = [168, 186, 214];
export const HILLS_FAR = NAVY_MID;
export const HILLS_NEAR = NAVY;
export const SEA_TOP = [36, 68, 138];
export const SEA_LOW = NAVY;
export const GLINT = [210, 228, 245];
export const HULL = NAVY;
export const SAIL = NAVY;
export const SAIL_STRIPE = mix(NAVY, CREAM, 0.22);
export const MARBLE = CREAM;
export const MARBLE_SHADE = CREAM_DOT;
export const MARBLE_DARK = NAVY_SOFT;
export const STONE = CREAM_DEEP;
export const STONE_DARK = mix(CREAM_DEEP, NAVY_SOFT, 0.35);
export const COAT = [140, 98, 60];
export const COAT_DARK = [100, 68, 42];
export const EAR = [78, 52, 34];
export const MUZZLE = [200, 166, 124];
export const MUZZLE_SHADE = [162, 128, 92];
export const GRIZZLE = [182, 174, 162];
export const NOSE = [26, 20, 18];
export const MOUTH = [44, 18, 16];
export const TONGUE = [212, 104, 112];
export const TONGUE_DARK = [168, 72, 82];
export const EYE_DARK = [34, 24, 18];
export const IRIS = [112, 70, 34];
export const EYE_SHINE = [240, 236, 226];
export const BRONZE = [184, 136, 64];
export const BRONZE_LIGHT = [232, 196, 120];
export const BRONZE_DARK = [124, 86, 38];
export const IRON = [64, 66, 68];
export const IRON_LIGHT = [118, 120, 122];
export const IRON_DARK = [36, 38, 40];
export const CREST = [156, 30, 30];
export const CREST_DARK = [104, 16, 18];
export const LEATHER = [56, 48, 40];
export const STRAP = [110, 70, 40];
export const CLOAK = [150, 30, 32];
export const CLOAK_DARK = [108, 18, 22];

export function sceneT() {
  return {
    a: VIEW,
    b: 0,
    c: 0,
    d: VIEW,
    e: (LW / 2) * (1 - VIEW),
    f: LH / 2 - VIEW * FOCUS_Y,
  };
}

export function dogPose(t, speaking) {
  const cx = LW / 2;
  const cy = 172 + DY + 2 * Math.sin(t * 1.5) + (speaking ? 1.2 * Math.sin(t * 13.5) : 0);
  const paw = LH - 46;
  const tilt = 0.04 * Math.sin(t * 0.68);
  const wag = Math.sin(t * (speaking ? 13.5 : 5.25)) * 0.4;
  const earSwing = 3 * Math.sin(t * 1.8) + (speaking ? 2 * Math.sin(t * 10.5) : 0);
  const open = speaking
    ? 2 + 11 * Math.abs(Math.sin(t * 12)) * (0.6 + 0.4 * Math.abs(Math.sin(t * 4.65)))
    : 0;
  const blink = t % 4 < 0.12;
  const glance = 2 * Math.sin(t * 0.6);
  const lift = speaking ? 2 * Math.abs(Math.sin(t * 7.5)) : 0;
  const sway = 2.5 * Math.sin(t * 2.25);
  return { cx, cy, paw, tilt, wag, earSwing, open, blink, glance, lift, sway };
}

/** Logical AABB of the dog after DOG_SCALE (with padding for crest/tail). */
export function dogLogicalBounds(pose) {
  const { cx, cy, paw } = pose;
  return {
    x0: cx - 160,
    y0: cy - 160,
    x1: cx + 160,
    y1: paw + 40,
  };
}

/**
 * @param {ReturnType<typeof createRaster>} r
 * @param {number} t
 * @param {{ static?: boolean, dynamic?: boolean }} [opts]
 */
export function paintBackground(r, t, opts = {}) {
  const doStatic = opts.static !== false;
  const doDynamic = opts.dynamic !== false;
  const { width, height, scale, setPx, poly, rect, ellipse, px } = r;
  const T = r.getT();
  const sunX = 300;
  const sunY = HORIZON - 44;

  if (doStatic) {
    // Fast row fill — same color across each scanline (no per-pixel setPx overhead).
    const row = new Uint8Array(width * 4);
    for (let y = 0; y < height; y++) {
      const ly = ((y + 0.5) / scale - T.f) / T.d;
      let c;
      if (ly < HORIZON) {
        const u = Math.max(0, Math.min(1, ly / HORIZON));
        if (u < 0.42) c = mix(SKY_TOP, SKY_MID, u / 0.42);
        else if (u < 0.78) c = mix(SKY_MID, mix(SKY_MID, SKY_LOW, 0.55), (u - 0.42) / 0.36);
        else c = mix(mix(SKY_MID, SKY_LOW, 0.55), SKY_LOW, (u - 0.78) / 0.22);
      } else if (ly < TERRACE) {
        c = mix(SEA_TOP, SEA_LOW, (ly - HORIZON) / (TERRACE - HORIZON));
      } else {
        c = mix(STONE, STONE_DARK, Math.min(1, (ly - TERRACE) / (LH - TERRACE)));
      }
      for (let x = 0, i = 0; x < width; x++, i += 4) {
        row[i] = c[0];
        row[i + 1] = c[1];
        row[i + 2] = c[2];
        row[i + 3] = 255;
      }
      px.set(row, y * width * 4);
    }

    // Soft sun glow via ellipses only (no full-frame bloom pass).
    ellipse(sunX, sunY, 58, 48, mix(SKY_LOW, SUN_GLOW, 0.65), y => y < HORIZON);
    ellipse(sunX, sunY, 38, 32, SUN_GLOW);
    ellipse(sunX, sunY, 24, 22, SUN);
  }

  if (doStatic) {
    // Hills of Ithaca on the horizon
    poly(
      [
        [-10, HORIZON],
        [20, HORIZON - 34],
        [70, HORIZON - 52],
        [120, HORIZON - 30],
        [160, HORIZON],
      ],
      HILLS_FAR,
    );
    poly(
      [
        [-10, HORIZON],
        [10, HORIZON - 18],
        [50, HORIZON - 26],
        [96, HORIZON],
      ],
      HILLS_NEAR,
    );
    poly(
      [
        [300, HORIZON],
        [330, HORIZON - 18],
        [370, HORIZON - 12],
        [370, HORIZON],
      ],
      HILLS_FAR,
    );

    // Marble terrace ledge + stone courses
    rect(-LW, TERRACE, LW * 3, 10, MARBLE);
    rect(-LW, TERRACE + 10, LW * 3, 3, MARBLE_DARK);
    for (let row = 0, y = TERRACE + 13; y < LH * 2; row++) {
      const h = 22 + row * 10;
      rect(-LW, y + h - 1.5, LW * 3, 1.5, STONE_DARK);
      for (let x = (row % 2) * 40 - 10 - LW; x < LW * 2; x += 80) {
        rect(x, y, 1.5, h, STONE_DARK);
      }
      y += h;
    }

    // Broken Doric columns framing Argos
    const column = (x0, w, top, broken) => {
      rect(x0, top, w, TERRACE - top, MARBLE);
      for (let f = x0 + 4; f < x0 + w - 2; f += 7) rect(f, top, 2, TERRACE - top, MARBLE_SHADE);
      rect(x0 + w - 5, top, 5, TERRACE - top, MARBLE_SHADE);
      rect(x0 - 5, TERRACE - 10, w + 10, 10, MARBLE_SHADE);
      if (broken) {
        poly(
          [
            [x0, top],
            [x0 + w * 0.3, top - 10],
            [x0 + w * 0.55, top - 3],
            [x0 + w * 0.8, top - 14],
            [x0 + w, top - 4],
            [x0 + w, top + 2],
            [x0, top + 2],
          ],
          MARBLE,
        );
      } else {
        rect(x0 - 6, top - 10, w + 12, 10, MARBLE);
        rect(x0 - 2, top - 3, w + 4, 3, MARBLE_SHADE);
        rect(x0 - 8, top - 20, w + 16, 10, MARBLE_SHADE);
      }
    };
    column(-6, 40, 150, false);
    column(318, 36, 260, true);
    ellipse(334, TERRACE + 22, 22, 12, MARBLE_SHADE);
    ellipse(334, TERRACE + 19, 22, 11, MARBLE);
    ellipse(LW / 2, LH - 30, 150, 18, STONE_DARK);
  }

  if (doDynamic) {
    // Soft layered clouds
    for (const [y, w, speed, off] of [
      [88, 130, 0.1, 0],
      [142, 100, 0.07, 170],
      [210, 150, 0.09, 60],
      [290, 88, 0.13, 250],
    ]) {
      const x = ((off + t * speed * 16) % (LW + w * 2)) - w;
      const nearHorizon = y > 240;
      const shade = nearHorizon ? mix(CLOUD_SHADE, SKY_LOW, 0.35) : CLOUD_SHADE;
      const lit = nearHorizon ? mix(CLOUD, SKY_LOW, 0.25) : CLOUD;
      ellipse(x, y + 5, w * 0.52, 11, shade);
      ellipse(x - w * 0.14, y, w * 0.44, 10, lit);
      ellipse(x + w * 0.2, y - 3, w * 0.26, 8, lit);
      ellipse(x + w * 0.02, y + 2, w * 0.3, 7, mix(lit, shade, 0.35));
    }

    // Wave lip + glints + galley (cheap overlays on cached static BG)
    const waveLip = (yBase, amp, phase, color) => {
      const pts = [[-40, TERRACE + 4]];
      for (let x = -40; x <= LW + 40; x += 14) {
        const y =
          yBase +
          Math.sin(x * 0.035 + phase + t * 0.7) * amp +
          Math.sin(x * 0.09 + phase * 1.7) * amp * 0.35;
        pts.push([x, Math.min(y, TERRACE - 2)]);
      }
      pts.push([LW + 40, TERRACE + 4]);
      poly(pts, color);
    };
    waveLip(HORIZON + 6, 10, 0.2, mix(CREAM, NAVY_SOFT, 0.45));
    waveLip(HORIZON + 22, 12, 1.1, mix(CREAM, NAVY_MID, 0.7));

    for (let i = 0; i < 40; i++) {
      const y = HORIZON + 3 + ((i * 37) % (TERRACE - HORIZON - 6));
      const nearSun = i % 2 === 0;
      const spread = 14 + (y - HORIZON) * 0.5;
      const x = nearSun
        ? sunX + Math.sin(i * 1.7 + t * 3.2) * spread
        : (i * 53 + t * (9.6 + (i % 3) * 4.8)) % (LW + 20) - 10;
      const len = 3 + (i % 4) * 2 + (y - HORIZON) * 0.05;
      rect(x, y, len, 1, nearSun ? mix(CREAM, NAVY_SOFT, 0.55) : GLINT);
    }

    const shipX = ((t * 5.6 + 40) % (LW + 120)) - 60;
    const shipY = HORIZON + 14;
    poly(
      [
        [shipX - 24, shipY - 6],
        [shipX + 24, shipY - 6],
        [shipX + 17, shipY + 2],
        [shipX - 17, shipY + 2],
      ],
      HULL,
    );
    poly(
      [
        [shipX + 22, shipY - 6],
        [shipX + 28, shipY - 14],
        [shipX + 25, shipY - 6],
      ],
      HULL,
    );
    rect(shipX - 0.75, shipY - 38, 1.5, 32, HULL);
    rect(shipX - 14, shipY - 36, 28, 22, SAIL);
    rect(shipX - 14, shipY - 28, 28, 5, SAIL_STRIPE);
    poly(
      [
        [shipX - 2, shipY - 32],
        [shipX + 5, shipY - 26],
        [shipX - 2, shipY - 20],
        [shipX - 9, shipY - 26],
      ],
      mix(NAVY, CREAM, 0.22),
    );
    for (let o = -16; o <= 12; o += 7) rect(shipX + o, shipY + 1, 1, 6, HULL);
  }

  void setPx;
}

/**
 * Draw Argos into an existing raster. Options control which parts for layer baking.
 * @param {ReturnType<typeof createRaster>} r
 * @param {ReturnType<typeof dogPose>} pose
 * @param {{ body?: boolean, tail?: boolean, head?: boolean, mouthOpen?: boolean, eyes?: boolean, eyesBlink?: boolean, helmet?: boolean, crest?: boolean, ears?: boolean }} parts
 */
export function paintArgos(r, pose, parts = {}) {
  const {
    body = true,
    tail = true,
    head = true,
    mouthOpen = true,
    mouthOnly = false,
    eyes = true,
    eyesBlink = false,
    eyesOnly = false,
    helmet = true,
    crest = true,
    crestOnly = false,
    ears = true,
  } = parts;
  const { withT, poly, rect, ellipse, dot } = r;
  const { cx, cy, paw, tilt, wag, earSwing, open, blink, glance, lift, sway } = pose;

  withT(around(cx, paw + 12, DOG_SCALE, 0), () => {
    if (body) {
      poly(
        [
          [cx - 70, cy + 96],
          [cx + 70, cy + 96],
          [cx + 128, paw - 30],
          [cx - 128, paw - 30],
        ],
        CLOAK,
      );
      for (const side of [-1, 1]) {
        poly(
          [
            [cx + side * 58, cy + 110],
            [cx + side * 64, cy + 110],
            [cx + side * 112, paw - 30],
            [cx + side * 100, paw - 30],
          ],
          CLOAK_DARK,
        );
        poly(
          [
            [cx + side * 30, cy + 110],
            [cx + side * 34, cy + 110],
            [cx + side * 64, paw - 30],
            [cx + side * 56, paw - 30],
          ],
          CLOAK_DARK,
        );
      }
      for (let i = 0; i <= 16; i++) ellipse(cx - 128 + i * 16, paw - 30, 7, 6, BRONZE);

      for (const side of [-1, 1]) {
        ellipse(cx + side * 64, paw - 34, 34, 42, COAT_DARK);
        ellipse(cx + side * 60, paw - 40, 26, 32, mix(COAT_DARK, COAT, 0.5));
        poly(
          [
            [cx + side * 76, paw - 14],
            [cx + side * 92, paw - 14],
            [cx + side * 94, paw],
            [cx + side * 74, paw],
          ],
          COAT_DARK,
        );
        ellipse(cx + side * 84, paw + 3, 15, 8, MUZZLE_SHADE);
        for (const tt of [-6, 0, 6]) rect(cx + side * 84 + tt - 0.5, paw + 1, 1, 7, COAT_DARK);
      }

      ellipse(cx, cy + 190, 80, 140, COAT, y => y < paw);
      ellipse(cx, cy + 170, 42, 96, mix(COAT, MUZZLE, 0.45), y => y < paw);
      for (const side of [-1, 1]) {
        const lx = cx + side * 36;
        poly(
          [
            [lx - 17, cy + 214],
            [lx + 17, cy + 214],
            [lx + 13, paw - 2],
            [lx - 13, paw - 2],
          ],
          COAT,
        );
        poly(
          [
            [lx + side * 9, cy + 214],
            [lx + side * 17, cy + 214],
            [lx + side * 13, paw - 2],
            [lx + side * 7, paw - 2],
          ],
          COAT_DARK,
        );
        ellipse(lx + side * 4, cy + 222, 19, 15, COAT);
        ellipse(lx, paw + 2, 20, 10, MUZZLE);
        for (const tt of [-12, -4, 4, 12]) ellipse(lx + tt, paw + 6, 5.5, 5, MUZZLE);
        for (const tt of [-8, 0, 8]) rect(lx + tt - 0.5, paw + 2, 1, 9, MUZZLE_SHADE);
      }

      for (const side of [-1, 1]) rect(side < 0 ? cx - 80 : cx + 54, cy + 132, 26, 9, STRAP);
      poly(
        [
          [cx - 60, cy + 104],
          [cx + 60, cy + 104],
          [cx + 54, cy + 202],
          [cx, cy + 242],
          [cx - 54, cy + 202],
        ],
        BRONZE_DARK,
      );
      poly(
        [
          [cx - 55, cy + 109],
          [cx + 55, cy + 109],
          [cx + 49, cy + 199],
          [cx, cy + 234],
          [cx - 49, cy + 199],
        ],
        LEATHER,
      );
      ellipse(cx, cy + 162, 18, 18, BRONZE_DARK);
      ellipse(cx, cy + 162, 15, 15, BRONZE);
      ellipse(cx, cy + 162, 6, 6, BRONZE_DARK);
      ellipse(cx - 5, cy + 156, 3, 2, BRONZE_LIGHT);
      for (const [x, y] of [
        [-42, 120],
        [42, 120],
        [-38, 194],
        [38, 194],
        [0, 222],
      ])
        ellipse(cx + x, cy + y, 2, 2, BRONZE);

      ellipse(cx, cy + 74, 64, 40, COAT_DARK);
      for (let i = 0; i < 13; i++)
        poly(
          [
            [cx - 60 + i * 10, cy + 100],
            [cx - 50 + i * 10, cy + 100],
            [cx - 55 + i * 10, cy + 114],
          ],
          COAT_DARK,
        );
      rect(cx - 46, cy + 80, 92, 10, BRONZE_DARK);
      rect(cx - 46, cy + 81, 92, 4, BRONZE);
      ellipse(cx, cy + 96, 9, 9, BRONZE_DARK);
      ellipse(cx, cy + 96, 7, 7, BRONZE);
      ellipse(cx - 2, cy + 94, 2, 2, BRONZE_LIGHT);
    }

    if (tail) {
      let tx = cx + 92;
      let ty = paw - 62;
      let dir = -Math.PI / 2 + 0.55 + wag;
      const segs = [];
      for (let i = 0; i < 24; i++) {
        segs.push([tx, ty, 10 - i * 0.25, i > 19]);
        tx += Math.cos(dir) * 4;
        ty += Math.sin(dir) * 4;
        dir -= 0.04;
      }
      for (const [x, y, rad] of segs) ellipse(x, y, rad + 1.5, rad + 1.5, COAT_DARK);
      for (const [x, y, rad, tip] of segs) ellipse(x, y, rad, rad, tip ? MUZZLE : COAT);
    }

    if (head || ears || helmet || crest || crestOnly || eyes || eyesBlink || eyesOnly || mouthOpen || mouthOnly) {
      withT(around(cx, cy + 70, 1, tilt), () => {
        if (ears) {
          for (const side of [-1, 1]) {
            const ex = cx + side * (56 + earSwing * side * 0.5);
            ellipse(ex, cy + 36, 25, 62, EAR);
            ellipse(ex + side * 5, cy + 44, 15, 48, mix(EAR, COAT_DARK, 0.4));
          }
        }

        if (mouthOnly) {
          const o = Math.max(open, 10);
          ellipse(cx, cy + 66 + o / 2, 20, o / 2 + 5, MOUTH);
          ellipse(cx, cy + 74 + o, 11, 8 + o * 0.7, TONGUE, y => y > cy + 62);
          rect(cx - 0.5, cy + 68, 1, 6 + o, TONGUE_DARK);
        }

        if (head) {
          ellipse(cx, cy - 2, 58, 54, COAT);
          ellipse(cx, cy + 26, 48, 34, COAT);
          for (let i = 0; i < 70; i++) {
            const a = i * 2.399;
            const rad = 30 + ((i * 37) % 26);
            const x = cx + Math.cos(a) * rad;
            const y = cy + 10 + Math.sin(a) * rad * 0.8;
            if (Math.abs(x - cx) > 24) dot(x, y, i % 2 ? GRIZZLE : COAT_DARK);
          }
          ellipse(cx, cy + 6, 13, 34, mix(COAT, MUZZLE, 0.6));
          ellipse(cx, cy + 72, 18, 8, MUZZLE_SHADE);
          if (mouthOpen && open > 1) {
            ellipse(cx, cy + 66 + open / 2, 20, open / 2 + 5, MOUTH);
            ellipse(cx, cy + 74 + open, 11, 8 + open * 0.7, TONGUE, y => y > cy + 62);
            rect(cx - 0.5, cy + 68, 1, 6 + open, TONGUE_DARK);
          }
          ellipse(cx, cy + 44, 34, 26, MUZZLE);
          for (const side of [-1, 1]) {
            ellipse(cx + side * 15, cy + 64, 17, 10, MUZZLE_SHADE);
            ellipse(cx + side * 15, cy + 60, 17, 10, MUZZLE);
          }
          for (let i = 0; i < 26; i++) {
            const side = i % 2 ? 1 : -1;
            dot(
              cx + side * (12 + ((i * 7) % 18)),
              cy + 46 + ((i * 5) % 16),
              i % 3 ? GRIZZLE : MUZZLE_SHADE,
            );
          }
          rect(cx - 0.5, cy + 44, 1, 22, MUZZLE_SHADE);
          ellipse(cx, cy + 36, 18, 12, NOSE);
          ellipse(cx - 7, cy + 39, 4, 3, [8, 6, 6]);
          ellipse(cx + 7, cy + 39, 4, 3, [8, 6, 6]);
          ellipse(cx - 5, cy + 30, 6, 2.5, [104, 98, 96]);
        }

        if (eyes || eyesBlink || eyesOnly) {
          const doBlink = eyesBlink || (eyes && blink);
          for (const side of [-1, 1]) {
            const ex = cx + side * 28;
            const ey = cy - 4;
            if (!eyesOnly) {
              ellipse(ex, ey, 11, 9, COAT_DARK);
              ellipse(ex + side * 2, ey - 12 - lift, 5, 3, MUZZLE);
            }
            if (doBlink) {
              rect(ex - 9, ey, 18, 2.5, NOSE);
            } else {
              ellipse(ex, ey, 8, 7.5, EYE_DARK);
              ellipse(ex + glance, ey, 6, 6, IRIS);
              ellipse(ex + glance, ey, 4.5, 4.5, EYE_DARK);
              ellipse(ex + glance + 2, ey - 2, 2, 2, EYE_SHINE);
            }
          }
        }

        if (helmet || crestOnly) {
          const hy = cy - 32;
          if (helmet && !crestOnly) {
            ellipse(cx, hy, 66, 52, IRON, y => y < hy + 12);
            ellipse(cx - 22, hy - 26, 22, 12, IRON_LIGHT, y => y < hy + 12);
            for (const side of [-1, 1]) {
              poly(
                [
                  [cx + side * 66, hy + 4],
                  [cx + side * 50, hy + 12],
                  [cx + side * 56, cy + 2],
                  [cx + side * 70, cy - 2],
                ],
                IRON,
              );
              poly(
                [
                  [cx + side * 66, hy + 4],
                  [cx + side * 62, hy + 10],
                  [cx + side * 66, cy],
                  [cx + side * 70, cy - 2],
                ],
                IRON_LIGHT,
              );
            }
            rect(cx - 64, hy + 8, 128, 7, IRON_DARK);
            for (let x = -54; x <= 54; x += 12) ellipse(cx + x, hy + 11.5, 1.5, 1.5, IRON_LIGHT);
          }
          if (crest || crestOnly) {
            rect(cx - 12, hy - 66, 24, 10, IRON_DARK);
            ellipse(cx + sway, hy - 88, 22, 30, CREST, y => y < hy - 62);
            for (let s = -16; s <= 16; s += 5) rect(cx + sway + s, hy - 116, 2, 54, CREST_DARK);
            ellipse(cx + sway, hy - 88, 22, 30, CREST, y => y < hy - 110);
          }
        }
      });
    }
  });
}

/** Transparent bake canvas for one dog part at high scale. */
export function bakePart(scale, partName, poseOverrides = {}) {
  const width = Math.round(LW * scale);
  const height = Math.round(LH * scale);
  const px = new Uint8Array(width * height * 4); // transparent
  const r = createRaster(width, height, scale, sceneT(), px);
  const pose = { ...dogPose(0.4, false), ...poseOverrides };
  const parts = {
    body: false,
    tail: false,
    head: false,
    mouthOpen: false,
    mouthOnly: false,
    eyes: false,
    eyesBlink: false,
    eyesOnly: false,
    helmet: false,
    crest: false,
    crestOnly: false,
    ears: false,
  };
  if (partName === 'body') parts.body = true;
  else if (partName === 'tail') {
    parts.tail = true;
    pose.wag = 0;
  } else if (partName === 'ears' || partName === 'ears_l' || partName === 'ears_r') {
    parts.ears = true;
    pose.earSwing = 0;
    pose.tilt = 0;
  } else if (partName === 'head') {
    parts.head = true;
    pose.open = 0;
    pose.tilt = 0;
  } else if (partName === 'mouth_open') {
    parts.mouthOnly = true;
    pose.open = 12;
    pose.tilt = 0;
  } else if (partName === 'eyes') {
    parts.eyesOnly = true;
    parts.eyes = true;
    pose.blink = false;
    pose.tilt = 0;
    pose.glance = 0;
  } else if (partName === 'eyes_blink') {
    parts.eyesOnly = true;
    parts.eyesBlink = true;
    pose.tilt = 0;
  } else if (partName === 'helmet') {
    parts.helmet = true;
    parts.crest = false;
    pose.tilt = 0;
  } else if (partName === 'crest') {
    parts.crestOnly = true;
    pose.sway = 0;
    pose.tilt = 0;
  } else if (partName === 'full') {
    parts.body = true;
    parts.tail = true;
    parts.ears = true;
    parts.head = true;
    parts.eyes = true;
    parts.helmet = true;
    parts.crest = true;
  }
  paintArgos(r, pose, parts);

  // Tight crop so realtime composite does not spin full 2K frames.
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) {
    return { rgba: new Uint8Array(4), width: 1, height: 1, ox: 0, oy: 0, pose };
  }
  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  // Even size so BAKE_S/publishS box-downsample divides cleanly.
  let cw = maxX - minX + 1;
  let ch = maxY - minY + 1;
  if (cw % 2) {
    if (minX > 0) minX -= 1;
    else if (maxX + 1 < width) maxX += 1;
    cw = maxX - minX + 1;
  }
  if (ch % 2) {
    if (minY > 0) minY -= 1;
    else if (maxY + 1 < height) maxY += 1;
    ch = maxY - minY + 1;
  }
  if (cw % 2) cw -= 1;
  if (ch % 2) ch -= 1;
  const cropped = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    cropped.set(
      px.subarray(((minY + y) * width + minX) * 4, ((minY + y) * width + minX + cw) * 4),
      y * cw * 4,
    );
  }
  return { rgba: cropped, width: cw, height: ch, ox: minX, oy: minY, pose };
}
