"""Export everything the phone app needs to run offline into mobile/src/data/.

- suitability_<crop>.json  the random forest from analysis/analyze_dataset.py as flat per-tree arrays,
                           evaluated in TypeScript by mobile/src/engine/suitability.ts
- <crop>.json, dataset_envelope.json   stage targets (copied from config/)
- kb.json                  the advisor knowledge base (advisor/kb/), merged into one file
- parity/*.json            Python reference outputs the TypeScript ports are tested against

    .venv/bin/python tools/export_mobile_assets.py
"""
import json
import shutil
import sys
from pathlib import Path

import joblib
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
OUT = ROOT / "mobile" / "src" / "data"
PARITY = ROOT / "mobile" / "test" / "parity"


def export_forest(crop):
    b = joblib.load(ROOT / "models" / f"suitability_{crop}.joblib")
    m = b["model"]
    pos = list(m.classes_).index(True)
    trees = []
    for est in m.estimators_:
        t = est.tree_
        v = t.value[:, 0, :]
        p = v[:, pos] / v.sum(axis=1)
        leaf = t.children_left == -1
        trees.append({
            # Leaves get feature -1; their threshold slot holds P(crop) instead.
            "f": [int(x) if not l else -1 for x, l in zip(t.feature, leaf)],
            "t": [round(float(pp if l else th), 6) for th, pp, l in zip(t.threshold, p, leaf)],
            "l": [int(x) for x in t.children_left],
            "r": [int(x) for x in t.children_right],
        })
    (OUT / f"suitability_{crop}.json").write_text(json.dumps(
        {"crop": crop, "features": b["features"], "cv_auc": b["cv_auc"], "trees": trees}, separators=(",", ":")))

    rng = np.random.default_rng(0)
    X = np.column_stack([rng.uniform(12, 38, 200), rng.uniform(30, 98, 200), rng.uniform(4.5, 8.5, 200)])
    import pandas as pd
    probs = m.predict_proba(pd.DataFrame(X, columns=b["features"]))[:, pos]
    (PARITY / f"suitability_{crop}.json").write_text(json.dumps(
        [{"x": [round(float(a), 6) for a in x], "p": float(pr)} for x, pr in zip(X, probs)]))


def export_kb():
    from advisor import kb as kbmod
    kb = kbmod.load()  # validates
    (OUT / "kb.json").write_text(json.dumps({
        "anchors": kb["anchors"], "nodes": list(kb["nodes"].values()), "causes": list(kb["causes"].values()),
        "strategies": list(kb["strategies"].values()), "rules": kb["rules"], "crops": kb["crops"],
    }, ensure_ascii=False, separators=(",", ":")))


