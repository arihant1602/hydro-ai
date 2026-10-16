// Learns which conditions maximise growth on *this* rig and recommends setpoints. Port of hydro/optimizer.py.
//
// Growth signal: daily water uptake from the ultrasonic reservoir sensor. Model: a quadratic response
// surface (ridge regression on x and x² of each controllable, adding interactions once there is enough
// data) fitted to each day's uptake relative to its surrounding week. The recommendation is the model's
// best point inside the biology-safe stage range, blended with the biology prior by
// n/(n+14) × max(0, cross-validated R²). Small daily perturbations ("explore") keep variation in the data.
import { RANGED, stageFor, stageIndex, type Stage } from './profiles';
import type { Actuators } from './types';

const MIN_DAYS = 7; // below this, use the biology prior only
const PRIOR_WEIGHT = 14; // days of data at which model and prior get equal weight
const EXPLORE: Record<string, number> = { air_temp_c: 1.0, humidity_pct: 4.0, light_hours: 1.0, ph: 0.1, ec_ms_cm: 0.1 };
const GRID_STEP: Record<string, number> = { air_temp_c: 0.5, humidity_pct: 2.5, light_hours: 1.0, ph: 0.1, ec_ms_cm: 0.1 };
const VARS = ['air_temp_c', 'humidity_pct', 'light_hours', 'ph', 'ec_ms_cm'];

export interface ReadingRow {
  ts: number;
  air_temp: number | null;
  humidity: number | null;
  ph: number | null;
  ec: number | null;
  water_liters: number | null;
}
export interface ActRow {
  ts: number;
  states: Actuators;
}
export interface Day {
  day: number;
  stage: number;
  uptake_l: number;
  [v: string]: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const nanMean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? mean(v) : NaN;
};

/** Least-squares slope of y on x (np.polyfit(x, y, 1)[0]). */
function slope(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  return den ? num / den : 0;
}

/**
 * Litres/day the plant drank, from the reservoir level. Split the day wherever the refill pump ran and
 * fit a straight line to each pump-free stretch; the slope is the uptake rate and sensor jitter averages out.
 */
function uptakePerDay(rows: (ReadingRow & { refill: boolean })[]): number {
  const d = rows.filter((r) => r.water_liters != null);
  const segs = new Map<number, typeof d>();
  let seg = 0;
  for (let i = 0; i < d.length; i++) {
    if (d[i].refill) seg++;
    // A reading taken while (or just after) pumping is part of no segment.
    if (d[i].refill || (i > 0 && d[i - 1].refill)) continue;
    if (!segs.has(seg)) segs.set(seg, []);
    segs.get(seg)!.push(d[i]);
  }
  const rates: number[] = [];
  const weights: number[] = [];
  for (const s of segs.values()) {
    if (s.length >= 12 && s[s.length - 1].ts - s[0].ts >= 3 * 3600) {
      rates.push(-slope(s.map((r) => r.ts), s.map((r) => r.water_liters!)) * 86400);
      weights.push(s.length);
    }
  }
  if (!rates.length) return NaN;
  const avg = rates.reduce((a, r, i) => a + r * weights[i], 0) / weights.reduce((a, b) => a + b, 0);
  return Math.max(0, avg);
}

export function dailyTable(crop: string, plantedAt: number, readings: ReadingRow[], acts: ActRow[]): Day[] {
  if (!readings.length) return [];
  const dayOf = (ts: number) => Math.floor((ts - plantedAt) / 86400);
  const pumping = new Set(acts.filter((a) => a.states.refill_pump).map((a) => a.ts));
  const byDay = new Map<number, (ReadingRow & { refill: boolean })[]>();
  for (const r of readings) {
    const k = dayOf(r.ts);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push({ ...r, refill: pumping.has(r.ts) });
  }
  const light = new Map<number, number[]>();
  for (const a of acts) {
    const k = dayOf(a.ts);
    if (!light.has(k)) light.set(k, []);
    light.get(k)!.push(a.states.light ? 1 : 0);
  }
  const days: Day[] = [];
  for (const [k, rows] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const span = (rows[rows.length - 1].ts - rows[0].ts) / 3600;
    const uptake = uptakePerDay(rows);
    if (span < 20 || Number.isNaN(uptake)) continue; // complete days only
    const l = light.get(k);
    days.push({
      day: k,
      stage: stageIndex(crop, stageFor(crop, k).name),
      uptake_l: uptake,
      air_temp_c: nanMean(rows.map((r) => r.air_temp)),
      humidity_pct: nanMean(rows.map((r) => r.humidity)),
      ph: nanMean(rows.map((r) => r.ph)),
      ec_ms_cm: nanMean(rows.map((r) => r.ec)),
      light_hours: l ? mean(l) * 24 : NaN,
    });
  }
  return days;
}

