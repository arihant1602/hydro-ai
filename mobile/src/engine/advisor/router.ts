// Stage 3 scorer: P(option | state) for a batch of typed questions. Port of advisor/router.py (lexical baseline).
// It is a dependency-free bag-of-words matcher; the Laya ONNX router can replace it behind the same interface.

export interface Question {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}
export interface Router {
  name: string;
  score(state: string, questions: Record<string, Question>): Record<string, Record<string, number>>;
}

const TOKEN = /[a-zऀ-ॿ]+/g;
// Words that carry no symptom information in farmer queries.
const STOP = new Set(
  `a an the and or of in on at to for from with is are was were be been my our your this that these those it its
there their they he she i we you me crop crops field plant plants leaf leaves farmer asked query about information
please tell how what why which when control problem problems issue mein me ke ki ka hai hain ho raha rahe rahi
se par aur ya bhi kya kaise`.split(/\s+/),
);

export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const t of text.toLowerCase().match(TOKEN) ?? []) {
    if (STOP.has(t) || t.length < 3) continue;
    out.push(t.slice(0, 5)); // crude stemming: yellowing/yellow, turning/turn, spots/spot...
  }
  return out;
}

function counter(xs: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

export class LexicalRouter implements Router {
  name = 'lexical-baseline';
  constructor(
    private temperature = 0.06,
    private anchorPrior = 0.1, // similarity the anchors get for free (they have no keywords to match)
  ) {}

  private sim(q: Map<string, number>, desc: string): number {
    const d = counter(tokens(desc));
    if (!q.size || !d.size) return 0;
    let overlap = 0;
    for (const [t, n] of q) overlap += Math.min(n, d.get(t) ?? 0);
    return overlap / Math.sqrt(total(q) * total(d));
  }

  score(state: string, questions: Record<string, Question>) {
    const q = counter(tokens(state));
    const out: Record<string, Record<string, number>> = {};
    for (const [name, spec] of Object.entries(questions)) {
      const sims: [string, number][] = Object.entries(spec.criteria).map(([label, desc]) => {
        let s = this.sim(q, desc);
        // "unrelated" gets a floor so a message matching nothing lands there; "normal" must be earned.
        if (label === '__unrelated') s = Math.max(s, this.anchorPrior);
        return [label, s];
      });
      const z = sims.map(([, v]) => Math.exp(v / this.temperature));
      const tot = z.reduce((a, b) => a + b, 0);
      out[name] = Object.fromEntries(sims.map(([k], i) => [k, z[i] / tot]));
    }
    return out;
  }
}
