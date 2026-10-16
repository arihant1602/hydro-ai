"""Fake ESP32 for the phone app: the same HTTP API as the firmware in LINK_PHONE mode, backed by the
simulated plant in simulate.py. Lets you run the app end-to-end without hardware.

    python simulator/fake_esp32.py                # serve on :8080, plant runs in real time
    python simulator/fake_esp32.py --speed 60     # one simulated minute per real second

Then set the board address on the app's Rig tab to <this-pc-ip>:8080 (phone and PC on the same WiFi).
"""
import argparse
import json
import random
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import simulate

HISTORY_LEN = 1080
INTERVAL_S = 10
RELAYS = ["fan", "light", "refill_pump", "mister", "heater"]


class Board:
    def __init__(self, speed, full):
        self.lock = threading.Lock()
        self.speed = speed
        self.rig = simulate.Rig(full, time.time())
        self.start_t = time.time() - 20 * 86400  # pretend the plant is 20 days old
        self.history = []
        self.seq = 0
        self.boot = time.monotonic()
        self.last_cmd = None
        self.acts = {r: False for r in RELAYS}

    def tick(self):
        with self.lock:
            simulate.STEP_S = INTERVAL_S * self.speed
            day = (self.rig.t - self.start_t) / 86400
            self.rig.act = {**self.acts, "_lh": 16}
            self.rig.step(day)
            r = self.rig.reading()
            self.seq += 1
            sample = {k: r.get(k) for k in ("air_temp", "humidity", "water_distance_cm", "ph", "ec") if k in r}
            self.history.append({"seq": self.seq, "mono": time.monotonic(), **sample, "acts": dict(self.acts)})
            del self.history[:-HISTORY_LEN]

    def holding(self):
        return self.last_cmd is None or time.monotonic() - self.last_cmd > 60


def handler(board):
    class H(BaseHTTPRequestHandler):
        def _send(self, obj, code=200):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            u = urlparse(self.path)
            q = parse_qs(u.query)
            if u.path == "/api/readings":
                after = int(q.get("after", ["0"])[0])
                with board.lock:
                    now = time.monotonic()
                    rows = [h for h in board.history if h["seq"] > after][:120]
                    self._send({
                        "device_id": "fake-esp32", "fw": "sim", "uptime_s": int(now - board.boot),
                        "interval_s": INTERVAL_S, "latest_seq": board.seq,
                        "oldest_seq": board.history[0]["seq"] if board.history else 1,
                        "holding": board.holding(), "clients": 1, "actuators": board.acts,
                        "readings": [{**{k: v for k, v in h.items() if k != "mono"}, "age_s": round(now - h["mono"], 1)}
                                     for h in rows],
                    })
            elif u.path == "/led":
                n = int(q.get("blink", ["5"])[0])
                print(f"LED blink x{n}")
                self._send({"ok": True, "blink": n, "uptime_s": int(time.monotonic() - board.boot)})
            else:
                self._send({"error": "not found"}, 404)

        def do_POST(self):
            if urlparse(self.path).path != "/api/actuators":
                return self._send({"error": "not found"}, 404)
            try:
                doc = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            except ValueError:
                return self._send({"error": "bad json"}, 400)
            with board.lock:
                board.acts = {r: bool(doc.get("actuators", {}).get(r, False)) for r in RELAYS}
                board.last_cmd = time.monotonic()
            doses = {k: v for k, v in doc.get("actuators", {}).items() if k.endswith("_ms") and v}
            print(f"<- {board.acts} {doses or ''} hold={doc.get('hold')}")
            self._send({"ok": True, "actuators": board.acts})

        def log_message(self, *a):
            pass

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--speed", type=float, default=1.0, help="simulated seconds per real second")
    ap.add_argument("--full", action="store_true", help="also simulate pH / EC probes")
    ap.add_argument("--seed", type=int)
    args = ap.parse_args()
    if args.seed is not None:
        random.seed(args.seed)
    board = Board(args.speed, args.full)

    def loop():
        while True:
            board.tick()
            time.sleep(INTERVAL_S if args.speed <= 1 else 1)

    threading.Thread(target=loop, daemon=True).start()
    print(f"fake ESP32 on :{args.port} (set the app's board address to <this-pc-ip>:{args.port})")
    ThreadingHTTPServer(("0.0.0.0", args.port), handler(board)).serve_forever()


if __name__ == "__main__":
    main()
