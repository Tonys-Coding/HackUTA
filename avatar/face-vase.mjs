// Odyssey-themed avatar: a bearded Greek hero in a crested bronze helmet, framed like an ancient
// black-figure vase, with a ship sailing the wine-dark sea below. Same contract as Chert's example:
// drawFace(tick, speaking) returns one WIDTH x HEIGHT RGBA frame. No dependencies.
export const WIDTH = 640;
export const HEIGHT = 360;
export const FPS = 15;

const TERRACOTTA = [196, 98, 45];
const TERRACOTTA_DARK = [158, 72, 32];
const BLACK = [24, 16, 12];
const SKIN = [226, 168, 118];
const SKIN_SHADE = [196, 136, 92];
const BEARD = [74, 44, 28];
const BEARD_LIGHT = [104, 64, 40];
const LIPS = [150, 70, 60];
const MOUTH = [40, 12, 12];
const TEETH = [236, 226, 206];
const EYE_WHITE = [244, 238, 226];
const IRIS = [40, 74, 104];
const BRONZE = [208, 152, 62];
const BRONZE_LIGHT = [240, 196, 110];
const BRONZE_DARK = [140, 94, 34];
const CREST = [168, 30, 34];
const CREST_DARK = [118, 18, 24];
const SEA = [86, 22, 52];       // "wine-dark sea"
const SEA_DEEP = [58, 14, 38];
const FOAM = [232, 190, 150];

// Greek key (meander) tile, drawn in terracotta on the black border bands. 8x8 cells, scaled 3x.
const MEANDER = [
  'XXXXXXX.',
  'X.....X.',
  'X.XXX.X.',
  'X.X.X.X.',
  'X.X...X.',
  'X.XXXXX.',
  'X.......',
  'XXXXXXXX',
];
const KEY_SCALE = 3;
const BAND = 8 * KEY_SCALE; // 24px

