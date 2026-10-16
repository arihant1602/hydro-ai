# Hydro AI: closed-loop AI hydroponics for maize

ESP32 sensor node → FastAPI server (ML setpoints + control + alerts) → actuator commands back to the ESP32,
with a live web dashboard. A simulator stands in for the hardware until it arrives.

```
 ESP32 (DHT22 + HC-SR04 [+ pH/TDS later])
   │  POST /api/readings every 10 s (JSON over WiFi)
   ▼
 FastAPI server ── biology stage profile (config/maize.json)
   │             ── Kaggle-derived envelope + suitability model (models/)
   │             ── optimizer: learns growth vs conditions → setpoints
   │             ── controller: hysteresis → fan / light / pump / mister / dosing
   │             ── alerts → dashboard (+ phone via ntfy, optional)
   ▼
 reply: {"actuators": {...}}  → ESP32 switches relays
```

## Phone app: fully offline (ESP32 + phone, nothing else)

`mobile/` is an Android app that runs the whole system on the phone: the ML setpoints, the controller, alerts,
the suitability forest, photo analysis and the crop advisor, all ported to TypeScript and checked against the
Python code (`cd mobile && npm test`). The ESP32 runs its own WiFi network (firmware `LINK_MODE` = `LINK_PHONE`,
the default now); the phone joins it. See `mobile/README.md` to build and install it.
For the original laptop server setup below, set `LINK_MODE` to `LINK_SERVER` in `firmware/include/config.h`.

## Quick start (no hardware)

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python analysis/analyze_dataset.py            # report + envelope + suitability model

