"""Out-of-range / hardware alerts. One active alert per key; cleared automatically when resolved.

Set HYDRO_NOTIFY_URL to an ntfy.sh topic (e.g. https://ntfy.sh/my-secret-corn-topic) to get
phone push notifications for critical alerts; the ntfy app subscribes to the same topic. Off by default.
"""
import os
import threading
import time
import urllib.request

from . import db

NOTIFY_URL = os.environ.get("HYDRO_NOTIFY_URL")
LABELS = {"air_temp": ("Air temperature", "air_temp_c", "°C"), "humidity": ("Humidity", "humidity_pct", "%"),
          "ph": ("pH", "ph", ""), "ec": ("EC", "ec_ms_cm", " mS/cm")}
# How far outside the stage range before it counts as critical rather than a warning.
CRITICAL_MARGIN = {"air_temp": 3.0, "humidity": 10.0, "ph": 0.4, "ec": 0.4}


def _notify(msg):
    if not NOTIFY_URL:
        return
    def send():
        try:
            urllib.request.urlopen(urllib.request.Request(NOTIFY_URL, data=msg.encode(), method="POST"), timeout=5)
        except OSError:
            pass
    threading.Thread(target=send, daemon=True).start()


def evaluate(reading, stage, settings, ts):
    found = {}
    for field, (label, key, unit) in LABELS.items():
        v = reading.get(field)
        if v is None:
            continue
        lo, hi = stage[key]
        if v < lo or v > hi:
            off = lo - v if v < lo else v - hi
            sev = "critical" if off > CRITICAL_MARGIN[field] else "warning"
            word = "low" if v < lo else "high"
            found[f"{field}_{word}"] = (sev, f"{label} {word}: {v:.1f}{unit} (target {lo}-{hi}{unit}, {stage['name']})")
    lvl = reading.get("water_level_pct")
    if lvl is not None and lvl < 20:
        found["water_low"] = ("critical", f"Reservoir at {lvl:.0f}% - check refill jug / pump")
    for field in ("air_temp", "humidity"):
        if field in reading and reading[field] is None:
            found["dht_fail"] = ("warning", "DHT sensor returned no data - check wiring / pull-up")
    if "water_distance_cm" in reading and reading["water_distance_cm"] is None:
        found["ultrasonic_fail"] = ("warning", "Ultrasonic sensor returned no echo - check ECHO divider / mounting")
    sync(found, ts)


PERSIST_S = 300  # a condition must last this long before it alerts, so noisy readings don't spam
_first_seen = {}


def sync(found, ts):
    active = {a["key"]: a for a in db.query("SELECT * FROM alerts WHERE active=1")}
    for key in list(_first_seen):
        if key not in found:
            del _first_seen[key]
    for key, (sev, msg) in found.items():
        first = _first_seen.setdefault(key, ts)
        if key not in active and ts - first < PERSIST_S and sev != "critical":
            continue
        if key not in active:
            db.execute("INSERT INTO alerts(ts, key, severity, message) VALUES(?,?,?,?)", (ts, key, sev, msg))
            if sev == "critical":  # warnings stay on the dashboard; only push what needs a human
                _notify(f"[{sev}] {msg}")
        elif active[key]["message"] != msg:
            db.execute("UPDATE alerts SET message=?, severity=? WHERE id=?", (msg, sev, active[key]["id"]))
    for key, a in active.items():
        # Only clear what this per-reading check owns; offline and photo (vision_) alerts manage themselves.
        if key not in found and key != "offline" and not key.startswith("vision_"):
            db.execute("UPDATE alerts SET active=0, cleared_ts=? WHERE id=?", (ts, a["id"]))


def check_offline(last_received, timeout=90):
    active = db.query("SELECT id FROM alerts WHERE active=1 AND key='offline'")
    offline = last_received is None or time.time() - last_received > timeout
    if offline and not active and last_received is not None:
        msg = "ESP32 has not reported for over 90 s"
        db.execute("INSERT INTO alerts(ts, key, severity, message) VALUES(?,?,?,?)",
                   (time.time(), "offline", "critical", msg))
        _notify(f"[critical] {msg}")
    elif not offline and active:
        db.execute("UPDATE alerts SET active=0, cleared_ts=? WHERE key='offline' AND active=1", (time.time(),))
    return not offline


def sync_group(prefix, found, ts, persist=False):
    """Raise/clear alerts whose keys start with `prefix` (e.g. photo analysis), independent of sensor readings."""
    active = {a["key"]: a for a in db.query("SELECT * FROM alerts WHERE active=1 AND key LIKE ?", (prefix + "%",))}
    for key, (sev, msg) in found.items():
        if key not in active:
            db.execute("INSERT INTO alerts(ts, key, severity, message) VALUES(?,?,?,?)", (ts, key, sev, msg))
            if sev == "critical":
                _notify(f"[{sev}] {msg}")
        elif active[key]["message"] != msg:
            db.execute("UPDATE alerts SET message=?, severity=? WHERE id=?", (msg, sev, active[key]["id"]))
    for key, a in active.items():
        if key not in found:
            db.execute("UPDATE alerts SET active=0, cleared_ts=? WHERE id=?", (ts, a["id"]))
