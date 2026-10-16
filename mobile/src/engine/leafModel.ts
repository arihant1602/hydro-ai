// Maize leaf disease classifier, run on the phone.
//
// Features: colour and lesion-shape statistics computed on the vision segmentation (vision.ts). They are
// ratios, so they mean the same for a 256 px dataset image and a 512 px camera photo.
// Model: a random forest trained on PlantVillage maize leaves (healthy, common rust, northern leaf blight,
// gray leaf spot) by tools/train_leaf_model.py on features produced by this very file
// (scripts/leaf_features.ts), so training and the phone compute features identically.
import model from '../data/leaf_disease_maize.json';
import { clean, label, onLeaf, type Analysis, type Issue, type Segmentation } from './vision';

export const FEATURE_NAMES = [
  'green', 'yellow', 'brown', 'purple', 'gray',
  'spots_log', 'big_spots', 'spot_mean', 'spot_max', 'small_spot_frac', 'elong_mean', 'elong_max',
  'spot_h', 'spot_s', 'spot_v', 'spot_h_std',
  'green_h', 'green_s', 'green_v', 'green_v_std',
  'orange',
  'rect_mean', 'align', 'spot_p50', 'spot_p90', 'contrast_v', 'contrast_s', 'gray_share', 'green_grad', 'leaf_grad',
  'hue_0', 'hue_20', 'hue_40', 'hue_60', 'hue_80', 'hue_100', 'hue_120', 'hue_140', 'hue_160',
] as const;

const MIN_SPOT_PX = 4; // smaller specks are JPEG noise
const BIG_SPOT = 0.003; // of leaf area, as vision.LESION_MIN_PATCH
const SHAPE_MIN = 0.001; // spots smaller than this share of the leaf are too few pixels for a shape

