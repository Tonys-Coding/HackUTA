// Argos, the loyal hound of Odysseus: an old, scruffy brown dog sitting on a marble terrace on Ithaca at
// sunset, beside broken columns, above the wine-dark sea where a ship sails home. He wears a
// crested iron helmet, a leather breastplate, a cape and a bronze collar. He tilts his head, wags his
// tail and pants while he talks. Same contract as Chert's example: drawFace(tick, speaking) returns one
// WIDTH x HEIGHT RGBA frame. No dependencies.
//
// Portrait at the iPhone screen shape (about 9:19.5) on purpose: FaceTime on a phone held upright shows
// the remote video as a portrait window, so a landscape frame gets letterboxed into a strip. A portrait
// frame fills the screen like a real caller's camera does. Scene coordinates live in a 360 x 780
// logical space, scaled by S to pixels.
//
// Chert's "Fill" video framing crops the middle of the frame: measured on an iPhone call, only about the
// central 54% of the width and height stays on screen. So the whole scene is drawn shrunk by VIEW into
// that middle area, and the sky, sea and terrace keep going outward to fill the rest of the frame.
// If you switch Chert back to "Fit", set VIEW to 1.
const LW = 360;
const LH = 780;
const S = 1.5;
export const WIDTH = LW * S; // 540
export const HEIGHT = LH * S; // 1170
/** 8fps leaves headroom for STT/VAD on one Mac core; 12–15+ logged "VAD slower than realtime". */
export const FPS = 8;

const SKY_TOP = [46, 58, 104];
const SKY_MID = [178, 108, 112];
const SKY_LOW = [246, 178, 110];
const SUN = [255, 226, 160];
const SUN_GLOW = [252, 200, 128];
const CLOUD = [236, 160, 132];
const CLOUD_SHADE = [176, 112, 118];
const HILLS_FAR = [118, 86, 112];
const HILLS_NEAR = [84, 60, 88];
const SEA_TOP = [92, 46, 78];
const SEA_LOW = [48, 26, 58];
const GLINT = [255, 202, 140];
const HULL = [44, 28, 24];
const SAIL = [226, 204, 168];
const SAIL_STRIPE = [168, 54, 44];
const MARBLE = [214, 200, 178];
const MARBLE_SHADE = [168, 150, 130];
const MARBLE_DARK = [128, 112, 96];
const STONE = [178, 160, 134];
const STONE_DARK = [140, 122, 100];
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
const STRAP = [110, 70, 40];
const CLOAK = [150, 30, 32];
const CLOAK_DARK = [108, 18, 22];
const FUR = [150, 132, 106];

const mix = (a, b, k) => [0, 1, 2].map((j) => Math.round(a[j] + (b[j] - a[j]) * k));

// Scene layout in logical coordinates.
const HORIZON = 440;
const TERRACE = 568;

// Scene scale on the frame, and the scene height that lands at the frame's vertical center.
const VIEW = 0.52;
const FOCUS_Y = 440; // a little below the middle: the sky above Argos is mostly empty

// 2D affine transforms: X = a*x + c*y + e, Y = b*x + d*y + f.
const compose = (p, q) => ({
  a: p.a * q.a + p.c * q.b, b: p.b * q.a + p.d * q.b,
  c: p.a * q.c + p.c * q.d, d: p.b * q.c + p.d * q.d,
  e: p.a * q.e + p.c * q.f + p.e, f: p.b * q.e + p.d * q.f + p.f,
});
// Scale by k and rotate by theta around the point (px, py).
const around = (px, py, k, theta) => {
  const a = k * Math.cos(theta), b = k * Math.sin(theta), c = -b, d = a;
  return { a, b, c, d, e: px - a * px - c * py, f: py - b * px - d * py };
};

