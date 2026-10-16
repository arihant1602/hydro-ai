"""Stage 3 scorer: P(option | state) for a batch of typed questions.

All backends share one interface, the Laya `predict` contract:
    score(state: str, questions: {name: {"type": "choice", "instructions": str, "criteria": {label: desc}}})
      -> {name: {label: probability}}

Backends
- LayaRouter    the real thing (`pip install laya`, needs torch); used on PC once disk space allows.
- LayaOnnx      the same model exported to ONNX for the phone (advisor/laya_lite.py, no torch).
- LexicalRouter a dependency-free bag-of-words baseline. It exists so the pipeline runs and is testable
                today, and as the ablation baseline in evaluation. It is NOT a substitute for Laya:
                it can't read Devanagari paraphrases or negation.
"""
import math
import re
from collections import Counter

TOKEN = re.compile(r"[a-zऀ-ॿ]+")
# Words that carry no symptom information in farmer queries.
STOP = set("""a an the and or of in on at to for from with is are was were be been my our your this that these those it its
there their they he she i we you me crop crops field plant plants leaf leaves farmer asked query about information
please tell how what why which when control problem problems issue mein me ke ki ka hai hain ho raha rahe rahi
se par aur ya bhi kya kaise""".split())


def tokens(text):
    out = []
    for t in TOKEN.findall(text.lower()):
        if t in STOP or len(t) < 3:
            continue
        out.append(t[:5])  # crude stemming: yellowing/yellow, turning/turn, spots/spot...
    return out


class LexicalRouter:
    name = "lexical-baseline"

    def __init__(self, temperature=0.06, anchor_prior=0.10):
        self.temperature = temperature
        self.anchor_prior = anchor_prior  # similarity the anchors get for free (they have no keywords to match)

    def _sim(self, q, desc):
        d = Counter(tokens(desc))
        if not q or not d:
            return 0.0
        overlap = sum(min(q[t], d[t]) for t in q)
        return overlap / math.sqrt(sum(q.values()) * sum(d.values()))

    def score(self, state, questions):
        q = Counter(tokens(state))
        out = {}
        for name, spec in questions.items():
            sims = {}
            for label, desc in spec["criteria"].items():
                s = self._sim(q, desc)
                # "unrelated" gets a floor so that a message matching nothing lands there; "normal" must be
                # earned with words like healthy/fine, otherwise "nothing matched" would read as "healthy".
                if label == "__unrelated":
                    s = max(s, self.anchor_prior)
                sims[label] = s
            z = [math.exp(v / self.temperature) for v in sims.values()]
            tot = sum(z)
            out[name] = {k: v / tot for k, v in zip(sims, z)}
        return out


class LayaRouter:
    """Wraps the official package (needs torch). Uses the multilingual checkpoint for Hindi."""
    name = "laya"

    def __init__(self, **kw):
        from laya import Router  # imported lazily: heavy and optional
        self.router = Router(preload=True, **kw)

    def score(self, state, questions):
        res = self.router.predict(state, questions)
        return {name: a.get("probabilities", {a["choice"]: 1.0}) for name, a in res["answers"].items()}


def get_router(kind="auto"):
    if kind in ("auto", "laya"):
        try:
            return LayaRouter()
        except Exception:
            if kind == "laya":
                raise
    if kind in ("auto", "onnx"):
        try:
            from .laya_lite import LayaOnnx
            return LayaOnnx.from_default_path()
        except Exception:
            if kind == "onnx":
                raise
    return LexicalRouter()
