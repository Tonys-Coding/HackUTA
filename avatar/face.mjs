// Argos, the loyal hound of Odysseus: an old, scruffy brown dog in a crested iron helmet, leather armor,
// a cloak and a bronze collar, standing in a misty pine forest. Same contract as Chert's example: drawFace(tick, speaking)
// returns one WIDTH x HEIGHT RGBA frame. No dependencies.
//
// Portrait at the iPhone screen shape (about 9:19.5) on purpose: FaceTime on a phone held upright shows the remote video as a portrait
// window, so a landscape frame gets letterboxed into a strip. A portrait frame fills the screen like a
// real caller's camera does. Scene coordinates live in a 360 x 780 logical space, scaled by S to pixels.
const LW = 360;
const LH = 780;
const S = 1.5;
export const WIDTH = LW * S; // 540
export const HEIGHT = LH * S; // 1170
export const FPS = 15;

const FOG_TOP = [168, 172, 166];
const FOG_LOW = [122, 118, 104];
const GROUND = [112, 74, 46];
const GROUND_DARK = [84, 54, 34];
const TRUNK = [58, 48, 40];
const COAT = [140, 98, 60];
const COAT_DARK = [100, 68, 42];
const EAR = [78, 52, 34];
const MUZZLE = [200, 166, 124];
const MUZZLE_SHADE = [162, 128, 92];
const GRIZZLE = [182, 174, 162];
const NOSE = [26, 20, 18];
const MOUTH = [44, 18, 16];
const TONGUE = [212, 104, 112];
const TONGUE_DARK = [168, 72, 82];
const EYE_DARK = [34, 24, 18];
const IRIS = [112, 70, 34];
const EYE_SHINE = [240, 236, 226];
const BRONZE = [184, 136, 64];
const BRONZE_LIGHT = [232, 196, 120];
const BRONZE_DARK = [124, 86, 38];
const IRON = [64, 66, 68];
const IRON_LIGHT = [118, 120, 122];
const IRON_DARK = [36, 38, 40];
const CREST = [156, 30, 30];
const CREST_DARK = [104, 16, 18];
const LEATHER = [56, 48, 40];
const LEATHER_LIGHT = [84, 72, 58];
const STRAP = [110, 70, 40];
const CLOAK = [98, 74, 50];
const CLOAK_DARK = [70, 52, 36];
const FUR = [150, 132, 106];

const mix = (a, b, k) => [0, 1, 2].map((j) => Math.round(a[j] + (b[j] - a[j]) * k));

// Pine trunks: x position, width, depth (0 = near, 1 = far, fades into fog). Logical coordinates.
const TREES = [
  [10, 18, 0.15], [52, 8, 0.7], [84, 12, 0.45], [112, 6, 0.85], [134, 9, 0.6],
  [222, 7, 0.8], [246, 12, 0.4], [280, 8, 0.7], [312, 18, 0.2], [346, 11, 0.55],
];