/** Feature vector for the classifier, or null when there is no leaf in the frame. */
export function leafFeatures(seg: Segmentation): number[] | null {
  const { w, h, H, S, V, green, yellow, brown, plant, nPlant, nGreen, nY, nB, nP } = seg;
  const N = w * h;
  if (!nPlant || !nGreen) return null;

  // Grey-tan lesions (gray leaf spot, blight): low saturation, so the warm-colour masks miss them. Only patches
  // mostly bordered by leaf count, so a grey table or background doesn't.
  const cand = new Uint8Array(N);
  for (let i = 0; i < N; i++) cand[i] = !plant[i] && S[i] < 0.25 && V[i] > 0.3 && V[i] < 0.85 ? 1 : 0;
  const gray = onLeaf(clean(cand, w, h), green, w, h);
  let nGray = 0;
  for (let i = 0; i < N; i++) nGray += gray[i];
  const A = nPlant + nGray; // leaf area including grey lesions

  // Lesions = yellow, brown or grey tissue on the leaf.
  const spots = new Uint8Array(N);
  for (let i = 0; i < N; i++) spots[i] = yellow[i] | brown[i] | gray[i];
  const [lab, n] = label(spots, w, h);
  const area = new Float64Array(n + 1);
  const sx = new Float64Array(n + 1);
  const sy = new Float64Array(n + 1);
  const sxx = new Float64Array(n + 1);
  const syy = new Float64Array(n + 1);
  const sxy = new Float64Array(n + 1);
  const x0 = new Int32Array(n + 1).fill(w);
  const x1 = new Int32Array(n + 1).fill(-1);
  const y0 = new Int32Array(n + 1).fill(h);
  const y1 = new Int32Array(n + 1).fill(-1);
  let hSum = 0;
  let hSq = 0;
  let sSum = 0;
  let vSum = 0;
  let nSpotPx = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const k = lab[i];
      if (!k) continue;
      area[k]++;
      sx[k] += x;
      sy[k] += y;
      sxx[k] += x * x;
      syy[k] += y * y;
      sxy[k] += x * y;
      if (x < x0[k]) x0[k] = x;
      if (x > x1[k]) x1[k] = x;
      if (y < y0[k]) y0[k] = y;
      if (y > y1[k]) y1[k] = y;
      hSum += H[i];
      hSq += H[i] * H[i];
      sSum += S[i];
      vSum += V[i];
      nSpotPx++;
    }
  let count = 0;
  let big = 0;
  let small = 0;
  let maxA = 0;
  let sumA = 0;
  let elongW = 0;
  let elongSum = 0;
  let elongMax = 0;
  let rectSum = 0;
  let c2 = 0; // orientation coherence: area-weighted doubled-angle vector
  let s2 = 0;
  const sizes: number[] = [];
  for (let k = 1; k <= n; k++) {
    const a = area[k];
    if (a < MIN_SPOT_PX) continue;
    count++;
    sizes.push(a / A);
    sumA += a;
    if (a > maxA) maxA = a;
    if (a >= BIG_SPOT * A) big++;
    else small += a;
    if (a >= Math.max(20, SHAPE_MIN * A)) {
      // Elongation from second moments: sqrt of the covariance eigenvalue ratio (1 = round, large = streak).
      const mx = sx[k] / a;
      const my = sy[k] / a;
      const cxx = sxx[k] / a - mx * mx;
      const cyy = syy[k] / a - my * my;
      const cxy = sxy[k] / a - mx * my;
      const tr = cxx + cyy;
      const d = Math.sqrt(Math.max(0, (cxx - cyy) ** 2 / 4 + cxy * cxy));
      const l1 = tr / 2 + d;
      const l2 = Math.max(tr / 2 - d, 0.25);
      const e = Math.sqrt(l1 / l2);
      elongSum += e * a;
      elongW += a;
      if (e > elongMax) elongMax = e;
      // How much of its bounding box the lesion fills (gray leaf spot: rectangular, between veins).
      rectSum += (a / ((x1[k] - x0[k] + 1) * (y1[k] - y0[k] + 1))) * a;
      // Lesion direction; vein-bound lesions all point the same way.
      const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      c2 += a * Math.cos(2 * theta);
      s2 += a * Math.sin(2 * theta);
    }
  }

  sizes.sort((a, b) => a - b);
  const pctl = (q: number) => (sizes.length ? sizes[Math.min(sizes.length - 1, Math.floor(q * sizes.length))] : 0);

  // Leaf texture: mean brightness step between neighbouring pixels (rust pustules add fine-grained texture).
  let gGrad = 0;
  let gGradN = 0;
  let lGrad = 0;
  let lGradN = 0;
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const d = Math.abs(V[i + 1] - V[i]) + Math.abs(V[i + w] - V[i]);
      if (green[i] && green[i + 1] && green[i + w]) {
        gGrad += d;
        gGradN++;
      }
      const inLeaf = (j: number) => plant[j] || gray[j];
      if (inLeaf(i) && inLeaf(i + 1) && inLeaf(i + w)) {
        lGrad += d;
        lGradN++;
      }
    }

  let gh = 0;
  let gs = 0;
  let gv = 0;
  let gvSq = 0;
  let orange = 0;
  const hist = new Float64Array(9);
  for (let i = 0; i < N; i++) {
    if (green[i]) {
      gh += H[i];
      gs += S[i];
      gv += V[i];
      gvSq += V[i] * V[i];
    }
    if (plant[i] || gray[i]) {
      if (plant[i] && H[i] >= 10 && H[i] < 40 && S[i] > 0.55 && V[i] > 0.3) orange++;
      if (H[i] < 180) hist[Math.floor(H[i] / 20)]++;
    }
  }
  const gMeanV = gv / nGreen;
  const gMeanS = gs / nGreen;
  const spotMeanH = nSpotPx ? hSum / nSpotPx : 0;
  const spotMeanS = nSpotPx ? sSum / nSpotPx : 0;
  const spotMeanV = nSpotPx ? vSum / nSpotPx : 0;
  return [
    nGreen / A,
    nY / A,
    nB / A,
    nP / A,
    nGray / A,
    Math.log1p(count),
    big,
    count ? sumA / count / A : 0,
    maxA / A,
    small / A,
    elongW ? elongSum / elongW : 0,
    elongMax,
    spotMeanH,
    spotMeanS,
    spotMeanV,
    nSpotPx ? Math.sqrt(Math.max(0, hSq / nSpotPx - spotMeanH ** 2)) : 0,
    gh / nGreen,
    gMeanS,
    gMeanV,
    Math.sqrt(Math.max(0, gvSq / nGreen - gMeanV ** 2)),
    orange / A,
    elongW ? rectSum / elongW : 0,
    elongW ? Math.hypot(c2, s2) / elongW : 0,
    pctl(0.5),
    pctl(0.9),
    nSpotPx ? spotMeanV - gMeanV : 0,
    nSpotPx ? spotMeanS - gMeanS : 0,
    nY + nB + nGray ? nGray / (nY + nB + nGray) : 0,
    gGradN ? gGrad / gGradN : 0,
    lGradN ? lGrad / lGradN : 0,
    ...Array.from(hist, (c) => c / A),
  ];
}

// ---------------- Random forest (exported from scikit-learn) ----------------

interface Tree {
  f: number[]; // feature index per node, -1 at leaves
  t: number[]; // split threshold, or the row of `v` at leaves
  l: number[];
  r: number[];
  v: number[][]; // class probabilities, one row per leaf
}
interface Forest {
  classes: string[];
  features: string[];
  threshold?: number; // P(diseased) needed to call a leaf diseased, chosen on validation data
  trees: Tree[];
  metrics?: Record<string, unknown>;
}
const forest = model as unknown as Forest;

