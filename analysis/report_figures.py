"""Figures for report/REPORT.md. Run analyze_dataset.py and run_experiments.py first."""
import glob
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.patches import FancyBboxPatch

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "report" / "data"
FIG = ROOT / "report" / "figures"
GREEN, GREY, RED, BLUE, AMBER = "#2a9d8f", "#b8bdb9", "#d1495b", "#3d7ab8", "#e9a23b"
TRUE_OPT = {"air_temp_c": 24.0, "light_hours": 17.0}  # hidden optimum in simulator/simulate.py
plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})


def save(fig, name):
    fig.tight_layout()
    fig.savefig(FIG / name, dpi=150)
    plt.close(fig)


def architecture():
    fig, ax = plt.subplots(figsize=(10, 3.6))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 3.6)
    ax.axis("off")
    boxes = {
        "esp": (0.1, 1.2, 2.2, 1.4, "ESP32 node\nDHT22 · HC-SR04\n(+ pH · TDS later)\nrelays"),
        "srv": (3.4, 0.9, 3.0, 2.0, "FastAPI server\nstage profile · suitability model\noptimizer (ML setpoints)\ncontroller · alerts · SQLite"),
        "ui": (7.5, 2.0, 2.3, 1.1, "Web dashboard\nlive charts · alerts"),
        "ph": (7.5, 0.4, 2.3, 1.1, "Phone (ntfy)\ncritical alerts"),
    }
    for x, y, w, h, text in boxes.values():
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.05", fc="#eef6f4", ec=GREEN, lw=1.5))
        ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=9)
    arrow = dict(arrowstyle="-|>", color="#444", lw=1.3)
    ax.annotate("", (3.4, 2.2), (2.3, 2.2), arrowprops=arrow)
    ax.text(2.85, 2.35, "readings (JSON, 10 s)", ha="center", fontsize=8)
    ax.annotate("", (2.3, 1.6), (3.4, 1.6), arrowprops=arrow)
    ax.text(2.85, 1.3, "actuator commands", ha="center", fontsize=8)
    ax.annotate("", (7.5, 2.5), (6.4, 2.3), arrowprops=arrow)
    ax.annotate("", (7.5, 0.95), (6.4, 1.3), arrowprops=arrow)
    save(fig, "architecture.png")


def feasibility():
    md = (ROOT / "analysis" / "output" / "crop_report.md").read_text().splitlines()
    rows = [l for l in md if l.startswith("| ") and "crop" not in l]
    df = pd.DataFrame([[c.strip() for c in r.strip("|").split("|")] for r in rows])
    df = df[[0, 6]].rename(columns={0: "crop", 6: "effort"}).dropna()
    df = df[df.effort.str.replace(".", "", regex=False).str.isdigit()]
    df["effort"] = df.effort.astype(float)
    df = df.sort_values("effort")
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.barh(df.crop, df.effort, color=[GREEN if c == "maize" else GREY for c in df.crop])
    ax.invert_yaxis()
    ax.set_xlabel("Control effort vs. a 28 °C / 60 % RH room (lower = easier)")
    save(fig, "feasibility.png")


def stage_targets():
    stages = json.loads((ROOT / "config" / "maize.json").read_text())["stages"]
    names = [s["name"].replace("_", " ") for s in stages]
    fig, axes = plt.subplots(1, 4, figsize=(12, 3))
    for ax, (key, label, color) in zip(axes, [("air_temp_c", "Air temp (°C)", RED), ("humidity_pct", "Humidity (%)", BLUE),
                                              ("ec_ms_cm", "EC (mS/cm)", AMBER), ("ph", "pH", "#8a5cc2")]):
        lo = [s[key][0] for s in stages]
        hi = [s[key][1] for s in stages]
        ax.bar(names, [h - l for l, h in zip(lo, hi)], bottom=lo, color=color, alpha=0.7)
        ax.set_title(label)
        ax.tick_params(axis="x", rotation=45)
    save(fig, "stage_targets.png")


def load_runs():
    runs = {}
    for path in sorted(glob.glob(str(DATA / "*_days.csv"))):
        tag = Path(path).name.removesuffix("_days.csv")
        cfg, seed = tag.rsplit("_s", 1)
        runs.setdefault(cfg, {})[int(seed)] = pd.read_csv(path)
    return runs


