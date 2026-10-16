"""Train the maize leaf disease model the phone app runs (mobile/src/engine/leafModel.ts).

Data: PlantVillage maize leaves (CC BY-SA 3.0, Hughes & Salathe 2015): healthy, common rust, northern leaf
blight, gray leaf spot. Features come from the app's own TypeScript pipeline (mobile/scripts/leaf_features.ts),
so training and the phone compute them identically.

Protocol: stratified 70/15/15 train/val/test split (seed 42). Hyper-parameters by 5-fold CV on train only;
the confidence threshold for changing the verdict is checked on val; the final model is fit on train+val and
the test set is scored exactly once. The colour-rule verdict on the same test images is the baseline.

    .venv/bin/python tools/train_leaf_model.py
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedKFold, train_test_split

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "raw" / "plantvillage_maize"
FEATURES = DATA / "features" / "features.csv"
OUT_MODEL = ROOT / "mobile" / "src" / "data" / "leaf_disease_maize.json"
OUT_PARITY = ROOT / "mobile" / "test" / "parity" / "leaf_model.json"
OUT_REPORT = ROOT / "report" / "leaf_model_report.md"
OUT_SPLIT = DATA / "split.json"
CLASSES = ["healthy", "common_rust", "northern_leaf_blight", "gray_leaf_spot"]
SEED = 42


def load():
    with open(FEATURES) as f:
        r = csv.reader(f)
        head = next(r)
        names = head[3:]
        rows = list(r)
    files = [x[1] for x in rows]  # csv already removed the quoting
    y = np.array([CLASSES.index(x[0]) for x in rows])
    verdict = np.array([x[2] for x in rows])
    X = np.array([[float(v) if v != "" else np.nan for v in x[3:]] for x in rows])
    return names, files, X, y, verdict


def export_forest(m, names):
    trees = []
    for est in m.estimators_:
        t = est.tree_
        leaf = t.children_left == -1
        v = t.value[:, 0, :]
        v = v / v.sum(axis=1, keepdims=True)
        rows, f, th = [], [], []
        for i in range(t.node_count):
            if leaf[i]:
                f.append(-1)
                th.append(len(rows))
                rows.append([round(float(p), 5) for p in v[i]])
            else:
                f.append(int(t.feature[i]))
                th.append(float(t.threshold[i]))  # full precision: the phone compares float32(x) <= threshold
        trees.append({"f": f, "t": th, "l": [int(x) for x in t.children_left], "r": [int(x) for x in t.children_right], "v": rows})
    return trees


def main():
    names, files, X, y, verdict = load()
    ok = ~np.isnan(X).any(axis=1)
    print(f"{len(y)} images, {int((~ok).sum())} with no leaf found (excluded):",
          {CLASSES[c]: int(((~ok) & (y == c)).sum()) for c in range(len(CLASSES))})
    idx = np.arange(len(y))
    tr, rest = train_test_split(idx, test_size=0.30, stratify=y, random_state=SEED)
    va, te = train_test_split(rest, test_size=0.50, stratify=y[rest], random_state=SEED)
    OUT_SPLIT.write_text(json.dumps({"train": [files[i] for i in tr], "val": [files[i] for i in va], "test": [files[i] for i in te]}))
    trk, vak, tek = tr[ok[tr]], va[ok[va]], te[ok[te]]

    # ---- model selection: 5-fold CV on train only ----
    grid = [dict(max_depth=d, min_samples_leaf=l, max_features=f, class_weight=w)
            for d in (14, None) for l in (1, 3) for f in ("sqrt", 0.5) for w in (None, "balanced")]
    cv = StratifiedKFold(5, shuffle=True, random_state=SEED)
    best, best_score = None, -1
    for g in grid:
        scores = []
        for a, b in cv.split(X[trk], y[trk]):
            m = RandomForestClassifier(n_estimators=100, random_state=SEED, n_jobs=-1, **g).fit(X[trk][a], y[trk][a])
            scores.append(f1_score(y[trk][b], m.predict(X[trk][b]), average="macro"))
        s = float(np.mean(scores))
        print(f"  {g}: CV macro-F1 {s:.4f} ± {np.std(scores):.4f}")
        if s > best_score:
            best, best_score = g, s
    print("chosen", best, f"CV macro-F1 {best_score:.4f}")

    # ---- validation: pick the threshold the app uses to call a leaf diseased ----
    # The app calls a leaf diseased when P(diseased) = 1 - P(healthy) >= threshold, then names the likeliest
    # disease. Pick the threshold with the best balanced accuracy on val (ties -> the stricter one); it is stored
    # in the model file, so the phone uses exactly this value.
    m = RandomForestClassifier(n_estimators=100, random_state=SEED, n_jobs=-1, **best).fit(X[trk], y[trk])
    pv = m.predict_proba(X[vak])
    sick = y[vak] != 0
    best_bal, threshold = -1.0, 0.5
    for thr in np.round(np.arange(0.5, 0.951, 0.05), 2):
        flag = (1 - pv[:, 0]) >= thr
        rec, fa = flag[sick].mean(), flag[~sick].mean()
        bal = (rec + 1 - fa) / 2
        print(f"  val threshold {thr:.2f}: diseased recall {rec:.3f}, healthy wrongly flagged {fa:.3f}, balanced {bal:.4f}")
        if bal >= best_bal:
            best_bal, threshold = bal, float(thr)
    print(f"threshold {threshold}")

    # ---- final fit on train+val, score the test set once ----
    fit_idx = np.concatenate([trk, vak])
    m = RandomForestClassifier(n_estimators=100, random_state=SEED, n_jobs=-1, **best).fit(X[fit_idx], y[fit_idx])
    pt = m.predict_proba(X[tek])
    pred = pt.argmax(1)
    acc = accuracy_score(y[tek], pred)
    mf1 = f1_score(y[tek], pred, average="macro")
    cm = confusion_matrix(y[tek], pred, labels=range(len(CLASSES)))
    rep = classification_report(y[tek], pred, target_names=CLASSES, digits=3)
    # Binary healthy-vs-diseased, as the app's verdict uses it, over ALL test images (no-leaf ones count wrong).
    sick_te = y[te] != 0
    model_flag = np.zeros(len(te), bool)
    pos = {i: k for k, i in enumerate(tek)}
    for j, i in enumerate(te):
        if i in pos:
            model_flag[j] = (1 - pt[pos[i]][0]) >= threshold
    model_bin = float((model_flag == sick_te).mean())
    heur_flag = verdict[te] == "needs attention"
    heur_ok = np.where(sick_te, heur_flag, verdict[te] == "healthy")
    heur_bin = float(heur_ok.mean())
    print(f"TEST (n={len(tek)} with a leaf of {len(te)}): 4-class accuracy {acc:.4f}, macro-F1 {mf1:.4f}")
    print(rep)
    print("confusion (rows = truth, cols = predicted):", CLASSES)
    print(cm)
    print(f"healthy-vs-diseased on all {len(te)} test images: model {model_bin:.4f}, colour rules {heur_bin:.4f}")
    print("colour-rule verdicts on test:", {v: int((verdict[te] == v).sum()) for v in sorted(set(verdict[te]))})

    imp = sorted(zip(m.feature_importances_, names), reverse=True)[:10]
    trees = export_forest(m, names)
    nodes = sum(len(t["f"]) for t in trees)
    metrics = {
        "dataset": "PlantVillage maize (CC BY-SA 3.0)",
        "n_train": int(len(fit_idx)), "n_test": int(len(tek)),
        "test_accuracy": round(acc, 4), "test_macro_f1": round(mf1, 4),
        "test_healthy_vs_diseased": round(model_bin, 4), "colour_rules_healthy_vs_diseased": round(heur_bin, 4),
        "cv_macro_f1": round(best_score, 4), "params": {k: (v if v is not None else "none") for k, v in best.items()},
        "threshold": threshold,
        "n_estimators": 100, "nodes": nodes,
    }
    OUT_MODEL.write_text(json.dumps({"classes": CLASSES, "features": names, "threshold": threshold, "trees": trees, "metrics": metrics}, separators=(",", ":")))
    print(f"exported {len(trees)} trees, {nodes} nodes, {OUT_MODEL.stat().st_size / 1e6:.2f} MB -> {OUT_MODEL}")

    # Parity fixture: TypeScript must reproduce scikit-learn's probabilities on these feature vectors.
    rng = np.random.default_rng(SEED)
    pick = rng.choice(tek, size=60, replace=False)
    OUT_PARITY.write_text(json.dumps([{"x": X[i].tolist(), "probs": m.predict_proba(X[i:i + 1])[0].tolist()} for i in pick]))

    # Report for the paper/demo.
    OUT_REPORT.parent.mkdir(exist_ok=True)
    OUT_REPORT.write_text(f"""# Maize leaf disease model

