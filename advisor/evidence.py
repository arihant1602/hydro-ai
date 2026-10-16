"""Stage 2: evidence fusion. Turns photo metrics, sensor readings and the farmer's form into
(a) short evidence sentences the router reads alongside the complaint, and
(b) boolean context flags used by priors and the contraindication engine.

This replaces the paper's LLM paraphrase TTA: instead of N rewordings of one text, the consensus
step compares independent evidence channels (what the farmer said vs. what the photo and sensors show).
"""
from . import kb as kbmod


def photo_sentence(a):
    """`a` is a hydro/vision.py analysis dict."""
    if not a or a.get("verdict") in (None, "no plant in view", "analysis failed"):
        return None
    if a.get("verdict", "").startswith("uncertain"):
        return "Photo: lighting is poor, colours unreliable."
    bits = []
    if (a.get("yellow_frac") or 0) > 0.08:
        bits.append(f"about {a['yellow_frac']:.0%} of the leaf area is yellow")
    if (a.get("lesion_frac") or 0) > 0.03:
        bits.append(f"{a.get('lesions', 0)} tan or brown spots and lesions cover {a['lesion_frac']:.0%} of the leaf")
    elif (a.get("brown_frac") or 0) > 0.05:
        bits.append(f"{a['brown_frac']:.0%} of the leaf is brown and dry")
    if (a.get("purple_frac") or 0) > 0.05:
        bits.append("leaves have purple tinge")
    if a.get("dgci") is not None and a["dgci"] < 0.45:
        bits.append("leaves are pale green")
    if not bits:
        return "Photo: leaves look green and healthy, no spots seen."
    return "Photo: " + "; ".join(bits) + "."


def context(form, sensors=None, photo=None, stage_targets=None):
    """form: {crop, day?, hydroponic?, rain_forecast?, wind_high?, weather?: [heavy_rain, cold, hot, humid, dry, frost]}
    sensors: latest hydro reading dict (air_temp, humidity, ph, ec, water_level_pct) or None.
    stage_targets: hydro stage dict with [lo, hi] ranges, for judging sensors."""
    kb = kbmod.load()
    crop = form.get("crop")
    flags = {w: True for w in form.get("weather", [])}
    if form.get("weather") and "frost" in form["weather"]:
        flags["cold"] = True
    flags["hydroponic"] = bool(form.get("hydroponic"))
    flags["not_hydroponic"] = not flags["hydroponic"]
    flags["rain_forecast_24h"] = bool(form.get("rain_forecast"))
    flags["wind_high"] = bool(form.get("wind_high"))
    if form.get("waterlogged"):
        flags["waterlogged"] = True
    flags["always"] = True

    stage = None
    if crop and form.get("day") is not None:
        stage = kbmod.stage_of(crop, int(form["day"]))
    elif form.get("stage"):
        stage = form["stage"]
    if stage:
        flags["flowering"] = stage == "flowering"
        flags["late_stage"] = stage in ("filling", "maturity")
        flags["near_harvest"] = stage == "maturity"
        flags["cereal_after_flowering"] = bool(kb["crops"].get(crop, {}).get("cereal")) and stage in ("filling", "maturity")

    sentences = []
    if crop:
        s = f"Crop: {kb['crops'][crop]['name_en']}"
        if stage:
            s += f", {stage} stage" + (f" (day {int(form['day'])})" if form.get("day") is not None else "")
        sentences.append(s + ".")
    weather_words = {"heavy_rain": "heavy rain recently", "cold": "cold nights", "hot": "very hot days",
                     "humid": "humid, foggy or wet weather", "dry": "dry weather, no rain", "frost": "frost (pala)"}
    w = [weather_words[k] for k in form.get("weather", []) if k in weather_words]
    if w:
        sentences.append("Weather: " + ", ".join(w) + ".")

    if sensors:
        t, h = sensors.get("air_temp"), sensors.get("humidity")
        if h is not None and h >= 80:
            flags["humid"] = True
        if t is not None and t >= 35:
            flags["hot"] = True
        if t is not None and t <= 10:
            flags["cold"] = True
        ph, ec = sensors.get("ph"), sensors.get("ec")
        if ph is not None and ph > (6.8 if flags["hydroponic"] else 7.8):
            flags["ph_high"] = True
        if ec is not None and stage_targets and ec > stage_targets["ec_ms_cm"][1] + 0.5:
            flags["ec_high"] = True
        bits = []
        if t is not None:
            bits.append(f"air {t:.0f} °C")
        if h is not None:
            bits.append(f"humidity {h:.0f}%" + (" (high)" if h >= 80 else ""))
        if ph is not None:
            bits.append(f"pH {ph:.1f}" + (" (high)" if flags.get("ph_high") else ""))
        if ec is not None:
            bits.append(f"EC {ec:.2f} mS/cm" + (" (too high)" if flags.get("ec_high") else ""))
        if bits:
            sentences.append("Sensors: " + ", ".join(bits) + ".")

    ps = photo_sentence(photo)
    return {"flags": flags, "stage": stage, "context_sentences": sentences, "photo_sentence": ps}
