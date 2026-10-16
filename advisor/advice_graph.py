"""Stage 5: cause -> strategy DAG with deterministic contraindication filtering.

Every edge carries an evidence state (Supp, Part, Uncert, Unk, Contra). Contra edges are never shown
as actions; they are reported under "avoid" so the farmer knows what NOT to do and why. Strategy tags
are checked against context flags (rain, wind, harvest, hydroponic...), and every named active
ingredient is checked against the banned list and, at flowering, the pollinator-toxic list.
"""
from . import kb as kbmod

LADDER = ["check", "cultural", "mechanical", "biological", "nutrient", "chemical", "escalate"]
EV_RANK = {"Supp": 0, "Part": 1, "Uncert": 2, "Unk": 3}


def _norm(a):
    return a.lower().strip()


def _is_banned(active, banned):
    a = _norm(active)
    return any(b.split(" (")[0] in a for b in banned)


def build(cause_ids, flags, lang="en"):
    kb = kbmod.load()
    rules = kb["rules"]
    banned = [_norm(b) for b in rules["banned_actives"]["actives"]]
    bee_toxic = [_norm(b) for b in rules["pollinator_toxic_actives"]]
    by_tag = {c["blocks_tag"]: c for c in rules["contraindications"] if "blocks_tag" in c and flags.get(c["when"])}
    flowering_rule = next(c for c in rules["contraindications"] if c["id"] == "FLOWERING_BEES")
    banned_rule = next(c for c in rules["contraindications"] if c["id"] == "BANNED")

    actions, avoid, seen = [], [], set()
    for cid in cause_ids:
        cause = kb["causes"][cid]
        for edge in cause["advice"]:
            strat = kb["strategies"][edge["s"]]
            actives = list(edge.get("actives", []))
            if edge["ev"] == "Contra":
                avoid.append({"cause": cid, "text": f"Do not use {', '.join(actives) or strat[lang]}",
                              "reason": edge.get("why", "contraindicated for this problem")})
                continue
            blocked = [by_tag[t] for t in strat["tags"] if t in by_tag]
            if blocked:
                r = blocked[0]
                # Hydro/soil mismatches are irrelevant rather than dangerous: drop silently.
                if r["id"] not in ("HYDROPONIC", "SOIL_FARM"):
                    avoid.append({"cause": cid, "text": strat[lang].replace("{actives}", ", ".join(actives) or "-"),
                                  "reason": r[f"reason_{lang}"]})
                continue
            kept = []
            for a in actives:
                if _is_banned(a, banned):
                    avoid.append({"cause": cid, "text": f"Do not use {a}", "reason": banned_rule[f"reason_{lang}"].replace("{actives}", a)})
                elif flags.get("flowering") and any(b in _norm(a) for b in bee_toxic):
                    avoid.append({"cause": cid, "text": f"Avoid {a} now", "reason": flowering_rule[f"reason_{lang}"].replace("{actives}", a)})
                else:
                    kept.append(a)
            if actives and not kept:
                continue  # every suggested chemical was filtered out
            key = (edge["s"], tuple(kept))
            if key in seen:
                continue
            seen.add(key)
            text = strat[lang].replace("{actives}", ", ".join(kept))
            if edge.get("note"):
                text += f" ({edge['note']})"
            actions.append({"cause": cid, "strategy": edge["s"], "kind": strat["kind"], "evidence": edge["ev"], "text": text})
    actions.sort(key=lambda a: (LADDER.index(a["kind"]), EV_RANK.get(a["evidence"], 9)))
    dedup_avoid = list({(a["text"], a["reason"]): a for a in avoid}.values())
    return actions, dedup_avoid
