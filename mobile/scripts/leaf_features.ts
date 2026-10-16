// Training data for the leaf disease model: runs the phone's own pipeline over labelled images and writes one
// CSV row per image (class, file, colour-rule verdict, features). Run with tsx:
//
//   npx tsx scripts/leaf_features.ts <list.tsv> <out.csv> [shard] [shards]
//
// <list.tsv> has "class<TAB>path" lines. The phone shrinks/enlarges every photo to 512 px on the long side
// before analysing it (lib/photos.ts), so this does the same with bilinear filtering.
import { readFileSync, writeFileSync } from 'node:fs';

import jpeg from 'jpeg-js';

import { FEATURE_NAMES, leafFeatures } from '../src/engine/leafModel';
import { analysePixels, WORK_SIDE } from '../src/engine/vision';

export function resizeBilinear(src: Uint8Array, w: number, h: number, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  const sx = w / W;
  const sy = h / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const a = src[4 * (y0 * w + x0) + c] * (1 - tx) + src[4 * (y0 * w + x1) + c] * tx;
        const b = src[4 * (y1 * w + x0) + c] * (1 - tx) + src[4 * (y1 * w + x1) + c] * tx;
        out[4 * (y * W + x) + c] = Math.round(a * (1 - ty) + b * ty);
      }
    }
  }
  return out;
}

/** Decode + resize like the phone; returns the pipeline's outputs. */
export function analyseFile(path: string) {
  const img = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true });
  const scale = WORK_SIDE / Math.max(img.width, img.height);
  const W = Math.round(img.width * scale);
  const H = Math.round(img.height * scale);
  const rgba = resizeBilinear(img.data, img.width, img.height, W, H);
  const res = analysePixels(rgba, W, H);
  return { analysis: res.analysis, features: leafFeatures(res.seg) };
}

function main() {
  const [list, out, shardArg, shardsArg] = process.argv.slice(2);
  const shard = Number(shardArg ?? 0);
  const shards = Number(shardsArg ?? 1);
  const rows = readFileSync(list, 'utf8').trim().split('\n').filter((_: string, i: number) => i % shards === shard);
  const lines: string[] = [];
  for (const row of rows) {
    const [cls, path] = row.split('\t');
    const { analysis, features } = analyseFile(path);
    const f = features ?? FEATURE_NAMES.map(() => NaN);
    lines.push([cls, JSON.stringify(path), JSON.stringify(analysis.verdict), ...f.map((v) => (Number.isNaN(v) ? '' : String(v)))].join(','));
  }
  writeFileSync(out, ['class,file,heuristic_verdict,' + FEATURE_NAMES.join(','), ...lines].join('\n') + '\n');
}

if (process.argv[1]?.endsWith('leaf_features.ts')) main();
