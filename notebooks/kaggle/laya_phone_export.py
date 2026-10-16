# Phase 0 (go/no-go): export Laya-multilingual for phones and measure what it costs.
#
# Run on Kaggle (free; CPU is enough, GPU T4 speeds up the PyTorch reference):
#   1. New Notebook -> File -> Import Notebook is not needed: paste this file into one code cell
#      (or split at the "# %%" markers).
#   2. Add Data -> Upload: a dataset containing parity_inputs.json and laya_lite.py from
#      esa_project/notebooks/kaggle/ (regenerate them with `python tools/make_parity_inputs.py`).
#   3. Settings -> Internet ON. Run all. Download /kaggle/working/laya_phone_bundle.zip and unzip it into
#      esa_project/models/laya-multilingual-onnx/.
#
# Outputs: model.onnx (fp32), model_fp16.onnx, model_int8.onnx, tokenizer files, rl_agent_config.json,
#          fixtures.json (official PyTorch probabilities for the parity test), report.json.

# %% install
import subprocess, sys
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "laya[onnx]", "onnxconverter-common", "tokenizers"], check=True)
subprocess.run(["git", "clone", "-q", "--depth", "1", "https://github.com/NandhaKishorM/laya", "/kaggle/working/laya-src"], check=False)

# %% locate inputs and the checkpoint
import glob, json, os, shutil, time
from pathlib import Path

INPUTS = next(Path(p).parent for p in glob.glob("/kaggle/input/**/parity_inputs.json", recursive=True))
OUT = Path("/kaggle/working/laya_phone_bundle"); OUT.mkdir(exist_ok=True)
MODEL_ID = os.environ.get("LAYA_MODEL", "convaiinnovations/laya-multilingual")
print("inputs:", INPUTS, "| model:", MODEL_ID)

from huggingface_hub import snapshot_download
snap = Path(snapshot_download(MODEL_ID))
print(sorted(p.relative_to(snap).as_posix() for p in snap.rglob("*") if p.is_file())[:30])

# tokenizer + config next to the onnx files, flat, as advisor/laya_lite.py expects
for name in ("tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"):
    hits = list(snap.rglob(name))
    if hits:
        shutil.copy(hits[0], OUT / name)
cfg_hits = list(snap.rglob("rl_agent_config.json"))
assert cfg_hits, "rl_agent_config.json not found in the checkpoint"
shutil.copy(cfg_hits[0], OUT / "rl_agent_config.json")

# %% export fp32 + int8 with the official exporter, then fp16
t0 = time.time()
subprocess.run([sys.executable, "/kaggle/working/laya-src/scripts/export_onnx.py", "--model", MODEL_ID,
                "--output", str(OUT / "model.onnx"), "--quantize"], check=True)
os.replace(OUT / "model.int8.onnx", OUT / "model_int8.onnx")
import onnx
from onnxconverter_common import float16
m = onnx.load(str(OUT / "model.onnx"))
m16 = float16.convert_float_to_float16(m, keep_io_types=True)  # int64/bool inputs stay as-is
onnx.save(m16, str(OUT / "model_fp16.onnx"))
print(f"export done in {time.time() - t0:.0f}s")
sizes = {f.name: round(f.stat().st_size / 1e6, 1) for f in OUT.glob("*.onnx")}
print("sizes MB:", sizes)

# %% ground truth: official PyTorch Laya on the advisor's real questions
from laya import Agent
agent = Agent(MODEL_ID)
cases = json.loads((INPUTS / "parity_inputs.json").read_text())
fixtures = []
t0 = time.time()
for c in cases:
    res = agent.predict(c["state"], c["questions"])
    probs = {}
    for qn, a in res["answers"].items():
        if "probabilities" in a:
            probs[qn] = a["probabilities"]
    fixtures.append({"state": c["state"], "questions": c["questions"], "probabilities": probs})
torch_ms = (time.time() - t0) * 1000 / len(cases)
(OUT / "fixtures.json").write_text(json.dumps(fixtures, ensure_ascii=False))
print(f"pytorch reference: {torch_ms:.0f} ms per state ({len(cases)} states)")

# %% our torch-free runtime on each export: parity + speed
sys.path.insert(0, str(INPUTS))
from laya_lite import LayaOnnx
report = {"model": MODEL_ID, "sizes_mb": sizes, "pytorch_ms_per_state": round(torch_ms)}
for f in ("model.onnx", "model_fp16.onnx", "model_int8.onnx"):
    rt = LayaOnnx(OUT, onnx_file=f, threads=4)
    worst, agree, n, t0 = 0.0, 0, 0, time.time()
    for fx in fixtures:
        got = rt.score(fx["state"], {k: v for k, v in fx["questions"].items() if k in fx["probabilities"]})
        for qn, ref in fx["probabilities"].items():
            if set(ref) != set(got[qn]):
                continue  # label naming differs (e.g. noul); compared on choice questions only
            worst = max(worst, max(abs(got[qn][lab] - p) for lab, p in ref.items()))
            agree += max(ref, key=ref.get) == max(got[qn], key=got[qn].get)
            n += 1
    ms = (time.time() - t0) * 1000 / len(fixtures)
    report[f] = {"max_abs_dp": round(worst, 4), "top1_agreement": round(agree / n, 3), "ms_per_state_4threads": round(ms)}
    print(f, report[f])

# Go/no-go gate from the plan: phone variant must agree with PyTorch on >= 97% of decisions.
best = max(("model_fp16.onnx", "model_int8.onnx"), key=lambda f: (report[f]["top1_agreement"] >= 0.97, -sizes[f]))
report["recommended_phone_model"] = best
(OUT / "report.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))

# %% bundle (drop fp32 to keep the download small unless you want it)
os.remove(OUT / "model.onnx")
shutil.make_archive("/kaggle/working/laya_phone_bundle", "zip", OUT)
print("download /kaggle/working/laya_phone_bundle.zip")
