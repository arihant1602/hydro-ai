# Hydro AI phone app

The whole Hydro AI system on one Android phone: ESP32 + sensors + this app, no laptop, router or internet.

```
 ESP32 (firmware LINK_PHONE mode) ── its own WiFi "HydroAI-maize", 192.168.4.1
   │  GET  /api/readings?after=<seq>   latest reading + up to 3 h buffered while the phone was away
   │  POST /api/actuators              relay commands + today's targets for the board to hold
   ▼
 Phone app (Expo / React Native, TypeScript), all on-device:
   engine/optimizer.ts    ridge response surface on daily water uptake -> setpoints (port of hydro/optimizer.py)
   engine/controller.ts   hysteresis -> fan / light / pump / mister / heater / dosing (hydro/controller.py)
   engine/suitability.ts  the scikit-learn random forest, exported to JSON and evaluated in TS
   engine/vision.ts       leaf-colour analysis of camera photos (hydro/vision.py)
   engine/advisor/        KhetSaathi crop advisor: safety, evidence, tree, consensus, advice DAG (advisor/)
   lib/                   SQLite log, ESP32 link, alerts + local notifications, photo storage
```

When the app is closed or the phone walks away, the board keeps today's targets with the same bands
(no dosing, no pumping blind) and buffers readings. The next time the app opens it backfills them, so the
learning signal has no gaps.

## Build and install (Android)

```bash
./deps.sh                                   # npm ci
npx expo prebuild --platform android        # generates android/ (not committed)
cd android && JAVA_HOME=/usr/lib/jvm/java-25-openjdk ./gradlew assembleRelease
adb install app/build/outputs/apk/release/app-release.apk
```
The release APK contains the JS bundle, fonts, model and knowledge base, so it needs nothing from the network.
It is signed with the debug key, which is fine for sideloading but not for the Play Store.

Development: `npx expo run:android` (a development build; Expo Go can't load the WiFi-binding module).

## Connect to the board

1. Flash the firmware once (`firmware/`, version 3.0 or newer). After that, every board setting (its WiFi name and
   password, an optional router + laptop dashboard, which sensors are fitted, GPIO pins, relay wiring, reading
   interval) is changed from the app: **Settings → Board**. The board validates pins before saving and restarts.
2. The board always runs its own WiFi (`HydroAI-…`, address 192.168.4.1). Join it from the phone; when Android says
   it has no internet, choose to stay connected. If the board has also joined a router (or this phone's hotspot),
   the app can use its router address instead: **Settings → Connection** offers both.
3. *Blink the board LED* proves you're talking to the right board. Calibrate the water tank and soil probe under
   **Settings → Calibration** ("Use now as empty/full/dry/wet").

Android normally sends traffic over mobile data when the WiFi has no internet. `modules/wifi-bind` binds the
app to the WiFi network so 192.168.4.1 stays reachable with mobile data on; the app only binds when an unbound
request fails, because binding would cut off a board reached through the phone's hotspot.

No hardware? `python simulator/fake_esp32.py --speed 60 --full` serves the same API from a simulated plant.
Put the phone and PC on one WiFi and set the board address to `<pc-ip>:8080`.

## Leaf disease model

Leaf check runs two things on the phone: the colour rules (`engine/vision.ts`: yellowing, purpling, paleness,
lesion area) and a random forest (`engine/leafModel.ts`) that names maize leaf diseases: healthy, common rust,
northern leaf blight, gray leaf spot. It was trained on PlantVillage maize leaves (CC BY-SA 3.0); results and
caveats are in `../report/leaf_model_report.md`. To retrain:

```bash
npx tsx scripts/leaf_features.ts <list.tsv> <out.csv>   # features with the app's own code (see the script)
../.venv/bin/python ../tools/train_leaf_model.py         # CV, threshold on val, test once, export the forest
npx tsx scripts/eval_leaf_app.ts                         # score the app's full pipeline on the test images
../.venv/bin/python ../tools/make_leaf_samples.py        # the "Try a sample" leaves (random test images)
```

## Tests

`npm test` checks the TypeScript engine against Python reference outputs in `test/parity/`: forest
probabilities, the optimizer's daily table / fit / setpoints, vision metrics on identical pixels, and the
advisor's causes, confidence, actions and contraindications, and the leaf disease forest's probabilities
against scikit-learn. After changing the Python side, regenerate with
`.venv/bin/python tools/export_mobile_assets.py` (it also refreshes `src/data/`).

Known differences from the Python server:
- The daily exploration nudge uses a different seeded random generator (same size of nudge, different values).
- JPEG decoding (jpeg-js vs libjpeg) differs on a few edge pixels, so area shares can move by ~0.1 %.
- The advisor uses the lexical router; the Laya ONNX router isn't wired in yet.
- Control runs while the app is open. For continuous phone-side control, leave a phone at the rig with
  *Keep screen on* (Rig tab); otherwise the board holds the targets itself.
