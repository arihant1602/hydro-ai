"""Run the simulator under several configurations (fresh server + DB each) for the report.

Writes report/data/<run>_days.csv (setpoints + height per day) and <run>_daily.json (uptake table).
Usage: python analysis/run_experiments.py [--days 60]
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "report" / "data"
PY = sys.executable
RUNS = {
    "baseline": ("fixed biology targets, no ML, no exploration", [], {"ml_enabled": False, "explore": False}),
    "ml_basic": ("ML, current hardware (DHT + ultrasonic)", [], {}),
    "ml_full": ("ML, all probes (adds pH + EC)", ["--full"], {}),
    "precise_baseline": ("precise level sensor (load cell), no ML", ["--level-noise-cm", "0.01"],
                         {"ml_enabled": False, "explore": False}),
    "precise_ml": ("precise level sensor (load cell) + ML", ["--level-noise-cm", "0.01"], {}),
}


def run(name, extra, settings, days, port, seed):
    db = OUT / f"{name}.db"
    db.unlink(missing_ok=True)
    server = subprocess.Popen([PY, "-m", "uvicorn", "hydro.server:app", "--port", str(port)], cwd=ROOT,
                              env={**os.environ, "HYDRO_DB": str(db)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(60):
            try:
                requests.get(f"{url}/api/settings", timeout=1)
                break
            except requests.ConnectionError:
                time.sleep(0.5)
        subprocess.run([PY, "simulator/simulate.py", "--server", url, "--days", str(days), "--seed", str(seed),
                        "--backfill-only", "--settings", json.dumps(settings),
                        "--log-csv", str(OUT / f"{name}_days.csv"), *extra],
                       cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
        (OUT / f"{name}_daily.json").write_text(requests.get(f"{url}/api/history/daily").text)
        (OUT / f"{name}_status.json").write_text(requests.get(f"{url}/api/status").text)
    finally:
        server.terminate()
        server.wait()
        db.unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--seeds", type=int, default=3, help="repeat each configuration with this many noise seeds")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [(f"{name}_s{seed}", desc, extra, settings, seed)
            for name, (desc, extra, settings) in RUNS.items() for seed in range(1, args.seeds + 1)]
    # Independent servers on separate ports/DBs, so run a few at once.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(4) as pool:
        for i, (tag, desc, extra, settings, seed) in enumerate(jobs):
            pool.submit(run, tag, extra, settings, args.days, 8790 + i, seed).add_done_callback(
                lambda f, tag=tag, desc=desc: print(f"done {tag}: {desc}", f.exception() or "", flush=True))


if __name__ == "__main__":
    main()
