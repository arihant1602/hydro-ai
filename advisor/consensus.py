"""Stage 4: cross-channel consensus, deterministic priors and the clarification loop.

Each evidence channel (complaint alone, complaint + photo, complaint + context, everything) is routed
independently. A cause the channels agree on is more trustworthy than one a single channel produced:

    S_c = 100 * V_c / N + 100 * mu_c - 50 * sigma_c + prior_c + answers_c

V = channels where the cause appears (p >= 0.01), mu/sigma = mean/std of its path probability across
channels. Priors come from rules, not the model: weather/sensor conditions that favour or rule out a
cause, and photo signals that match what the cause should look like.
"""
import math

from . import kb as kbmod

VOTE_FLOOR = 0.05  # a channel votes for a cause only if its path probability is meaningful
CONDITION_FOR, CONDITION_AGAINST = 8.0, -15.0
PHOTO_MATCH, PHOTO_HEALTHY_PENALTY = 8.0, -6.0
ANSWER_YES, ANSWER_NO = 20.0, -25.0
CLARIFY_MARGIN = 15.0  # ask follow-up questions when the top two are this close


def _photo_prior(cause, photo):
    if not photo or photo.get("verdict") in (None, "no plant in view", "analysis failed") or \
            str(photo.get("verdict", "")).startswith("uncertain"):
        return 0.0
    exp = cause.get("photo", {})
    bonus = 0.0
    if exp.get("yellow_frac") in ("high", "medium") and (photo.get("yellow_frac") or 0) > 0.12:
        bonus += PHOTO_MATCH
    if exp.get("lesions") in ("high", "medium") and (photo.get("lesion_frac") or 0) > 0.04:
        bonus += PHOTO_MATCH
    if exp.get("brown_frac") in ("high", "medium") and (photo.get("brown_frac") or 0) > 0.06:
        bonus += PHOTO_MATCH / 2
    if exp.get("purple_frac") and (photo.get("purple_frac") or 0) > 0.06:
        bonus += PHOTO_MATCH
    if exp.get("dgci") == "low" and photo.get("dgci") is not None and photo["dgci"] < 0.45:
        bonus += PHOTO_MATCH / 2
    is_normal = "NORMAL" in cause["syndromes"]
    if photo.get("verdict") == "healthy":
        bonus += PHOTO_MATCH if is_normal else PHOTO_HEALTHY_PENALTY
    return bonus


def _condition_prior(cause, flags):
    total = 0.0
    for cond, direction in cause.get("conditions", {}).items():
        if flags.get(cond):
            total += CONDITION_FOR if direction == "for" else CONDITION_AGAINST
    if "NORMAL" in cause["syndromes"] and cause["id"] == "C_NORMAL_SENESCENCE" and not flags.get("late_stage", False):
        total += CONDITION_AGAINST  # lower leaves dying in a young crop is not "normal ageing"
    return total


def aggregate(channel_leaves, flags, photo=None, answers=None):
    kb = kbmod.load()
    n = len(channel_leaves)
    cands = set().union(*[set(l) for l in channel_leaves.values()]) if channel_leaves else set()
    answers = answers or {}
    rows = []
    for cid in cands:
        ps = [channel_leaves[ch].get(cid, 0.0) for ch in channel_leaves]
        v = sum(p >= VOTE_FLOOR for p in ps)
        mu = sum(ps) / n
        sigma = math.sqrt(sum((p - mu) ** 2 for p in ps) / n)
        cause = kb["causes"][cid]
        prior = _condition_prior(cause, flags) + _photo_prior(cause, photo)
        ans = 0.0
        for crit in cause.get("criteria", []):
            if crit["id"] in answers:
                ans += ANSWER_YES if answers[crit["id"]] else ANSWER_NO
        score = 100 * v / n + 100 * mu - 50 * sigma + prior + ans
        rows.append({"id": cid, "score": round(score, 1), "votes": v, "of": n, "mu": round(mu, 3),
                     "sigma": round(sigma, 3), "prior": prior, "answers": ans})
    rows.sort(key=lambda r: -r["score"])
    return rows


def clarifying_questions(ranked, answers=None, k=2):
    """Distinguishing yes/no checks from the top two causes when they are close."""
    if len(ranked) < 2 or ranked[0]["score"] - ranked[1]["score"] >= CLARIFY_MARGIN:
        return []
    kb = kbmod.load()
    answers = answers or {}
    qs = []
    for row in ranked[:2]:
        for crit in kb["causes"][row["id"]].get("criteria", []):
            if crit["id"] not in answers:
                qs.append({"id": crit["id"], "for": row["id"], "en": crit["en"], "hi": crit["hi"]})
                break
    return qs[:k]


def confidence_label(ranked):
    if not ranked:
        return "none"
    top = ranked[0]
    gap = top["score"] - (ranked[1]["score"] if len(ranked) > 1 else 0)
    if top["votes"] == top["of"] and gap >= 25:
        return "high"
    if gap >= CLARIFY_MARGIN:
        return "medium"
    return "low"
