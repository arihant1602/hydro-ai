"""Fake ESP32 + fake corn plant, so the whole loop can be developed before the hardware exists.

It POSTs readings exactly like the firmware does, obeys the actuator commands the server
returns, and models a plant whose water uptake depends on conditions through a *hidden*
optimum the server doesn't know. If the optimizer works, its recommended setpoints should
drift toward that hidden optimum over the simulated days.

  python simulator/simulate.py --days 30            # backfill 30 days fast, then stream live
  python simulator/simulate.py --days 30 --full     # also simulate pH / EC / water-temp / lux probes
"""
import argparse
import csv
import json
import math
import random
import time

import requests

STEP_S = 600  # simulated seconds between readings (10 min)
# Hidden "true" optimum for this virtual plant; deliberately not the stage-range mid-points.
TRUE_OPT = {"air_temp": 24.0, "humidity": 63.0, "light_hours": 17.0}


class Rig:
    def __init__(self, full, start, level_noise_cm=0.2):
        self.full = full
        self.level_noise_cm = level_noise_cm
        self.t = start
        self.air, self.hum = 27.0, 60.0
        self.water_l = 20.0          # 30x30 cm tank, ~22.5 L when full
        self.ph, self.ec = 6.1, 1.2
        self.height = 0.0
        self.light_today = 0.0
        self.act = {}

    def ambient(self):
        hour = (self.t / 3600) % 24
        temp = 28 + 4 * math.sin((hour - 9) / 24 * 2 * math.pi)   # Indian room, peak ~3 pm
        hum = 60 - 10 * math.sin((hour - 9) / 24 * 2 * math.pi)
        return temp, hum

    def step(self, day):
        a, dt_h = self.act, STEP_S / 3600
        amb_t, amb_h = self.ambient()
        target_t = amb_t - (5 if a.get("fan") else 0) + (5 if a.get("heater") else 0) + (1.5 if a.get("light") else 0)
        self.air += (target_t - self.air) * 0.5 + random.gauss(0, 0.15)
        target_h = amb_h + (25 if a.get("mister") else 0) - (8 if a.get("fan") else 0) + min(day, 60) * 0.1
        self.hum += (target_h - self.hum) * 0.5 + random.gauss(0, 0.8)
        self.hum = min(max(self.hum, 20), 99)
        if a.get("light"):
            self.light_today += dt_h

        # Plant: size grows logistically; uptake = size * condition quality.
        size = 1 / (1 + math.exp(-(day - 35) / 8))
        quality = math.exp(-((self.air - TRUE_OPT["air_temp"]) / 4) ** 2 - ((self.hum - TRUE_OPT["humidity"]) / 15) ** 2)
        light_q = 1.0 if not a.get("light") else 1.15 - 0.03 * abs(17 - max(8, min(18, a.get("_lh", 16))))
        transp = (0.05 + 1.6 * size) * quality * light_q * (1.4 if a.get("light") else 0.5)  # L/day
        self.water_l -= transp * dt_h / 24
        self.height += 0.25 * size * quality * light_q * (1 - size) * 4 * dt_h if day > 6 else 0
        drunk = transp * dt_h / 24
        self.ec *= 1 + 0.3 * drunk / max(self.water_l, 1)    # plants drink water faster than salts
        if a.get("refill_pump"):
            added = min(0.8, 22.5 - self.water_l)         # ~4.8 L/h pump, fresh water EC ~0
            self.ec *= self.water_l / (self.water_l + added + 1e-9)
            self.water_l += added
        self.water_l = min(max(self.water_l, 0), 22.5)

        # Nutrient chemistry: nitrate uptake pushes pH up, evaporation concentrates EC, refills dilute.
        self.ph += 0.002 + random.gauss(0, 0.003) - (0.15 if a.get("ph_down_ms") else 0) + (0.15 if a.get("ph_up_ms") else 0)
        self.ec += 0.08 if a.get("nutrient_ms") else 0
        self.t += STEP_S

    def reading(self):
        dist = 30 - self.water_l * 1000 / 900 + random.gauss(0, self.level_noise_cm)  # what the HC-SR04 sees
        r = {"device_id": "sim", "ts": self.t, "air_temp": round(self.air, 2), "humidity": round(self.hum, 1),
             "water_distance_cm": round(dist, 1)}
        if random.random() < 0.003:
            r["air_temp"] = r["humidity"] = None   # occasional DHT read failure, like the real thing
        if self.full:
            r.update(ph=round(self.ph + random.gauss(0, 0.02), 2), ec=round(self.ec, 2),
                     water_temp=round(self.air - 2, 1), light_lux=12000.0 if self.act.get("light") else 30.0)
        return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="http://127.0.0.1:8000")
    ap.add_argument("--days", type=float, default=30, help="days to backfill as fast as possible")
    ap.add_argument("--full", action="store_true", help="simulate pH/EC/water-temp/lux probes too")
    ap.add_argument("--live-interval", type=float, default=1.0, help="wall seconds per simulated 10 min after backfill")
    ap.add_argument("--level-noise-cm", type=float, default=0.2,
                    help="water-level sensor noise; 0.2 ~ HC-SR04, 0.01 ~ load cell under the reservoir")
    ap.add_argument("--seed", type=int, help="seed the plant/sensor noise for repeatable runs")
    ap.add_argument("--settings", default="{}", help='extra server settings as JSON, e.g. \'{"ml_enabled": false}\'')
    ap.add_argument("--log-csv", help="write one row per simulated day (height, setpoints) to this file")
    ap.add_argument("--backfill-only", action="store_true", help="exit after the backfill instead of streaming")
    args = ap.parse_args()

    start = time.time() - args.days * 86400
    start -= start % 86400 - 6 * 3600  # plant at 06:00-ish so day boundaries are tidy
    if args.seed is not None:
        random.seed(args.seed)
    requests.post(f"{args.server}/api/settings",
                  json={"planted_at": start, **json.loads(args.settings)}).raise_for_status()
    rig = Rig(args.full, start, args.level_noise_cm)
    s = requests.Session()
    print(f"backfilling {args.days} days ...")
    log = None
    while True:
        day = (rig.t - start) / 86400
        resp = s.post(f"{args.server}/api/readings", json=rig.reading()).json()
        rig.act = {**resp["actuators"], "_lh": resp["setpoints"].get("light_hours", 16)}
        if int(day) != int((rig.t + STEP_S - start) / 86400):
            sp = resp["setpoints"]
            print(f"day {int(day):3d}  height {rig.height:5.1f} cm  setpoints {sp}")
            s.post(f"{args.server}/api/observations", json={"ts": rig.t, "height_cm": round(rig.height, 1)})
            if args.log_csv:
                row = {"day": int(day), "height_cm": round(rig.height, 2), **sp}
                if log is None:
                    f = open(args.log_csv, "w", newline="")
                    log = csv.DictWriter(f, fieldnames=["day", "height_cm", "air_temp_c", "humidity_pct",
                                                        "light_hours", "ph", "ec_ms_cm"])
                    log.writeheader()
                log.writerow(row)
                f.flush()
        rig.step(day)
        if day >= args.days:
            if args.backfill_only:
                return
            time.sleep(args.live_interval)


if __name__ == "__main__":
    main()
