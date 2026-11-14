// Odyssey-themed avatar: a battle-worn Greek warrior in a dark iron crested helmet, leather armor and
// a cloak, standing in a misty pine forest. Same contract as Chert's example: drawFace(tick, speaking)
// returns one WIDTH x HEIGHT RGBA frame. No dependencies.
export const WIDTH = 640;
export const HEIGHT = 360;
export const FPS = 15;

const FOG_TOP = [168, 172, 166];
const FOG_LOW = [122, 118, 104];
const GROUND = [112, 74, 46];
const GROUND_DARK = [84, 54, 34];
const TRUNK = [58, 48, 40];
const SKIN = [204, 152, 112];
const SKIN_SHADE = [168, 118, 84];
const BEARD = [52, 40, 32];
const BEARD_GRAY = [104, 94, 86];
const LIPS = [140, 80, 66];
const MOUTH = [36, 14, 12];
const TEETH = [228, 218, 198];
const EYE_WHITE = [236, 230, 218];
const IRIS = [76, 50, 32];
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

// Pine trunks: x position, width, depth (0 = near, 1 = far, fades into fog).
const TREES = [
  [18, 26, 0.15], [92, 12, 0.7], [140, 18, 0.45], [196, 9, 0.85], [236, 14, 0.6],
  [384, 10, 0.8], [430, 20, 0.4], [492, 12, 0.7], [548, 28, 0.2], [606, 16, 0.55],
];

