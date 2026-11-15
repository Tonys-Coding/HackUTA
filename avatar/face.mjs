// Argos, the loyal hound of Odysseus — FaceTime avatar.
// Contract: drawFace(tick, speaking) → WIDTH×HEIGHT RGBA. Scene is 360×780 logical.
//
// improved-UI / 2K path:
// - Publish 1080×2340 (S=3) so FaceTime Fill scales down instead of up.
// - Cache Ithaca background every few frames.
// - Procedural dog drawn in a 2× supersample pad, then box-filtered (phase 1).
// - When avatar/layers/*.png exist (baked at BAKE_S=6), use layered composite instead (phase 2).

import { blitOver, createRaster, downsampleBox } from './face-raster.mjs';
import { compositeLayers, layersReady } from './face-layers.mjs';
import {
  LH,
  LW,
  dogLogicalBounds,
  dogPose,
  paintArgos,
  paintBackground,
  sceneT,
} from './face-scene.mjs';

const S = 3;
export const WIDTH = LW * S; // 1080
export const HEIGHT = LH * S; // 2340
/** 12fps keeps ~83ms budget; 1080×2340 + layers were stalling FaceTime at 16. */
export const FPS = 12;

/** Dog supersample factor (procedural path only). */
const DOG_SS = 2;
/** Animate clouds/ship rarely — full BG rebuild is expensive. */
const BG_EVERY = 36;

/** @type {Uint8Array | null} */
let staticBg = null;
/** @type {Uint8Array | null} */
let bgCache = null;
let bgBucket = -1;

function getStaticBackground() {
  if (staticBg) return staticBg;
  const r = createRaster(WIDTH, HEIGHT, S, sceneT());
  paintBackground(r, 0, { dynamic: false });
  staticBg = r.px;
  return staticBg;
}

function getBackground(tick) {
  const bucket = Math.floor(tick / BG_EVERY);
  if (bgCache && bucket === bgBucket) return bgCache;
  bgBucket = bucket;
  const t = (bucket * BG_EVERY) / FPS;
  // Copy static sky/terrace/columns, then overlay cheap animated bits.
  const px = new Uint8Array(getStaticBackground());
  const r = createRaster(WIDTH, HEIGHT, S, sceneT(), px);
  paintBackground(r, t, { dynamic: true, static: false });
  bgCache = r.px;
  return bgCache;
}

/**
 * Procedural dog into dest via local 2× supersample of the dog AABB.
 * @param {Uint8Array} dest
 * @param {number} tick
 * @param {boolean} speaking
 */
function drawArgosSupersampled(dest, tick, speaking) {
  const t = tick / FPS;
  const pose = dogPose(t, speaking);
  const bounds = dogLogicalBounds(pose);

  // Expand AABB in logical space, then map through sceneT to publish pixels.
  const base = sceneT();
  const corners = [
    [bounds.x0, bounds.y0],
    [bounds.x1, bounds.y0],
    [bounds.x1, bounds.y1],
    [bounds.x0, bounds.y1],
  ].map(([x, y]) => {
    const X = (base.a * x + base.c * y + base.e) * S;
    const Y = (base.b * x + base.d * y + base.f) * S;
    return [X, Y];
  });
  const pad = 24;
  let minX = Math.min(...corners.map(c => c[0])) - pad;
  let maxX = Math.max(...corners.map(c => c[0])) + pad;
  let minY = Math.min(...corners.map(c => c[1])) - pad;
  let maxY = Math.max(...corners.map(c => c[1])) + pad;
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(WIDTH, Math.ceil(maxX));
  maxY = Math.min(HEIGHT, Math.ceil(maxY));
  const dw = maxX - minX;
  const dh = maxY - minY;
  if (dw < 8 || dh < 8) return;

  const sw = dw * DOG_SS;
  const sh = dh * DOG_SS;
  // High-res raster: same logical sceneT, but pixel scale S*DOG_SS, then we only keep the crop.
  // Shift so crop lands at 0,0 in the SS buffer: subtract minX/minY in pixel space before scale.
  // Easier: draw full frame at S*SS into a buffer is too big. Instead offset baseT.
  // publish_px = logical_to_px * S; we want ss_px = publish_px * SS - min*SS
  // ss_px = (T*logical)*S*SS - min*SS. So use scale=S*SS and translate e,f... 
  // createRaster toPx: (T.a*x+...+T.e)*scale. We need result - minX*SS.
  // Add post translate by baking into a wrapper setPx — simplest: full SS frame for crop only via modified T.e/f.
  // (T* p)* (S*SS) - min*SS = (T*p)*S*SS + (-min*SS). So e' = e - minX/S? 
  // toPx_x = (a*x+c*y+e)*scale. Want (a*x+c*y+e)*S*SS - minX*SS = (a*x+c*y+e - minX/S)*S*SS
  // so e2 = e - minX/S, f2 = f - minY/S, scale = S*SS.
  const scale = S * DOG_SS;
  const Tss = {
    ...base,
    e: base.e - minX / S,
    f: base.f - minY / S,
  };
  const hi = createRaster(sw, sh, scale, Tss);
  // Transparent clear — only dog pixels get alpha 255 from setPx.
  paintArgos(hi, pose);

  const { rgba: lo, width: ow, height: oh } = downsampleBox(hi.px, sw, sh, DOG_SS);
  blitOver(dest, WIDTH, HEIGHT, lo, ow, oh, minX, minY);
}

/** Double-buffer publish frames — avoids allocating a fresh 10MB RGBA every tick. */
let frameA = null;
let frameB = null;
let useA = true;

export function drawFace(tick, speaking) {
  const bg = getBackground(tick);
  const need = bg.length;
  if (!frameA || frameA.length !== need) frameA = new Uint8Array(need);
  if (!frameB || frameB.length !== need) frameB = new Uint8Array(need);
  const px = useA ? frameA : frameB;
  useA = !useA;
  px.set(bg);

  if (layersReady(S) && compositeLayers(px, S, tick, speaking, FPS)) {
    return px;
  }

  drawArgosSupersampled(px, tick, speaking);
  return px;
}

export { bakePart, dogPose, paintArgos, paintBackground, sceneT } from './face-scene.mjs';
export { LW, LH };
