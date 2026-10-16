"""Build the Kaggle upload bundle in notebooks/kaggle/: parity_inputs.json (real advisor questions on real
texts) plus a copy of advisor/laya_lite.py, so the notebook can score them with the official PyTorch Laya
(ground truth) and with our ONNX runtime. Re-run after changing the KB or laya_lite.py.
"""
import shutil
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from advisor import kb as kbmod, tree  # noqa: E402

OUT = ROOT / "notebooks" / "kaggle" / "parity_inputs.json"


def questions_for(kb, crop, rng):
    q = {"root": tree._question(kb, [(n["id"], n["desc"]) for n in kbmod.children(kb, None)], with_normal=True)}
    l1 = rng.choice([n["id"] for n in kbmod.children(kb, None)])
    q["l2"] = tree._question(kb, [(n["id"], n["desc"]) for n in kbmod.children(kb, l1)], with_normal=False)
    view = kbmod.crop_view(crop)
    syn = rng.choice([s for s in view if s != "NORMAL"])
    q["cause"] = tree._question(kb, [(c, kb["causes"][c]["desc"]) for c in view[syn][0]], with_normal=False)
    cause = kb["causes"][view[syn][0][0]]
    if cause["criteria"]:
        q["check"] = {"type": "noul", "instructions": cause["criteria"][0]["en"]}
    return q


def main():
    rng = random.Random(0)
    kb = kbmod.load()
    texts = []
    for c in json.loads((ROOT / "advisor" / "eval" / "scenarios.json").read_text())["cases"]:
        crop = c.get("form", {}).get("crop") or kbmod.detect_crop(c["text"])
        if crop:
            texts.append((c["text"], crop))
    kcc = [json.loads(l) for l in (ROOT / "advisor" / "eval" / "kcc_eval.jsonl").read_text().splitlines()]
    texts += [(k["text"], k["crop"]) for k in rng.sample(kcc, 40)]
    cases = [{"state": t, "crop": crop, "questions": questions_for(kb, crop, rng)} for t, crop in texts]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cases, ensure_ascii=False, indent=1))
    shutil.copy(ROOT / "advisor" / "laya_lite.py", OUT.parent / "laya_lite.py")
    print(f"{len(cases)} cases, {sum(len(c['questions']) for c in cases)} questions -> {OUT}")


if __name__ == "__main__":
    main()
