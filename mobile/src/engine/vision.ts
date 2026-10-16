// Plant-health analysis of camera photos, run on the phone. Port of hydro/vision.py.
//
// 1. Segment the plant: green leaf pixels by hue/saturation, then yellow (chlorotic), brown (necrotic) and
//    purple pixels, but only patches mostly bordered by leaf, so tables or skin don't count as dying leaves.
// 2. Measure canopy cover, yellow/brown/purple share, discrete lesions and DGCI (Dark Green Colour Index).
// 3. Verdict + advice, plus an overlay showing what was classified as what.
// These are colour heuristics, not a trained classifier. Input: RGBA pixels already scaled to <= 512 px.

export const WORK_SIDE = 512;
export const VERSION = 1;

const GREEN_HUE = [62, 170];
const YELLOW_HUE = [35, 62];
const BROWN_HUE = [8, 35];
const PURPLE_HUE = [270, 345];
export const MIN_GREEN_PCT = 1.0;
const MAX_OFFCOLOUR_RATIO = 1.5;
const YELLOW_WARN = 0.15;
const BROWN_WARN = 0.06;
const PURPLE_WARN = 0.08;
const LESION_WARN = 0.04;
export const LESION_MIN_PATCH = 0.003;
const DGCI_LOW = 0.45;

export interface Metrics {
  canopy_pct: number;
  green_pct: number;
  yellow_frac: number | null;
  brown_frac: number | null;
  purple_frac: number | null;
  lesion_frac: number | null;
  lesions: number;
  dgci: number | null;
  brightness: number;
  colour_cast: number;
  blown_pct: number;
}
export type Issue = [string, string];
export interface Analysis extends Partial<Metrics> {
  verdict: string;
  issues: Issue[];
  version: number;
  /** Leaf disease model's call (leafModel.ts), when a leaf was in view. */
  disease?: { label: string; p: number; probs: Record<string, number> };
}

export type Mask = Uint8Array;

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Max (dilate) or min (erode) filter over a size x size square, edges replicated like PIL. */
function rank(m: Mask, w: number, h: number, size: number, max: boolean): Mask {
  const r = size >> 1;
  const tmp = new Uint8Array(m.length);
  const out = new Uint8Array(m.length);
  // Separable: a square max/min is a row pass then a column pass.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = max ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const s = m[y * w + Math.min(w - 1, Math.max(0, x + k))];
        v = max ? v | s : v & s;
      }
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = max ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const s = tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
        v = max ? v | s : v & s;
      }
      out[y * w + x] = v;
    }
  return out;
}

export const dilate = (m: Mask, w: number, h: number, px: number) => rank(m, w, h, px | 1, true);
/** Drop speckle: erode then dilate (morphological opening). */
export const clean = (m: Mask, w: number, h: number, px = 3) => rank(rank(m, w, h, px, false), w, h, px, true);

/** 4-connected component labelling (scipy.ndimage.label default). Returns labels and count. */
export function label(m: Mask, w: number, h: number): [Int32Array, number] {
  const lab = new Int32Array(m.length);
  const stack: number[] = [];
  let n = 0;
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || lab[i]) continue;
    lab[i] = ++n;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb)
        if (q >= 0 && m[q] && !lab[q]) {
          lab[q] = n;
          stack.push(q);
        }
    }
  }
  return [lab, n];
}

/** Keep connected patches of `cand` whose outer border is mostly green leaf. */
export function onLeaf(cand: Mask, green: Mask, w: number, h: number, minGreenBorder = 0.5): Mask {
  const [lab, n] = label(cand, w, h);
  if (n === 0) return cand;
  const grown = dilate(cand, w, h, 3);
  const tot = new Float64Array(n + 1);
  const grn = new Float64Array(n + 1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!grown[i] || cand[i]) continue;
      // The border pixel belongs to the highest-numbered adjacent patch (PIL max filter on labels).
      let best = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const l = lab[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
          if (l > best) best = l;
        }
      tot[best] += 1;
      grn[best] += green[i];
    }
  const keep = new Uint8Array(n + 1);
  for (let k = 1; k <= n; k++) keep[k] = tot[k] > 0 && grn[k] / Math.max(tot[k], 1) >= minGreenBorder ? 1 : 0;
  const out = new Uint8Array(cand.length);
  for (let i = 0; i < cand.length; i++) out[i] = keep[lab[i]];
  return out;
}

export interface Result {
  analysis: Analysis;
  /** RGBA overlay at the working size: background dimmed, leaf/yellow/brown/purple painted. */
  overlay: Uint8Array;
  width: number;
  height: number;
  /** The masks behind the analysis, reused by the leaf disease model. */
  seg: Segmentation;
}

/** Per-pixel HSV and the class masks (leaf, yellow, brown, purple). Shared by analysePixels and the leaf model. */
export interface Segmentation {
  w: number;
  h: number;
  H: Float32Array; // hue, degrees
  S: Float32Array;
  V: Float32Array;
  green: Mask;
  yellow: Mask;
  brown: Mask;
  purple: Mask;
  plant: Mask;
  nPlant: number;
  nGreen: number;
  nY: number;
  nB: number;
  nP: number;
  chan: number[]; // summed R, G, B (0-1)
}