export function drawFace(tick, speaking) {
  const px = new Uint8Array(WIDTH * HEIGHT * 4);
  // Pixel-space write. Everything else below takes logical coordinates and scales by S.
  const setPx = (x, y, c) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const i = (y * WIDTH + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  };
  const getPx = (x, y) => {
    const i = (y * WIDTH + x) * 4;
    return [px[i], px[i + 1], px[i + 2]];
  };
  // `clip` receives the logical y of each row.
  const ellipse = (lcx, lcy, lrx, lry, c, clip) => {
    const cx = lcx * S, cy = lcy * S, rx = lrx * S, ry = lry * S;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      if (clip && !clip(y / S)) continue;
      const t = 1 - ((y - cy) / ry) ** 2;
      if (t < 0) continue;
      const half = rx * Math.sqrt(t);
      for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x++) setPx(x, y, c);
    }
  };
  const rect = (x0, y0, w, h, c) => {
    for (let y = Math.round(y0 * S); y < Math.round((y0 + h) * S); y++)
      for (let x = Math.round(x0 * S); x < Math.round((x0 + w) * S); x++) setPx(x, y, c);
  };
  const dot = (x, y, c) => rect(Math.round(x), Math.round(y), 1, 1, c);
  // Filled convex polygon via scanline.
  const poly = (lpts, c) => {
    const pts = lpts.map(([x, y]) => [x * S, y * S]);
    const ys = pts.map((p) => p[1]);
    for (let y = Math.ceil(Math.min(...ys)); y <= Math.floor(Math.max(...ys)); y++) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        if ((y >= y1 && y <= y2) || (y >= y2 && y <= y1)) {
          const x = y1 === y2 ? x1 : x1 + ((y - y1) / (y2 - y1)) * (x2 - x1);
          lo = Math.min(lo, x); hi = Math.max(hi, x);
        }
      }
      for (let x = Math.ceil(lo); x <= Math.floor(hi); x++) setPx(x, y, c);
    }
  };

  // Vertical layout: the head sits a little above center, like a selfie, with the body filling the bottom.
  const DY = 220;

  // Misty sky-to-floor gradient.
  const groundY = 286 + DY;
  for (let y = 0; y < HEIGHT; y++) {
    const ly = y / S;
    const c = ly < groundY ? mix(FOG_TOP, FOG_LOW, ly / groundY) : mix(GROUND, GROUND_DARK, (ly - groundY) / (LH - groundY));
    for (let x = 0; x < WIDTH; x++) setPx(x, y, c);
  }
  // Pine trunks, far ones washed out by fog.
  for (const [tx, w, depth] of TREES) {
    const c = mix(TRUNK, FOG_LOW, depth * 0.8);
    const base = groundY + (1 - depth) * 30;
    rect(tx - w / 2, 0, w, base, c);
    if (depth < 0.5) rect(tx + w / 2 - 3, 0, 3, base, mix(c, [0, 0, 0], 0.25));
  }
  // Forest-floor needles.
  for (let i = 0; i < 90; i++) {
    const x = (i * 97) % LW, y = groundY + ((i * 53) % (LH - groundY));
    rect(x, y, 5, 1, i % 3 ? GROUND_DARK : [140, 96, 58]);
  }

  // Argos bobs slightly as if breathing; a little more while speaking.
  const cx = LW / 2;
  const cy = 172 + DY + Math.round(2 * Math.sin(tick * 0.1) + (speaking ? 1.2 * Math.sin(tick * 0.9) : 0));

  // A sitting hound seen from the front: cape over the back, folded hind legs, deep chest, front legs.
  const paw = LH - 46;
  poly([[cx - 70, cy + 96], [cx + 70, cy + 96], [cx + 128, paw - 30], [cx - 128, paw - 30]], CLOAK_DARK);
  for (let i = 0; i <= 16; i++) ellipse(cx - 128 + i * 16, paw - 30, 7, 6, mix(FUR, CLOAK, 0.5));
  for (const side of [-1, 1]) {
    ellipse(cx + side * 92, paw - 44, 50, 66, COAT_DARK); // haunch
    ellipse(cx + side * 120, paw + 4, 28, 12, MUZZLE_SHADE); // hind paw
  }
  ellipse(cx, cy + 190, 80, 140, COAT, (y) => y < paw); // chest and belly
  ellipse(cx, cy + 170, 42, 96, mix(COAT, MUZZLE, 0.45), (y) => y < paw); // pale chest fur
  for (const side of [-1, 1]) {
    const lx = cx + side * 38;
    rect(lx - 14, cy + 220, 28, paw - (cy + 220), COAT);
    rect(lx + side * 8, cy + 220, 6, paw - (cy + 220), COAT_DARK);
    ellipse(lx, paw, 21, 11, MUZZLE);
    for (const t of [-7, 0, 7]) rect(lx + t, paw - 2, 1, 9, MUZZLE_SHADE);
  }

  // Leather barding: a shield-shaped breastplate with a bronze rim and boss, strapped round the chest.
  for (const side of [-1, 1]) rect(side < 0 ? cx - 80 : cx + 54, cy + 132, 26, 9, STRAP);
  poly([[cx - 60, cy + 104], [cx + 60, cy + 104], [cx + 54, cy + 202], [cx, cy + 242], [cx - 54, cy + 202]], BRONZE_DARK);
  poly([[cx - 55, cy + 109], [cx + 55, cy + 109], [cx + 49, cy + 199], [cx, cy + 234], [cx - 49, cy + 199]], LEATHER);
  ellipse(cx, cy + 162, 18, 18, BRONZE_DARK);
  ellipse(cx, cy + 162, 15, 15, BRONZE);
  ellipse(cx, cy + 162, 6, 6, BRONZE_DARK);
  ellipse(cx - 5, cy + 156, 3, 2, BRONZE_LIGHT);
  for (const [x, y] of [[-42, 120], [42, 120], [-38, 194], [38, 194], [0, 222]]) ellipse(cx + x, cy + y, 2, 2, BRONZE);

  // Shaggy ruff of fur around the neck, with the bronze collar.
  ellipse(cx, cy + 74, 64, 40, COAT_DARK);
  for (let i = 0; i < 13; i++) poly([[cx - 60 + i * 10, cy + 100], [cx - 50 + i * 10, cy + 100], [cx - 55 + i * 10, cy + 114]], COAT_DARK);
  rect(cx - 46, cy + 80, 92, 10, BRONZE_DARK);
  rect(cx - 46, cy + 81, 92, 4, BRONZE);
  ellipse(cx, cy + 96, 9, 9, BRONZE_DARK);
  ellipse(cx, cy + 96, 7, 7, BRONZE);
  ellipse(cx - 2, cy + 94, 2, 2, BRONZE_LIGHT);

  // Long floppy ears hanging from under the helmet; they swing gently, a bit more while talking.
  const earSwing = 3 * Math.sin(tick * 0.12) + (speaking ? 2 * Math.sin(tick * 0.7) : 0);
  for (const side of [-1, 1]) {
    const ex = cx + side * (56 + earSwing * side * 0.5);
    ellipse(ex, cy + 36, 25, 62, EAR);
    ellipse(ex + side * 5, cy + 44, 15, 48, mix(EAR, COAT_DARK, 0.4));
  }

  // Head: broad skull, cheeks tapering into a big muzzle.
  ellipse(cx, cy - 2, 58, 54, COAT);
  ellipse(cx, cy + 26, 48, 34, COAT);
  for (let i = 0; i < 70; i++) { // grizzled fur: Argos is an old dog
    const a = i * 2.399, r = 30 + ((i * 37) % 26);
    const x = cx + Math.cos(a) * r, y = cy + 10 + Math.sin(a) * r * 0.8;
    if (Math.abs(x - cx) > 24) dot(x, y, i % 2 ? GRIZZLE : COAT_DARK);
  }
  ellipse(cx, cy + 6, 13, 34, mix(COAT, MUZZLE, 0.6)); // blaze up the snout

  // Mouth: the jaw drops while speaking and the tongue hangs out, panting.
  const open = speaking ? 2 + 11 * Math.abs(Math.sin(tick * 0.8)) * (0.6 + 0.4 * Math.abs(Math.sin(tick * 0.31))) : 0;
  ellipse(cx, cy + 72 + open, 18, 8, MUZZLE_SHADE); // chin
  if (open > 1) {
    ellipse(cx, cy + 66 + open / 2, 20, open / 2 + 5, MOUTH);
    ellipse(cx, cy + 74 + open, 11, 8 + open * 0.7, TONGUE, (y) => y > cy + 62);
    rect(cx - 0.5, cy + 68, 1, 6 + open, TONGUE_DARK);
  }
  // Muzzle with droopy jowls on each side.
  ellipse(cx, cy + 44, 34, 26, MUZZLE);
  for (const side of [-1, 1]) {
    ellipse(cx + side * 15, cy + 64, 17, 10, MUZZLE_SHADE);
    ellipse(cx + side * 15, cy + 60, 17, 10, MUZZLE);
  }
  for (let i = 0; i < 26; i++) { // whisker spots and gray hairs
    const side = i % 2 ? 1 : -1;
    dot(cx + side * (12 + ((i * 7) % 18)), cy + 46 + ((i * 5) % 16), i % 3 ? GRIZZLE : MUZZLE_SHADE);
  }
  rect(cx - 0.5, cy + 44, 1, 22, MUZZLE_SHADE);
  // Big wet nose.
  ellipse(cx, cy + 36, 18, 12, NOSE);
  ellipse(cx - 7, cy + 39, 4, 3, [8, 6, 6]);
  ellipse(cx + 7, cy + 39, 4, 3, [8, 6, 6]);
  ellipse(cx - 5, cy + 30, 6, 2.5, [104, 98, 96]);

  // Eyes: dark and soulful, set wide. Blink every ~4 s, slow glance. Tan brow spots lift while speaking.
  const blink = tick % 60 < 3;
  const glance = Math.round(2 * Math.sin(tick * 0.04));
  const lift = speaking ? Math.round(2 * Math.abs(Math.sin(tick * 0.5))) : 0;
  for (const side of [-1, 1]) {
    const ex = cx + side * 28, ey = cy - 4;
    ellipse(ex, ey, 11, 9, COAT_DARK);
    ellipse(ex + side * 2, ey - 12 - lift, 5, 3, MUZZLE);
    if (blink) {
      rect(ex - 9, ey, 18, 2.5, NOSE);
    } else {
      ellipse(ex, ey, 8, 7.5, EYE_DARK);
      ellipse(ex + glance, ey, 6, 6, IRIS);
      ellipse(ex + glance, ey, 4.5, 4.5, EYE_DARK);
      ellipse(ex + glance + 2, ey - 2, 2, 2, EYE_SHINE);
    }
  }

  // Iron crested helmet sized for a dog: dome, brow rim, short guards over the base of the ears.
  const hy = cy - 32;
  ellipse(cx, hy, 66, 52, IRON, (y) => y < hy + 12);
  ellipse(cx - 22, hy - 26, 22, 12, IRON_LIGHT, (y) => y < hy + 12);
  for (const side of [-1, 1]) {
    poly([[cx + side * 66, hy + 4], [cx + side * 50, hy + 12], [cx + side * 56, cy + 2], [cx + side * 70, cy - 2]], IRON);
    poly([[cx + side * 66, hy + 4], [cx + side * 62, hy + 10], [cx + side * 66, cy], [cx + side * 70, cy - 2]], IRON_LIGHT);
  }
  rect(cx - 64, hy + 8, 128, 7, IRON_DARK);
  for (let x = -54; x <= 54; x += 12) ellipse(cx + x, hy + 11.5, 1.5, 1.5, IRON_LIGHT); // rivets

  // Tall red crest, swaying.
  const sway = Math.round(2.5 * Math.sin(tick * 0.15));
  rect(cx - 12, hy - 66, 24, 10, IRON_DARK);
  ellipse(cx + sway, hy - 88, 22, 30, CREST, (y) => y < hy - 62);
  for (let s = -16; s <= 16; s += 5) rect(cx + sway + s, hy - 116, 2, 54, CREST_DARK);
  ellipse(cx + sway, hy - 88, 22, 30, CREST, (y) => y < hy - 110);

  // Drifting fog in front of everything (always moving, so a frozen picture is easy to spot).
  const fogMid = 270 + DY;
  for (let y = Math.floor((fogMid - 70) * S); y < HEIGHT; y++) {
    const ly = y / S;
    const band = Math.max(0, 1 - Math.abs(ly - fogMid) / 70);
    if (band <= 0) continue;
    for (let x = 0; x < WIDTH; x++) {
      const f = 0.5 + 0.5 * Math.sin((x / S) * 0.012 + tick * 0.05 + Math.sin(ly * 0.03) * 1.5);
      const k = 0.28 * f * band;
      if (k > 0.01) setPx(x, y, mix(getPx(x, y), [196, 198, 192], k));
    }
  }

  return px;
}
