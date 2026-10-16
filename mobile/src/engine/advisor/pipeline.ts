// Stages 1, 2, 4 and 5 of the advisor: safety gate, evidence fusion, consensus and the advice DAG.
// Ports of advisor/safety.py, evidence.py, consensus.py and advice_graph.py.
import type { Analysis } from '../vision';
import type { Stage } from '../profiles';
import { kb, stageOf, type Cause } from './kb';
import { DISEASES } from '../leafModel';

export type Lang = 'en' | 'hi';
export type Flags = Record<string, boolean>;

// ---------------- Stage 1: safety ----------------

const ORDER = ['poisoning', 'distress', 'outbreak'] as const; // most urgent first
const compiled = Object.fromEntries(
  ORDER.map((k) => [k, kb.rules.safety[k].patterns.map((p) => new RegExp(p, 'i'))]),
) as Record<(typeof ORDER)[number], RegExp[]>;

export interface SafetyHit {
  kind: string;
  halt: boolean;
  en: string;
  hi: string;
}

/** null = proceed. Poisoning and distress halt the pipeline; an outbreak report is added on top of advice. */
export function safetyCheck(text: string): SafetyHit | null {
  for (const kind of ORDER)
    if (compiled[kind].some((p) => p.test(text))) {
      const s = kb.rules.safety[kind];
      return { kind, halt: kind === 'poisoning' || kind === 'distress', en: s.en, hi: s.hi };
    }
  return null;
}

// ---------------- Stage 2: evidence ----------------

const pct0 = (x: number) => `${Math.round(x * 100)}%`;

export function photoSentence(a: Partial<Analysis> | null | undefined): string | null {
  if (!a || a.verdict == null || a.verdict === 'no plant in view' || a.verdict === 'analysis failed') return null;
  if (a.verdict.startsWith('uncertain')) return 'Photo: lighting is poor, colours unreliable.';
  const bits: string[] = [];
  // The leaf disease model's confident call (leafModel.withModel adds it as a disease_<label> issue).
  const disease = a.issues?.find(([k]) => k.startsWith('disease_'))?.[0].slice('disease_'.length);
  if (disease && DISEASES[disease]) bits.push(`the leaf model sees ${DISEASES[disease].name.toLowerCase()}`);
  if ((a.yellow_frac ?? 0) > 0.08) bits.push(`about ${pct0(a.yellow_frac!)} of the leaf area is yellow`);
  if ((a.lesion_frac ?? 0) > 0.03)
    bits.push(`${a.lesions ?? 0} tan or brown spots and lesions cover ${pct0(a.lesion_frac!)} of the leaf`);
  else if ((a.brown_frac ?? 0) > 0.05) bits.push(`${pct0(a.brown_frac!)} of the leaf is brown and dry`);
  if ((a.purple_frac ?? 0) > 0.05) bits.push('leaves have purple tinge');
  if (a.dgci != null && a.dgci < 0.45) bits.push('leaves are pale green');
  if (!bits.length) return 'Photo: leaves look green and healthy, no spots seen.';
  return `Photo: ${bits.join('; ')}.`;
}

export interface Form {
  crop?: string | null;
  day?: number | null;
  stage?: string;
  hydroponic?: boolean;
  rain_forecast?: boolean;
  wind_high?: boolean;
  waterlogged?: boolean;
  weather?: string[];
}
export interface SensorSnapshot {
  air_temp?: number | null;
  humidity?: number | null;
  ph?: number | null;
  ec?: number | null;
}