export const DISEASES: Record<string, { name: string; advice: string }> = {
  healthy: { name: 'Healthy leaf', advice: '' },
  common_rust: {
    name: 'Common rust',
    advice:
      'Small cinnamon-brown pustules on both leaf sides (Puccinia sorghi). Remove the worst leaves, keep leaves dry and air moving, and lower humidity; it spreads in cool, humid weather.',
  },
  northern_leaf_blight: {
    name: 'Northern leaf blight',
    advice:
      'Long cigar-shaped grey-tan lesions (Exserohilum turcicum). Remove affected leaves, cut humidity and improve airflow; avoid wetting leaves.',
  },
  gray_leaf_spot: {
    name: 'Gray leaf spot',
    advice:
      'Narrow rectangular grey-tan lesions between the veins (Cercospora zeae-maydis). Favoured by long leaf wetness and high humidity: lower humidity, space plants, remove infected leaves.',
  },
};

export interface LeafPrediction {
  /** Most likely class overall. */
  label: string;
  p: number;
  probs: Record<string, number>;
}

export function classify(x: number[]): LeafPrediction {
  const k = forest.classes.length;
  const sum = new Float64Array(k);
  for (const tree of forest.trees) {
    let n = 0;
    // scikit-learn compares float32 features against the threshold, so do the same.
    while (tree.f[n] !== -1) n = Math.fround(x[tree.f[n]]) <= tree.t[n] ? tree.l[n] : tree.r[n];
    const row = tree.v[tree.t[n]];
    for (let c = 0; c < k; c++) sum[c] += row[c];
  }
  const probs: Record<string, number> = {};
  let best = 0;
  for (let c = 0; c < k; c++) {
    probs[forest.classes[c]] = sum[c] / forest.trees.length;
    if (sum[c] > sum[best]) best = c;
  }
  return { label: forest.classes[best], p: sum[best] / forest.trees.length, probs };
}

/** P(diseased) = 1 - P(healthy) at or above this calls the leaf diseased (picked on validation data at training). */
export const CONFIDENT = forest.threshold ?? 0.8;

/** Chance the leaf is diseased at all, and the likeliest disease. */
export function diseaseOf(pred: LeafPrediction): { pSick: number; label: string; p: number } {
  let label = '';
  let p = -1;
  for (const [k, v] of Object.entries(pred.probs)) if (k !== 'healthy' && v > p) [label, p] = [k, v];
  return { pSick: 1 - (pred.probs.healthy ?? 0), label, p };
}

// Colour-rule findings that are about leaf disease, which the model judges better. Nutrient findings
// (chlorosis, purpling, pale) stay: the model was never shown those.
const DISEASE_LIKE = ['lesions', 'necrosis'];
// Once a disease is named, the yellow/tan area and the paler green are the lesions themselves, so the
// nitrogen readings of them would be false alarms. Purpling isn't a symptom of these diseases and stays.
const CAUSED_BY_DISEASE = [...DISEASE_LIKE, 'chlorosis', 'pale'];

/**
 * Combine the colour analysis with the model (only when a leaf is in view):
 * - confident the leaf is diseased: "needs attention", naming the likeliest disease (the colour rules' yellowing
 *   and paleness findings are dropped: they are measuring the lesions);
 * - confident it is healthy: drop the colour rules' lesion/necrosis findings, keep nutrient findings;
 * - unsure: the colour-rule verdict stands; the model's estimate is still shown.
 * Bad lighting keeps its "uncertain (lighting)" verdict either way.
 */
export function withModel(a: Analysis, pred: LeafPrediction | null): Analysis {
  if (!pred || a.verdict === 'no plant in view' || a.verdict === 'uncertain') return a;
  const out: Analysis = { ...a, disease: pred };
  if (a.verdict === 'uncertain (lighting)') return out;
  const d = diseaseOf(pred);
  if (d.pSick >= CONFIDENT) {
    const info = DISEASES[d.label];
    const issue: Issue = [
      `disease_${d.label}`,
      `Looks like ${info.name.toLowerCase()} (model: ${Math.round(d.pSick * 100)}% sure the leaf is diseased, ${Math.round(d.p * 100)}% this disease). ${info.advice}`,
    ];
    out.issues = [issue, ...a.issues.filter(([k]) => !CAUSED_BY_DISEASE.includes(k))];
    out.verdict = 'needs attention';
  } else if (1 - d.pSick >= CONFIDENT) {
    out.issues = a.issues.filter(([k]) => !DISEASE_LIKE.includes(k));
    const problems = out.issues.some(([k]) => ['chlorosis', 'pale', 'purpling'].includes(k));
    out.verdict = problems ? 'needs attention' : 'healthy';
  }
  return out;
}

export const MODEL_INFO = forest.metrics ?? {};
