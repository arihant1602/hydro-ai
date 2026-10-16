"""Analyse the Kaggle crop-recommendation dataset and produce artifacts for the hydroponic system.

Outputs:
  analysis/output/crop_report.md        per-crop envelopes + indoor-feasibility ranking
  analysis/output/*.png                 figures for the report/presentation
  config/dataset_envelope.json          5th-95th percentile envelope for the chosen crop
  models/suitability_<crop>.joblib      "how maize-like are current conditions" classifier

Usage: python analysis/analyze_dataset.py [--crop maize]
"""
import argparse
import json
from pathlib import Path

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "raw" / "Crop_recommendation.csv"
OUT = ROOT / "analysis" / "output"
# Features a small ESP32 rig can realistically measure. N/P/K need a lab test or an
# expensive ion-selective probe, rainfall is meaningless indoors.
SENSED = ["temperature", "humidity", "ph"]
ALL = ["N", "P", "K", "temperature", "humidity", "ph", "rainfall"]

# Rough room conditions for an Indian indoor setup (no chiller/heater).
ROOM_TEMP, ROOM_HUM = 28.0, 60.0


def envelopes(df):
    q = df.groupby("label")[ALL].quantile([0.05, 0.95]).unstack()
    return {
        crop: {c: [round(q.loc[crop, (c, 0.05)], 2), round(q.loc[crop, (c, 0.95)], 2)] for c in ALL}
        for crop in q.index
    }


def feasibility(env):
    """Lower = easier to hold indoors: distance of the crop's climate band from room conditions
    plus how wide (forgiving) the band is."""
    rows = []
    for crop, e in env.items():
        t_lo, t_hi = e["temperature"]
        h_lo, h_hi = e["humidity"]
        t_gap = max(0, t_lo - ROOM_TEMP, ROOM_TEMP - t_hi)
        h_gap = max(0, h_lo - ROOM_HUM, ROOM_HUM - h_hi)
        rows.append({"crop": crop, "temp_band": f"{t_lo:.1f}-{t_hi:.1f}", "hum_band": f"{h_lo:.0f}-{h_hi:.0f}",
                     "ph_band": f"{e['ph'][0]:.2f}-{e['ph'][1]:.2f}",
                     "temp_gap_c": round(t_gap, 1), "hum_gap_pct": round(h_gap, 1),
                     "control_effort": round(t_gap * 3 + h_gap, 1)})
    return pd.DataFrame(rows).sort_values("control_effort")


def train_suitability(df, crop):
    y = df["label"] == crop
    clf = RandomForestClassifier(n_estimators=300, class_weight="balanced", random_state=0, min_samples_leaf=3)
    auc = cross_val_score(clf, df[SENSED], y, cv=5, scoring="roc_auc").mean()
    clf.fit(df[SENSED], y)
    return clf, auc


def figures(df, crop):
    fig, ax = plt.subplots(figsize=(7, 5))
    other = df[df.label != crop]
    mine = df[df.label == crop]
    ax.scatter(other.temperature, other.humidity, s=6, c="#bbb", label="other 21 crops")
    ax.scatter(mine.temperature, mine.humidity, s=12, c="#2a9d8f", label=crop)
    ax.set_xlabel("Air temperature (°C)")
    ax.set_ylabel("Relative humidity (%)")
    ax.set_title(f"{crop}: climate envelope vs other crops")
    ax.legend()
    fig.tight_layout()
    fig.savefig(OUT / f"{crop}_climate_envelope.png", dpi=130)

    fig, axes = plt.subplots(1, 4, figsize=(13, 3.5))
    for ax, col in zip(axes, ["N", "P", "K", "ph"]):
        ax.hist(mine[col], bins=15, color="#2a9d8f")
        ax.set_title(f"{crop} {col}")
    fig.tight_layout()
    fig.savefig(OUT / f"{crop}_nutrients.png", dpi=130)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--crop", default="maize")
    args = ap.parse_args()
    crop = args.crop
    OUT.mkdir(parents=True, exist_ok=True)
    (ROOT / "models").mkdir(exist_ok=True)

    df = pd.read_csv(DATA)
    if crop not in set(df.label):
        raise SystemExit(f"unknown crop {crop!r}; choose from {sorted(df.label.unique())}")

    env = envelopes(df)
    feas = feasibility(env)
    clf, auc = train_suitability(df, crop)
    joblib.dump({"model": clf, "features": SENSED, "crop": crop, "cv_auc": round(auc, 3)},
                ROOT / "models" / f"suitability_{crop}.joblib")
    (ROOT / "config" / "dataset_envelope.json").write_text(json.dumps({"crop": crop, "envelope": env[crop]}, indent=2))
    figures(df, crop)

    e = env[crop]
    report = [
        "# Crop recommendation dataset: analysis",
        "",
        f"- Rows: {len(df)}, crops: {df.label.nunique()}, rows per crop: {df.label.value_counts().iloc[0]} (perfectly balanced)",
        "- Ranges look synthetic: every crop has an N spread of ~40, P ~25 and K ~10, sampled uniformly.",
        "- The data is soil-based and has no growth stage or yield column. It defines *where a crop is happy*,",
        "  not *what maximises yield*, so we use it as a prior and learn the rest from our own sensor logs.",
        "",
        f"## Chosen crop: {crop}",
        "",
        "| Parameter | 5th-95th percentile |",
        "|---|---|",
        *[f"| {k} | {v[0]} - {v[1]} |" for k, v in e.items()],
        "",
        f"Suitability model ({'+'.join(SENSED)} only, {crop} vs rest): 5-fold ROC-AUC = **{auc:.3f}**",
        "",
        f"## Indoor feasibility ranking (room ~{ROOM_TEMP:.0f} °C / {ROOM_HUM:.0f}% RH)",
        "",
        "`control_effort` = how far the crop's climate band sits from room conditions (temperature weighted 3x,",
        "since heating/cooling is harder than misting). Lower is easier.",
        "",
        feas.to_markdown(index=False),
        "",
    ]
    (OUT / "crop_report.md").write_text("\n".join(report))
    print("\n".join(report[:20]))
    print(f"\nwrote {OUT/'crop_report.md'}, config/dataset_envelope.json, models/suitability_{crop}.joblib")


if __name__ == "__main__":
    main()
