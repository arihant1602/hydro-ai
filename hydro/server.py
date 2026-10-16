"""FastAPI backend: ESP32 ingest, control loop, ML setpoints, alerts, dashboard.

Run: .venv/bin/uvicorn hydro.server:app --host 0.0.0.0 --port 8000
(0.0.0.0 so the ESP32 on the same WiFi can reach your laptop's LAN IP.)
"""
import io
import json
import os
import time
import urllib.request
from collections import deque
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import alerts, controller, db, optimizer, profiles, suitability, vision

STATIC = Path(__file__).resolve().parent / "static"
SENSOR_FIELDS = ["air_temp", "humidity", "water_distance_cm", "water_temp", "ph", "ec", "light_lux", "soil_raw"]
REPORT_INTERVAL_S = 10

PHOTOS = db.DB_PATH.parent / "photos"
PHOTOS.mkdir(parents=True, exist_ok=True)
IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_PHOTO_BYTES = 8 * 1024 * 1024

app = FastAPI(title="Hydro AI")
app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.mount("/photos", StaticFiles(directory=PHOTOS), name="photos")


class Reading(BaseModel):
    device_id: str = "esp32"
    ts: Optional[float] = None  # omit from the ESP32; the simulator sets it to fast-forward time
    air_temp: Optional[float] = None
    humidity: Optional[float] = None
    water_distance_cm: Optional[float] = None
    water_temp: Optional[float] = None
    ph: Optional[float] = None
    ec: Optional[float] = None
    light_lux: Optional[float] = None
    soil_raw: Optional[float] = None  # soil moisture probe, raw ADC (higher = drier)
    # Link diagnostics from the firmware (not stored with the readings).
    rssi: Optional[int] = None       # WiFi signal, dBm
    uptime_s: Optional[int] = None
    ip: Optional[str] = None
    fw: Optional[str] = None
    failed_posts: Optional[int] = None  # consecutive failures before this successful one


LINK_FIELDS = {"rssi", "uptime_s", "ip", "fw", "failed_posts"}
# Recent ESP32 <-> server exchanges, kept in memory for the dashboard's link panel.
_traffic = deque(maxlen=30)
_link = {}
_pending = {}  # commands to piggyback on the next report reply if pushing directly fails


class Observation(BaseModel):
    height_cm: Optional[float] = None
    notes: str = ""
    ts: Optional[float] = None


def water_level(distance, s):
    if distance is None:
        return None, None
    depth = s["tank_empty_distance_cm"] - s["tank_full_distance_cm"]
    water_cm = min(max(s["tank_empty_distance_cm"] - distance, 0), depth)
    return round(100 * water_cm / depth, 1), round(water_cm * s["tank_area_cm2"] / 1000, 3)


def sensors_present():
    """Which optional probes have reported in the last few readings."""
    rows = db.query("SELECT ph, ec, water_temp, light_lux FROM readings ORDER BY ts DESC LIMIT 5")
    present = {k for r in rows for k, v in r.items() if v is not None}
    return {"ph" if k == "ph" else "ec_ms_cm" if k == "ec" else k for k in present}


def last_actuators():
    row = db.query("SELECT states FROM actuator_log ORDER BY ts DESC LIMIT 1")
    return json.loads(row[0]["states"]) if row else {}


def context(ts):
    s = db.get_settings()
    day = profiles.day_of_grow(s["planted_at"], ts)
    rec = optimizer.recommend(s["crop"], s["planted_at"], day, sensors_present(), s["explore"], s["ml_enabled"])
    return s, day, rec


@app.post("/api/readings")
def ingest(r: Reading, request: Request):
    now = time.time()
    ts = r.ts or now
    s, day, rec = context(ts)
    pct, liters = water_level(r.water_distance_cm, s)
    db.execute(
        "INSERT INTO readings(ts, received_at, device_id, air_temp, humidity, water_distance_cm, water_level_pct,"
        " water_liters, water_temp, ph, ec, light_lux, soil_raw) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (ts, now, r.device_id, r.air_temp, r.humidity, r.water_distance_cm, pct, liters,
         r.water_temp, r.ph, r.ec, r.light_lux, r.soil_raw))
    reading = {**r.model_dump(exclude_unset=True, exclude=LINK_FIELDS), "water_level_pct": pct, "ts": ts}
    alerts.evaluate(reading, rec["stage"], s, ts)
    acts = controller.decide(reading, rec["setpoints"], s, last_actuators(),
                             profiles.load(s["crop"])["lights_on_hour"], now=ts)
    db.execute("INSERT INTO actuator_log(ts, states) VALUES(?, ?)", (ts, json.dumps(acts)))
    reply = {"actuators": acts, "setpoints": rec["setpoints"], "interval_s": REPORT_INTERVAL_S}
    if "led_blink" in _pending:
        reply["led_blink"] = _pending.pop("led_blink")
    if r.ts is None:  # real device, not the fast-forward simulator
        sent = r.model_dump(exclude_unset=True)
        _link.update({k: v for k, v in sent.items() if k in LINK_FIELDS}, device_id=r.device_id,
                     last_seen=now, client=request.client.host if request.client else None,
                     handled_ms=round((time.time() - now) * 1000, 1))
        _link["packets"] = _link.get("packets", 0) + 1
        _traffic.append({"t": now, "sent": sent, "reply": reply["actuators"]})
    return reply