export function context(form: Form, sensors?: SensorSnapshot | null, photo?: Partial<Analysis> | null, stageTargets?: Stage | null) {
  const crop = form.crop ?? undefined;
  const weather = form.weather ?? [];
  const flags: Flags = Object.fromEntries(weather.map((w) => [w, true]));
  if (weather.includes('frost')) flags.cold = true;
  flags.hydroponic = !!form.hydroponic;
  flags.not_hydroponic = !flags.hydroponic;
  flags.rain_forecast_24h = !!form.rain_forecast;
  flags.wind_high = !!form.wind_high;
  if (form.waterlogged) flags.waterlogged = true;
  flags.always = true;

  let stage: string | null = null;
  if (crop && form.day != null) stage = stageOf(crop, Math.trunc(form.day));
  else if (form.stage) stage = form.stage;
  if (stage) {
    flags.flowering = stage === 'flowering';
    flags.late_stage = stage === 'filling' || stage === 'maturity';
    flags.near_harvest = stage === 'maturity';
    flags.cereal_after_flowering = !!kb.crops[crop ?? '']?.cereal && flags.late_stage;
  }

  const sentences: string[] = [];
  if (crop) {
    let s = `Crop: ${kb.crops[crop].name_en}`;
    if (stage) s += `, ${stage} stage` + (form.day != null ? ` (day ${Math.trunc(form.day)})` : '');
    sentences.push(s + '.');
  }
  const words: Record<string, string> = {
    heavy_rain: 'heavy rain recently',
    cold: 'cold nights',
    hot: 'very hot days',
    humid: 'humid, foggy or wet weather',
    dry: 'dry weather, no rain',
    frost: 'frost (pala)',
  };
  const w = weather.filter((k) => k in words).map((k) => words[k]);
  if (w.length) sentences.push(`Weather: ${w.join(', ')}.`);

  if (sensors) {
    const { air_temp: t, humidity: h, ph, ec } = sensors;
    if (h != null && h >= 80) flags.humid = true;
    if (t != null && t >= 35) flags.hot = true;
    if (t != null && t <= 10) flags.cold = true;
    if (ph != null && ph > (flags.hydroponic ? 6.8 : 7.8)) flags.ph_high = true;
    if (ec != null && stageTargets && ec > stageTargets.ec_ms_cm[1] + 0.5) flags.ec_high = true;
    const bits: string[] = [];
    if (t != null) bits.push(`air ${t.toFixed(0)} °C`);
    if (h != null) bits.push(`humidity ${h.toFixed(0)}%` + (h >= 80 ? ' (high)' : ''));
    if (ph != null) bits.push(`pH ${ph.toFixed(1)}` + (flags.ph_high ? ' (high)' : ''));
    if (ec != null) bits.push(`EC ${ec.toFixed(2)} mS/cm` + (flags.ec_high ? ' (too high)' : ''));
    if (bits.length) sentences.push(`Sensors: ${bits.join(', ')}.`);
  }
  return { flags, stage, contextSentences: sentences, photoSentence: photoSentence(photo) };
}

// ---------------- Stage 4: consensus ----------------

const VOTE_FLOOR = 0.05;
const CONDITION_FOR = 8;
const CONDITION_AGAINST = -15;
const PHOTO_MATCH = 8;
const PHOTO_HEALTHY_PENALTY = -6;
const ANSWER_YES = 20;
const ANSWER_NO = -25;
const CLARIFY_MARGIN = 15;

function photoPrior(cause: Cause, photo?: Partial<Analysis> | null): number {
  const v = photo?.verdict;
  if (!photo || v == null || v === 'no plant in view' || v === 'analysis failed' || v.startsWith('uncertain')) return 0;
  const exp = cause.photo ?? {};
  const hi = (k: string) => exp[k] === 'high' || exp[k] === 'medium';
  let bonus = 0;
  if (hi('yellow_frac') && (photo.yellow_frac ?? 0) > 0.12) bonus += PHOTO_MATCH;
  if (hi('lesions') && (photo.lesion_frac ?? 0) > 0.04) bonus += PHOTO_MATCH;
  if (hi('brown_frac') && (photo.brown_frac ?? 0) > 0.06) bonus += PHOTO_MATCH / 2;
  if (exp.purple_frac && (photo.purple_frac ?? 0) > 0.06) bonus += PHOTO_MATCH;
  if (exp.dgci === 'low' && photo.dgci != null && photo.dgci < 0.45) bonus += PHOTO_MATCH / 2;
  if (v === 'healthy') bonus += cause.syndromes.includes('NORMAL') ? PHOTO_MATCH : PHOTO_HEALTHY_PENALTY;
  return bonus;
}

function conditionPrior(cause: Cause, flags: Flags): number {
  let total = 0;
  for (const [cond, dir] of Object.entries(cause.conditions ?? {}))
    if (flags[cond]) total += dir === 'for' ? CONDITION_FOR : CONDITION_AGAINST;
  // Lower leaves dying in a young crop is not "normal ageing".
  if (cause.id === 'C_NORMAL_SENESCENCE' && !flags.late_stage) total += CONDITION_AGAINST;
  return total;
}