export function drawFace(tick, speaking) {
  const px = new Uint8Array(WIDTH * HEIGHT * 4);
  const setPx = (x, y, c) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const i = (y * WIDTH + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  };

  // Shapes take local logical coordinates; the current transform T maps them onto the canvas.
  let T = { a: VIEW, b: 0, c: 0, d: VIEW, e: (LW / 2) * (1 - VIEW), f: LH / 2 - VIEW * FOCUS_Y };
  const withT = (t, draw) => { const prev = T; T = compose(prev, t); draw(); T = prev; };
  const toPx = (x, y) => [(T.a * x + T.c * y + T.e) * S, (T.b * x + T.d * y + T.f) * S];

  // Filled convex polygon via scanline, in pixel space after transforming the points.
  const poly = (lpts, c) => {
    const pts = lpts.map(([x, y]) => toPx(x, y));
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
  const rect = (x0, y0, w, h, c) => poly([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], c);
  const dot = (x, y, c) => rect(Math.round(x), Math.round(y), 1, 1, c);
  // Ellipse: test each pixel in the transformed bounding box against the local shape.
  // `clip` receives the local y of the point.
  const ellipse = (cx, cy, rx, ry, c, clip) => {
    const corners = [[cx - rx, cy - ry], [cx + rx, cy - ry], [cx + rx, cy + ry], [cx - rx, cy + ry]].map(([x, y]) => toPx(x, y));
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
    const det = T.a * T.d - T.b * T.c;
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(HEIGHT - 1, Math.ceil(Math.max(...ys))); y++) {
      const Y = (y + 0.5) / S - T.f;
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(WIDTH - 1, Math.ceil(Math.max(...xs))); x++) {
        const X = (x + 0.5) / S - T.e;
        const lx = (T.d * X - T.c * Y) / det, ly = (-T.b * X + T.a * Y) / det;
        if (((lx - cx) / rx) ** 2 + ((ly - cy) / ry) ** 2 > 1) continue;
        if (clip && !clip(ly)) continue;
        setPx(x, y, c);
      }
    }
  };

  const DY = 220;

  // Sky, sea and terrace bands, row by row across the whole frame (they continue past the scene's edges).
  // Sunset sky: deep blue overhead fading through rose to gold at the horizon. Then the wine-dark sea,
  // then the stone terrace where Argos sits.
  for (let y = 0; y < HEIGHT; y++) {
    const ly = ((y + 0.5) / S - T.f) / T.d;
    let c;
    if (ly < HORIZON) {
      const t = Math.max(0, ly / HORIZON);
      c = t < 0.55 ? mix(SKY_TOP, SKY_MID, t / 0.55) : mix(SKY_MID, SKY_LOW, (t - 0.55) / 0.45);
    } else if (ly < TERRACE) {
      c = mix(SEA_TOP, SEA_LOW, (ly - HORIZON) / (TERRACE - HORIZON));
    } else {
      c = mix(STONE, STONE_DARK, Math.min(1, (ly - TERRACE) / (LH - TERRACE)));
    }
    for (let x = 0; x < WIDTH; x++) setPx(x, y, c);
  }
  // Setting sun with a soft glow, low on the right.
  const sunX = 300, sunY = HORIZON - 44;
  ellipse(sunX, sunY, 46, 40, mix(SKY_LOW, SUN_GLOW, 0.5), (y) => y < HORIZON);
  ellipse(sunX, sunY, 32, 28, SUN_GLOW);
  ellipse(sunX, sunY, 22, 22, SUN);
  // Long sunset clouds drifting slowly (wrapping around the frame).
  for (const [y, w, speed, off] of [[96, 120, 0.12, 0], [150, 90, 0.08, 170], [228, 140, 0.1, 60], [310, 80, 0.15, 250]]) {
    const x = ((off + tick * speed) % (LW + w * 2)) - w;
    ellipse(x, y + 4, w * 0.5, 9, CLOUD_SHADE);
    ellipse(x - w * 0.12, y, w * 0.42, 8, CLOUD);
    ellipse(x + w * 0.18, y - 3, w * 0.24, 7, CLOUD);
  }
  // Hills of Ithaca on the horizon.
  poly([[-10, HORIZON], [20, HORIZON - 34], [70, HORIZON - 52], [120, HORIZON - 30], [160, HORIZON]], HILLS_FAR);
  poly([[-10, HORIZON], [10, HORIZON - 18], [50, HORIZON - 26], [96, HORIZON]], HILLS_NEAR);
  poly([[300, HORIZON], [330, HORIZON - 18], [370, HORIZON - 12], [370, HORIZON]], HILLS_FAR);

  // Glints on the water: a golden path under the sun and scattered sparkles, always moving.
  for (let i = 0; i < 70; i++) {
    const y = HORIZON + 3 + ((i * 37) % (TERRACE - HORIZON - 6));
    const nearSun = i % 2 === 0;
    const spread = 14 + (y - HORIZON) * 0.5;
    const x = nearSun
      ? sunX + Math.sin(i * 1.7 + tick * 0.2) * spread
      : (i * 53 + tick * (0.6 + (i % 3) * 0.3)) % (LW + 20) - 10;
    const len = 3 + (i % 4) * 2 + (y - HORIZON) * 0.05;
    rect(x, y, len, 1, nearSun ? GLINT : mix(SEA_TOP, GLINT, 0.45));
  }
  // Odysseus' ship sailing home along the horizon.
  const shipX = ((tick * 0.35 + 40) % (LW + 120)) - 60, shipY = HORIZON + 14;
  poly([[shipX - 24, shipY - 6], [shipX + 24, shipY - 6], [shipX + 17, shipY + 2], [shipX - 17, shipY + 2]], HULL);
  poly([[shipX + 22, shipY - 6], [shipX + 28, shipY - 14], [shipX + 25, shipY - 6]], HULL); // curved prow
  rect(shipX - 0.75, shipY - 38, 1.5, 32, HULL);
  rect(shipX - 14, shipY - 36, 28, 22, SAIL);
  rect(shipX - 14, shipY - 28, 28, 5, SAIL_STRIPE);
  for (let o = -16; o <= 12; o += 7) rect(shipX + o, shipY + 1, 1, 6, HULL); // oars

  // Marble terrace ledge and stone slabs, extended well past the scene's sides and bottom.
  rect(-LW, TERRACE, LW * 3, 10, MARBLE);
  rect(-LW, TERRACE + 10, LW * 3, 3, MARBLE_DARK);
  for (let row = 0, y = TERRACE + 13; y < LH * 2; row++) {
    const h = 22 + row * 10;
    rect(-LW, y + h - 1.5, LW * 3, 1.5, STONE_DARK);
    for (let x = (row % 2) * 40 - 10 - LW; x < LW * 2; x += 80) rect(x, y, 1.5, h, STONE_DARK);
    y += h;
  }

  // Broken Doric columns framing the scene.
  const column = (x0, w, top, broken) => {
    rect(x0, top, w, TERRACE - top, MARBLE);
    for (let f = x0 + 4; f < x0 + w - 2; f += 7) rect(f, top, 2, TERRACE - top, MARBLE_SHADE); // fluting
    rect(x0 + w - 5, top, 5, TERRACE - top, MARBLE_SHADE);
    rect(x0 - 5, TERRACE - 10, w + 10, 10, MARBLE_SHADE); // base
    if (broken) {
      poly([[x0, top], [x0 + w * 0.3, top - 10], [x0 + w * 0.55, top - 3], [x0 + w * 0.8, top - 14], [x0 + w, top - 4], [x0 + w, top + 2], [x0, top + 2]], MARBLE);
    } else {
      rect(x0 - 6, top - 10, w + 12, 10, MARBLE); // capital
      rect(x0 - 2, top - 3, w + 4, 3, MARBLE_SHADE);
      rect(x0 - 8, top - 20, w + 16, 10, MARBLE_SHADE); // abacus
    }
  };
  column(-6, 40, 150, false);
  column(318, 36, 260, true);
  // A fallen drum of a column on the terrace.
  ellipse(334, TERRACE + 22, 22, 12, MARBLE_SHADE);
  ellipse(334, TERRACE + 19, 22, 11, MARBLE);

  // Soft shadow where Argos sits.
  ellipse(LW / 2, LH - 30, 150, 18, STONE_DARK);

  // Argos breathes (a little faster while panting/talking). cx, cy is the center of his head.
  const cx = LW / 2;
  const cy = 172 + DY + Math.round(2 * Math.sin(tick * 0.1) + (speaking ? 1.2 * Math.sin(tick * 0.9) : 0));
  const paw = LH - 46;

  // The whole dog is drawn 1.22x bigger, anchored at his paws, so he fills the portrait frame.
  withT(around(cx, paw + 12, 1.22, 0), () => {
    // Cape hanging behind him, with a fur trim.
    poly([[cx - 70, cy + 96], [cx + 70, cy + 96], [cx + 128, paw - 30], [cx - 128, paw - 30]], CLOAK);
    for (const side of [-1, 1]) { // folds in the red cloth
      poly([[cx + side * 58, cy + 110], [cx + side * 64, cy + 110], [cx + side * 112, paw - 30], [cx + side * 100, paw - 30]], CLOAK_DARK);
      poly([[cx + side * 30, cy + 110], [cx + side * 34, cy + 110], [cx + side * 64, paw - 30], [cx + side * 56, paw - 30]], CLOAK_DARK);
    }
    for (let i = 0; i <= 16; i++) ellipse(cx - 128 + i * 16, paw - 30, 7, 6, BRONZE); // gold trim

    // Folded hind legs: compact haunches tucked beside the chest, back paws resting just outside the front ones.
    for (const side of [-1, 1]) {
      ellipse(cx + side * 64, paw - 34, 34, 42, COAT_DARK); // thigh
      ellipse(cx + side * 60, paw - 40, 26, 32, mix(COAT_DARK, COAT, 0.5)); // thigh highlight
      poly([[cx + side * 76, paw - 14], [cx + side * 92, paw - 14], [cx + side * 94, paw], [cx + side * 74, paw]], COAT_DARK); // hock
      ellipse(cx + side * 84, paw + 3, 15, 8, MUZZLE_SHADE); // back paw
      for (const t of [-6, 0, 6]) rect(cx + side * 84 + t - 0.5, paw + 1, 1, 7, COAT_DARK);
    }

    // Tail: rises from behind his right haunch, curls up and wags, faster while he talks.
    const wag = Math.sin(tick * (speaking ? 0.9 : 0.35)) * 0.4;
    let tx = cx + 92, ty = paw - 62, dir = -Math.PI / 2 + 0.55 + wag;
    const tail = [];
    for (let i = 0; i < 24; i++) {
      tail.push([tx, ty, 10 - i * 0.25, i > 19]);
      tx += Math.cos(dir) * 4; ty += Math.sin(dir) * 4; dir -= 0.04;
    }
    for (const [x, y, r] of tail) ellipse(x, y, r + 1.5, r + 1.5, COAT_DARK); // outline first,
    for (const [x, y, r, tip] of tail) ellipse(x, y, r, r, tip ? MUZZLE : COAT); // then one smooth fill
    // Deep chest and belly with pale fur down the front.
    ellipse(cx, cy + 190, 80, 140, COAT, (y) => y < paw);
    ellipse(cx, cy + 170, 42, 96, mix(COAT, MUZZLE, 0.45), (y) => y < paw);
    // Front legs: rounded elbows, tapering legs, paws with toes.
    for (const side of [-1, 1]) {
      const lx = cx + side * 36;
      poly([[lx - 17, cy + 214], [lx + 17, cy + 214], [lx + 13, paw - 2], [lx - 13, paw - 2]], COAT);
      poly([[lx + side * 9, cy + 214], [lx + side * 17, cy + 214], [lx + side * 13, paw - 2], [lx + side * 7, paw - 2]], COAT_DARK);
      ellipse(lx + side * 4, cy + 222, 19, 15, COAT);
      ellipse(lx, paw + 2, 20, 10, MUZZLE);
      for (const t of [-12, -4, 4, 12]) ellipse(lx + t, paw + 6, 5.5, 5, MUZZLE);
      for (const t of [-8, 0, 8]) rect(lx + t - 0.5, paw + 2, 1, 9, MUZZLE_SHADE);
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

    // Shaggy ruff of fur around the neck, with the bronze collar and medallion.
    ellipse(cx, cy + 74, 64, 40, COAT_DARK);
    for (let i = 0; i < 13; i++) poly([[cx - 60 + i * 10, cy + 100], [cx - 50 + i * 10, cy + 100], [cx - 55 + i * 10, cy + 114]], COAT_DARK);
    rect(cx - 46, cy + 80, 92, 10, BRONZE_DARK);
    rect(cx - 46, cy + 81, 92, 4, BRONZE);
    ellipse(cx, cy + 96, 9, 9, BRONZE_DARK);
    ellipse(cx, cy + 96, 7, 7, BRONZE);
    ellipse(cx - 2, cy + 94, 2, 2, BRONZE_LIGHT);

    // The head tilts slowly side to side, the curious way dogs do, pivoting at the neck.
    const tilt = 0.1 * Math.sin(tick * 0.045);
    withT(around(cx, cy + 70, 1, tilt), () => drawHead(cx, cy));
  });

  function drawHead(cx, cy) {
    // Long floppy ears hanging from under the helmet; they swing, a bit more while talking.
    const earSwing = 3 * Math.sin(tick * 0.12) + (speaking ? 2 * Math.sin(tick * 0.7) : 0);
    for (const side of [-1, 1]) {
      const ex = cx + side * (56 + earSwing * side * 0.5);
      ellipse(ex, cy + 36, 25, 62, EAR);
      ellipse(ex + side * 5, cy + 44, 15, 48, mix(EAR, COAT_DARK, 0.4));
    }

    // Broad skull, cheeks tapering into a big muzzle.
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

    // Iron crested helmet sized for a dog: dome, brow rim with rivets, short guards over the ears.
    const hy = cy - 32;
    ellipse(cx, hy, 66, 52, IRON, (y) => y < hy + 12);
    ellipse(cx - 22, hy - 26, 22, 12, IRON_LIGHT, (y) => y < hy + 12);
    for (const side of [-1, 1]) {
      poly([[cx + side * 66, hy + 4], [cx + side * 50, hy + 12], [cx + side * 56, cy + 2], [cx + side * 70, cy - 2]], IRON);
      poly([[cx + side * 66, hy + 4], [cx + side * 62, hy + 10], [cx + side * 66, cy], [cx + side * 70, cy - 2]], IRON_LIGHT);
    }
    rect(cx - 64, hy + 8, 128, 7, IRON_DARK);
    for (let x = -54; x <= 54; x += 12) ellipse(cx + x, hy + 11.5, 1.5, 1.5, IRON_LIGHT);

    // Tall red crest, swaying.
    const sway = Math.round(2.5 * Math.sin(tick * 0.15));
    rect(cx - 12, hy - 66, 24, 10, IRON_DARK);
    ellipse(cx + sway, hy - 88, 22, 30, CREST, (y) => y < hy - 62);
    for (let s = -16; s <= 16; s += 5) rect(cx + sway + s, hy - 116, 2, 54, CREST_DARK);
    ellipse(cx + sway, hy - 88, 22, 30, CREST, (y) => y < hy - 110);
  }

  return px;
}