# terminal 1: server on a throwaway DB
HYDRO_DB=data/sim.db .venv/bin/python -m hydro.run   # stop the hydro service first (same ports)
# terminal 2: 40 simulated days, then keeps streaming
.venv/bin/python simulator/simulate.py --days 40          # add --full to simulate pH/EC probes too
```
Open http://localhost:8000. Delete `data/sim.db` to start over. Use the default DB (`data/hydro.db`) for the real plant.

## Why maize, and what the dataset can/can't do

`analysis/output/crop_report.md` has the full numbers. Summary:
- The Kaggle data is 22 crops × 100 rows of soil N/P/K, temperature, humidity, pH, rainfall. It looks synthetic
  (uniform ranges) and has **no growth-stage or yield column**.
- So it is used for (1) the maize climate/pH envelope (18–26 °C, 57–74 % RH, pH 5.6–6.9) and
  (2) a "how maize-like are the current conditions" classifier (temp + humidity + pH, ROC-AUC 0.97).
- Stage-by-stage targets (germination → grain fill) live in `config/maize.json`. **The biology team should verify them.**
- Maize's dataset band sits just below typical Indian room temperatures, so expect the fan / evaporative cooling to run often.
- A full maize plant reaches ~2 m and takes ~110 days. For more experiment cycles in a semester, consider a
  dwarf/sweet-corn variety or **hydroponic maize fodder** (7–10 day trays, common in India). Shorten the stage days in the config to match.

## The ML loop (`hydro/optimizer.py`)

1. **Growth signal:** daily water uptake from the ultrasonic reservoir sensor. It's the slope of the level between
   refill-pump events, so sensor jitter averages out.
2. **Target:** each day's uptake relative to its surrounding week. Raw uptake is dominated by plant size.
3. **Model:** a quadratic response surface (Ridge regression) of the target vs. air temp, humidity and light hours
   (plus pH/EC once those probes exist).
4. **Recommendation:** the model's best point inside the biology-safe stage range, blended with the biology prior
   by `n/(n+14) × max(0, cross-validated R²)`. A model that can't predict unseen days has zero influence.
5. **Exploration:** small daily setpoint perturbations give the data variation to learn from.

The full write-up with simulated experiments is in `report/REPORT.md` (and `report/REPORT.pdf`).
The short version: with an HC-SR04 and a fan-only rig, the signal is too weak to learn from one plant. The guard
keeps the system on the biology targets. A load cell plus parallel A/B trays are the fix.

## Wiring (what you have now)

| Part | Part pin | ESP32 |
|---|---|---|
| DHT22/DHT11 | VCC / GND / DATA | 3V3 / GND / **GPIO4** (10 kΩ DATA→3V3 if it's a bare 4-pin sensor, not a module) |
| HC-SR04 | VCC / GND | **5V (VIN)** / GND |
| HC-SR04 | TRIG | **GPIO5** |
| HC-SR04 | ECHO | **GPIO18 via divider**: ECHO–1 kΩ–GPIO18–2 kΩ–GND (ECHO is 5 V, ESP32 is 3.3 V only!) |

Mount the HC-SR04 on the reservoir lid facing straight down, at least 3 cm above the full water line (blind zone).
Then set `tank_empty_distance_cm`, `tank_full_distance_cm` and `tank_area_cm2` with a POST to `/api/settings`.
Humidity can condense on a plain HC-SR04. The waterproof **JSN-SR04T** is a drop-in replacement with the same pins.

Later (pins already reserved in `firmware/include/config.h`):
- Relay module: fan 25, light 26, refill pump 27, mister 32, heater/dosing pumps set to -1 until fitted.
- pH board (PH-4502C) → GPIO34 and TDS board → GPIO35. Use ADC1 pins only (ADC2 stops working while WiFi is on).
  Their outputs can reach 5 V, so use a divider. Set `ENABLE_PH`/`ENABLE_TDS` to 1 and calibrate in buffer solutions.

## Flashing the ESP32

```bash
cp firmware/include/secrets.example.h firmware/include/secrets.h   # WiFi (2.4 GHz) + your laptop's LAN IP
cd firmware && ../.venv/bin/pio run -t upload && ../.venv/bin/pio device monitor
```
Run the server with `--host 0.0.0.0` and allow port 8000 through your firewall. If the server is unreachable for 3 posts,
the ESP32 falls back to local safety rules: fan above 30 °C, pumps off, lights on an NTP schedule.

## Running for real (systemd user service)

The server runs as `~/.config/systemd/user/hydro.service` (`python -m hydro.run`): real DB at `data/hydro.db`,
HTTP on :8000 (ESP32 + dashboard) and HTTPS on :8443 (phone camera), starts at login and restarts on crash.

**Phone as the plant camera:** scan the QR code in the dashboard's *Plant camera* panel, or open
`https://<laptop-ip>:8443/camera`. The certificate is self-signed (`data/certs/`, regenerated when the laptop's
IP changes), so accept the warning once. Then use *Start camera*, *Capture*, or auto-capture every N minutes.
Photos are saved to `data/photos/`, tagged with grow day and stage. Over plain HTTP the page falls back to the
phone's camera app. A future ESP32-CAM can upload the same way: `POST /api/photos?source=esp32cam` with a JPEG body.
```bash
systemctl --user status hydro       # restart / stop / start the same way
journalctl --user -u hydro -f       # live log (each ESP32 POST shows up here)
```
Dashboard: http://localhost:8000, or `http://<laptop-ip>:8000` from a phone on the same hotspot.
When you actually plant, reset the grow clock:
`curl -X POST localhost:8000/api/settings -H 'content-type: application/json' -d "{\"planted_at\": $(date +%s)}"`

As you wire sensors, set `ENABLE_DHT` / `ENABLE_ULTRASONIC` to 1 in `firmware/include/config.h` and reflash.
While a sensor is 0, its field is left out of the report entirely, so it doesn't trigger "sensor failed" alerts.
Flashing at 460800 baud dropped out on this board, so `upload_speed` is pinned to 115200.

## Plant-health analysis (runs on this PC)

Every uploaded photo is analysed in the background by `hydro/vision.py` (numpy + Pillow + scipy, no GPU, no
cloud). It separates the plant from the background and reports:
- canopy cover %: a direct growth signal if the phone stays put;
- yellow/tan share: nitrogen deficiency;
- discrete lesions: blight or rust;
- brown share: necrosis or tip burn;
- purple share: phosphorus deficiency or cold;
- **DGCI** (Dark Green Colour Index), a published proxy for maize leaf nitrogen.

