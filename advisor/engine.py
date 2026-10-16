"""End-to-end advisor: safety -> evidence -> tree (per channel) -> consensus -> advice.

    from advisor.engine import Advisor
    adv = Advisor()                       # picks Laya if installed, else the lexical baseline
    adv.advise("makka ke patte peele ho rahe hain", form={"crop": "maize", "day": 40})

    python -m advisor "leaves turning yellow from the tip" --crop wheat --day 50
"""
import time

from . import advice_graph, consensus, evidence, safety, tree
from . import kb as kbmod
from .router import get_router

MAX_CAUSES_ADVISED = 2


class Advisor:
    def __init__(self, router=None, **gate):
        self.router = router or get_router()
        self.gate = gate  # tau / alpha / beta / beam overrides

    def advise(self, text="", form=None, photo=None, sensors=None, stage_targets=None, answers=None, lang="en"):
        t0 = time.perf_counter()
        form = dict(form or {})
        kb = kbmod.load()
        out = {"router": self.router.name, "safety": None}

        alert = safety.check(text or "")
        if alert:
            out["safety"] = {k: alert[k] for k in ("kind", "halt")} | {"message": alert[lang]}
            if alert["halt"]:
                out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
                return out

        form.setdefault("crop", kbmod.detect_crop(text or ""))
        if not form["crop"]:
            out["needs"] = {"field": "crop", "en": "Which crop is this?", "hi": "यह कौन सी फसल है?",
                            "options": sorted(kb["crops"])}
            return out
        ctx = evidence.context(form, sensors=sensors, photo=photo, stage_targets=stage_targets)

        # Independent evidence channels. With only a complaint there is one channel; each extra
        # source adds a view that must agree for a cause to gain votes.
        ctx_text = " ".join(ctx["context_sentences"])
        channels = {}
        if text:
            channels["complaint"] = text
            if ctx["photo_sentence"]:
                channels["complaint+photo"] = f"{text} {ctx['photo_sentence']}"
            if ctx_text:
                channels["complaint+context"] = f"{text} {ctx_text}"
            if ctx["photo_sentence"] and ctx_text:
                channels["all"] = f"{text} {ctx['photo_sentence']} {ctx_text}"
        elif ctx["photo_sentence"]:
            channels["photo+context"] = f"{ctx['photo_sentence']} {ctx_text}".strip()
        else:
            out["needs"] = {"field": "complaint", "en": "Describe the problem or add a photo.", "hi": "समस्या बताइए या फोटो जोड़िए।"}
            return out

        runs = {ch: tree.traverse(self.router, s, form["crop"], **self.gate) for ch, s in channels.items()}
        # "Unrelated" anchor dominant in every channel: not a crop problem (weather, schemes, prices...).
        alpha = self.gate.get("alpha", 0.85)
        roots = [r["trace"][0]["probs"] for r in runs.values() if r["trace"]]
        if roots and all(p.get(tree.UNREL, 0) >= alpha or max(v for k, v in p.items() if k != tree.UNREL) < 0.2
                         for p in roots) and not any(r["leaves"] for r in runs.values()):
            out.update({"crop": form["crop"], "unrelated": True,
                        "message": {"en": "This doesn't look like a crop problem. Describe what you see on the plants "
                                          "(leaves, stem, fruit, insects) or add a photo.",
                                    "hi": "यह फसल की समस्या नहीं लगती। पौधे पर क्या दिख रहा है (पत्ती, तना, फल, कीट) बताइए या फोटो जोड़िए।"}[lang],
                        "router_calls": sum(r["calls"] for r in runs.values()),
                        "latency_ms": round((time.perf_counter() - t0) * 1000, 1)})
            return out
        ranked = consensus.aggregate({ch: r["leaves"] for ch, r in runs.items()}, ctx["flags"], photo, answers)
        conf = consensus.confidence_label(ranked)
        questions = consensus.clarifying_questions(ranked, answers)

        if not ranked:
            top_ids = []
        elif conf == "high" or len(ranked) == 1:
            top_ids = [ranked[0]["id"]]
        else:
            top_ids = [r["id"] for r in ranked[:MAX_CAUSES_ADVISED]]
        actions, avoid = advice_graph.build(top_ids, ctx["flags"], lang)
        escalate = not ranked or conf == "low"
        if escalate and not any(a["strategy"] == "CHK_SAMPLE_KVK" for a in actions):
            s = kb["strategies"]["CHK_SAMPLE_KVK"]
            actions.append({"cause": None, "strategy": "CHK_SAMPLE_KVK", "kind": "escalate", "evidence": "Supp", "text": s[lang]})

        out.update({
            "crop": form["crop"], "stage": ctx["stage"],
            "likely": [{"id": r["id"], "name": kb["causes"][r["id"]][f"name_{lang}"], "score": r["score"],
                        "agreement": f"{r['votes']}/{r['of']} evidence channels"} for r in ranked[:3]],
            "confidence": conf,
            "questions": questions,
            "actions": actions,
            "avoid": avoid,
            "evidence_used": list(channels),
            "notifiable": any(kb["causes"][c].get("notifiable") for c in top_ids),
            "router_calls": sum(r["calls"] for r in runs.values()),
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "debug": {"ranked": ranked[:6], "flags": {k: v for k, v in ctx["flags"].items() if v},
                      "channels": channels},
        })
        return out