class LedCommand(BaseModel):
    blink: int = 5


@app.post("/api/led")
def led(cmd: LedCommand):
    """Blink the ESP32's built-in LED. Pushed straight to the board's own web server for an instant
    response; if that fails, queued into the reply to its next report (up to ~10 s later)."""
    times = max(1, min(cmd.blink, 50))
    ip = _link.get("ip") or _link.get("client")
    if ip:
        t0 = time.time()
        try:
            with urllib.request.urlopen(f"http://{ip}/led?blink={times}", timeout=3) as r:
                board = json.loads(r.read())
            rtt = round((time.time() - t0) * 1000)
            _traffic.append({"t": time.time(), "sent": {"command": f"LED blink x{times}"},
                             "reply": {f"board ack in {rtt} ms": True}})
            return {"via": "direct", "rtt_ms": rtt, "board": board}
        except (OSError, ValueError) as e:
            err = str(e)
    else:
        err = "board has not reported yet"
    _pending["led_blink"] = times
    return {"via": "queued", "reason": err, "eta_s": REPORT_INTERVAL_S}


@app.get("/api/link")
def link():
    """Live ESP32 connection info for the dashboard."""
    now = time.time()
    last = _link.get("last_seen")
    return {
        **_link,
        "server_time": now,
        "age_s": None if last is None else round(now - last, 1),
        "online": last is not None and now - last < 3 * REPORT_INTERVAL_S,
        "packets_last_min": sum(1 for x in _traffic if now - x["t"] < 60),
        "traffic": list(_traffic)[-10:][::-1],
    }


@app.get("/api/status")
def status():
    latest = db.query("SELECT * FROM readings ORDER BY ts DESC LIMIT 1")
    latest = latest[0] if latest else None
    online = alerts.check_offline(latest["received_at"] if latest else None)
    ts = latest["ts"] if latest else time.time()
    s, day, rec = context(ts)
    stage = rec["stage"]
    score, note = (None, "no data yet")
    if latest:
        score, note = suitability.score(s["crop"], latest["air_temp"], latest["humidity"], latest["ph"],
                                        sum(stage["ph"]) / 2)
    obs = db.query("SELECT ts, height_cm, notes FROM observations ORDER BY ts DESC LIMIT 10")
    return {
        "crop": profiles.load(s["crop"])["display_name"],
        "day": round(day, 1),
        "stage": stage,
        "latest": latest,
        "online": online,
        "actuators": last_actuators(),
        "recommendation": {k: v for k, v in rec.items() if k != "stage"},
        "dataset_envelope": profiles.dataset_envelope(),
        "suitability": {"score": score, "note": note},
        "alerts": db.query("SELECT * FROM alerts WHERE active=1 ORDER BY ts DESC"),
        "observations": obs,
        "settings": s,
    }


@app.get("/api/readings")
def readings(hours: float = 24, max_points: int = 400):
    end = db.query("SELECT MAX(ts) AS t FROM readings")[0]["t"] or time.time()
    rows = db.query("SELECT ts, " + ", ".join(SENSOR_FIELDS + ["water_level_pct"]) +
                    " FROM readings WHERE ts >= ? ORDER BY ts", (end - hours * 3600,))
    step = max(1, len(rows) // max_points)
    return rows[::step]


@app.get("/api/history/daily")
def daily():
    s = db.get_settings()
    d = optimizer.daily_table(s["crop"], s["planted_at"])
    return [] if d.empty else json.loads(d.reset_index(drop=True).to_json(orient="records"))


@app.get("/api/alerts")
def alert_history(limit: int = 50):
    return db.query("SELECT * FROM alerts ORDER BY ts DESC LIMIT ?", (limit,))


@app.post("/api/observations")
def add_observation(o: Observation):
    db.execute("INSERT INTO observations(ts, height_cm, notes) VALUES(?,?,?)", (o.ts or time.time(), o.height_cm, o.notes))
    return {"ok": True}


@app.get("/api/settings")
def get_settings():
    return db.get_settings()


@app.post("/api/settings")
def update_settings(values: dict):
    try:
        db.set_settings(values)
    except KeyError as e:
        raise HTTPException(400, f"unknown setting {e}")
    return db.get_settings()


# ---- Camera: a phone (or later an ESP32-CAM) uploads plant photos ----

@app.post("/api/photos")
async def upload_photo(request: Request, source: str = "phone", note: str = ""):
    """Raw image body (Content-Type image/jpeg|png|webp). Raw bytes rather than multipart, so an
    ESP32-CAM can POST its JPEG buffer the same way later."""
    ctype = request.headers.get("content-type", "").split(";")[0].strip()
    if ctype not in IMAGE_TYPES:
        raise HTTPException(415, f"send image/jpeg, image/png or image/webp, not {ctype or 'nothing'}")
    data = await request.body()
    if not data or len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "photo empty or larger than 8 MB")
    now = time.time()
    s = db.get_settings()
    day = profiles.day_of_grow(s["planted_at"], now)
    stage = profiles.stage_for(s["crop"], day)["name"]
    name = time.strftime("%Y%m%d-%H%M%S", time.localtime(now)) + f"-{int(now * 1000) % 1000:03d}" + IMAGE_TYPES[ctype]
    (PHOTOS / name).write_bytes(data)
    cur = db.execute("INSERT INTO photos(ts, file, source, day, stage, bytes, note) VALUES(?,?,?,?,?,?,?)",
                     (now, name, source[:20], round(day, 2), stage, len(data), note[:200]))
    vision.analyse_async(cur.lastrowid)  # plant-health analysis runs on this PC in the background
    return {"ok": True, "id": cur.lastrowid, "file": name, "url": f"/photos/{name}", "day": round(day, 1), "stage": stage}


