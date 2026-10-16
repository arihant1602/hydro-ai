"""Evaluate the advisor: python -m advisor.eval [--router lexical|laya|onnx|auto] [--kcc-limit N]

Reports
- scenario suite (advisor/eval/scenarios.json): top1/top3 + hard safety/contraindication requirements
- KCC suite (advisor/eval/kcc_eval.jsonl, real UP 2024 farmer queries): top1/top3 per cause
- invariants over every run: banned actives in actions, sprays with rain forecast, soil advice in hydroponics
- cost: router calls and latency per crop (must be flat across crops)
"""
import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path

from .. import kb as kbmod
from ..engine import Advisor
from ..router import get_router

HERE = Path(__file__).resolve().parent


def _ids(res):
    return [l["id"] for l in res.get("likely", [])]


def check_invariants(res, form, kb):
    """Rules that must hold for every single answer, whatever the model does."""
    problems = []
    banned = [b.split(" (")[0] for b in kb["rules"]["banned_actives"]["actives"]]
    for a in res.get("actions", []):
        low = a["text"].lower()
        if any(b in low for b in banned):
            problems.append(f"banned active in action: {a['text'][:60]}")
        tags = kb["strategies"][a["strategy"]]["tags"]
        if form.get("rain_forecast") and "spray" in tags:
            problems.append(f"spray advised with rain forecast: {a['strategy']}")
        if form.get("hydroponic") and "soil_only" in tags:
            problems.append(f"soil-only advice for hydroponics: {a['strategy']}")
        if not form.get("hydroponic") and "hydro_only" in tags:
            problems.append(f"hydroponic advice for a soil farm: {a['strategy']}")
    return problems


def run_scenarios(adv, kb):
    cases = json.loads((HERE / "scenarios.json").read_text())["cases"]
    rows = []
    for c in cases:
        form = dict(c.get("form", {}))
        res = adv.advise(c["text"], form=form, photo=c.get("photo"), sensors=c.get("sensors"),
                         stage_targets={"ec_ms_cm": [1.4, 2.0]} if c.get("sensors") else None)
        e, ids, fails = c["expect"], _ids(res), []
        top1 = top3 = None
        if "top" in e:
            top1 = bool(ids) and ids[0] in e["top"]
            top3 = any(i in e["top"] for i in ids[:3])
            if not top3:
                fails.append(f"got {ids[:3]}")
        if "safety" in e and (res.get("safety") or {}).get("kind") != e["safety"]:
            fails.append(f"safety {res.get('safety')}")
        if e.get("unrelated") and not res.get("unrelated"):
            fails.append("not flagged unrelated")
        strategies = {a["strategy"] for a in res.get("actions", [])}
        for s in e.get("no_strategy", []):
            if s in strategies:
                fails.append(f"recommended {s}")
        for s in e.get("has_strategy", []):
            if s not in strategies and top3:
                fails.append(f"missing {s}")
        for t in e.get("no_tag", []):
            if any(t in kb["strategies"][s]["tags"] for s in strategies):
                fails.append(f"recommended a '{t}' strategy")
        for a in e.get("avoid_actives", []):
            if any(a in x["text"].lower() for x in res.get("actions", [])):
                fails.append(f"recommended {a}")
        if e.get("no_bee_toxic"):
            bee = kb["rules"]["pollinator_toxic_actives"]
            if any(b in x["text"].lower() for x in res.get("actions", []) for b in bee):
                fails.append("bee-toxic insecticide at flowering")
        hard = [f for f in fails if not f.startswith("got ")]
        rows.append({"id": c["id"], "top1": top1, "top3": top3, "hard_fail": hard, "got": ids[:3],
                     "invariants": check_invariants(res, form, kb), "lang": c.get("lang", "en")})
    return rows


def run_kcc(adv, kb, limit=None):
    path = HERE / "kcc_eval.jsonl"
    if not path.exists():
        return None
    items = [json.loads(l) for l in path.read_text().splitlines()][:limit]
    per = defaultdict(lambda: [0, 0, 0])
    cost = defaultdict(list)
    inv = []
    for it in items:
        form = {"crop": it["crop"]}
        res = adv.advise(it["text"], form=form)
        ids = _ids(res)
        g = it["gold"][0]
        per[g][0] += 1
        per[g][1] += bool(ids) and ids[0] in it["gold"]
        per[g][2] += any(i in it["gold"] for i in ids[:3])
        if "router_calls" in res:
            cost[it["crop"]].append((res["router_calls"], res["latency_ms"]))
        inv += check_invariants(res, form, kb)
    return per, cost, inv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--router", default="auto", choices=["auto", "laya", "onnx", "lexical"])
    ap.add_argument("--kcc-limit", type=int)
    ap.add_argument("--json", help="also write results here")
    a = ap.parse_args()
    kb = kbmod.load()
    adv = Advisor(router=get_router(a.router))
    print(f"router: {adv.router.name}\n")

    sc = run_scenarios(adv, kb)
    scored = [r for r in sc if r["top1"] is not None]
    print(f"SCENARIOS  top1 {sum(r['top1'] for r in scored)}/{len(scored)}   top3 {sum(r['top3'] for r in scored)}/{len(scored)}   "
          f"hard-requirement failures {sum(bool(r['hard_fail']) for r in sc)}")
    for r in sc:
        mark = "ok " if (r["top1"] in (True, None) and not r["hard_fail"]) else ("~  " if r["top3"] and not r["hard_fail"] else "XX ")
        print(f"  {mark}{r['id']:24s} {'' if r['top1'] is None else 'top1' if r['top1'] else 'top3' if r['top3'] else 'miss'}  "
              f"{'; '.join(r['hard_fail'])}  {'' if r['top1'] else r['got']}")

    kcc = run_kcc(adv, kb, a.kcc_limit)
    inv_all = [p for r in sc for p in r["invariants"]]
    if kcc:
        per, cost, inv = kcc
        inv_all += inv
        n = sum(v[0] for v in per.values())
        print(f"\nKCC (real farmer queries, UP 2024)  n={n}   top1 {sum(v[1] for v in per.values()) / n:.1%}   "
              f"top3 {sum(v[2] for v in per.values()) / n:.1%}   macro-top1 {statistics.mean(v[1] / v[0] for v in per.values()):.1%}")
        for g, (cnt, t1, t3) in sorted(per.items(), key=lambda kv: -kv[1][0]):
            print(f"  {g:20s} n={cnt:3d}  top1 {t1 / cnt:5.0%}  top3 {t3 / cnt:5.0%}")
        print("\nCOST per crop (router calls, latency):")
        for crop, xs in sorted(cost.items()):
            calls = [c for c, _ in xs]
            print(f"  {crop:7s} calls mean {statistics.mean(calls):.2f} (min {min(calls)}, max {max(calls)})   "
                  f"latency mean {statistics.mean(l for _, l in xs):.1f} ms")
    print(f"\nINVARIANT VIOLATIONS: {len(inv_all)}")
    for p in inv_all[:10]:
        print("  ", p)
    if a.json:
        Path(a.json).write_text(json.dumps({"router": adv.router.name, "scenarios": sc,
                                            "kcc": {k: v for k, v in (kcc[0].items() if kcc else [])}}, indent=2))


if __name__ == "__main__":
    main()
