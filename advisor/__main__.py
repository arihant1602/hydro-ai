"""CLI: python -m advisor "complaint text" [--crop maize] [--day 40] [--weather humid,heavy_rain] [--photo ID]"""
import argparse
import json

from .engine import Advisor


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("text")
    ap.add_argument("--crop")
    ap.add_argument("--day", type=int)
    ap.add_argument("--weather", default="", help="comma list: heavy_rain,cold,hot,humid,dry,frost")
    ap.add_argument("--hydroponic", action="store_true")
    ap.add_argument("--rain-forecast", action="store_true")
    ap.add_argument("--lang", default="en", choices=["en", "hi"])
    ap.add_argument("--router", default="auto", choices=["auto", "laya", "onnx", "lexical"])
    ap.add_argument("--debug", action="store_true")
    a = ap.parse_args()
    from .router import get_router
    adv = Advisor(router=get_router(a.router))
    form = {"crop": a.crop, "day": a.day, "weather": [w for w in a.weather.split(",") if w],
            "hydroponic": a.hydroponic, "rain_forecast": a.rain_forecast}
    res = adv.advise(a.text, form={k: v for k, v in form.items() if v not in (None, [], False)} | {"hydroponic": a.hydroponic}, lang=a.lang)
    if not a.debug:
        res.pop("debug", None)
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