def _photo_out(r):
    a = r.pop("analysis", None)
    return {**r, "url": f"/photos/{r['file']}", "analysis": json.loads(a) if a else None}


@app.get("/api/photos")
def list_photos(limit: int = 24):
    vision._ensure_columns()
    return [_photo_out(r) for r in db.query("SELECT * FROM photos ORDER BY ts DESC LIMIT ?", (limit,))]


@app.post("/api/photos/{photo_id}/analyse")
def reanalyse(photo_id: int):
    res = vision.analyse_photo(photo_id)
    if res is None:
        raise HTTPException(404, "no such photo")
    return res


@app.get("/api/vision/growth")
def vision_growth():
    return vision.growth_series()


def lan_ip():
    return os.environ.get("HYDRO_LAN_IP")


@app.get("/api/camera-url")
def camera_url():
    ip = lan_ip()
    return {"https": f"https://{ip}:8443/camera" if ip else None, "ip": ip}


@app.get("/api/qr.svg")
def qr_svg():
    """QR code for the phone camera page, so you can scan it off the laptop screen."""
    import qrcode
    import qrcode.image.svg
    url = camera_url()["https"]
    if not url:
        raise HTTPException(404, "start the server with `python -m hydro.run` to enable HTTPS")
    buf = io.BytesIO()
    qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2).save(buf)
    return Response(buf.getvalue(), media_type="image/svg+xml")


# ---- Crop advisor (advisor/ package): complaint + photo + sensors -> likely cause + what to do ----

class AdviseRequest(BaseModel):
    text: str = ""
    crop: Optional[str] = None
    day: Optional[int] = None
    weather: list[str] = []
    rain_forecast: bool = False
    wind_high: bool = False
    hydroponic: Optional[bool] = None
    use_photo: bool = True        # latest analysed photo from the last 24 h
    use_sensors: bool = True      # latest ESP32 reading (implies the hydroponic rig)
    answers: dict[str, bool] = {}
    lang: str = "en"


_advisor = None


def advisor():
    global _advisor
    if _advisor is None:
        from advisor.engine import Advisor
        _advisor = Advisor()
    return _advisor


@app.post("/api/advise")
def advise(req: AdviseRequest):
    s = db.get_settings()
    form = {"crop": req.crop, "day": req.day, "weather": req.weather, "rain_forecast": req.rain_forecast,
            "wind_high": req.wind_high}
    sensors = stage_targets = None
    if req.use_sensors:
        latest = db.query("SELECT * FROM readings ORDER BY ts DESC LIMIT 1")
        if latest and time.time() - latest[0]["received_at"] < 600:
            sensors = latest[0]
            day = profiles.day_of_grow(s["planted_at"], sensors["ts"])
            stage_targets = profiles.stage_for(s["crop"], day)
            form["crop"] = form["crop"] or s["crop"]
            form["day"] = form["day"] if form["day"] is not None else int(day)
    form["hydroponic"] = req.hydroponic if req.hydroponic is not None else sensors is not None
    photo = None
    if req.use_photo:
        vision._ensure_columns()
        row = db.query("SELECT analysis, ts FROM photos WHERE analysis IS NOT NULL ORDER BY ts DESC LIMIT 1")
        if row and time.time() - row[0]["ts"] < 86400:
            photo = json.loads(row[0]["analysis"])
    res = advisor().advise(req.text, form={k: v for k, v in form.items() if v is not None},
                           photo=photo, sensors=sensors, stage_targets=stage_targets,
                           answers=req.answers, lang=req.lang)
    res["inputs"] = {"photo": bool(photo), "sensors": bool(sensors), "hydroponic": form["hydroponic"]}
    res.pop("debug", None)
    return res


@app.get("/camera")
def camera_page():
    return FileResponse(STATIC / "camera.html")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")
