// Checks the on-phone TypeScript engine against the Python reference outputs in test/parity/
// (regenerate with `.venv/bin/python tools/export_mobile_assets.py`). Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import jpeg from 'jpeg-js';

import { Advisor } from '../src/engine/advisor';
import { decide } from '../src/engine/controller';
import { dailyTable, fit, recommend } from '../src/engine/optimizer';
import { predict } from '../src/engine/suitability';
import { DEFAULT_SETTINGS } from '../src/engine/types';
import { TREATMENT_SOURCES, TREATMENTS } from '../src/data/treatments';
import { classify, DISEASES } from '../src/engine/leafModel';
import model from '../src/data/leaf_disease_maize.json';
import { analysePixels } from '../src/engine/vision';

const dir = join(__dirname, 'parity');
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const close = (a: number | null | undefined, b: number | null | undefined, tol: number, what: string) => {
  if (a == null || b == null) return assert.equal(a ?? null, b ?? null, what);
  assert.ok(Math.abs(a - b) <= tol, `${what}: ts ${a} vs py ${b}`);
};

test('suitability forest matches scikit-learn predict_proba', () => {
  for (const { x, p } of load('suitability_maize.json')) close(predict('maize', x), p, 1e-6, `x=${x}`);
});

test('optimizer daily table, fit and setpoints match Python', () => {
  const o = load('optimizer.json');
  const days = dailyTable('maize', o.planted_at, o.readings, o.acts);
  assert.equal(days.length, o.days.length);
  days.forEach((d, i) => {
    for (const k of ['uptake_l', 'air_temp_c', 'humidity_pct', 'light_hours', 'stage', 'day'])
      close(d[k], o.days[i][k], 1e-6, `day ${i} ${k}`);
  });
  const f = fit(days);
  assert.deepEqual(f.vars, o.fit.vars);
  assert.equal(f.n_days, o.fit.n_days);
  close(f.r2, o.fit.r2, 0.0011, 'r2');
  close(f.cv_r2, o.fit.cv_r2, 0.0011, 'cv_r2');
  const rec = recommend('maize', 40, new Set(), f, false);
  close(rec.model_weight, o.model_weight, 0.011, 'model_weight');
  for (const [k, v] of Object.entries(o.setpoints)) close(rec.setpoints[k], v as number, 0.011, `setpoint ${k}`);
});

const METRICS = ['canopy_pct', 'green_pct', 'yellow_frac', 'brown_frac', 'purple_frac', 'lesion_frac', 'dgci', 'brightness', 'colour_cast', 'blown_pct'];

test('vision metrics match Python exactly on identical pixels', () => {
  for (const { raw, size: [w, h], result } of load('vision.json')) {
    const rgb = readFileSync(join(dir, raw));
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2], 255], 4 * i);
    const { analysis } = analysePixels(rgba, w, h);
    for (const k of METRICS) close(analysis[k as 'dgci'], result[k], 0.0011, `${raw} ${k}`);
    assert.equal(analysis.lesions, result.lesions, `${raw} lesions`);
    assert.equal(analysis.verdict, result.verdict, `${raw} verdict`);
    assert.deepEqual(analysis.issues, result.issues, `${raw} issues`);
  }
});

test('vision verdict survives decoding the JPEG with jpeg-js (as the phone does)', () => {
  for (const { file, result } of load('vision.json')) {
    const img = jpeg.decode(readFileSync(join(dir, file)), { useTArray: true });
    const { analysis } = analysePixels(img.data, img.width, img.height);
    // jpeg-js and libjpeg upsample chroma differently, so a few edge pixels change class.
    close(analysis.canopy_pct, result.canopy_pct, 0.3, `${file} canopy`);
    assert.equal(analysis.lesions, result.lesions, `${file} lesions`);
    assert.equal(analysis.verdict, result.verdict, `${file} verdict`);
  }
});

test('advisor reaches the same causes, confidence and advice as Python', () => {
  const adv = new Advisor();
  for (const c of load('advisor.json')) {
    const r = adv.advise({ text: c.text, form: c.form, photo: c.photo, sensors: c.sensors });
    const py = c.result;
    assert.deepEqual(r.safety, py.safety, `${c.text}: safety`);
    assert.equal(!!r.unrelated, !!py.unrelated, `${c.text}: unrelated`);
    assert.equal(r.router_calls, py.router_calls, `${c.text}: router calls`);
    assert.equal(r.confidence, py.confidence, `${c.text}: confidence`);
    const ids = (xs?: { id: string; score: number }[]) => (xs ?? []).map((x) => `${x.id}:${x.score}`).sort();
    assert.deepEqual(ids(r.likely), ids(py.likely), `${c.text}: likely`);
    assert.deepEqual((r.actions ?? []).map((a) => a.text), (py.actions ?? []).map((a: { text: string }) => a.text), `${c.text}: actions`);
    assert.deepEqual((r.avoid ?? []).map((a) => a.text), (py.avoid ?? []).map((a: { text: string }) => a.text), `${c.text}: avoid`);
  }
});

test('controller holds temperature with hysteresis and never doses twice within cooldown', () => {
  const s = { ...DEFAULT_SETTINGS, planted_at: 0 };
  const sp = { air_temp_c: 25, humidity_pct: 65, light_hours: 16, ph: 6, ec_ms_cm: 1.5 };
  const r = { ts: 1_000_000, air_temp: 26, humidity: 65, water_level_pct: 50, ph: 6.5, ec: 1.0 };
  const a = decide(r, sp, s, {}, 6);
  assert.equal(a.fan, true);
  assert.equal(a.ph_down_ms, 800);
  assert.equal(a.nutrient_ms, 800);
  const b = decide({ ...r, ts: r.ts + 10, air_temp: 25.2 }, sp, s, a, 6);
  assert.equal(b.fan, true, 'inside the band the fan keeps its previous state');
  assert.equal(b.ph_down_ms, undefined, 'dose cooldown');
  assert.equal(decide({ ...r, ts: r.ts + 20, air_temp: 24 }, sp, s, b, 6).fan, false);
});

test('leaf disease forest gives the same probabilities as scikit-learn', () => {
  for (const { x, probs } of load('leaf_model.json')) {
    const p = classify(x);
    ['healthy', 'common_rust', 'northern_leaf_blight', 'gray_leaf_spot'].forEach((k, i) => close(p.probs[k], probs[i], 1e-4, `P(${k})`));
  }
});

test('every disease the model can name has a treatment plan with costs', () => {
  for (const cls of (model as { classes: string[] }).classes.filter((k) => k !== 'healthy')) {
    assert.ok(DISEASES[cls], `no description for ${cls}`);
    const plan = TREATMENTS[cls];
    assert.ok(plan, `no treatment plan for ${cls}`);
    assert.ok(plan.steps.length >= 3 && plan.products.length >= 1 && plan.prevention.length >= 1, `${cls} plan is incomplete`);
    for (const p of plan.products) for (const l of ['en', 'hi'] as const) assert.match(p.costPerAcre[l], /₹/, `${cls}: ${p.ingredient.en} has no ${l} cost`);
  }
  assert.ok(TREATMENT_SOURCES.every((s) => s.url.startsWith('https://')));
});