export function drawFace(tick, speaking) {
  const px = new Uint8Array(WIDTH * HEIGHT * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const i = (y * WIDTH + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  };
  // Fill an ellipse, optionally only rows where clip(y) is true.
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

  // Background: terracotta with a soft darker vignette toward the edges.
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const d = ((x - WIDTH / 2) / (WIDTH * 0.62)) ** 2 + ((y - HEIGHT / 2) / (HEIGHT * 0.75)) ** 2;
      const k = Math.min(1, Math.max(0, d - 0.25));
      set(x, y, TERRACOTTA.map((v, j) => Math.round(v + (TERRACOTTA_DARK[j] - v) * k)));
    }
  }

  // Sun low on the horizon behind the hero.
  ellipse(500, 250, 46, 46, [226, 140, 60]);

  // Wine-dark sea with moving waves (always moving, so a frozen picture is easy to spot).
  const seaTop = 292;
  for (let x = 0; x < WIDTH; x++) {
    const wave = seaTop + 5 * Math.sin(x * 0.045 + tick * 0.18) + 3 * Math.sin(x * 0.11 - tick * 0.12);
    for (let y = Math.floor(wave); y < HEIGHT - BAND; y++) set(x, y, y > wave + 30 ? SEA_DEEP : SEA);
    set(x, Math.floor(wave), FOAM);
    set(x, Math.floor(wave) + 1, FOAM);
  }

  // A small black-figure ship sailing across the horizon.
  const shipX = ((tick * 1.2 + 220) % (WIDTH + 160)) - 80;
  const shipY = seaTop - 4 + 3 * Math.sin(shipX * 0.045 + tick * 0.18);
  ellipse(shipX, shipY, 34, 9, BLACK, (y) => y >= shipY);             // hull
  rect(shipX - 1, shipY - 34, 3, 34, BLACK);                           // mast
  rect(shipX - 16, shipY - 32, 32, 20, [236, 214, 180]);              // sail
  rect(shipX - 16, shipY - 32, 32, 3, BLACK);                          // yard
  for (let i = -24; i <= 20; i += 8) rect(shipX + i, shipY + 6, 2, 9, BLACK); // oars

  // The hero. Bobs gently like he's on deck; bobs a little more while speaking.
  const cx = 300;
  const cy = 182 + Math.round(3 * Math.sin(tick * 0.12) + (speaking ? 1.5 * Math.sin(tick * 0.9) : 0));

  // Shoulders and cloak (black-figure style) rising from the sea.
  ellipse(cx, cy + 150, 150, 80, BLACK);
  ellipse(cx, cy + 150, 120, 62, [44, 30, 22]);
  // Neck.
  rect(cx - 26, cy + 40, 52, 60, SKIN_SHADE);

  // Head.
  ellipse(cx, cy, 66, 80, SKIN);
  // Ears.
  ellipse(cx - 66, cy + 4, 9, 16, SKIN_SHADE);
  ellipse(cx + 66, cy + 4, 9, 16, SKIN_SHADE);

  // Beard: full and curly, covering the jaw.
  ellipse(cx, cy + 34, 72, 72, BEARD, (y) => y > cy + 2);
  for (let i = 0; i < 9; i++) {                                         // curls
    const a = (i / 8) * Math.PI;
    ellipse(cx + Math.cos(a) * 60, cy + 40 + Math.sin(a) * 52, 11, 11, BEARD_LIGHT);
    ellipse(cx + Math.cos(a) * 60, cy + 40 + Math.sin(a) * 52, 6, 6, BEARD);
  }
  // Cheeks above the beard line.
  ellipse(cx, cy + 6, 50, 26, SKIN, (y) => y < cy + 22);

  // Mouth: lips, then an opening that moves while speaking.
  const open = speaking ? 3 + 11 * Math.abs(Math.sin(tick * 0.8)) * (0.6 + 0.4 * Math.abs(Math.sin(tick * 0.31))) : 2;
  ellipse(cx, cy + 46, 26, open + 6, LIPS);
  ellipse(cx, cy + 46, 20, open, MOUTH);
  if (open > 6) rect(cx - 13, cy + 46 - open + 1, 26, 3, TEETH);
  // Moustache.
  ellipse(cx - 18, cy + 34, 22, 8, BEARD);
  ellipse(cx + 18, cy + 34, 22, 8, BEARD);

  // Nose.
  ellipse(cx, cy + 12, 10, 18, SKIN_SHADE);
  ellipse(cx, cy + 8, 7, 16, SKIN);

  // Eyes: blink every ~4 s, glance slowly side to side.
  const blink = tick % 60 < 3;
  const glance = Math.round(4 * Math.sin(tick * 0.04));
  for (const side of [-1, 1]) {
    const ex = cx + side * 28, ey = cy - 12;
    if (blink) {
      rect(ex - 14, ey - 1, 28, 3, BLACK);
    } else {
      ellipse(ex, ey, 14, 9, EYE_WHITE);
      ellipse(ex + glance, ey, 6, 7, IRIS);
      ellipse(ex + glance, ey, 3, 3, BLACK);
      ellipse(ex + glance + 2, ey - 2, 1.5, 1.5, EYE_WHITE);
    }
    // Heavy brows, raised a little while speaking.
    const lift = speaking ? Math.round(2 * Math.abs(Math.sin(tick * 0.5))) : 0;
    for (let k = 0; k < 30; k++) {
      const bx = ex - 15 + k;
      const by = ey - 19 - lift - Math.round(side * (k - 15) * -0.12);
      rect(bx, by, 1, 6, BEARD);
    }
  }

  // Corinthian helmet pushed up on the head, the way heroes wear it on vases.
  const hy = cy - 56;
  ellipse(cx, hy, 78, 58, BRONZE, (y) => y < hy + 20);
  ellipse(cx - 22, hy - 24, 26, 16, BRONZE_LIGHT, (y) => y < hy + 20);  // highlight
  rect(cx - 78, hy + 12, 156, 9, BRONZE_DARK);                          // rim
  for (let x = cx - 72; x < cx + 72; x += 12) ellipse(x, hy + 16, 2, 2, BRONZE_LIGHT); // rivets
  // Nose guard of the raised helmet.
  rect(cx - 5, hy + 20, 10, 10, BRONZE_DARK);

  // Horsehair crest, swaying a touch.
  const sway = Math.round(3 * Math.sin(tick * 0.15));
  ellipse(cx + sway, hy - 64, 24, 40, CREST, (y) => y < hy - 40);
  for (let s = -14; s <= 14; s += 5) rect(cx + sway + s, hy - 98, 2, 54, CREST_DARK);
  ellipse(cx + sway, hy - 64, 24, 40, CREST, (y) => y < hy - 92);
  rect(cx - 14, hy - 44, 28, 6, BRONZE_DARK);                           // crest holder

  // Greek key borders, top and bottom.
  for (const y0 of [0, HEIGHT - BAND]) {
    rect(0, y0, WIDTH, BAND, BLACK);
    for (let y = 0; y < BAND; y++) {
      const row = MEANDER[Math.floor(y / KEY_SCALE)];
      for (let x = 0; x < WIDTH; x++) {
        if (row[Math.floor(x / KEY_SCALE) % 8] === 'X') set(x, y0 + y, TERRACOTTA);
      }
    }
  }

  return px;
}
