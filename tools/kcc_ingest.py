"""Kisan Call Centre (KCC) transcripts -> problem-frequency table + labelled evaluation set.

Source: data.gov.in "Kisan Call Centre (KCC) - Transcripts of farmers queries & answers"
(Open Government Licence - India), via the Hugging Face mirror rishabha25/kcc_up_2024_100k (UP, 2024).

KCC `QueryText` is a call-centre summary that usually NAMES the problem ("control of stem borer in
paddy"), so labels come from matching those names to KB causes. It tests routing of real farmer
vocabulary (incl. Hinglish like khaira, gundhi, deemak, mahu); symptom-description routing is tested
by advisor/eval/scenarios.json.

  python tools/kcc_ingest.py        # writes advisor/eval/kcc_eval.jsonl and data/kcc/problem_frequency.csv
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from advisor import kb as kbmod  # noqa: E402

SRC = ROOT / "data" / "kcc" / "kcc_up_2024_100k.csv"
URL = "https://huggingface.co/datasets/rishabha25/kcc_up_2024_100k/resolve/main/kcc_up_2024_100k.csv"
PER_CLASS = 25

# Named problem in the query -> acceptable KB causes, per crop ('*' = any pilot crop).
LABELS = [
    (r"fall army ?worm|\bfaw\b", "*", ["P_FAW"]),
    (r"stem ?borer|tana chhedak|dead ?heart", "paddy", ["P_PADDY_STEMBORER"]),
    (r"stem ?borer|tana chhedak|dead ?heart", "maize", ["P_MAIZE_STEMBORER"]),
    (r"leaf ?folder|patti lapetak", "paddy", ["P_LEAFFOLDER"]),
    (r"plant ?hopper|\bbph\b|hopper", "paddy", ["P_BPH"]),
    (r"gundhi|gandhi bug|ear ?head bug", "paddy", ["P_GUNDHI"]),
    (r"false smut|haldi rog|kandua", "paddy", ["D_FALSE_SMUT"]),
    (r"\bblast\b|jhonka", "paddy", ["D_BLAST"]),
    (r"bacterial (leaf )?blight|\bblb\b", "paddy", ["D_BLB"]),
    (r"sheath blight", "*", ["D_SHEATH_BLIGHT"]),
    (r"khaira|zinc", "*", ["C_ZN_DEF"]),
    (r"yellow rust|peela ratua|stripe rust", "wheat", ["D_YELLOW_RUST"]),
    (r"brown rust|leaf rust|bhura ratua", "wheat", ["D_BROWN_RUST"]),
    (r"loose smut", "wheat", ["D_LOOSE_SMUT"]),
    (r"termite|deemak|dimak", "*", ["P_TERMITE"]),
    (r"aphid|mahu|maahu|chepa", "*", ["P_APHID"]),
    (r"white ?fly|safed makhi", "*", ["P_WHITEFLY", "V_TOLCV"]),
    (r"fruit ?borer|phal chhedak", "*", ["P_FRUITBORER"]),
    (r"late blight|pachheti", "*", ["D_LATE_BLIGHT"]),
    (r"early blight|ageti", "*", ["D_EARLY_BLIGHT"]),
    (r"\bblight\b|jhulsa", "potato", ["D_LATE_BLIGHT", "D_EARLY_BLIGHT"]),
    (r"leaf curl|patti marod", "tomato", ["V_TOLCV"]),
    (r"cut ?worm|katua", "*", ["P_CUTWORM"]),
    (r"frost|pala|paala", "*", ["C_FROST"]),
    (r"black scurf", "potato", ["D_BLACK_SCURF"]),
    (r"(fruit|flower).{0,15}drop", "tomato", ["M_FLOWER_DROP", "C_HEAT"]),
    (r"tuber size|small tuber", "potato", ["M_SMALL_TUBER"]),
]


def main():
    if not SRC.exists():
        raise SystemExit(f"download first:\n  curl -L -o {SRC} {URL}")
    df = pd.read_csv(SRC)
    df["QueryType"] = df.QueryType.str.strip()
    kb = kbmod.load()
    kcc_to_crop = {n: c for c, p in kb["crops"].items() for n in p["kcc_names"]}
    df["crop"] = df.Crop.map(kcc_to_crop)
    df = df[df.crop.notna()]

    # 1) What farmers of each pilot crop call about: guides which causes the KB must cover first.
    freq = (df.groupby(["crop", "QueryType"]).size().rename("calls").reset_index()
              .sort_values(["crop", "calls"], ascending=[True, False]))
    freq.to_csv(ROOT / "data" / "kcc" / "problem_frequency.csv", index=False)

    # 2) Labelled eval set from problem-naming queries.
    rows = []
    q = df[df.QueryType.isin(["Plant Protection", "Nutrient Management", "Fertilizer Use and Availability",
                              "Cultural Practices", "Water Management"])]
    for text, crop in zip(q.QueryText.astype(str), q.crop):
        t = text.lower()
        for pattern, host, gold in LABELS:
            if (host == "*" or host == crop) and re.search(pattern, t):
                gold = [g for g in gold if crop in kb["causes"][g]["hosts"] or "*" in kb["causes"][g]["hosts"]]
                if gold:
                    rows.append({"text": re.sub(r"\s+", " ", text).strip(), "crop": crop, "gold": gold})
                break
    out = pd.DataFrame(rows).drop_duplicates("text")
    out["cls"] = out.gold.str[0]
    sample = pd.concat(g.sample(min(len(g), PER_CLASS), random_state=0) for _, g in out.groupby("cls"))
    path = ROOT / "advisor" / "eval" / "kcc_eval.jsonl"
    with path.open("w") as f:
        for r in sample.itertuples():
            f.write(json.dumps({"text": r.text, "crop": r.crop, "gold": r.gold}, ensure_ascii=False) + "\n")
    print(f"labelled {len(out)} unique problem queries; sampled {len(sample)} across {sample.cls.nunique()} causes -> {path}")
    print(sample.cls.value_counts().to_string())


if __name__ == "__main__":
    main()