export function segment(rgba: Uint8Array, w: number, h: number): Segmentation {
  const N = w * h;
  const H = new Float32Array(N);
  const S = new Float32Array(N);
  const V = new Float32Array(N);
  const chan = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const r = rgba[4 * i] / 255;
    const g = rgba[4 * i + 1] / 255;
    const b = rgba[4 * i + 2] / 255;
    chan[0] += r;
    chan[1] += g;
    chan[2] += b;
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    let hue = 0;
    if (d > 1e-6) {
      if (mx === r) hue = (((60 * (g - b)) / d) % 360 + 360) % 360;
      else if (mx === g) hue = (60 * (b - r)) / d + 120;
      else hue = (60 * (r - g)) / d + 240;
    }
    H[i] = hue;
    S[i] = mx > 1e-6 ? d / Math.max(mx, 1e-6) : 0;
    V[i] = mx;
  }
  const inH = (i: number, [lo, hi]: number[]) => H[i] >= lo && H[i] < hi;

  const g0 = new Uint8Array(N);
  const warm0 = new Uint8Array(N);
  const purple0 = new Uint8Array(N);
  for (let i = 0; i < N; i++) g0[i] = inH(i, GREEN_HUE) && S[i] > 0.18 && V[i] > 0.12 ? 1 : 0;
  const green = clean(g0, w, h, 5);
  for (let i = 0; i < N; i++) {
    if (green[i]) continue;
    warm0[i] = H[i] >= BROWN_HUE[0] && H[i] < YELLOW_HUE[1] && S[i] > 0.2 && V[i] > 0.15 && V[i] < 0.95 ? 1 : 0;
    purple0[i] = inH(i, PURPLE_HUE) && S[i] > 0.15 && V[i] > 0.15 ? 1 : 0;
  }
  const t1 = onLeaf(clean(warm0, w, h), green, w, h);
  const t2 = onLeaf(clean(purple0, w, h), green, w, h);
  const yellow = new Uint8Array(N);
  const brown = new Uint8Array(N);
  const purple = new Uint8Array(N);
  const plant = new Uint8Array(N);
  let nPlant = 0;
  let nGreen = 0;
  let nY = 0;
  let nB = 0;
  let nP = 0;
  for (let i = 0; i < N; i++) {
    const tissue = t1[i] | t2[i];
    yellow[i] = tissue && inH(i, YELLOW_HUE) && V[i] > 0.3 ? 1 : 0;
    purple[i] = tissue && H[i] >= PURPLE_HUE[0] ? 1 : 0;
    brown[i] = tissue && !yellow[i] && !purple[i] ? 1 : 0;
    plant[i] = green[i] | yellow[i] | brown[i] | purple[i];
    nPlant += plant[i];
    nGreen += green[i];
    nY += yellow[i];
    nB += brown[i];
    nP += purple[i];
  }
  return { w, h, H, S, V, green, yellow, brown, purple, plant, nPlant, nGreen, nY, nB, nP, chan };
}

export function analysePixels(rgba: Uint8Array, w: number, h: number): Result {
  const seg = segment(rgba, w, h);
  const { H, S, V, green, yellow, brown, purple, plant, nPlant, nGreen, nY, nB, nP, chan } = seg;
  const N = w * h;
  const meanAll = (chan[0] + chan[1] + chan[2]) / (3 * N);
  let vSum = 0;
  for (let i = 0; i < N; i++) vSum += V[i];
  let blown = 0;
  if (nPlant) {
    const near = dilate(plant, w, h, 15);
    let cnt = 0;
    let hit = 0;
    for (let i = 0; i < N; i++)
      if (near[i]) {
        cnt++;
        if (V[i] > 0.95 && S[i] < 0.15) hit++;
      }
    blown = round((100 * hit) / cnt, 1);
  }
  const m: Metrics = {
    canopy_pct: round((100 * nPlant) / N, 2),
    green_pct: round((100 * nGreen) / N, 2),
    yellow_frac: nPlant ? round(nY / nPlant, 3) : null,
    brown_frac: nPlant ? round(nB / nPlant, 3) : null,
    purple_frac: nPlant ? round(nP / nPlant, 3) : null,
    lesion_frac: null,
    lesions: 0,
    dgci: null,
    brightness: round(vSum / N, 3),
    colour_cast: round(Math.max(...chan.map((c) => Math.abs(c / N - meanAll))), 3),
    blown_pct: blown,
  };
  if (nPlant) {
    const spots = new Uint8Array(N);
    for (let i = 0; i < N; i++) spots[i] = (yellow[i] | brown[i]) & (purple[i] ^ 1);
    const [lab, n] = label(spots, w, h);
    const sizes = new Float64Array(n + 1);
    for (let i = 0; i < N; i++) sizes[lab[i]]++;
    let big = 0;
    let bigSum = 0;
    for (let k = 1; k <= n; k++)
      if (sizes[k] >= LESION_MIN_PATCH * nPlant) {
        big++;
        bigSum += sizes[k];
      }
    m.lesions = big;
    m.lesion_frac = round(bigSum / nPlant, 3);
  }
  if (nGreen) {
    // DGCI = [(H - 60)/60 + (1 - S) + (1 - B)] / 3 over green leaf pixels.
    let s = 0;
    for (let i = 0; i < N; i++) if (green[i]) s += ((H[i] - 60) / 60 + (1 - S[i]) + (1 - V[i])) / 3;
    m.dgci = round(s / nGreen, 3);
  }

  const [verdict, issues] = judge(m);

  const overlay = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    let c: number[];
    const px = [rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]];
    if (purple[i]) c = [153, 77, 230];
    else if (brown[i]) c = [217, 38, 38];
    else if (yellow[i]) c = [255, 217, 26];
    else if (green[i]) c = [px[0] * 0.5 + 13, px[1] * 0.5 + 102, px[2] * 0.5 + 38];
    else c = px.map((v) => v * 0.35);
    overlay.set([c[0], c[1], c[2], 255], 4 * i);
  }
  return { analysis: { ...m, verdict, issues, version: VERSION }, overlay, width: w, height: h, seg };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const PROBLEMS = ['chlorosis', 'lesions', 'necrosis', 'pale', 'purpling'];

