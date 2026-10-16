"""Learns which conditions maximise growth on *this* rig and recommends setpoints.

Growth signal: daily water uptake from the ultrasonic reservoir sensor (transpiration tracks
biomass/photosynthesis closely), so it works with the hardware we have today.

Model: quadratic response surface (Ridge on x and x^2 of each controllable variable, adding
interactions once there is enough data) fitted to *relative* uptake, i.e. each day vs its
surrounding week, so plant size doesn't masquerade as a condition effect. A quadratic has a
real optimum and the coefficients are explainable in a report. The recommendation is the
model's best point inside the biology-safe stage range, blended with the biology prior
according to how many days of data we have and how well the model predicts unseen days. Small daily perturbations ("explore") keep
variation in the data, otherwise a perfect controller would leave nothing to learn from.
"""
import itertools
import json

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.model_selection import cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, PolynomialFeatures, StandardScaler

from . import db, profiles

MIN_DAYS = 7          # below this, use the biology prior only
PRIOR_WEIGHT = 14     # days of data at which model and prior get equal weight
# Daily exploration amplitude per variable.
EXPLORE = {"air_temp_c": 1.0, "humidity_pct": 4.0, "light_hours": 1.0, "ph": 0.1, "ec_ms_cm": 0.1}
GRID_STEP = {"air_temp_c": 0.5, "humidity_pct": 2.5, "light_hours": 1.0, "ph": 0.1, "ec_ms_cm": 0.1}
SENSOR_COL = {"air_temp_c": "air_temp", "humidity_pct": "humidity", "ph": "ph", "ec_ms_cm": "ec"}

_cache = {"key": None, "fit": None}


