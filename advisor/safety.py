"""Stage 1: deterministic safety interception. Runs before any model and cannot be overridden by one."""
import re
from functools import lru_cache

from . import kb as kbmod

ORDER = ["poisoning", "distress", "outbreak"]  # most urgent first


@lru_cache
def _compiled():
    safety = kbmod.load()["rules"]["safety"]
    return {k: [re.compile(p, re.IGNORECASE) for p in safety[k]["patterns"]] for k in ORDER}


def check(text):
    """Returns None (proceed) or {'kind', 'halt', 'en', 'hi'}. Poisoning and distress halt the pipeline;
    an outbreak report is added on top of normal advice."""
    safety = kbmod.load()["rules"]["safety"]
    for kind in ORDER:
        if any(p.search(text) for p in _compiled()[kind]):
            return {"kind": kind, "halt": kind in ("poisoning", "distress"),
                    "en": safety[kind]["en"], "hi": safety[kind]["hi"]}
    return None