function std(xs: number[], ddof: number): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - ddof));
}

function controllables(days: Day[]): string[] {
  return VARS.filter((v) => days.every((d) => Number.isFinite(d[v])) && std(days.map((d) => d[v]), 1) > 1e-6);
}

/** Each day's uptake relative to its surrounding week (centred 7-day mean), so plant size cancels out. */
function relativeUptake(days: Day[]): { y: number[]; keep: boolean[] } {
  const u = days.map((d) => d.uptake_l);
  const keep: boolean[] = [];
  const y: number[] = [];
  for (let i = 0; i < u.length; i++) {
    const win = u.slice(Math.max(0, i - 3), Math.min(u.length, i + 4));
    const trend = win.length >= 4 ? mean(win) : NaN;
    const k = trend > 0.05; // skip pre-emergence days where the ratio is pure noise
    keep.push(k);
    if (k) y.push(Math.log((u[i] + 0.02) / (trend + 0.02)));
  }
  return { y, keep };
}

// ---- Feature expansion + ridge regression (sklearn StandardScaler -> poly -> Ridge(alpha=1)) ----

interface Transform {
  mu: number[];
  sd: number[];
  full: boolean;
}

function expand(t: Transform, x: number[]): number[] {
  const z = x.map((v, i) => (v - t.mu[i]) / t.sd[i]);
  if (!t.full) return [...z, ...z.map((v) => v * v)];
  const out = [...z];
  for (let i = 0; i < z.length; i++) for (let j = i; j < z.length; j++) out.push(z[i] * z[j]);
  return out;
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

interface Ridge {
  w: number[];
  b: number;
}

function ridgeFit(X: number[][], y: number[], alpha = 1.0): Ridge {
  const p = X[0].length;
  const xm = Array.from({ length: p }, (_, j) => mean(X.map((r) => r[j])));
  const ym = mean(y);
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j ? alpha : 0)));
  const rhs = new Array(p).fill(0);
  for (let n = 0; n < X.length; n++) {
    const xc = X[n].map((v, j) => v - xm[j]);
    for (let i = 0; i < p; i++) {
      rhs[i] += xc[i] * (y[n] - ym);
      for (let j = 0; j < p; j++) A[i][j] += xc[i] * xc[j];
    }
  }
  const w = solve(A, rhs);
  return { w, b: ym - w.reduce((a, wi, j) => a + wi * xm[j], 0) };
}

const ridgePredict = (m: Ridge, x: number[]) => m.b + x.reduce((a, v, j) => a + v * m.w[j], 0);

function r2(yTrue: number[], yPred: number[]): number {
  const m = mean(yTrue);
  const ssRes = yTrue.reduce((a, y, i) => a + (y - yPred[i]) ** 2, 0);
  const ssTot = yTrue.reduce((a, y) => a + (y - m) ** 2, 0);
  if (ssTot === 0) return ssRes === 0 ? 1 : 0;
  return 1 - ssRes / ssTot;
}

/** sklearn cross_val_score(Ridge(), X, y, cv=5, scoring="r2"): unshuffled KFold, mean of fold R². */
function cvR2(X: number[][], y: number[], k = 5): number {
  const n = y.length;
  const scores: number[] = [];
  let start = 0;
  for (let f = 0; f < k; f++) {
    const size = Math.floor(n / k) + (f < n % k ? 1 : 0);
    const test = new Set(Array.from({ length: size }, (_, i) => start + i));
    start += size;
    const tr = [...Array(n).keys()].filter((i) => !test.has(i));
    const m = ridgeFit(tr.map((i) => X[i]), tr.map((i) => y[i]));
    const te = [...test];
    if (te.length < 2) continue; // R² is undefined on one sample (sklearn gives NaN, then nanmean)
    scores.push(r2(te.map((i) => y[i]), te.map((i) => ridgePredict(m, X[i]))));
  }
  const s = scores.length ? mean(scores) : 0;
  return Number.isFinite(s) ? s : 0;
}

export interface Fit {
  n_days: number;
  model: Ridge | null;
  ctrl?: Transform;
  vars?: string[];
  r2?: number;
  cv_r2?: number;
}