The dashboard shows the verdict, the advice, an overlay of what the analyzer saw, and a canopy/DGCI trend.
Problems raise alerts. Bad lighting (backlit, RGB/coloured light) gives "uncertain" instead of a confident
wrong answer. Re-run on everything: `python -m hydro.vision`.
These are colour heuristics, not a trained classifier. Once enough labelled photos exist, train a CNN.

## Crop advisor ("KhetSaathi", `advisor/`)

This answers "what's wrong with my crop and what do I do" for Indian farmers in Hindi or English, from a complaint,
the latest photo analysis, the ESP32 sensors and a short form. Ask it from the dashboard's *Ask about my crop* panel,
via `POST /api/advise`, or with `python -m advisor "makka ke patte peele" --crop maize --day 40`.

It runs in five stages, adapted from the neuro-symbolic mental-health pipeline it is modelled on:
1. **Safety gate (`safety.py`)** catches pesticide poisoning, farmer distress (Tele-MANAS 14416) and locust outbreaks
   before any model runs.
2. **Evidence fusion (`evidence.py`)** turns the photo, sensors and form into short sentences and context flags.
3. **Crop-agnostic tree (`tree.py`)** has 4 layers (domain, agent, syndrome, cause), each with "unrelated" and "normal"
   anchors and the paper's gate. Every crop shares layers 1–3, so a query costs at most 8 router calls whatever the crop.
4. **Consensus (`consensus.py`)** combines the evidence channels and rule-based priors, and asks yes/no follow-up
   questions when the top two causes are close.
5. **Advice DAG (`advice_graph.py`)** orders actions along the IPM ladder and prunes anything contraindicated: banned
   pesticides (including streptocycline since 2024), sprays when rain is forecast, bee-toxic products at flowering,
   chemicals near harvest, and soil advice for hydroponics.

Doses are never invented; chemicals are named with "label dose / ask KVK".

**Knowledge base:** `advisor/kb/` holds 35 tree nodes, 46 causes and 52 strategies for 5 pilot crops (maize, paddy,
wheat, tomato, potato), prioritised from real Kisan Call Centre queries. Adding a crop means adding a `crops.json`
entry plus host ids; no retraining.

**Router:** the router is `advisor/router.py`. Laya (multilingual) is the intended model. Until it is available, a
lexical baseline runs instead; on the 22 scored scenarios plus 429 real KCC queries it gets 11/22 scenarios and 34.5%
top-1. It has 0 safety or contraindication violations; those come from the deterministic layers, not the model.
Evaluate with `python -m advisor.eval [--router laya|onnx|lexical]`.

**Phone path (Phase 0, go/no-go):**
1. Run `python tools/make_parity_inputs.py`.
2. Upload `notebooks/kaggle/` to a Kaggle notebook and run `laya_phone_export.py`.
3. Unzip the bundle into `models/laya-multilingual-onnx/`.

`advisor/laya_lite.py` then runs it with onnxruntime + tokenizers only (no torch) and is the reference for the
browser port. It is unverified until its parity test passes (`python -m advisor.laya_lite --parity fixtures.json`).
Run `pip install onnxruntime tokenizers` first.

Data: KCC transcripts from data.gov.in (Open Government Licence – India). `tools/kcc_ingest.py` builds
`advisor/eval/kcc_eval.jsonl`.

## Alerts
Out-of-range values relative to the current stage, a low reservoir, a dead DHT or ultrasonic, and the ESP32 going offline.
A condition must persist for 5 min before it alerts (critical alerts fire immediately). To get critical alerts on your phone,
`export HYDRO_NOTIFY_URL=https://ntfy.sh/<a-long-random-topic>` and subscribe to that topic in the ntfy app.

## Layout
```
analysis/analyze_dataset.py   dataset EDA, crop ranking, envelope, suitability model
config/maize.json             stage-wise biology targets (edit me)
hydro/                        server, db, optimizer, controller, alerts, dashboard (static/)
simulator/simulate.py         fake ESP32 + fake plant
firmware/                     PlatformIO ESP32 project
```
