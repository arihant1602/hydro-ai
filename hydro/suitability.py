"""Dataset-derived score: how typical are the current conditions for the crop (0-1)."""
from functools import lru_cache
from pathlib import Path

import joblib
import pandas as pd

MODELS = Path(__file__).resolve().parent.parent / "models"


@lru_cache
def _bundle(crop):
    path = MODELS / f"suitability_{crop}.joblib"
    return joblib.load(path) if path.exists() else None


def score(crop, air_temp, humidity, ph, fallback_ph):
    """Returns (probability, note). pH falls back to the stage target mid-point when no probe is fitted."""
    b = _bundle(crop)
    if b is None or air_temp is None or humidity is None:
        return None, "model missing - run analysis/analyze_dataset.py" if b is None else "no climate reading"
    note = "" if ph is not None else "pH assumed at stage target (no probe)"
    x = pd.DataFrame([[air_temp, humidity, ph if ph is not None else fallback_ph]], columns=b["features"])
    return round(float(b["model"].predict_proba(x)[0][1]), 3), note
