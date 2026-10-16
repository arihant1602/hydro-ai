"""Minimal Laya runtime: ONNX Runtime + `tokenizers` only (no torch, no transformers).

A line-for-line port of the sequence building and decoding in the official `laya` package
(laya/common.py build_head/build_sequence/render_options, laya/onnx_agent.py decode), so that
- the PC can run Laya without installing torch, and
- the phone/browser port (TypeScript) has a small, readable reference.

Model directory layout (produced by notebooks/export_laya_multilingual_onnx.ipynb):
    model.onnx | model_fp16.onnx | model_int8.onnx
    tokenizer.json, tokenizer_config.json        (HF fast tokenizer files)
    rl_agent_config.json                         (max_len, head_max_len, temperature, temperature_by_options)

Parity with the official package must be checked with `python -m advisor.laya_lite --parity fixtures.json`
(the notebook writes those fixtures from the PyTorch model) before trusting numbers from this runtime.
"""
import json
import os
from pathlib import Path

import numpy as np

QTYPES = {"choice": 0, "score": 1, "noul": 2}
QTYPE_NAMES = {v: k for k, v in QTYPES.items()}
TEMP_MIN, TEMP_MAX = 0.5, 5.0
# Same lookup order as laya-ts: ModernBERT `[X]` names first, Gemma/mmBERT `<x>` names after.
SPECIAL_ALIASES = {"cls": ["[CLS]", "<bos>", "<s>"], "sep": ["[SEP]", "<eos>", "</s>"],
                   "pad": ["[PAD]", "<pad>"], "mask": ["[MASK]", "<mask>"]}
DEFAULT_DIR = Path(os.environ.get("LAYA_ONNX_DIR", Path(__file__).resolve().parent.parent / "models" / "laya-multilingual-onnx"))


def _render_criterion(v):
    return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, separators=(", ", ": "), default=str)


def render_options(q):
    t, crit = q["t"], q.get("crit")
    if t == "choice":
        return [str(k) if v is None or v == "" else "%s: %s" % (k, _render_criterion(v)) for k, v in crit.items()]
    if t == "score":
        return ["level %d: %s" % (i, _render_criterion(c)) for i, c in enumerate(crit)]
    crit = crit or {}
    f, tr = crit.get("false"), crit.get("true")
    return ["false: " + (_render_criterion(f) if f not in (None, "") else "no, the statement does not hold"),
            "true: " + (_render_criterion(tr) if tr not in (None, "") else "yes, the statement holds")]


def to_internal(qdef):
    t, crit = qdef["type"], qdef.get("criteria")
    if t == "choice" and isinstance(crit, list):
        crit = {c: None for c in crit}
    elif t == "noul" and isinstance(crit, dict):
        crit = {str(k).lower(): v for k, v in crit.items()}
    ins = qdef["instructions"]
    if not isinstance(ins, str):
        ins = json.dumps(ins, ensure_ascii=False)
    return {"t": t, "ins": ins, "crit": crit}


def temp_bucket(qt, k):
    size = "2" if k <= 2 else "3-5" if k <= 5 else "6-10" if k <= 10 else "11+"
    return "%s:%s" % (QTYPE_NAMES[qt], size)


def clamp_t(t):
    try:
        t = float(t)
    except (TypeError, ValueError):
        return 1.0
    return min(TEMP_MAX, max(TEMP_MIN, t))


