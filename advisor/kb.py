"""Load, validate and slice the knowledge base.

The KB is plain JSON so the phone app can ship the exact same files. `crop_view(crop)` returns the
tree as seen for one crop: universal L1-L3 nodes plus only the L4 causes that host that crop, with
fan-out capped so every crop costs the same number of router passes.
"""
import json
from functools import lru_cache
from pathlib import Path

KB_DIR = Path(__file__).resolve().parent / "kb"
MAX_FANOUT = 5
LAYERS = {1: "domain", 2: "agent class", 3: "syndrome", 4: "cause"}


@lru_cache
def load():
    tree = json.loads((KB_DIR / "universal" / "tree.json").read_text())
    causes = []
    for f in sorted((KB_DIR / "causes").glob("*.json")):
        causes += json.loads(f.read_text())["causes"]
    kb = {
        "anchors": tree["anchors"],
        "nodes": {n["id"]: n for n in tree["nodes"]},
        "causes": {c["id"]: c for c in causes},
        "strategies": {s["id"]: s for s in json.loads((KB_DIR / "strategies.json").read_text())["strategies"]},
        "rules": json.loads((KB_DIR / "rules.json").read_text()),
        "crops": json.loads((KB_DIR / "crops.json").read_text())["crops"],
    }
    validate(kb)
    return kb


def validate(kb):
    """Fail loudly on dangling references; cheap enough to run on every load."""
    errors = []
    nodes, causes, strategies = kb["nodes"], kb["causes"], kb["strategies"]
    for n in nodes.values():
        if n["parent"] is not None and n["parent"] not in nodes:
            errors.append(f"node {n['id']}: unknown parent {n['parent']}")
    for c in causes.values():
        for s in c["syndromes"]:
            if s != "NORMAL" and s not in nodes:
                errors.append(f"cause {c['id']}: unknown syndrome {s}")
        for a in c["advice"]:
            if a["s"] not in strategies:
                errors.append(f"cause {c['id']}: unknown strategy {a['s']}")
            if a["ev"] not in {"Supp", "Part", "Uncert", "Unk", "Contra"}:
                errors.append(f"cause {c['id']}: bad evidence state {a['ev']}")
        for h in c["hosts"]:
            if h != "*" and h not in kb["crops"] and h not in KNOWN_EXTRA_HOSTS:
                errors.append(f"cause {c['id']}: unknown host {h}")
    for nid in nodes:
        kids = [k for k in nodes.values() if k["parent"] == nid]
        if len(kids) > MAX_FANOUT:
            errors.append(f"node {nid}: fan-out {len(kids)} > {MAX_FANOUT}")
    if errors:
        raise ValueError("knowledge base invalid:\n  " + "\n  ".join(errors))


# Hosts named on shared causes for crops not yet profiled in crops.json (kept so adding them later
# is just a crops.json entry).
KNOWN_EXTRA_HOSTS = {"sorghum", "sugarcane", "groundnut", "chilli", "brinjal", "cotton", "okra", "capsicum",
                     "watermelon", "chickpea"}


def children(kb, node_id):
    return [n for n in kb["nodes"].values() if n["parent"] == node_id]


@lru_cache
def crop_view(crop):
    """L4 causes for this crop, grouped by syndrome, each group split into chunks of <= MAX_FANOUT."""
    kb = load()
    if crop not in kb["crops"]:
        raise KeyError(f"unknown crop {crop!r}; known: {sorted(kb['crops'])}")
    by_syn = {}
    for c in kb["causes"].values():
        if "*" in c["hosts"] or crop in c["hosts"]:
            for s in c["syndromes"]:
                by_syn.setdefault(s, []).append(c["id"])
    # Specific (crop-listed) causes before universal ones, so chunking keeps a crop's own problems together.
    for s, ids in by_syn.items():
        ids.sort(key=lambda i: ("*" in kb["causes"][i]["hosts"], i))
        by_syn[s] = [ids[i:i + MAX_FANOUT] for i in range(0, len(ids), MAX_FANOUT)]
    return by_syn


def stage_of(crop, day):
    stages = load()["crops"][crop]["stages"]
    for name, (lo, hi) in stages.items():
        if lo <= day <= hi:
            return name
    return "maturity" if day > max(hi for _, hi in stages.values()) else "establish"


def detect_crop(text):
    """Crop named in free text (English, Hinglish or Hindi), or None."""
    t = text.lower()
    for crop, p in load()["crops"].items():
        if any(s in t for s in p["synonyms"]):
            return crop
    return None
