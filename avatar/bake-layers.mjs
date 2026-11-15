// Bake high-res transparent PNG layers for Argos. Usage: node avatar/bake-layers.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakePart, dogPose, FOCUS_Y, LH, LW, VIEW } from './face-scene.mjs';
import { BAKE_S, resetLayerCache } from './face-layers.mjs';
import { encodePng } from './png-util.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'layers');
mkdirSync(OUT, { recursive: true });

const PARTS = ['body', 'tail', 'ears', 'head', 'mouth_open', 'eyes', 'eyes_blink', 'helmet', 'crest'];

function logicalToBake(x, y) {
  const e = (LW / 2) * (1 - VIEW);
  const f = LH / 2 - VIEW * FOCUS_Y;
  return [(VIEW * x + e) * BAKE_S, (VIEW * y + f) * BAKE_S];
}

console.log(`Baking Argos layers at S=${BAKE_S} → ${OUT}`);
const t0 = Date.now();
const pose = dogPose(0.4, false);
const meta = { bakeS: BAKE_S, layers: {} };

for (const name of PARTS) {
  const { rgba, width, height, ox, oy } = bakePart(BAKE_S, name);
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, encodePng(rgba, width, height));

  let pivotX = width / 2;
  let pivotY = height / 2;
  if (name === 'body') {
    const [px, py] = logicalToBake(pose.cx, pose.paw + 12);
    pivotX = px - ox;
    pivotY = py - oy;
  } else if (name === 'tail') {
    const [px, py] = logicalToBake(pose.cx + 92, pose.paw - 62);
    pivotX = px - ox;
    pivotY = py - oy;
  } else {
    const [px, py] = logicalToBake(pose.cx, pose.cy + 70);
    pivotX = px - ox;
    pivotY = py - oy;
  }

  meta.layers[name] = { file: `${name}.png`, width, height, ox, oy, pivotX, pivotY };
  console.log(`  ${name}.png  ${width}×${height}  origin=(${ox},${oy})`);
}

writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
resetLayerCache();
console.log(`done in ${Date.now() - t0}ms`);
