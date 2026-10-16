// End-to-end advisor: safety -> evidence -> tree (per channel) -> consensus -> advice. Port of advisor/engine.py.
import type { Stage } from '../profiles';
import type { Analysis } from '../vision';
import { detectCrop, kb } from './kb';
import {
  aggregate,
  buildAdvice,
  clarifyingQuestions,
  confidenceLabel,
  context,
  safetyCheck,
  type Action,
  type Avoid,
  type Clarify,
  type Form,
  type Lang,
  type SensorSnapshot,
} from './pipeline';
import { LexicalRouter, type Router } from './router';
import { traverse, UNREL, type Gate } from './tree';

const MAX_CAUSES_ADVISED = 2;

export interface AdviceResult {
  router: string;
  safety: { kind: string; halt: boolean; message: string } | null;
  needs?: { field: string; en: string; hi: string; options?: string[] };
  unrelated?: boolean;
  message?: string;
  crop?: string;
  stage?: string | null;
  likely?: { id: string; name: string; score: number; agreement: string }[];
  confidence?: string;
  questions?: Clarify[];
  actions?: Action[];
  avoid?: Avoid[];
  evidence_used?: string[];
  notifiable?: boolean;
  router_calls?: number;
  latency_ms?: number;
}

export interface AdviseInput {
  text?: string;
  form?: Form;
  photo?: Partial<Analysis> | null;
  sensors?: SensorSnapshot | null;
  stageTargets?: Stage | null;
  answers?: Record<string, boolean>;
  lang?: Lang;
}

export class Advisor {
  constructor(
    public router: Router = new LexicalRouter(),
    private gate: Gate = {},
  ) {}

  advise({ text = '', form: f = {}, photo, sensors, stageTargets, answers = {}, lang = 'en' }: AdviseInput): AdviceResult {
    const t0 = Date.now();
    const form: Form = { ...f };
    const out: AdviceResult = { router: this.router.name, safety: null };
    const done = () => ({ ...out, latency_ms: Date.now() - t0 });

    const alert = safetyCheck(text);
    if (alert) {
      out.safety = { kind: alert.kind, halt: alert.halt, message: alert[lang] };
      if (alert.halt) return done();
    }

    if (!form.crop) form.crop = detectCrop(text);
    if (!form.crop) {
      out.needs = { field: 'crop', en: 'Which crop is this?', hi: 'यह कौन सी फसल है?', options: Object.keys(kb.crops).sort() };
      return out;
    }
    const crop = form.crop;
    const ctx = context(form, sensors, photo, stageTargets);

    // Independent evidence channels: each extra source adds a view that must agree for a cause to gain votes.
    const ctxText = ctx.contextSentences.join(' ');
    const channels: Record<string, string> = {};
    if (text) {
      channels.complaint = text;
      if (ctx.photoSentence) channels['complaint+photo'] = `${text} ${ctx.photoSentence}`;
      if (ctxText) channels['complaint+context'] = `${text} ${ctxText}`;
      if (ctx.photoSentence && ctxText) channels.all = `${text} ${ctx.photoSentence} ${ctxText}`;
    } else if (ctx.photoSentence) {
      channels['photo+context'] = `${ctx.photoSentence} ${ctxText}`.trim();
    } else {
      out.needs = { field: 'complaint', en: 'Describe the problem or add a photo.', hi: 'समस्या बताइए या फोटो जोड़िए।' };
      return out;
    }

    const runs = Object.fromEntries(
      Object.entries(channels).map(([ch, s]) => [ch, traverse(this.router, s, crop, this.gate)]),
    );
    const calls = Object.values(runs).reduce((a, r) => a + r.calls, 0);
    // "Unrelated" anchor dominant in every channel: not a crop problem (weather, schemes, prices...).
    const alpha = this.gate.alpha ?? 0.85;
    const roots = Object.values(runs)
      .filter((r) => r.trace.length)
      .map((r) => r.trace[0].probs);
    const noLeaves = Object.values(runs).every((r) => !Object.keys(r.leaves).length);
    if (
      roots.length &&
      noLeaves &&
      roots.every(
        (p) => (p[UNREL] ?? 0) >= alpha || Math.max(...Object.entries(p).filter(([k]) => k !== UNREL).map(([, v]) => v)) < 0.2,
      )
    ) {
      out.crop = crop;
      out.unrelated = true;
      out.message = {
        en: "This doesn't look like a crop problem. Describe what you see on the plants (leaves, stem, fruit, insects) or add a photo.",
        hi: 'यह फसल की समस्या नहीं लगती। पौधे पर क्या दिख रहा है (पत्ती, तना, फल, कीट) बताइए या फोटो जोड़िए।',
      }[lang];
      out.router_calls = calls;
      return done();
    }
    const ranked = aggregate(
      Object.fromEntries(Object.entries(runs).map(([ch, r]) => [ch, r.leaves])),
      ctx.flags,
      photo,
      answers,
    );
    const conf = confidenceLabel(ranked);
    const topIds = !ranked.length
      ? []
      : conf === 'high' || ranked.length === 1
        ? [ranked[0].id]
        : ranked.slice(0, MAX_CAUSES_ADVISED).map((r) => r.id);
    const [actions, avoid] = buildAdvice(topIds, ctx.flags, lang);
    const escalate = !ranked.length || conf === 'low';
    if (escalate && !actions.some((a) => a.strategy === 'CHK_SAMPLE_KVK')) {
      const s = kb.strategies.CHK_SAMPLE_KVK;
      actions.push({ cause: null, strategy: 'CHK_SAMPLE_KVK', kind: 'escalate', evidence: 'Supp', text: s[lang] });
    }

    Object.assign(out, {
      crop,
      stage: ctx.stage,
      likely: ranked.slice(0, 3).map((r) => ({
        id: r.id,
        name: lang === 'hi' ? kb.causes[r.id].name_hi : kb.causes[r.id].name_en,
        score: r.score,
        agreement: `${r.votes}/${r.of} evidence channels`,
      })),
      confidence: conf,
      questions: clarifyingQuestions(ranked, answers),
      actions,
      avoid,
      evidence_used: Object.keys(channels),
      notifiable: topIds.some((c) => kb.causes[c].notifiable),
      router_calls: calls,
    });
    return done();
  }
}
