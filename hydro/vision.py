"""Plant-health analysis of camera photos, run locally (numpy + Pillow, no GPU or downloads).

Per photo:
  1. Segment the plant: green leaf pixels by hue/saturation, then yellow (chlorotic) and brown
     (necrotic) pixels, but only *near* green tissue, so wooden tables or skin don't count as dying leaves.
  2. Measure:
     - canopy_pct   plant area as % of the frame; tracks growth if the phone stays in one spot
     - yellow_frac  share of plant tissue that is yellow: chlorosis, classic nitrogen deficiency in maize
     - brown_frac   share that is brown, or pale tan lesions enclosed by leaf: blight, rust, burn
     - purple_frac  share that is purple-tinged: phosphorus deficiency / cold stress
     - dgci         Dark Green Colour Index (Karcher & Richardson 2003), 0-1. Used to estimate maize leaf
                    nitrogen from photos: higher = darker green = more N
  3. Verdict + advice, plus an overlay PNG showing exactly what was classified as what.

These are colour heuristics, not a trained disease classifier. They need roughly even, daylight-ish
lighting (no RGB keyboard glow) and the plant filling a decent part of the frame. Once enough labelled
photos exist, a CNN can replace step 3.

  python -m hydro.vision            # (re)analyse every stored photo
"""
import json
import threading

import numpy as np
from PIL import Image, ImageFilter, ImageOps
from scipy.ndimage import label

from . import db

ANALYSIS_DIR = db.DB_PATH.parent / "photos" / "analysis"
WORK_SIDE = 512
VERSION = 1

# Hue in degrees (0-360).
GREEN_HUE = (62, 170)         # includes the pale yellow-green of young / backlit leaves
YELLOW_HUE = (35, 62)         # true chlorotic yellow
BROWN_HUE = (8, 35)
PURPLE_HUE = (270, 345)       # anthocyanin purpling
MIN_GREEN_PCT = 1.0           # green leaf area (% of frame) needed before we call it a plant
MAX_OFFCOLOUR_RATIO = 1.5     # yellow+brown > 1.5x green: probably background (wood, skin), not sick leaves
YELLOW_WARN, BROWN_WARN, PURPLE_WARN = 0.15, 0.06, 0.08
LESION_WARN = 0.04            # share of plant in large discrete off-colour patches (spots/streaks, not diffuse yellowing)
LESION_MIN_PATCH = 0.003      # a patch must be >= 0.3% of plant area to count as a lesion
DGCI_LOW = 0.45               # pale foliage; maize with adequate N typically reads higher under daylight

_lock = threading.Lock()