def daily_table(crop, planted_at):
    r = pd.DataFrame(db.query("SELECT ts, air_temp, humidity, ph, ec, water_liters FROM readings ORDER BY ts"))
    if r.empty:
        return pd.DataFrame()
    r["day"] = ((r.ts - planted_at) // 86400).astype(int)

    a = [(x["ts"], json.loads(x["states"])) for x in db.query("SELECT ts, states FROM actuator_log ORDER BY ts")]
    lights = pd.DataFrame({"ts": [t for t, _ in a], "light": [float(st.get("light", False)) for _, st in a]})
    pumping = {t for t, st in a if st.get("refill_pump")}
    r["refill"] = r.ts.isin(pumping)

    g = r.groupby("day")
    days = pd.DataFrame({
        "air_temp_c": g.air_temp.mean(), "humidity_pct": g.humidity.mean(),
        "ph": g.ph.mean(), "ec_ms_cm": g.ec.mean(),
        "uptake_l": g.apply(_uptake_per_day, include_groups=False),
        "span_h": (g.ts.max() - g.ts.min()) / 3600,
    })
    if not lights.empty:
        lights["day"] = ((lights.ts - planted_at) // 86400).astype(int)
        days["light_hours"] = lights.groupby("day").light.mean() * 24
    days = days[(days.span_h >= 20) & days.uptake_l.notna()].drop(columns="span_h")  # complete days only
    days["stage"] = [profiles.stage_index(crop, profiles.stage_for(crop, d)["name"]) for d in days.index]
    days["day"] = days.index
    return days.dropna(axis=1, how="all")


def _uptake_per_day(day):
    """Litres/day the plant drank, from the reservoir level.

    Summing every small drop would count ultrasonic jitter as uptake, so instead split the day
    wherever the refill pump ran and fit a straight line to each pump-free stretch; the slope
    is the uptake rate and the jitter averages out.
    """
    d = day.dropna(subset=["water_liters"])
    # A reading taken while (or just after) pumping is part of no segment.
    d = d.assign(seg=d.refill.cumsum())[~d.refill & ~d.refill.shift(1, fill_value=False)]
    rates, weights = [], []
    for _, seg in d.groupby("seg"):
        if len(seg) >= 12 and seg.ts.iloc[-1] - seg.ts.iloc[0] >= 3 * 3600:
            slope = np.polyfit(seg.ts, seg.water_liters, 1)[0]  # L/s
            rates.append(-slope * 86400)
            weights.append(len(seg))
    return max(0.0, float(np.average(rates, weights=weights))) if rates else np.nan


def _controllables(days):
    return [v for v in ["air_temp_c", "humidity_pct", "light_hours", "ph", "ec_ms_cm"]
            if v in days and days[v].notna().all() and days[v].std() > 1e-6]


def _relative_uptake(days):
    """Each day's uptake relative to its surrounding week.

    Raw uptake is dominated by plant size (it rises ~10x over the season), which swamps the few
    percent that conditions change it by and gets mis-credited to anything that also drifts
    over the season. Dividing by a centred 7-day mean cancels size; the daily setpoint
    perturbations then become a within-week comparison of conditions.
    """
    trend = days.uptake_l.rolling(7, center=True, min_periods=4).mean()
    keep = trend > 0.05  # skip pre-emergence days where the ratio is pure noise
    return np.log((days.uptake_l + 0.02) / (trend + 0.02))[keep], keep


def fit(crop, planted_at, day):
    # Only complete days are used, so the fit can only change when the day rolls over.
    key = (crop, planted_at, int(day))
    if _cache["key"] == key:
        return _cache["fit"]
    days = daily_table(crop, planted_at)
    result = {"n_days": len(days), "model": None}
    if len(days) >= MIN_DAYS:
        vars_ = _controllables(days)
        if vars_:
            # Full quadratic (with interactions) needs ~10 days per term; until then use an additive
            # quadratic (x and x^2 per variable), which can't overfit cross-terms on a few weeks of data.
            n_full = len(vars_) * (len(vars_) + 3) // 2
            expand = (PolynomialFeatures(2, include_bias=False) if len(days) >= 10 * n_full
                      else FunctionTransformer(lambda x: np.hstack([x, x ** 2])))
            ctrl = make_pipeline(StandardScaler(), expand)
            y, keep = _relative_uptake(days)
            if keep.sum() >= MIN_DAYS:
                X = ctrl.fit_transform(days.loc[keep, vars_])
                model = Ridge(alpha=1.0).fit(X, y)
                # Out-of-sample skill decides how far we trust the model: a model that can't predict
                # unseen days (CV R^2 <= 0) is fitting sensor noise and must not move the setpoints.
                cv_r2 = float(np.nanmean(cross_val_score(Ridge(alpha=1.0), X, y, cv=5, scoring="r2")))
                cv_r2 = cv_r2 if np.isfinite(cv_r2) else 0.0
                result.update(model=model, ctrl=ctrl, vars=vars_, n_days=int(keep.sum()),
                              r2=round(model.score(X, y), 3), cv_r2=round(cv_r2, 3))
    _cache.update(key=key, fit=result)
    return result


def recommend(crop, planted_at, day, sensors_present, explore=True, ml_enabled=True):
    stage = profiles.stage_for(crop, day)
    bounds = {k: stage[k] for k in profiles.RANGED}
    lh = stage["light_hours"]
    bounds["light_hours"] = [lh, lh] if lh == 0 else [max(8, lh - 2), min(18, lh + 2)]
    active = ["air_temp_c", "humidity_pct", "light_hours"] + [v for v in ("ph", "ec_ms_cm") if v in sensors_present]
    prior = {v: (bounds[v][0] + bounds[v][1]) / 2 for v in active}
    if "light_hours" in prior:
        prior["light_hours"] = lh

    f = fit(crop, planted_at, day) if ml_enabled else {"n_days": 0, "model": None}
    best, alpha = dict(prior), 0.0
    if f["model"] is not None:
        alpha = f["n_days"] / (f["n_days"] + PRIOR_WEIGHT) * float(np.clip(f["cv_r2"], 0, 1))
        mvars = f["vars"]
        axes = [np.arange(bounds[v][0], bounds[v][1] + 1e-9, GRID_STEP[v]) for v in mvars]
        grid = pd.DataFrame(list(itertools.product(*axes)), columns=mvars)
        pred = f["model"].predict(f["ctrl"].transform(grid))
        top = grid.iloc[int(np.argmax(pred))]
        for v in mvars:
            if v in best:
                best[v] = prior[v] + alpha * (top[v] - prior[v])

    offset = {}
    if explore:
        rng = np.random.default_rng(int(day))  # same perturbation all day, new one tomorrow
        for v in best:
            if lh == 0 and v == "light_hours":
                continue
            offset[v] = round(float(rng.uniform(-1, 1) * EXPLORE[v]), 2)
            best[v] += offset[v]
    for v in best:
        best[v] = round(float(np.clip(best[v], *bounds[v])), 2)

    return {
        "setpoints": best,
        "bounds": {v: bounds[v] for v in active},
        "source": "model+prior" if alpha else "biology prior",
        "model_weight": round(alpha, 2),
        "n_days": f["n_days"],
        "r2": f.get("r2"),
        "cv_r2": f.get("cv_r2"),
        "learned_vars": f.get("vars", []),
        "explore_offset": offset,
        "stage": stage,
    }
