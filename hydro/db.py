"""SQLite storage. One file, no server; fine for a single grow rig."""
import json
import os
import sqlite3
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("HYDRO_DB", ROOT / "data" / "hydro.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY,
    ts REAL NOT NULL,             -- reading time (epoch s); device/simulator time
    received_at REAL NOT NULL,    -- wall-clock time the server got it
    device_id TEXT,
    air_temp REAL, humidity REAL,
    water_distance_cm REAL, water_level_pct REAL, water_liters REAL,
    water_temp REAL, ph REAL, ec REAL, light_lux REAL,
    soil_raw REAL                 -- soil moisture probe, raw 12-bit ADC (higher = drier)
);
CREATE INDEX IF NOT EXISTS readings_ts ON readings(ts);
CREATE TABLE IF NOT EXISTS actuator_log (
    id INTEGER PRIMARY KEY, ts REAL NOT NULL, states TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS actuator_ts ON actuator_log(ts);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY, ts REAL NOT NULL, key TEXT NOT NULL, severity TEXT NOT NULL,
    message TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, cleared_ts REAL
);
CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY, ts REAL NOT NULL, height_cm REAL, notes TEXT
);
CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY, ts REAL NOT NULL, file TEXT NOT NULL, source TEXT, day REAL, stage TEXT,
    bytes INTEGER, note TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

DEFAULT_SETTINGS = {
    "crop": "maize",
    "planted_at": None,            # epoch s; filled on first start
    # Ultrasonic sensor mounted on the reservoir lid, pointing down at the water.
    "tank_empty_distance_cm": 30.0,  # sensor -> tank bottom
    "tank_full_distance_cm": 5.0,    # sensor -> water surface when full (keep >= 3 cm, HC-SR04 blind zone)
    "tank_area_cm2": 900.0,          # inner floor area (30 x 30 cm box)
    "refill_below_pct": 40.0,
    "refill_until_pct": 90.0,
    "explore": True,
    "ml_enabled": True,              # False = fixed biology targets only (baseline for comparison)
    # ^ explore: small daily setpoint perturbations so the optimizer has variation to learn from
}

_lock = threading.Lock()
_conn = None


def conn():
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(SCHEMA)
        # Columns added after the first release: CREATE TABLE IF NOT EXISTS won't add them to an existing db.
        cols = {r["name"] for r in _conn.execute("PRAGMA table_info(readings)")}
        if "soil_raw" not in cols:
            _conn.execute("ALTER TABLE readings ADD COLUMN soil_raw REAL")
            _conn.commit()
    return _conn


def execute(sql, params=()):
    with _lock:
        cur = conn().execute(sql, params)
        conn().commit()
        return cur


def query(sql, params=()):
    with _lock:
        return [dict(r) for r in conn().execute(sql, params).fetchall()]


def get_settings():
    stored = {r["key"]: json.loads(r["value"]) for r in query("SELECT key, value FROM settings")}
    s = {**DEFAULT_SETTINGS, **stored}
    if s["planted_at"] is None:
        s["planted_at"] = time.time()
        set_settings({"planted_at": s["planted_at"]})
    return s


def set_settings(values):
    for k, v in values.items():
        if k not in DEFAULT_SETTINGS:
            raise KeyError(k)
        execute("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, json.dumps(v)))