def _hsv(rgb):
    """rgb float array in 0..1 -> hue degrees, saturation, value."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-6
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & ~rm & ~gm
    h[rm] = (60 * ((g - b)[rm] / d[rm])) % 360
    h[gm] = 60 * ((b - r)[gm] / d[gm]) + 120
    h[bm] = 60 * ((r - g)[bm] / d[bm]) + 240
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def _dilate(mask, px):
    img = Image.fromarray((mask * 255).astype(np.uint8))
    return np.asarray(img.filter(ImageFilter.MaxFilter(px | 1))) > 0


def _close(mask, px):
    """Dilate then erode: fills holes in the leaf (where lesions are) without growing its outline."""
    img = Image.fromarray((mask * 255).astype(np.uint8))
    return np.asarray(img.filter(ImageFilter.MaxFilter(px | 1)).filter(ImageFilter.MinFilter(px | 1))) > 0


def _on_leaf(candidates, green, min_green_border=0.5):
    """Keep connected patches of `candidates` whose outer border is mostly green leaf."""
    lab, n = label(candidates)
    if n == 0:
        return candidates
    border = _dilate(candidates, 3) & ~candidates
    # Per patch: share of its border pixels that are green. The border pixel belongs to whichever
    # patch is adjacent; a max filter on labels attributes it.
    lab_img = Image.fromarray(lab.astype(np.int32).astype(np.float32), mode="F")
    near_lab = np.asarray(lab_img.filter(ImageFilter.MaxFilter(3))).astype(np.int64)
    idx = near_lab[border]
    tot = np.bincount(idx, minlength=n + 1)
    grn = np.bincount(idx, weights=green[border], minlength=n + 1)
    keep = np.zeros(n + 1, bool)
    keep[1:] = (tot[1:] > 0) & (grn[1:] / np.maximum(tot[1:], 1) >= min_green_border)
    return keep[lab]


def _clean(mask, px=3):
    """Drop speckle: erode then dilate (morphological opening)."""
    img = Image.fromarray((mask * 255).astype(np.uint8))
    img = img.filter(ImageFilter.MinFilter(px)).filter(ImageFilter.MaxFilter(px))
    return np.asarray(img) > 0


def analyse_image(path):
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    img.thumbnail((WORK_SIDE, WORK_SIDE))
    rgb = np.asarray(img, dtype=np.float32) / 255
    h, s, v = _hsv(rgb)

    green = _clean((h >= GREEN_HUE[0]) & (h < GREEN_HUE[1]) & (s > 0.18) & (v > 0.12), 5)
    # Off-colour tissue (yellowing, lesions, purpling) is a patch of non-green colour that is mostly
    # *bordered by leaf*. Background (wood, soil, skin) is mostly bordered by other background, even
    # when it touches a leaf, so judging each patch by its border keeps it out.
    warm = ~green & (h >= BROWN_HUE[0]) & (h < YELLOW_HUE[1]) & (s > 0.2) & (v > 0.15) & (v < 0.95)
    purple_c = ~green & (h >= PURPLE_HUE[0]) & (h < PURPLE_HUE[1]) & (s > 0.15) & (v > 0.15)
    tissue = _on_leaf(_clean(warm), green) | _on_leaf(_clean(purple_c), green)
    yellow = tissue & (h >= YELLOW_HUE[0]) & (h < YELLOW_HUE[1]) & (v > 0.30)
    purple = tissue & (h >= PURPLE_HUE[0])
    brown = tissue & ~yellow & ~purple
    plant = green | yellow | brown | purple

    n_plant = int(plant.sum())
    canopy_pct = 100 * n_plant / plant.size
    m = {
        "canopy_pct": round(canopy_pct, 2),
        "green_pct": round(100 * green.sum() / plant.size, 2),
        "yellow_frac": round(yellow.sum() / n_plant, 3) if n_plant else None,
        "brown_frac": round(brown.sum() / n_plant, 3) if n_plant else None,
        "purple_frac": round(purple.sum() / n_plant, 3) if n_plant else None,
        "lesion_frac": None, "lesions": 0,
        "dgci": None,
        "brightness": round(float(v.mean()), 3),
        "colour_cast": round(float(np.abs(rgb.mean((0, 1)) - rgb.mean()).max()), 3),
        "blown_pct": round(100 * float(((v > 0.95) & (s < 0.15))[_dilate(plant, 15)].mean()), 1) if n_plant else 0.0,
    }
    if n_plant:
        lab, n = label((yellow | brown) & ~purple)
        sizes = np.bincount(lab.ravel())[1:]
        big = sizes[sizes >= LESION_MIN_PATCH * n_plant]
        m["lesions"], m["lesion_frac"] = int(len(big)), round(float(big.sum()) / n_plant, 3)
    if green.any():
        # DGCI = [(H - 60)/60 + (1 - S) + (1 - B)] / 3 over green leaf pixels.
        m["dgci"] = round(float(np.mean(((h[green] - 60) / 60 + (1 - s[green]) + (1 - v[green])) / 3)), 3)

    verdict, issues = _verdict(m)

    # Overlay: dim the background, paint classes so the user can see what the analyzer saw.
    over = rgb * 0.35
    over[green] = rgb[green] * 0.5 + np.array([0.1, 0.8, 0.3]) * 0.5
    over[yellow] = np.array([1.0, 0.85, 0.1])
    over[brown] = np.array([0.85, 0.15, 0.15])
    over[purple] = np.array([0.6, 0.3, 0.9])
    ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)
    out = ANALYSIS_DIR / (path.stem + ".png")
    Image.fromarray((np.clip(over, 0, 1) * 255).astype(np.uint8)).save(out, optimize=True)
    return {**m, "verdict": verdict, "issues": issues, "overlay": f"/photos/analysis/{out.name}", "version": VERSION}


def _verdict(m):
    issues = []
    if m["brightness"] < 0.18:
        issues.append(("too_dark", "Photo too dark to judge leaf colour. Add light or move the phone."))
    unreliable = False
    if m["blown_pct"] > 15:
        unreliable = True
        issues.append(("overexposed", f"{m['blown_pct']:.0f}% of the frame is blown out (backlit / sun in frame). "
                                      "Shoot with the light behind the camera."))
    if m["colour_cast"] > 0.12:
        unreliable = True
        issues.append(("colour_cast", "Strong colour cast (RGB lights or a coloured grow light?). Colour readings are unreliable."))
    if m["green_pct"] < MIN_GREEN_PCT:
        issues.append(("no_plant", "No plant detected in the frame."))
        return "no plant in view", issues
    offcolour = m["canopy_pct"] - m["green_pct"]
    if offcolour > MAX_OFFCOLOUR_RATIO * m["green_pct"]:
        issues.append(("uncertain", "Far more yellow/brown than green around the plant. Probably background "
                                    "(wood, skin, warm light) being picked up. Reframe on the plant with a plain background."))
        return "uncertain", issues
    if m["yellow_frac"] is not None and m["yellow_frac"] > YELLOW_WARN:
        issues.append(("chlorosis", f"{m['yellow_frac']:.0%} of leaf area is yellow/tan. Even yellowing from the tips of "
                                    "older leaves usually means nitrogen deficiency: check EC and raise nutrient strength. "
                                    "Long cigar-shaped tan patches mean northern leaf blight (fungal): remove the leaves and cut humidity."))
    if m["lesion_frac"] is not None and m["lesion_frac"] > LESION_WARN and not any(k == "chlorosis" for k, _ in issues):
        issues.append(("lesions", f"{m['lesions']} distinct tan/brown patch(es) covering {m['lesion_frac']:.0%} of the leaf. "
                                  "Long cigar-shaped grey-tan lesions point to northern leaf blight; small rusty pustules to "
                                  "common rust. Remove affected leaves, lower humidity, improve airflow."))
    if m["brown_frac"] is not None and m["brown_frac"] > BROWN_WARN:
        issues.append(("necrosis", f"{m['brown_frac']:.0%} brown/necrotic tissue. Look for leaf spots or lesions "
                                   "(blight, rust) or tip burn from high EC."))
    if m["purple_frac"] is not None and m["purple_frac"] > PURPLE_WARN:
        issues.append(("purpling", f"{m['purple_frac']:.0%} purple-tinged tissue. In maize this usually means phosphorus "
                                   "deficiency or cold stress (P uptake stalls below ~15 °C)."))
    if m["dgci"] is not None and m["dgci"] < DGCI_LOW and not any(k == "chlorosis" for k, _ in issues):
        issues.append(("pale", f"Leaves are pale (DGCI {m['dgci']:.2f}). Nitrogen may be running low."))
    problems = [k for k, _ in issues if k in ("chlorosis", "lesions", "necrosis", "pale", "purpling")]
    if problems and unreliable:
        return "uncertain (lighting)", issues
    return ("needs attention" if problems else "healthy"), issues


def _ensure_columns():
    cols = {r["name"] for r in db.query("PRAGMA table_info(photos)")}
    if "analysis" not in cols:
        db.execute("ALTER TABLE photos ADD COLUMN analysis TEXT")


def analyse_photo(photo_id):
    """Analyse one stored photo, save the result, and raise/clear vision alerts if it's the newest."""
    from . import alerts
    _ensure_columns()
    row = db.query("SELECT * FROM photos WHERE id=?", (photo_id,))
    if not row:
        return None
    row = row[0]
    path = db.DB_PATH.parent / "photos" / row["file"]
    with _lock:
        try:
            result = analyse_image(path)
        except Exception as e:  # corrupt upload etc.: record it rather than crash the server thread
            result = {"verdict": "analysis failed", "issues": [("error", str(e))], "version": VERSION}
    db.execute("UPDATE photos SET analysis=? WHERE id=?", (json.dumps(result), photo_id))
    newest = db.query("SELECT id FROM photos ORDER BY ts DESC LIMIT 1")[0]["id"]
    if newest == photo_id:
        found = {f"vision_{k}": ("warning", msg) for k, msg in result["issues"]
                 if k in ("chlorosis", "lesions", "necrosis", "pale", "purpling")}
        alerts.sync_group("vision_", found, row["ts"], persist=False)
    return result


def analyse_async(photo_id):
    threading.Thread(target=analyse_photo, args=(photo_id,), daemon=True).start()


def growth_series():
    """Canopy cover over time, from photos that contain a plant."""
    _ensure_columns()
    out = []
    for r in db.query("SELECT ts, day, analysis FROM photos WHERE analysis IS NOT NULL ORDER BY ts"):
        a = json.loads(r["analysis"])
        if a.get("green_pct", 0) >= MIN_GREEN_PCT:
            out.append({"ts": r["ts"], "day": r["day"], "canopy_pct": a["canopy_pct"], "dgci": a.get("dgci"),
                        "yellow_frac": a.get("yellow_frac"), "brown_frac": a.get("brown_frac")})
    return out


if __name__ == "__main__":
    _ensure_columns()
    for r in db.query("SELECT id, file FROM photos ORDER BY ts"):
        res = analyse_photo(r["id"])
        print(f"{r['file']}: {res['verdict']}  canopy {res.get('canopy_pct')}%  "
              f"yellow {res.get('yellow_frac')}  brown {res.get('brown_frac')}  dgci {res.get('dgci')}")
        for _, msg in res["issues"]:
            print("   -", msg)
