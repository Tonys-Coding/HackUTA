import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { blitOver, blitRotated, downsampleBox } from './face-raster.mjs';
import { decodePng } from './png-util.mjs';
import { dogPose } from './face-scene.mjs';

export const BAKE_S = 6;

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'layers');
const LAYER_NAMES = [
  'body',
  'tail',
  'ears',
  'head',
  'mouth_open',
  'eyes',
  'eyes_blink',
  'helmet',
  'crest',
];

/**
 * @typedef {{
 *   rgba: Uint8Array, width: number, height: number,
 *   ox: number, oy: number, pivotX: number, pivotY: number
 * }} LayerSprite
 */

/** @type {Record<string, LayerSprite> | null} */
let layers = null;
let loadAttempted = false;
/** Publish S these sprites were downsampled for. */
let loadedForS = 0;

function tryLoad(publishS) {
  if (loadAttempted && layers && loadedForS === publishS) return layers;
  loadAttempted = true;
  const metaPath = join(DIR, 'meta.json');
  if (!existsSync(metaPath)) {
    layers = null;
    return null;
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const bakeS = meta.bakeS || BAKE_S;
  if (bakeS % publishS !== 0) {
    console.warn('[argos] bakeS must be multiple of publish S', { bakeS, publishS });
    layers = null;
    return null;
  }
  const ss = bakeS / publishS;
  /** @type {Record<string, LayerSprite>} */
  const out = {};
  for (const name of LAYER_NAMES) {
    const info = meta.layers?.[name];
    if (!info) {
      layers = null;
      return null;
    }
    const path = join(DIR, info.file || `${name}.png`);
    if (!existsSync(path)) {
      layers = null;
      return null;
    }
    try {
      const raw = decodePng(readFileSync(path));
      // Downsample bake → publish once at load.
      const { rgba, width, height } = downsampleBox(raw.rgba, raw.width, raw.height, ss);
      out[name] = {
        rgba,
        width,
        height,
        ox: info.ox / ss,
        oy: info.oy / ss,
        pivotX: info.pivotX / ss,
        pivotY: info.pivotY / ss,
      };
    } catch (err) {
      console.warn('[argos] layer decode failed', name, err?.message || err);
      layers = null;
      return null;
    }
  }
  layers = out;
  loadedForS = publishS;
  console.info('[argos] loaded cropped 2K layers @ publish S=', publishS);
  return layers;
}

export function layersReady(publishS = 3) {
  return !!tryLoad(publishS);
}

export function resetLayerCache() {
  layers = null;
  loadAttempted = false;
  loadedForS = 0;
}

/**
 * Composite cropped publish-resolution sprites onto dest (background already present).
 */
export function compositeLayers(dest, S, tick, speaking, fps) {
  const L = tryLoad(S);
  if (!L) return false;

  const t = tick / fps;
  const pose = dogPose(t, speaking);
  const { tilt, wag, open, blink, sway } = pose;
  const dw = dest.length && S ? Math.round((dest.length / 4) / Math.round((780 * S))) : 0;
  // WIDTH/HEIGHT from caller: derive from dest buffer
  const width = Math.round(360 * S);
  const height = Math.round(780 * S);

  const place = (layer, theta) => {
    // Skip tiny rotations — blitRotated over 2K crops was stalling FaceTime.
    if (Math.abs(theta) < 0.035) {
      blitOver(dest, width, height, layer.rgba, layer.width, layer.height, Math.round(layer.ox), Math.round(layer.oy));
      return;
    }
    blitRotated(
      dest,
      width,
      height,
      layer.rgba,
      layer.width,
      layer.height,
      layer.ox + layer.pivotX,
      layer.oy + layer.pivotY,
      layer.pivotX,
      layer.pivotY,
      theta,
      1,
    );
  };

  place(L.body, 0);
  place(L.tail, wag * 0.45);
  place(L.ears, tilt);
  place(L.head, tilt);
  if (open > 3) place(L.mouth_open, tilt);
  // Helmet before eyes so the open face stays readable; crest on top.
  place(L.helmet, tilt);
  if (blink) place(L.eyes_blink, tilt);
  else place(L.eyes, tilt);
  place(L.crest, tilt + sway * 0.012);

  void dw;
  return true;
}
