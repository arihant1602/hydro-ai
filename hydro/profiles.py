"""Crop growth-stage profiles (biology targets) and the dataset envelope."""
import json
from functools import lru_cache
from pathlib import Path

CONFIG = Path(__file__).resolve().parent.parent / "config"
# Parameters that have a [lo, hi] target in every stage.
RANGED = ["air_temp_c", "humidity_pct", "ph", "ec_ms_cm"]


@lru_cache
def load(crop):
    return json.loads((CONFIG / f"{crop}.json").read_text())


@lru_cache
def dataset_envelope():
    path = CONFIG / "dataset_envelope.json"
    return json.loads(path.read_text())["envelope"] if path.exists() else None


def day_of_grow(planted_at, ts):
    return max(0.0, (ts - planted_at) / 86400)


def stage_for(crop, day):
    stages = load(crop)["stages"]
    for s in stages:
        if day <= s["end_day"] + 0.999:
            return s
    return stages[-1]


def stage_index(crop, name):
    return [s["name"] for s in load(crop)["stages"]].index(name)