export function drawFace(tick, speaking) {
  const px = new Uint8Array(WIDTH * HEIGHT * 4);
  const set = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const i = (y * WIDTH + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  };
  const get = (x, y) => {
    const i = (y * WIDTH + x) * 4;
    return [px[i], px[i + 1], px[i + 2]];
  };
  const ellipse = (cx, cy, rx, ry, c, clip) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      if (clip && !clip(y)) continue;
      const t = 1 - ((y - cy) / ry) ** 2;
      if (t < 0) continue;
      const half = rx * Math.sqrt(t);
      for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x++) set(x, y, c);
    }
  };
  const rect = (x0, y0, w, h, c) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) set(x, y, c);
  };
  // Filled convex polygon via scanline.
  const poly = (pts, c) => {
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
      for (let x = Math.ceil(lo); x <= Math.floor(hi); x++) set(x, y, c);
    }
  };

  // Misty sky-to-floor gradient.
  const groundY = 286;
  for (let y = 0; y < HEIGHT; y++) {
    const c = y < groundY ? mix(FOG_TOP, FOG_LOW, y / groundY) : mix(GROUND, GROUND_DARK, (y - groundY) / (HEIGHT - groundY));
    for (let x = 0; x < WIDTH; x++) set(x, y, c);
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
    const x = (i * 97) % WIDTH, y = groundY + ((i * 53) % (HEIGHT - groundY));
    rect(x, y, 5, 1, i % 3 ? GROUND_DARK : [140, 96, 58]);
  }

  // Warrior bobs slightly as if breathing; a little more while speaking.
  const cx = 320;
  const cy = 172 + Math.round(2 * Math.sin(tick * 0.1) + (speaking ? 1.2 * Math.sin(tick * 0.9) : 0));

  // Cloak behind the shoulders.
  poly([[cx - 150, HEIGHT], [cx - 120, cy + 92], [cx + 120, cy + 92], [cx + 150, HEIGHT]], CLOAK_DARK);
  // Leather cuirass.
  poly([[cx - 92, HEIGHT], [cx - 98, cy + 108], [cx + 98, cy + 108], [cx + 92, HEIGHT]], LEATHER);
  // Chest plate ridges.
  ellipse(cx - 36, cy + 150, 34, 26, LEATHER_LIGHT, (y) => y < cy + 160);
  ellipse(cx + 36, cy + 150, 34, 26, LEATHER_LIGHT, (y) => y < cy + 160);
  ellipse(cx - 36, cy + 154, 30, 22, LEATHER);
  ellipse(cx + 36, cy + 154, 30, 22, LEATHER);
  // Shoulder guards.
  ellipse(cx - 104, cy + 112, 40, 24, LEATHER_LIGHT);
  ellipse(cx + 104, cy + 112, 40, 24, LEATHER_LIGHT);
  ellipse(cx - 104, cy + 116, 36, 18, LEATHER);
  ellipse(cx + 104, cy + 116, 36, 18, LEATHER);
  // Diagonal baldric strap.
  poly([[cx + 70, cy + 100], [cx + 94, cy + 100], [cx - 56, HEIGHT], [cx - 80, HEIGHT]], STRAP);
  // Cloak draped over the left shoulder with a fur trim.
  poly([[cx - 150, HEIGHT], [cx - 140, cy + 96], [cx - 60, cy + 92], [cx - 84, HEIGHT]], CLOAK);
  ellipse(cx - 104, cy + 98, 44, 10, mix(FUR, CLOAK, 0.5));
  for (let i = 0; i < 8; i++) ellipse(cx - 142 + i * 11, cy + 104, 4, 6, mix(FUR, CLOAK, 0.5));

  // Neck.
  rect(cx - 28, cy + 50, 56, 56, SKIN_SHADE);

  // Head.
  ellipse(cx, cy + 6, 58, 74, SKIN);

  // Short dark beard with gray flecks.
  ellipse(cx, cy + 40, 60, 54, BEARD, (y) => y > cy + 10);
  for (let i = 0; i < 40; i++) {
    const a = (i * 2.399) % Math.PI, r = 18 + ((i * 37) % 36);
    set(cx + Math.cos(a) * r, cy + 42 + Math.sin(a) * r * 0.85, BEARD_GRAY);
    set(cx + Math.cos(a) * r + 1, cy + 42 + Math.sin(a) * r * 0.85, BEARD_GRAY);
  }
  // Cheeks above the beard line.
  ellipse(cx, cy + 12, 44, 22, SKIN, (y) => y < cy + 26);

  // Mouth.
  const open = speaking ? 3 + 10 * Math.abs(Math.sin(tick * 0.8)) * (0.6 + 0.4 * Math.abs(Math.sin(tick * 0.31))) : 1.5;
  ellipse(cx, cy + 50, 22, open + 5, LIPS);
  ellipse(cx, cy + 50, 17, open, MOUTH);
  if (open > 6) rect(cx - 11, cy + 50 - open + 1, 22, 3, TEETH);
  // Moustache.
  ellipse(cx - 15, cy + 38, 19, 7, BEARD);
  ellipse(cx + 15, cy + 38, 19, 7, BEARD);

  // Nose.
  ellipse(cx, cy + 18, 9, 16, SKIN_SHADE);
  ellipse(cx - 1, cy + 14, 6, 14, SKIN);

  // Eyes: blink every ~4 s, slow glance.
  const blink = tick % 60 < 3;
  const glance = Math.round(3 * Math.sin(tick * 0.04));
  for (const side of [-1, 1]) {
    const ex = cx + side * 24, ey = cy - 2;
    if (blink) {
      rect(ex - 11, ey, 22, 3, BEARD);
    } else {
      ellipse(ex, ey, 11, 7, EYE_WHITE);
      ellipse(ex + glance, ey, 5, 6, IRIS);
      ellipse(ex + glance, ey, 2.5, 2.5, [14, 10, 8]);
      ellipse(ex + glance + 2, ey - 2, 1.2, 1.2, EYE_WHITE);
    }
    // Heavy, stern brows angled down toward the nose; lift a bit while speaking.
    const lift = speaking ? Math.round(2 * Math.abs(Math.sin(tick * 0.5))) : 0;
    for (let k = 0; k < 26; k++) {
      const toward = side === -1 ? k : 25 - k;
      rect(ex - 13 + k, ey - 14 - lift + Math.round(toward * 0.07), 1, 5, BEARD);
    }
  }

  // Corinthian iron helmet: dome, brow rim, cheek guards framing the face.
  const hy = cy - 30;
  ellipse(cx, hy, 70, 60, IRON, (y) => y < hy + 12);
  ellipse(cx - 24, hy - 30, 24, 14, IRON_LIGHT, (y) => y < hy + 12);
  for (const side of [-1, 1]) {
    poly([
      [cx + side * 70, hy + 4], [cx + side * 46, hy + 12],
      [cx + side * 50, cy + 44], [cx + side * 64, cy + 56], [cx + side * 72, cy + 30],
    ], IRON);
    poly([
      [cx + side * 70, hy + 4], [cx + side * 66, hy + 10],
      [cx + side * 66, cy + 40], [cx + side * 72, cy + 30],
    ], IRON_LIGHT);
  }
  rect(cx - 66, hy + 8, 132, 7, IRON_DARK);
  poly([[cx - 10, hy + 14], [cx + 10, hy + 14], [cx, hy + 22]], IRON_DARK);

  // Tall red crest, swaying.
  const sway = Math.round(2.5 * Math.sin(tick * 0.15));
  rect(cx - 12, hy - 66, 24, 10, IRON_DARK);
  ellipse(cx + sway, hy - 88, 22, 30, CREST, (y) => y < hy - 62);
  for (let s = -16; s <= 16; s += 5) rect(cx + sway + s, hy - 116, 2, 54, CREST_DARK);
  ellipse(cx + sway, hy - 88, 22, 30, CREST, (y) => y < hy - 110);

  // Drifting fog in front of everything (always moving, so a frozen picture is easy to spot).
  for (let y = 190; y < HEIGHT; y++) {
    const band = Math.max(0, 1 - Math.abs(y - 270) / 70);
    if (band <= 0) continue;
    for (let x = 0; x < WIDTH; x++) {
      const f = 0.5 + 0.5 * Math.sin(x * 0.012 + tick * 0.05 + Math.sin(y * 0.03) * 1.5);
      const k = 0.28 * f * band;
      if (k > 0.01) set(x, y, mix(get(x, y), [196, 198, 192], k));
    }
  }

  return px;
}