def results_table(runs):
    rows = []
    for cfg, seeds in runs.items():
        last = pd.DataFrame([d.iloc[-1] for d in seeds.values()])
        status = [json.loads((DATA / f"{cfg}_s{s}_status.json").read_text()) for s in seeds]
        rows.append({"config": cfg, "final_height_cm": last.height_cm.mean(), "height_min": last.height_cm.min(),
                     "height_max": last.height_cm.max(),
                     "model_weight": sum(s["recommendation"]["model_weight"] for s in status) / len(status),
                     "cv_r2": sum((s["recommendation"]["cv_r2"] or 0) for s in status) / len(status)})
    df = pd.DataFrame(rows).set_index("config")
    df.round(3).to_csv(DATA / "summary.csv")
    return df


def results_chart(summary):
    order = [c for c in ["baseline", "ml_basic", "ml_full", "precise_baseline", "precise_ml"] if c in summary.index]
    s = summary.loc[order]
    labels = {"baseline": "Fixed rules\n(HC-SR04)", "ml_basic": "ML\n(DHT+HC-SR04)", "ml_full": "ML\n(+pH, EC)",
              "precise_baseline": "Fixed rules\n(load cell)", "precise_ml": "ML\n(load cell)"}
    fig, ax = plt.subplots(figsize=(8, 3.6))
    colors = [GREY if "baseline" in c else GREEN for c in order]
    ax.bar([labels[c] for c in order], s.final_height_cm, color=colors,
           yerr=[s.final_height_cm - s.height_min, s.height_max - s.final_height_cm], capsize=4)
    ax.set_ylabel("Simulated plant height, day 60 (cm)")
    ax.set_ylim(0, s.height_max.max() * 1.15)
    for i, v in enumerate(s.final_height_cm):
        ax.text(i, v + 2, f"{v:.0f}", ha="center")
    save(fig, "results_height.png")


def signal(runs):
    """Why the optimizer stays on the prior: the rig can't move temperature much, and
    day-to-day uptake noise is larger than the effect we're trying to detect."""
    import numpy as np
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.8))
    sp = runs["ml_basic"][1].set_index("day")
    daily = pd.DataFrame(json.loads((DATA / "ml_basic_s1_daily.json").read_text())).set_index("day")
    ax = axes[0]
    ax.plot(sp.index, sp.air_temp_c, color=GREY, lw=2, label="setpoint")
    ax.plot(daily.index, daily.air_temp_c, color=RED, lw=2, label="achieved daily mean")
    ax.axhline(TRUE_OPT["air_temp_c"], color=RED, ls="--", lw=1, label="hidden optimum")
    ax.set_xlabel("Day")
    ax.set_ylabel("Air temperature (°C)")
    ax.set_title("Setpoint vs. what the rig achieved")
    ax.legend(fontsize=8)
    ax = axes[1]
    for cfg, color, name in [("ml_basic", AMBER, "HC-SR04 level"), ("precise_ml", GREEN, "load cell")]:
        d = pd.DataFrame(json.loads((DATA / f"{cfg}_s1_daily.json").read_text()))
        trend = d.uptake_l.rolling(7, center=True, min_periods=4).mean()
        rel = np.log((d.uptake_l + 0.02) / (trend + 0.02))
        keep = trend > 0.05
        ax.scatter(d.air_temp_c[keep], rel[keep], s=16, color=color, label=name, alpha=0.8)
    ax.axhline(0, color="#999", lw=0.8)
    ax.set_xlabel("Daily mean air temperature (°C)")
    ax.set_ylabel("Uptake vs. its 7-day mean (log ratio)")
    ax.set_title("Learning signal per day")
    ax.legend(fontsize=8)
    save(fig, "results_signal.png")


def main():
    FIG.mkdir(parents=True, exist_ok=True)
    for name in ["maize_climate_envelope.png", "maize_nutrients.png"]:
        (FIG / name).write_bytes((ROOT / "analysis" / "output" / name).read_bytes())
    architecture()
    feasibility()
    stage_targets()
    runs = load_runs()
    if runs:
        summary = results_table(runs)
        print(summary.round(3).to_string())
        results_chart(summary)
        signal(runs)


if __name__ == "__main__":
    main()
