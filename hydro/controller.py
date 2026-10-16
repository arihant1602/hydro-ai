"""Turns ML setpoints + the latest reading into actuator commands.

The ML layer decides *where* to hold the environment; this layer holds it there with
hysteresis (so relays don't chatter). Every actuator is optional: the ESP32 simply ignores
commands for hardware it doesn't have.
"""
import time
from datetime import datetime

TEMP_BAND = 0.7      # +/- °C around the temperature setpoint
HUM_BAND = 4.0       # +/- % RH around the humidity setpoint
DOSE_COOLDOWN = 600  # s between pH/nutrient doses so the reservoir can mix
DOSE_MS = 800        # peristaltic pump pulse length

_last_dose = {}


def _hyst(prev, value, on_above, off_below):
    if value is None:
        return prev
    if value > on_above:
        return True
    if value < off_below:
        return False
    return prev


def decide(reading, setpoints, settings, prev, lights_on_hour, now=None):
    now = now or reading.get("ts") or time.time()
    sp = setpoints
    t, h = reading.get("air_temp"), reading.get("humidity")
    out = {}

    # Cooling: exhaust fan / evaporative cooler. Also vents excess humidity.
    hot = _hyst(prev.get("fan", False), t, sp["air_temp_c"] + TEMP_BAND, sp["air_temp_c"] - TEMP_BAND)
    humid = h is not None and h > sp["humidity_pct"] + HUM_BAND
    out["fan"] = bool(hot or humid)
    # Heater only if one is fitted; mirrored hysteresis below the setpoint.
    out["heater"] = (not out["fan"]) and bool(
        _hyst(prev.get("heater", False), None if t is None else -t,
              -(sp["air_temp_c"] - 2 * TEMP_BAND), -(sp["air_temp_c"] - TEMP_BAND / 2)))
    # Humidifier / mister below the band.
    out["mister"] = bool(_hyst(prev.get("mister", False), None if h is None else -h,
                               -(sp["humidity_pct"] - HUM_BAND), -(sp["humidity_pct"] + 1)))
    if out["fan"]:
        out["mister"] = False
    # A dead DHT must not leave heat/moisture running blind.
    if t is None:
        out["heater"] = False
    if h is None:
        out["mister"] = False

    # Grow lights on a photoperiod schedule from the setpoint.
    hour = datetime.fromtimestamp(now).hour + datetime.fromtimestamp(now).minute / 60
    lh = sp.get("light_hours", 0)
    out["light"] = lh > 0 and (hour - lights_on_hour) % 24 < lh

    # Reservoir top-up from a fresh-water jug.
    lvl = reading.get("water_level_pct")
    out["refill_pump"] = bool(_hyst(prev.get("refill_pump", False), None if lvl is None else -lvl,
                                    -settings["refill_below_pct"], -settings["refill_until_pct"]))
    # Nutrient solution too strong (water evaporated/drunk faster than salts): dilute with fresh water.
    ec = reading.get("ec")
    if ec is not None and "ec_ms_cm" in sp and ec > sp["ec_ms_cm"] + 0.3 and lvl is not None and lvl < 98:
        out["refill_pump"] = True

    # Dosing pulses (only meaningful once pH / EC probes exist).
    doses = {}
    ph = reading.get("ph")
    if ph is not None and "ph" in sp:
        if ph > sp["ph"] + 0.2:
            doses["ph_down_ms"] = DOSE_MS
        elif ph < sp["ph"] - 0.2:
            doses["ph_up_ms"] = DOSE_MS
    if ec is not None and "ec_ms_cm" in sp and ec < sp["ec_ms_cm"] - 0.15:
        doses["nutrient_ms"] = DOSE_MS
    for k in list(doses):
        if now - _last_dose.get(k, 0) < DOSE_COOLDOWN:
            del doses[k]
        else:
            _last_dose[k] = now
    out.update(doses)
    return out