def export_advisor_parity():
    from advisor.engine import Advisor
    from advisor.router import LexicalRouter
    adv = Advisor(router=LexicalRouter())
    cases = [
        ("makka ke patte peele ho rahe hain", {"crop": "maize", "day": 40}),
        ("leaves turning yellow from the tip", {"crop": "wheat", "day": 50}),
        ("long grey tan lesions on maize leaves after humid weather", {"crop": "maize", "day": 45, "weather": ["humid"]}),
        ("caterpillar eating the whorl, sawdust like frass", {"crop": "maize", "day": 30}),
        ("tomato leaves have brown spots with rings", {"crop": "tomato", "day": 60, "rain_forecast": True}),
        ("plants look healthy and green", {"crop": "maize", "day": 20}),
        ("what is the mandi price of wheat", {"crop": "wheat"}),
        ("I drank pesticide by mistake", {"crop": "maize"}),
        ("leaves purple in cold nights", {"crop": "maize", "day": 15, "weather": ["cold"], "hydroponic": True}),
    ]
    photo = {"verdict": "needs attention", "yellow_frac": 0.22, "lesion_frac": 0.01, "lesions": 1,
             "brown_frac": 0.02, "purple_frac": 0.0, "dgci": 0.41}
    sensors = {"air_temp": 31.0, "humidity": 84.0, "ph": 6.1, "ec": 1.1}
    out = []
    for i, (text, form) in enumerate(cases):
        kw = {"photo": photo, "sensors": sensors} if i == 0 else {}
        r = adv.advise(text, form=dict(form), **kw)
        r.pop("latency_ms", None)
        r.pop("debug", None)
        out.append({"text": text, "form": form, **kw, "result": r})
    (PARITY / "advisor.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))


def export_optimizer_parity():
    """40 simulated days (10-min readings) of a plant whose uptake peaks at 24 °C / 65 % RH, run through the
    real daily_table/fit/recommend with db.query patched to serve them."""
    from hydro import db, optimizer
    rng = np.random.default_rng(1)
    planted = 1_700_000_000.0
    readings, acts = [], []
    level = 20.0
    for d in range(40):
        t_set, h_set = 24 + rng.uniform(-3, 3), 65 + rng.uniform(-8, 8)
        size = 0.05 + 0.04 * d
        rate = size * np.exp(-((t_set - 24) / 4) ** 2 - ((h_set - 65) / 15) ** 2)  # L/day
        for i in range(144):
            ts = planted + d * 86400 + i * 600
            hour = (i * 10) // 60
            light = bool(6 <= hour < 22)
            level -= rate / 144
            pump = bool(level < 8)
            if pump:
                level = 20.0
            readings.append({"ts": ts, "air_temp": round(t_set + rng.normal(0, 0.3), 2),
                             "humidity": round(h_set + rng.normal(0, 1), 1), "ph": None, "ec": None,
                             "water_liters": round(level + rng.normal(0, 0.03), 3)})
            acts.append({"ts": ts, "states": json.dumps({"light": light, "refill_pump": pump})})

    def fake_query(sql, params=()):
        return readings if "FROM readings" in sql else acts
    real = db.query
    optimizer.db.query = fake_query
    try:
        days = optimizer.daily_table("maize", planted)
        f = optimizer.fit("maize", planted, 40)
        rec = optimizer.recommend("maize", planted, 40, set(), explore=False)
    finally:
        optimizer.db.query = real
    (PARITY / "optimizer.json").write_text(json.dumps({
        "planted_at": planted,
        "readings": readings,
        "acts": [{"ts": a["ts"], "states": json.loads(a["states"])} for a in acts],
        "days": json.loads(days.reset_index(drop=True).to_json(orient="records")),
        "fit": {k: f[k] for k in ("n_days", "r2", "cv_r2", "vars")},
        "setpoints": rec["setpoints"], "model_weight": rec["model_weight"],
    }))


def synthetic_leaf():
    """A drawn maize leaf with a yellow tip, tan lesions and a purple patch on a grey background, so the
    parity test exercises every branch of the analyser (the stored photos may not contain a plant)."""
    from PIL import Image, ImageDraw, ImageFilter
    img = Image.new("RGB", (640, 480), (150, 150, 145))
    d = ImageDraw.Draw(img)
    d.polygon([(40, 300), (300, 170), (600, 120), (590, 160), (300, 250), (60, 340)], fill=(52, 128, 40))
    d.polygon([(500, 135), (600, 120), (590, 160), (500, 175)], fill=(215, 190, 40))   # chlorotic tip
    for x, y in ((220, 240), (330, 205), (390, 195)):
        d.ellipse((x - 22, y - 8, x + 22, y + 8), fill=(160, 110, 60))                 # lesions
    d.ellipse((120, 270, 160, 295), fill=(120, 50, 140))                               # purpling
    path = ROOT / "data" / "photos" / "_synthetic_leaf.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    img.filter(ImageFilter.GaussianBlur(1)).save(path)
    return path


def export_vision_parity():
    from hydro import vision
    photos = sorted((ROOT / "data" / "photos").glob("*.jpg"))[:4] + [synthetic_leaf()]
    out = []
    for p in photos:
        from PIL import Image, ImageOps
        img = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
        img.thumbnail((vision.WORK_SIDE, vision.WORK_SIDE))
        # Same 512 px JPEG the phone produces, so both sides analyse identical pixels.
        small = PARITY / f"vision_{p.stem}.jpg"
        img.save(small, quality=92)
        vision.ANALYSIS_DIR = PARITY / "_overlay"
        r = vision.analyse_image(small)
        # Also the exact pixels PIL decoded, so the test can check the algorithm apart from JPEG decoding.
        dec = Image.open(small).convert("RGB")
        (PARITY / f"{small.stem}.rgb").write_bytes(dec.tobytes())
        shutil.rmtree(PARITY / "_overlay", ignore_errors=True)
        out.append({"file": small.name, "raw": f"{small.stem}.rgb", "size": dec.size, "result": {k: v for k, v in r.items() if k != "overlay"}})
    (PARITY / "vision.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    PARITY.mkdir(parents=True, exist_ok=True)
    for f in ("maize.json", "dataset_envelope.json"):
        shutil.copy(ROOT / "config" / f, OUT / f)
    export_forest("maize")
    export_kb()
    export_advisor_parity()
    export_vision_parity()
    export_optimizer_parity()
    for f in sorted(OUT.iterdir()):
        print(f"{f.relative_to(ROOT)}  {f.stat().st_size // 1024} KB")
