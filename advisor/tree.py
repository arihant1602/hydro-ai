"""Stage 3: batched beam traversal of the crop-agnostic tree with the paper-style activation gate.

At each level every frontier node becomes one question (its children + anchors), and all questions of
a level go to the router in ONE call. The number of router calls per query is therefore fixed by the
tree depth (4), whatever the crop.
"""
from . import kb as kbmod

UNREL, NORMAL = "__unrelated", "__normal"


def gate(p, p_unrel, tau, alpha, beta):
    """Eq. 5 of the reference paper: absolute threshold, or relative threshold when the
    'unrelated' anchor is not dominant and the option clears an absolute floor."""
    return p >= tau or (p_unrel < alpha and p / max(1e-9, 1 - p_unrel) >= tau and p >= beta)


def _question(kb, opts, with_normal):
    criteria = {o: desc for o, desc in opts}
    criteria[UNREL] = kb["anchors"]["unrelated"]["desc"]
    if with_normal:
        criteria[NORMAL] = kb["anchors"]["normal"]["desc"]
    return {"type": "choice", "instructions": "Which best describes the farmer's crop problem?", "criteria": criteria}


def traverse(router, state, crop, tau=0.30, alpha=0.85, beta=0.05, beam=3):
    kb = kbmod.load()
    view = kbmod.crop_view(crop)
    calls = 0
    trace = []
    leaves = {}          # cause_id -> path probability
    normal_p = 0.0

    # frontier items: (question key, options [(id, desc)], parent path prob, path, kind)
    l1 = [(n["id"], n["desc"]) for n in kbmod.children(kb, None)]
    frontier = [("root", l1, 1.0, [], "node")]
    for depth in range(1, 5):
        if not frontier:
            break
        questions = {key: _question(kb, opts, with_normal=(depth == 1)) for key, opts, _, _, _ in frontier}
        probs = router.score(state, questions)
        calls += 1
        candidates = []
        for key, opts, pp, path, kind in frontier:
            p = probs[key]
            p_un = p.get(UNREL, 0.0)
            if depth == 1 and gate(p.get(NORMAL, 0.0), p_un, tau, alpha, beta):
                normal_p = p[NORMAL]  # 'normal' competes like any other top-level branch
            trace.append({"depth": depth, "node": key, "probs": {k: round(v, 3) for k, v in p.items()}})
            for oid, _ in opts:
                if gate(p[oid], p_un, tau, alpha, beta):
                    candidates.append((pp * p[oid], oid, path + [oid], kind))
        candidates.sort(reverse=True)
        next_frontier = []
        for prob, oid, path, kind in candidates[:beam] if depth < 4 else candidates:
            if kind == "cause":
                leaves[oid] = max(leaves.get(oid, 0.0), prob)
                continue
            node_layer = kb["nodes"][oid]["layer"]
            if node_layer < 3:
                opts = [(c["id"], c["desc"]) for c in kbmod.children(kb, oid)]
                next_frontier.append((oid, opts, prob, path, "node"))
            else:  # syndrome -> crop-filtered causes, possibly in several <=5 chunks
                for i, chunk in enumerate(view.get(oid, [])):
                    opts = [(cid, kb["causes"][cid]["desc"]) for cid in chunk]
                    next_frontier.append((f"{oid}#{i}", opts, prob, path, "cause"))
        frontier = next_frontier

    # Normal anchor: compare the 'normal' causes directly when it was a contender at the top level.
    if normal_p > 0:
        normals = view.get("NORMAL", [[]])[0]
        if normals:
            q = {"normal": _question(kb, [(c, kb["causes"][c]["desc"]) for c in normals], with_normal=False)}
            p = router.score(state, q)["normal"]
            calls += 1
            for c in normals:
                leaves[c] = max(leaves.get(c, 0.0), normal_p * p[c])
    return {"leaves": leaves, "calls": calls, "trace": trace}