export function judge(m: Metrics): [string, Issue[]] {
  const issues: Issue[] = [];
  const has = (k: string) => issues.some(([key]) => key === k);
  if (m.brightness < 0.18) issues.push(['too_dark', 'Photo too dark to judge leaf colour. Add light or move the phone.']);
  let unreliable = false;
  if (m.blown_pct > 15) {
    unreliable = true;
    issues.push([
      'overexposed',
      `${m.blown_pct.toFixed(0)}% of the frame is blown out (backlit or sun in frame). Shoot with the light behind the camera.`,
    ]);
  }
  if (m.colour_cast > 0.12) {
    unreliable = true;
    issues.push(['colour_cast', 'Strong colour cast (RGB lights or a coloured grow light?). Colour readings are unreliable.']);
  }
  if (m.green_pct < MIN_GREEN_PCT) {
    issues.push(['no_plant', 'No plant detected in the frame.']);
    return ['no plant in view', issues];
  }
  if (m.canopy_pct - m.green_pct > MAX_OFFCOLOUR_RATIO * m.green_pct) {
    issues.push([
      'uncertain',
      'Far more yellow/brown than green around the plant. Probably background (wood, skin, warm light) being picked up. Reframe on the plant with a plain background.',
    ]);
    return ['uncertain', issues];
  }
  if (m.yellow_frac != null && m.yellow_frac > YELLOW_WARN)
    issues.push([
      'chlorosis',
      `${pct(m.yellow_frac)} of leaf area is yellow/tan. Even yellowing from the tips of older leaves usually means nitrogen deficiency: check EC and raise nutrient strength. Long cigar-shaped tan patches mean northern leaf blight (fungal): remove the leaves and cut humidity.`,
    ]);
  if (m.lesion_frac != null && m.lesion_frac > LESION_WARN && !has('chlorosis'))
    issues.push([
      'lesions',
      `${m.lesions} distinct tan/brown patch(es) covering ${pct(m.lesion_frac)} of the leaf. Long cigar-shaped grey-tan lesions point to northern leaf blight; small rusty pustules to common rust. Remove affected leaves, lower humidity, improve airflow.`,
    ]);
  if (m.brown_frac != null && m.brown_frac > BROWN_WARN)
    issues.push([
      'necrosis',
      `${pct(m.brown_frac)} brown/necrotic tissue. Look for leaf spots or lesions (blight, rust) or tip burn from high EC.`,
    ]);
  if (m.purple_frac != null && m.purple_frac > PURPLE_WARN)
    issues.push([
      'purpling',
      `${pct(m.purple_frac)} purple-tinged tissue. In maize this usually means phosphorus deficiency or cold stress (P uptake stalls below ~15 °C).`,
    ]);
  if (m.dgci != null && m.dgci < DGCI_LOW && !has('chlorosis'))
    issues.push(['pale', `Leaves are pale (DGCI ${m.dgci.toFixed(2)}). Nitrogen may be running low.`]);
  const problems = issues.some(([k]) => PROBLEMS.includes(k));
  if (problems && unreliable) return ['uncertain (lighting)', issues];
  return [problems ? 'needs attention' : 'healthy', issues];
}

/** Photo issues that become alerts (key prefix vision_), including the leaf model's disease calls. */
export function visionAlerts(a: Analysis): Record<string, ['warning', string]> {
  const out: Record<string, ['warning', string]> = {};
  for (const [k, msg] of a.issues) if (PROBLEMS.includes(k) || k.startsWith('disease_')) out[`vision_${k}`] = ['warning', msg];
  return out;
}