export interface Ranked {
  id: string;
  score: number;
  votes: number;
  of: number;
  mu: number;
  sigma: number;
  prior: number;
  answers: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function aggregate(
  channelLeaves: Record<string, Record<string, number>>,
  flags: Flags,
  photo?: Partial<Analysis> | null,
  answers: Record<string, boolean> = {},
): Ranked[] {
  const chans = Object.values(channelLeaves);
  const n = chans.length;
  const cands = new Set(chans.flatMap((l) => Object.keys(l)));
  const rows: Ranked[] = [];
  for (const cid of cands) {
    const ps = chans.map((l) => l[cid] ?? 0);
    const v = ps.filter((p) => p >= VOTE_FLOOR).length;
    const mu = ps.reduce((a, b) => a + b, 0) / n;
    const sigma = Math.sqrt(ps.reduce((a, p) => a + (p - mu) ** 2, 0) / n);
    const cause = kb.causes[cid];
    const prior = conditionPrior(cause, flags) + photoPrior(cause, photo);
    let ans = 0;
    for (const c of cause.criteria ?? []) if (c.id in answers) ans += answers[c.id] ? ANSWER_YES : ANSWER_NO;
    const score = (100 * v) / n + 100 * mu - 50 * sigma + prior + ans;
    rows.push({ id: cid, score: r1(score), votes: v, of: n, mu: Math.round(mu * 1000) / 1000, sigma: Math.round(sigma * 1000) / 1000, prior, answers: ans });
  }
  return rows.sort((a, b) => b.score - a.score);
}

export interface Clarify {
  id: string;
  for: string;
  en: string;
  hi: string;
}

/** Distinguishing yes/no checks from the top two causes when they are close. */
export function clarifyingQuestions(ranked: Ranked[], answers: Record<string, boolean> = {}, k = 2): Clarify[] {
  if (ranked.length < 2 || ranked[0].score - ranked[1].score >= CLARIFY_MARGIN) return [];
  const qs: Clarify[] = [];
  for (const row of ranked.slice(0, 2)) {
    const c = (kb.causes[row.id].criteria ?? []).find((c) => !(c.id in answers));
    if (c) qs.push({ id: c.id, for: row.id, en: c.en, hi: c.hi });
  }
  return qs.slice(0, k);
}

export function confidenceLabel(ranked: Ranked[]): 'none' | 'high' | 'medium' | 'low' {
  if (!ranked.length) return 'none';
  const top = ranked[0];
  const gap = top.score - (ranked.length > 1 ? ranked[1].score : 0);
  if (top.votes === top.of && gap >= 25) return 'high';
  if (gap >= CLARIFY_MARGIN) return 'medium';
  return 'low';
}

// ---------------- Stage 5: advice DAG ----------------

const LADDER = ['check', 'cultural', 'mechanical', 'biological', 'nutrient', 'chemical', 'escalate'];
const EV_RANK: Record<string, number> = { Supp: 0, Part: 1, Uncert: 2, Unk: 3 };
const norm = (a: string) => a.toLowerCase().trim();

export interface Action {
  cause: string | null;
  strategy: string;
  kind: string;
  evidence: string;
  text: string;
}
export interface Avoid {
  cause: string;
  text: string;
  reason: string;
}

export function buildAdvice(causeIds: string[], flags: Flags, lang: Lang = 'en'): [Action[], Avoid[]] {
  const rules = kb.rules;
  const banned = rules.banned_actives.actives.map(norm);
  const beeToxic = rules.pollinator_toxic_actives.map(norm);
  const byTag: Record<string, (typeof rules.contraindications)[number]> = {};
  for (const c of rules.contraindications) if (c.blocks_tag && c.when && flags[c.when]) byTag[c.blocks_tag] = c;
  const flowering = rules.contraindications.find((c) => c.id === 'FLOWERING_BEES')!;
  const bannedRule = rules.contraindications.find((c) => c.id === 'BANNED')!;
  const isBanned = (a: string) => banned.some((b) => norm(a).includes(b.split(' (')[0]));
  const reason = (c: typeof flowering) => (lang === 'hi' ? c.reason_hi : c.reason_en);

  const actions: Action[] = [];
  const avoid: Avoid[] = [];
  const seen = new Set<string>();
  for (const cid of causeIds) {
    for (const edge of kb.causes[cid].advice) {
      const strat = kb.strategies[edge.s];
      const actives = edge.actives ?? [];
      if (edge.ev === 'Contra') {
        avoid.push({ cause: cid, text: `Do not use ${actives.join(', ') || strat[lang]}`, reason: edge.why ?? 'contraindicated for this problem' });
        continue;
      }
      const blocked = strat.tags.filter((t) => t in byTag).map((t) => byTag[t]);
      if (blocked.length) {
        // Hydro/soil mismatches are irrelevant rather than dangerous: drop silently.
        if (blocked[0].id !== 'HYDROPONIC' && blocked[0].id !== 'SOIL_FARM')
          avoid.push({ cause: cid, text: strat[lang].replaceAll('{actives}', actives.join(', ') || '-'), reason: reason(blocked[0]) });
        continue;
      }
      const kept: string[] = [];
      for (const a of actives) {
        if (isBanned(a)) avoid.push({ cause: cid, text: `Do not use ${a}`, reason: reason(bannedRule).replaceAll('{actives}', a) });
        else if (flags.flowering && beeToxic.some((b) => norm(a).includes(b)))
          avoid.push({ cause: cid, text: `Avoid ${a} now`, reason: reason(flowering).replaceAll('{actives}', a) });
        else kept.push(a);
      }
      if (actives.length && !kept.length) continue; // every suggested chemical was filtered out
      const key = `${edge.s}|${kept.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let text = strat[lang].replaceAll('{actives}', kept.join(', '));
      if (edge.note) text += ` (${edge.note})`;
      actions.push({ cause: cid, strategy: edge.s, kind: strat.kind, evidence: edge.ev, text });
    }
  }
  actions.sort((a, b) => LADDER.indexOf(a.kind) - LADDER.indexOf(b.kind) || (EV_RANK[a.evidence] ?? 9) - (EV_RANK[b.evidence] ?? 9));
  const dedup = new Map(avoid.map((a) => [`${a.text}|${a.reason}`, a]));
  return [actions, [...dedup.values()]];
}