export function fit(days: Day[]): Fit {
  const result: Fit = { n_days: days.length, model: null };
  if (days.length < MIN_DAYS) return result;
  const vars = controllables(days);
  if (!vars.length) return result;
  // Full quadratic (with interactions) needs ~10 days per term; until then use x and x² per variable,
  // which can't overfit cross-terms on a few weeks of data.
  const nFull = (vars.length * (vars.length + 3)) / 2;
  const { y, keep } = relativeUptake(days);
  if (y.length < MIN_DAYS) return result;
  const raw = days.filter((_, i) => keep[i]).map((d) => vars.map((v) => d[v]));
  const ctrl: Transform = {
    mu: vars.map((_, j) => mean(raw.map((r) => r[j]))),
    sd: vars.map((_, j) => std(raw.map((r) => r[j]), 0) || 1),
    full: days.length >= 10 * nFull,
  };
  const X = raw.map((r) => expand(ctrl, r));
  const model = ridgeFit(X, y);
  // Out-of-sample skill decides how far we trust the model: one that can't predict unseen days
  // (CV R² <= 0) is fitting sensor noise and must not move the setpoints.
  const cv = cvR2(X, y);
  return {
    model,
    ctrl,
    vars,
    n_days: y.length,
    r2: round(r2(y, X.map((x) => ridgePredict(model, x))), 3),
    cv_r2: round(cv, 3),
  };
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const clip = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Deterministic per-day PRNG (mulberry32), so the exploration offset holds all day and changes tomorrow. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Recommendation {
  setpoints: Record<string, number>;
  bounds: Record<string, [number, number]>;
  source: 'model+prior' | 'biology prior';
  model_weight: number;
  n_days: number;
  r2?: number;
  cv_r2?: number;
  learned_vars: string[];
  explore_offset: Record<string, number>;
  stage: Stage;
}

export function recommend(
  crop: string,
  day: number,
  sensorsPresent: Set<string>,
  f: Fit,
  explore = true,
): Recommendation {
  const stage = stageFor(crop, day);
  const bounds: Record<string, [number, number]> = {};
  for (const k of RANGED) bounds[k] = stage[k];
  const lh = stage.light_hours;
  bounds.light_hours = lh === 0 ? [lh, lh] : [Math.max(8, lh - 2), Math.min(18, lh + 2)];
  const active = ['air_temp_c', 'humidity_pct', 'light_hours', ...['ph', 'ec_ms_cm'].filter((v) => sensorsPresent.has(v))];
  const prior: Record<string, number> = {};
  for (const v of active) prior[v] = (bounds[v][0] + bounds[v][1]) / 2;
  prior.light_hours = lh;

  const best = { ...prior };
  let alpha = 0;
  if (f.model && f.vars && f.ctrl) {
    alpha = (f.n_days / (f.n_days + PRIOR_WEIGHT)) * clip(f.cv_r2 ?? 0, 0, 1);
    const axes = f.vars.map((v) => {
      const out: number[] = [];
      for (let i = 0; bounds[v][0] + i * GRID_STEP[v] <= bounds[v][1] + 1e-9; i++) out.push(bounds[v][0] + i * GRID_STEP[v]);
      return out;
    });
    let top: number[] = [];
    let topPred = -Infinity;
    const point = new Array(axes.length).fill(0);
    const walk = (i: number) => {
      if (i === axes.length) {
        const p = ridgePredict(f.model!, expand(f.ctrl!, point));
        if (p > topPred) [topPred, top] = [p, [...point]];
        return;
      }
      for (const v of axes[i]) {
        point[i] = v;
        walk(i + 1);
      }
    };
    walk(0);
    f.vars.forEach((v, i) => {
      if (v in best) best[v] = prior[v] + alpha * (top[i] - prior[v]);
    });
  }

  const offset: Record<string, number> = {};
  if (explore) {
    const rand = rng(Math.floor(day));
    for (const v of Object.keys(best)) {
      const u = rand() * 2 - 1;
      if (lh === 0 && v === 'light_hours') continue;
      offset[v] = round(u * EXPLORE[v]);
      best[v] += offset[v];
    }
  }
  for (const v of Object.keys(best)) best[v] = round(clip(best[v], bounds[v][0], bounds[v][1]));

  return {
    setpoints: best,
    bounds: Object.fromEntries(active.map((v) => [v, bounds[v]])),
    source: alpha ? 'model+prior' : 'biology prior',
    model_weight: round(alpha),
    n_days: f.n_days,
    r2: f.r2,
    cv_r2: f.cv_r2,
    learned_vars: f.vars ?? [],
    explore_offset: offset,
    stage,
  };
}
