// Stage 3: batched beam traversal of the crop-agnostic tree with the paper-style activation gate.
// Port of advisor/tree.py. One router call per tree level, so cost is fixed by depth (4).
import { children, cropView, kb } from './kb';
import type { Question, Router } from './router';

export const UNREL = '__unrelated';
export const NORMAL = '__normal';

export function gate(p: number, pUnrel: number, tau: number, alpha: number, beta: number): boolean {
  return p >= tau || (pUnrel < alpha && p / Math.max(1e-9, 1 - pUnrel) >= tau && p >= beta);
}

function question(opts: [string, string][], withNormal: boolean): Question {
  const criteria: Record<string, string> = Object.fromEntries(opts);
  criteria[UNREL] = kb.anchors.unrelated.desc;
  if (withNormal) criteria[NORMAL] = kb.anchors.normal.desc;
  return { type: 'choice', instructions: "Which best describes the farmer's crop problem?", criteria };
}

export interface Gate {
  tau?: number;
  alpha?: number;
  beta?: number;
  beam?: number;
}
export interface Trace {
  depth: number;
  node: string;
  probs: Record<string, number>;
}

type Frontier = [key: string, opts: [string, string][], pp: number, path: string[], kind: 'node' | 'cause'];

export function traverse(router: Router, state: string, crop: string, g: Gate = {}) {
  const { tau = 0.3, alpha = 0.85, beta = 0.05, beam = 3 } = g;
  const view = cropView(crop);
  let calls = 0;
  const trace: Trace[] = [];
  const leaves: Record<string, number> = {};
  let normalP = 0;

  let frontier: Frontier[] = [['root', children(null).map((n) => [n.id, n.desc]), 1, [], 'node']];
  for (let depth = 1; depth <= 4 && frontier.length; depth++) {
    const questions = Object.fromEntries(frontier.map(([key, opts]) => [key, question(opts, depth === 1)]));
    const probs = router.score(state, questions);
    calls++;
    const cands: [number, string, string[], 'node' | 'cause'][] = [];
    for (const [key, opts, pp, path, kind] of frontier) {
      const p = probs[key];
      const pUn = p[UNREL] ?? 0;
      if (depth === 1 && gate(p[NORMAL] ?? 0, pUn, tau, alpha, beta)) normalP = p[NORMAL];
      trace.push({ depth, node: key, probs: p });
      for (const [oid] of opts) if (gate(p[oid], pUn, tau, alpha, beta)) cands.push([pp * p[oid], oid, [...path, oid], kind]);
    }
    // Python sorts the tuples descending: probability first, then id.
    cands.sort((a, b) => b[0] - a[0] || (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
    const next: Frontier[] = [];
    for (const [prob, oid, path, kind] of depth < 4 ? cands.slice(0, beam) : cands) {
      if (kind === 'cause') {
        leaves[oid] = Math.max(leaves[oid] ?? 0, prob);
        continue;
      }
      if (kb.nodes[oid].layer < 3) {
        next.push([oid, children(oid).map((c) => [c.id, c.desc]), prob, path, 'node']);
      } else {
        // syndrome -> crop-filtered causes, possibly in several <=5 chunks
        (view[oid] ?? []).forEach((chunk, i) =>
          next.push([`${oid}#${i}`, chunk.map((cid) => [cid, kb.causes[cid].desc]), prob, path, 'cause']),
        );
      }
    }
    frontier = next;
  }

  // Normal anchor: compare the 'normal' causes directly when it was a contender at the top level.
  if (normalP > 0) {
    const normals = (view.NORMAL ?? [[]])[0];
    if (normals.length) {
      const p = router.score(state, { normal: question(normals.map((c) => [c, kb.causes[c].desc]), false) }).normal;
      calls++;
      for (const c of normals) leaves[c] = Math.max(leaves[c] ?? 0, normalP * p[c]);
    }
  }
  return { leaves, calls, trace };
}