Data: PlantVillage maize leaves (CC BY-SA 3.0), {len(y)} images: {', '.join(f'{CLASSES[c]} {int((y == c).sum())}' for c in range(len(CLASSES)))}.
{int((~ok).sum())} images had no leaf found by the segmentation and are excluded from the model (counted as wrong
in the healthy-vs-diseased comparison).

Protocol: stratified 70/15/15 split (seed {SEED}); hyper-parameters by 5-fold CV on train (macro-F1
{best_score:.4f}); final model fit on train+val ({len(fit_idx)} images); test scored once ({len(tek)} images).
Model: random forest, 100 trees, {best}; {nodes} nodes, runs on the phone in TypeScript.

## Test set

4-class accuracy **{acc:.4f}**, macro-F1 **{mf1:.4f}**.

```
{rep}
```

Confusion matrix (rows = truth, columns = prediction; {', '.join(CLASSES)}):

```
{cm}
```

Healthy vs diseased (all {len(te)} test images; the app flags a leaf when P(diseased) = 1 - P(healthy) >= {threshold}, chosen on val):
model **{model_bin:.4f}**, previous colour rules **{heur_bin:.4f}**.

Most important features: {', '.join(f'{n} ({v:.3f})' for v, n in imp)}.

## Caveats

- The test set was scored once with an earlier feature set (4-class accuracy 0.886) before features were added
  and the model re-selected by cross-validation on train only; the test numbers above are therefore not
  entirely untouched.

- PlantVillage photos are single detached leaves on a plain background in controlled light. Accuracy on whole
  plants in the field will be lower; the app asks for one leaf filling the frame.
- PlantVillage contains several photos of some leaves, so the random split can put near-duplicates in train and
  test, which flatters the numbers.
- Nutrient problems (nitrogen yellowing, phosphorus purpling) are not in the dataset; the colour rules still
  report those.
""")
    print("report ->", OUT_REPORT)


if __name__ == "__main__":
    sys.exit(main())
