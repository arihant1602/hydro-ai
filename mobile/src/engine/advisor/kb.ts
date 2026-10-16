// Knowledge base (exported from advisor/kb/ by tools/export_mobile_assets.py). Port of advisor/kb.py.
import raw from '../../data/kb.json';

export interface Node {
  id: string;
  layer: number;
  parent: string | null;
  label_en: string;
  label_hi: string;
  desc: string;
}
export interface Criterion {
  id: string;
  en: string;
  hi: string;
}
export interface AdviceEdge {
  s: string;
  ev: 'Supp' | 'Part' | 'Uncert' | 'Unk' | 'Contra';
  actives?: string[];
  why?: string;
  note?: string;
}
export interface Cause {
  id: string;
  hosts: string[];
  syndromes: string[];
  name_en: string;
  name_hi: string;
  desc: string;
  criteria?: Criterion[];
  photo?: Record<string, string>;
  conditions?: Record<string, 'for' | 'against'>;
  notifiable?: boolean;
  advice: AdviceEdge[];
}
export interface Strategy {
  id: string;
  kind: string;
  tags: string[];
  en: string;
  hi: string;
}
export interface Crop {
  name_en: string;
  name_hi: string;
  synonyms: string[];
  cereal?: boolean;
  stages: Record<string, [number, number]>;
}
export interface Contraindication {
  id: string;
  blocks_tag?: string;
  when?: string;
  reason_en: string;
  reason_hi: string;
}
export interface Rules {
  banned_actives: { actives: string[] };
  pollinator_toxic_actives: string[];
  contraindications: Contraindication[];
  safety: Record<string, { patterns: string[]; en: string; hi: string }>;
}

export interface KB {
  anchors: { unrelated: { desc: string }; normal: { desc: string } };
  nodes: Record<string, Node>;
  causes: Record<string, Cause>;
  strategies: Record<string, Strategy>;
  rules: Rules;
  crops: Record<string, Crop>;
}

export const MAX_FANOUT = 5;
const r = raw as unknown as {
  anchors: KB['anchors'];
  nodes: Node[];
  causes: Cause[];
  strategies: Strategy[];
  rules: Rules;
  crops: Record<string, Crop>;
};
const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));

export const kb: KB = {
  anchors: r.anchors,
  nodes: byId(r.nodes),
  causes: byId(r.causes),
  strategies: byId(r.strategies),
  rules: r.rules,
  crops: r.crops,
};

export function children(nodeId: string | null): Node[] {
  return Object.values(kb.nodes).filter((n) => n.parent === nodeId);
}

const views: Record<string, Record<string, string[][]>> = {};

/** L4 causes for this crop, grouped by syndrome, each group split into chunks of <= MAX_FANOUT. */
export function cropView(crop: string): Record<string, string[][]> {
  if (views[crop]) return views[crop];
  if (!kb.crops[crop]) throw new Error(`unknown crop ${crop}`);
  const bySyn: Record<string, string[]> = {};
  for (const c of Object.values(kb.causes))
    if (c.hosts.includes('*') || c.hosts.includes(crop)) for (const s of c.syndromes) (bySyn[s] ??= []).push(c.id);
  const out: Record<string, string[][]> = {};
  for (const [s, ids] of Object.entries(bySyn)) {
    // Specific (crop-listed) causes before universal ones, so chunking keeps a crop's own problems together.
    const key = (i: string) => `${kb.causes[i].hosts.includes('*') ? 1 : 0}${i}`;
    ids.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    out[s] = [];
    for (let i = 0; i < ids.length; i += MAX_FANOUT) out[s].push(ids.slice(i, i + MAX_FANOUT));
  }
  return (views[crop] = out);
}

export function stageOf(crop: string, day: number): string {
  const stages = Object.entries(kb.crops[crop].stages);
  for (const [name, [lo, hi]] of stages) if (lo <= day && day <= hi) return name;
  return day > Math.max(...stages.map(([, [, hi]]) => hi)) ? 'maturity' : 'establish';
}

/** Crop named in free text (English, Hinglish or Hindi), or null. */
export function detectCrop(text: string): string | null {
  const t = text.toLowerCase();
  for (const [crop, p] of Object.entries(kb.crops)) if (p.synonyms.some((s) => t.includes(s))) return crop;
  return null;
}
