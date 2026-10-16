// Dataset-derived score: how typical the current conditions are for the crop (0-1).
// Evaluates the scikit-learn random forest exported by tools/export_mobile_assets.py.
import forest from '../data/suitability_maize.json';

interface Tree {
  f: number[]; // feature index per node, -1 for leaves
  t: number[]; // split threshold, or P(crop) at a leaf
  l: number[];
  r: number[];
}

const FORESTS: Record<string, { trees: Tree[]; features: string[] }> = { maize: forest as never };

export function predict(crop: string, x: number[]): number | null {
  const m = FORESTS[crop];
  if (!m) return null;
  let sum = 0;
  for (const tree of m.trees) {
    let n = 0;
    while (tree.f[n] !== -1) n = x[tree.f[n]] <= tree.t[n] ? tree.l[n] : tree.r[n];
    sum += tree.t[n];
  }
  return sum / m.trees.length;
}

/** Returns [probability, note]. pH falls back to the stage target mid-point when no probe is fitted. */
export function score(
  crop: string,
  airTemp: number | null | undefined,
  humidity: number | null | undefined,
  ph: number | null | undefined,
  fallbackPh: number,
): [number | null, string] {
  if (!FORESTS[crop]) return [null, 'no model for this crop'];
  if (airTemp == null || humidity == null) return [null, 'no climate reading'];
  const note = ph != null ? '' : 'pH assumed at stage target (no probe)';
  const p = predict(crop, [airTemp, humidity, ph ?? fallbackPh])!;
  return [Math.round(p * 1000) / 1000, note];
}