class LayaOnnx:
    name = "laya-onnx"

    def __init__(self, model_dir, onnx_file=None, threads=None):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        d = Path(model_dir)
        self.tok = Tokenizer.from_file(str(d / "tokenizer.json"))
        tcfg = json.loads((d / "tokenizer_config.json").read_text()) if (d / "tokenizer_config.json").exists() else {}
        found = {}
        for role, aliases in SPECIAL_ALIASES.items():
            v = tcfg.get(f"{role}_token")
            names = ([v if isinstance(v, str) else v["content"]] if v else []) + aliases
            tok_name = next((n for n in names if self.tok.token_to_id(n) is not None), None)
            if tok_name is None:
                raise ValueError(f"tokenizer has no {role} token (tried {names})")
            found[role] = tok_name
        self.cls_id, self.sep_id, self.mask_id, self.pad_id = (self.tok.token_to_id(found[r]) for r in ("cls", "sep", "mask", "pad"))
        self.mask_token = found["mask"]
        cfg = json.loads((d / "rl_agent_config.json").read_text())
        self.max_len = cfg.get("max_len", 512)
        self.head_max_len = cfg.get("head_max_len", 192)
        self.temperature = [clamp_t(t) for t in cfg.get("temperature", [1.0, 1.0, 1.0])]
        self.temperature_by_options = {k: clamp_t(v) for k, v in cfg.get("temperature_by_options", {}).items()}
        # fp16 first: the official exporter measured int8 agreeing with the eager multilingual model on
        # only ~83% of decisions, so int8 is opt-in (pass onnx_file="model_int8.onnx").
        f = onnx_file or next(n for n in ("model_fp16.onnx", "model.onnx", "laya.onnx", "model_int8.onnx") if (d / n).exists())
        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        self.session = ort.InferenceSession(str(d / f), sess_options=so, providers=["CPUExecutionProvider"])
        self.model_file = f

    @classmethod
    def from_default_path(cls):
        if not DEFAULT_DIR.exists():
            raise FileNotFoundError(f"no ONNX model at {DEFAULT_DIR}; run the Kaggle export notebook")
        return cls(DEFAULT_DIR)

    def _encode(self, text, max_tokens=None):
        ids = self.tok.encode(text, add_special_tokens=False).ids
        return ids[:max_tokens] if max_tokens else ids

    def build_head(self, q):
        opts = render_options(q)
        head_ids = self._encode("%s question: %s" % (q["t"], str(q["ins"]).replace(self.mask_token, " ")))
        opt_ids = [[self.mask_id] + self._encode(" " + o.replace(self.mask_token, " "), 48) for o in opts]
        budget = self.head_max_len - sum(len(o) for o in opt_ids)
        if budget < 16:
            per = max(4, (self.head_max_len - 16) // max(1, len(opt_ids)))
            opt_ids = [o[:per] for o in opt_ids]
            budget = self.head_max_len - sum(len(o) for o in opt_ids)
        head_ids = head_ids[: max(8, budget)]
        ids = [self.cls_id] + head_ids + [self.sep_id]
        markers = []
        for o in opt_ids:
            markers.append(len(ids))
            ids.extend(o)
        ids.append(self.sep_id)
        return ids, markers

    def build_sequence(self, state_ids, q):
        ids, markers = self.build_head(q)
        room = max(0, self.max_len - len(ids) - 1)
        ids = ids + state_ids[:room] + [self.sep_id]
        ids, markers = ids[: self.max_len], [m for m in markers if m < self.max_len]
        return ids, markers

    def score(self, state, questions):
        """Same contract as advisor.router: {name: {label: probability}}."""
        state_ids = self._encode(state.replace(self.mask_token, " ") if isinstance(state, str) else json.dumps(state, ensure_ascii=False))
        names = list(questions)
        internal = [to_internal(questions[n]) for n in names]
        items = [self.build_sequence(state_ids, q) for q in internal]
        n, L = len(items), max(len(i) for i, _ in items)
        kmax = max(2, max(len(m) for _, m in items))  # exported head needs >= 2 slots (topk(2))
        input_ids = np.full((n, L), self.pad_id, dtype=np.int64)
        att = np.zeros((n, L), dtype=np.int64)
        mpos = np.zeros((n, kmax), dtype=np.int64)
        mmask = np.zeros((n, kmax), dtype=bool)
        for r, (ids, markers) in enumerate(items):
            input_ids[r, : len(ids)] = ids
            att[r, : len(ids)] = 1
            mpos[r, : len(markers)] = markers
            mmask[r, : len(markers)] = True
        qtype = np.array([QTYPES[q["t"]] for q in internal], dtype=np.int64)
        logits = self.session.run(["logits"], {"input_ids": input_ids, "attention_mask": att, "marker_pos": mpos,
                                               "marker_mask": mmask, "qtype": qtype})[0]
        out = {}
        for r, (name, q) in enumerate(zip(names, internal)):
            k = len(items[r][1])
            qt = QTYPES[q["t"]]
            t = self.temperature_by_options.get(temp_bucket(qt, k), self.temperature[qt])
            z = logits[r, :k].astype(np.float64) / t
            p = np.exp(z - z.max())
            p /= p.sum()
            labels = (list(q["crit"]) if q["t"] == "choice" else ["false", "true"] if q["t"] == "noul"
                      else [str(i) for i in range(k)])
            out[name] = {lab: float(v) for lab, v in zip(labels, p)}
        return out


def _parity(fixtures_path, model_dir):
    """Compare against probabilities recorded from the official PyTorch package."""
    fx = json.loads(Path(fixtures_path).read_text())
    m = LayaOnnx(model_dir)
    worst = 0.0
    for case in fx:
        got = m.score(case["state"], case["questions"])
        for qn, probs in case["probabilities"].items():
            for lab, v in probs.items():
                worst = max(worst, abs(got[qn][lab] - v))
    print(f"{len(fx)} cases, max |dp| = {worst:.4f} ({m.model_file})")
    return worst


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--parity", required=True)
    ap.add_argument("--model-dir", default=str(DEFAULT_DIR))
    a = ap.parse_args()
    _parity(a.parity, a.model_dir)
