// ESP32 hydroponic node: read sensors, report them, apply actuator commands.
//
// The board always runs its own WiFi network (AP) for the phone app, and can at the same time join a router
// (STA) to report to the FastAPI dashboard on a laptop. Who drives the relays, in order:
//   1. the phone app (POST /api/actuators within PHONE_TIMEOUT_S)
//   2. the dashboard server (its reply to our POST /api/readings, within SERVER_TIMEOUT_S)
//   3. the board itself, holding the last setpoints with simple hysteresis (no dosing, no blind pumping)
//
// Settings (WiFi names, sensors on/off, pins, calibration) live in NVS and are edited from the app via
// GET/POST /api/config, so changing hardware never needs a reflash. config.h only holds first-boot defaults.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <sys/time.h>
#include <time.h>

#include <vector>

#include "config.h"

#define FW_VERSION "3.1"
#include "secrets.h"

#ifndef AP_SSID
#define AP_SSID "HydroAI-maize"
#endif
#ifndef AP_PASS
#define AP_PASS "change-me-123"
#endif
#ifndef WIFI_SSID
#define WIFI_SSID ""
#endif
#ifndef WIFI_PASS
#define WIFI_PASS ""
#endif
#ifndef SERVER_URL
#define SERVER_URL ""
#endif
#ifndef DEVICE_ID
#define DEVICE_ID "esp32-corn-1"
#endif

// ---------------- Settings (NVS) ----------------

enum { FAN, LIGHT, REFILL, MISTER, HEATER, N_RELAYS };
enum { PH_DOWN, PH_UP, NUTRIENT, N_DOSERS };
const char *RELAY_NAMES[N_RELAYS] = {"fan", "light", "refill_pump", "mister", "heater"};
const char *DOSER_NAMES[N_DOSERS] = {"ph_down_ms", "ph_up_ms", "nutrient_ms"};

struct Config {
  String deviceId = DEVICE_ID;
  String apSsid = AP_SSID, apPass = AP_PASS;
  String staSsid = WIFI_SSID, staPass = WIFI_PASS;
  String serverUrl = SERVER_URL;
  int intervalS = DEF_INTERVAL_S;
  bool dht = DEF_DHT;
  int dhtType = DEF_DHT_TYPE, dhtPin = DEF_DHT_PIN;
  bool ultrasonic = DEF_ULTRASONIC;
  int trigPin = DEF_US_TRIG_PIN, echoPin = DEF_US_ECHO_PIN;
  bool soil = DEF_SOIL;
  int soilPin = DEF_SOIL_PIN;
  bool ph = DEF_PH;
  int phPin = DEF_PH_PIN;
  float phNeutralV = DEF_PH_NEUTRAL_V, phVoltsPerUnit = DEF_PH_VOLTS_PER_UNIT;
  bool tds = DEF_TDS;
  int tdsPin = DEF_TDS_PIN;
  bool relayActiveLow = DEF_RELAY_ACTIVE_LOW;
  int relayPins[N_RELAYS] = {DEF_PIN_FAN, DEF_PIN_LIGHT, DEF_PIN_REFILL_PUMP, DEF_PIN_MISTER, DEF_PIN_HEATER};
  int doserPins[N_DOSERS] = {DEF_PIN_PH_DOWN, DEF_PIN_PH_UP, DEF_PIN_NUTRIENT};
} cfg;

Preferences prefs;

// Passwords are never sent back out; the app only learns whether one is set.
void configToJson(JsonObject o, bool withSecrets) {
  o["device_id"] = cfg.deviceId;
  o["ap_ssid"] = cfg.apSsid;
  o["sta_ssid"] = cfg.staSsid;
  o["server_url"] = cfg.serverUrl;
  o["interval_s"] = cfg.intervalS;
  o["dht"] = cfg.dht;
  o["dht_type"] = cfg.dhtType;
  o["dht_pin"] = cfg.dhtPin;
  o["ultrasonic"] = cfg.ultrasonic;
  o["trig_pin"] = cfg.trigPin;
  o["echo_pin"] = cfg.echoPin;
  o["soil"] = cfg.soil;
  o["soil_pin"] = cfg.soilPin;
  o["ph"] = cfg.ph;
  o["ph_pin"] = cfg.phPin;
  o["ph_neutral_v"] = cfg.phNeutralV;
  o["ph_volts_per_unit"] = cfg.phVoltsPerUnit;
  o["tds"] = cfg.tds;
  o["tds_pin"] = cfg.tdsPin;
  o["relay_active_low"] = cfg.relayActiveLow;
  JsonObject rp = o["relay_pins"].to<JsonObject>();
  for (int i = 0; i < N_RELAYS; i++) rp[RELAY_NAMES[i]] = cfg.relayPins[i];
  for (int i = 0; i < N_DOSERS; i++) rp[DOSER_NAMES[i]] = cfg.doserPins[i];
  if (withSecrets) {
    o["ap_pass"] = cfg.apPass;
    o["sta_pass"] = cfg.staPass;
  } else {
    o["ap_pass_set"] = cfg.apPass.length() > 0;
    o["sta_pass_set"] = cfg.staPass.length() > 0;
  }
}

// Merge the keys present in `o` into `c`. Absent keys keep their value; an empty password keeps the old one
// (except when the router is being removed, which clears its password too).
void configFromJson(Config &c, JsonObjectConst o) {
  if (o["device_id"].is<const char *>()) c.deviceId = o["device_id"].as<String>();
  if (o["ap_ssid"].is<const char *>()) c.apSsid = o["ap_ssid"].as<String>();
  if (o["ap_pass"].is<const char *>() && strlen(o["ap_pass"]) > 0) c.apPass = o["ap_pass"].as<String>();
  if (o["sta_ssid"].is<const char *>()) c.staSsid = o["sta_ssid"].as<String>();
  if (o["sta_pass"].is<const char *>() && strlen(o["sta_pass"]) > 0) c.staPass = o["sta_pass"].as<String>();
  if (c.staSsid.isEmpty()) c.staPass = "";
  if (o["server_url"].is<const char *>()) c.serverUrl = o["server_url"].as<String>();
  c.intervalS = o["interval_s"] | c.intervalS;
  c.dht = o["dht"] | c.dht;
  c.dhtType = o["dht_type"] | c.dhtType;
  c.dhtPin = o["dht_pin"] | c.dhtPin;
  c.ultrasonic = o["ultrasonic"] | c.ultrasonic;
  c.trigPin = o["trig_pin"] | c.trigPin;
  c.echoPin = o["echo_pin"] | c.echoPin;
  c.soil = o["soil"] | c.soil;
  c.soilPin = o["soil_pin"] | c.soilPin;
  c.ph = o["ph"] | c.ph;
  c.phPin = o["ph_pin"] | c.phPin;
  c.phNeutralV = o["ph_neutral_v"] | c.phNeutralV;
  c.phVoltsPerUnit = o["ph_volts_per_unit"] | c.phVoltsPerUnit;
  c.tds = o["tds"] | c.tds;
  c.tdsPin = o["tds_pin"] | c.tdsPin;
  c.relayActiveLow = o["relay_active_low"] | c.relayActiveLow;
  JsonObjectConst rp = o["relay_pins"];
  if (!rp.isNull()) {
    for (int i = 0; i < N_RELAYS; i++) c.relayPins[i] = rp[RELAY_NAMES[i]] | c.relayPins[i];
    for (int i = 0; i < N_DOSERS; i++) c.doserPins[i] = rp[DOSER_NAMES[i]] | c.doserPins[i];
  }
}

// Pins that are safe on an ESP32 DevKit: no flash pins (6-11), no boot-strapping pins (0, 2, 12, 15),
// no serial (1, 3). 34-39 are input only; analog probes need ADC1 (32-39) because ADC2 is dead with WiFi on.
bool outputPin(int p) {
  return p == 4 || p == 5 || p == 13 || p == 14 || (p >= 16 && p <= 19) || (p >= 21 && p <= 23) || (p >= 25 && p <= 27) ||
         p == 32 || p == 33;
}
bool inputPin(int p) { return outputPin(p) || (p >= 34 && p <= 39); }
bool adcPin(int p) { return p >= 32 && p <= 39; }

String validate(const Config &c) {
  if (c.apSsid.length() < 1 || c.apSsid.length() > 32) return "WiFi name must be 1-32 characters";
  if (c.apPass.length() < 8 || c.apPass.length() > 63) return "WiFi password must be 8-63 characters";
  if (c.staSsid.length() > 32) return "Router name is too long";
  if (c.serverUrl.length() && !c.serverUrl.startsWith("http://")) return "Dashboard URL must start with http://";
  if (c.intervalS < 2 || c.intervalS > 3600) return "Reading interval must be 2-3600 s";
  if (c.dhtType != 11 && c.dhtType != 22) return "DHT type must be 11 or 22";
  if (c.phVoltsPerUnit == 0) return "pH volts per unit can't be 0";
  struct Use {
    bool on;
    int pin;
    const char *what;
    int kind;  // 0 digital in, 1 digital out, 2 analog in
  } uses[] = {
      {c.dht, c.dhtPin, "DHT", 1},
      {c.ultrasonic, c.trigPin, "Ultrasonic TRIG", 1},
      {c.ultrasonic, c.echoPin, "Ultrasonic ECHO", 0},
      {c.soil, c.soilPin, "Soil probe", 2},
      {c.ph, c.phPin, "pH probe", 2},
      {c.tds, c.tdsPin, "TDS probe", 2},
  };
  std::vector<std::pair<int, String>> taken;
  for (auto &u : uses) {
    if (!u.on) continue;
    bool ok = u.kind == 1 ? outputPin(u.pin) : u.kind == 2 ? adcPin(u.pin) : inputPin(u.pin);
    if (!ok) return String(u.what) + " can't use GPIO " + u.pin + (u.kind == 2 ? " (analog needs 32-39)" : "");
    taken.push_back({u.pin, u.what});
  }
  for (int i = 0; i < N_RELAYS + N_DOSERS; i++) {
    int p = i < N_RELAYS ? c.relayPins[i] : c.doserPins[i - N_RELAYS];
    const char *n = i < N_RELAYS ? RELAY_NAMES[i] : DOSER_NAMES[i - N_RELAYS];
    if (p < 0) continue;
    if (!outputPin(p)) return String(n) + " relay can't use GPIO " + p;
    taken.push_back({p, n});
  }
  for (size_t i = 0; i < taken.size(); i++)
    for (size_t j = i + 1; j < taken.size(); j++)
      if (taken[i].first == taken[j].first)
        return taken[i].second + " and " + taken[j].second + " both use GPIO " + taken[i].first;
  return "";
}

void loadConfig() {
  prefs.begin("hydro", true);
  String s = prefs.getString("cfg", "");
  prefs.end();
  if (s.isEmpty()) return;  // first boot: compiled defaults
  JsonDocument doc;
  if (deserializeJson(doc, s)) return;
  Config c = cfg;
  configFromJson(c, doc.as<JsonObjectConst>());
  String err = validate(c);
  if (err.isEmpty()) cfg = c;
  else Serial.println("Stored settings invalid, using defaults: " + err);
}

void saveConfig() {
  JsonDocument doc;
  configToJson(doc.to<JsonObject>(), true);
  String s;
  serializeJson(doc, s);
  prefs.begin("hydro", false);
  prefs.putString("cfg", s);
  prefs.end();
}

// ---------------- Hardware ----------------

DHT *dht = nullptr;
uint32_t lastSample = 0;
WebServer web(80);
int blinksLeft = 0;  // remaining on+off toggles
uint32_t nextToggle = 0;
uint32_t rebootAt = 0;  // millis() when a pending restart (after a settings change) fires

bool relayOn[N_RELAYS] = {false};

void writePin(int pin, bool on) {
  if (pin >= 0) digitalWrite(pin, (on ^ cfg.relayActiveLow) ? HIGH : LOW);
}

void setRelay(int i, bool on) {
  relayOn[i] = on;
  writePin(cfg.relayPins[i], on);
}

void startBlink(int times) {
  blinksLeft = constrain(times, 1, 50) * 2;
  nextToggle = 0;
}

// Non-blocking, so blinking never delays sensor reads or reports.
void updateLed() {
  if (blinksLeft <= 0 || millis() < nextToggle) return;
  digitalWrite(LED_PIN, blinksLeft % 2 == 0 ? HIGH : LOW);
  blinksLeft--;
  nextToggle = millis() + 150;
}

// Median of 5 pings, speed of sound corrected for air temperature. NAN if no echo.
float readDistanceCm(float airTemp) {
  float cmPerUs = (331.3f + 0.606f * (isnan(airTemp) ? 25.0f : airTemp)) / 10000.0f;
  float samples[5];
  int n = 0;
  for (int i = 0; i < 5; i++) {
    digitalWrite(cfg.trigPin, LOW);
    delayMicroseconds(3);
    digitalWrite(cfg.trigPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(cfg.trigPin, LOW);
    unsigned long us = pulseIn(cfg.echoPin, HIGH, 30000);
    if (us > 0) samples[n++] = us * cmPerUs / 2.0f;
    delay(60);  // let echoes die out
  }
  if (n == 0) return NAN;
  for (int i = 1; i < n; i++)  // insertion sort, n <= 5
    for (int j = i; j > 0 && samples[j] < samples[j - 1]; j--) std::swap(samples[j], samples[j - 1]);
  return samples[n / 2];
}

float readAdcVolts(int pin) {
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(pin);
  return mv / 16.0f / 1000.0f;
}

void putOrNull(JsonObject obj, const char *key, float v, int decimals = 2) {
  if (isnan(v)) obj[key] = nullptr;
  else obj[key] = roundf(v * powf(10, decimals)) / powf(10, decimals);
}

// ---------------- Sensor sampling + history ring buffer ----------------

struct Sample {
  uint32_t seq;
  uint32_t ms;  // millis() when taken
  float airTemp, humidity, distance, ph, ec, soil;
  uint8_t acts;  // bit per relay (FAN..HEATER) at the time of the reading
};
Sample history[HISTORY_LEN];
uint32_t seqNext = 1;  // history[(seq - 1) % HISTORY_LEN]

Sample takeSample() {
  Sample s = {seqNext, millis(), NAN, NAN, NAN, NAN, NAN, NAN, 0};
  if (cfg.dht && dht) {
    s.airTemp = dht->readTemperature();
    s.humidity = dht->readHumidity();
  }
  if (cfg.ultrasonic) s.distance = readDistanceCm(s.airTemp);
  if (cfg.soil) {
    uint32_t raw = 0;
    for (int i = 0; i < 16; i++) raw += analogRead(cfg.soilPin);
    s.soil = raw / 16.0f;
  }
  if (cfg.ph) s.ph = 7.0f + (cfg.phNeutralV - readAdcVolts(cfg.phPin)) / cfg.phVoltsPerUnit;
  if (cfg.tds) {
    // DFRobot-style TDS board cubic fit, temperature compensated; EC (mS/cm) ~= TDS(ppm) / 500.
    float v = readAdcVolts(cfg.tdsPin) / (1.0f + 0.02f * ((isnan(s.airTemp) ? 25.0f : s.airTemp) - 25.0f));
    float ppm = (133.42f * v * v * v - 255.86f * v * v + 857.39f * v) * 0.5f;
    s.ec = ppm / 500.0f;
  }
  for (int i = 0; i < N_RELAYS; i++)
    if (relayOn[i]) s.acts |= 1 << i;
  Serial.printf("#%u  temp=%.1fC  humidity=%.0f%%  distance=%.1fcm  soil_raw=%.0f\n", s.seq, s.airTemp, s.humidity,
                s.distance, s.soil);
  history[(seqNext - 1) % HISTORY_LEN] = s;
  seqNext++;
  return s;
}

// Disabled sensors are left out entirely, so the phone/server doesn't raise "sensor failed" alerts for them.
void writeSample(JsonObject o, const Sample &s) {
  if (cfg.dht) {
    putOrNull(o, "air_temp", s.airTemp);
    putOrNull(o, "humidity", s.humidity, 1);
  }
  if (cfg.ultrasonic) putOrNull(o, "water_distance_cm", s.distance, 1);
  if (cfg.soil) putOrNull(o, "soil_raw", s.soil, 0);
  if (cfg.ph) putOrNull(o, "ph", s.ph);
  if (cfg.tds) putOrNull(o, "ec", s.ec);
}

// ---------------- Control ----------------

uint32_t lastPhoneMs = 0, lastServerMs = 0;
bool phoneEver = false, serverEver = false;
// What to hold while nobody is commanding (from the phone's "hold" block or the server's setpoints).
struct Hold {
  bool valid = false;
  float tempC = 25, humidityPct = 65, lightHours = 16;
  int lightsOnHour = FAILSAFE_LIGHT_ON_HOUR;
  float emptyCm = 30, fullCm = 5, refillBelow = 40, refillUntil = 90;
} hold;
long tzOffsetS = TZ_OFFSET_S;

bool phoneConnected() { return phoneEver && millis() - lastPhoneMs < PHONE_TIMEOUT_S * 1000UL; }
bool serverConnected() { return serverEver && millis() - lastServerMs < SERVER_TIMEOUT_S * 1000UL; }

void applyCommands(JsonObjectConst acts) {
  for (int i = 0; i < N_RELAYS; i++) setRelay(i, acts[RELAY_NAMES[i]] | false);
  for (int i = 0; i < N_DOSERS; i++) {
    int ms = acts[DOSER_NAMES[i]] | 0;
    if (ms > 0 && cfg.doserPins[i] >= 0) {
      Serial.printf("dose %s %d ms\n", DOSER_NAMES[i], ms);
      writePin(cfg.doserPins[i], true);
      delay(min(ms, 3000));  // hard cap so a bad command can't empty a bottle
      writePin(cfg.doserPins[i], false);
    }
  }
}

int localHour() {
  time_t now = time(nullptr);
  if (now < 1600000000) return -1;  // clock never set
  return ((now + tzOffsetS) / 3600) % 24;
}

// Nobody commanding: keep the plant on the last setpoints with the same bands the phone's controller uses.
// No dosing, and no pumping unless the water level is actually known.
void holdLocally(const Sample &s) {
  if (!hold.valid) {  // nothing received yet: plain safety rules
    setRelay(FAN, !isnan(s.airTemp) && s.airTemp > FAILSAFE_TEMP_MAX);
    setRelay(REFILL, false);
    setRelay(MISTER, false);
    setRelay(HEATER, false);
  } else {
    bool fan = relayOn[FAN];
    if (!isnan(s.airTemp)) fan = s.airTemp > hold.tempC + 0.7f ? true : s.airTemp < hold.tempC - 0.7f ? false : fan;
    if (!isnan(s.humidity) && s.humidity > hold.humidityPct + 4) fan = true;
    setRelay(FAN, fan);
    bool mist = relayOn[MISTER];
    if (isnan(s.humidity) || fan) mist = false;
    else mist = s.humidity < hold.humidityPct - 4 ? true : s.humidity > hold.humidityPct + 1 ? false : mist;
    setRelay(MISTER, mist);
    bool heat = relayOn[HEATER];
    if (isnan(s.airTemp) || fan) heat = false;
    else heat = s.airTemp < hold.tempC - 1.4f ? true : s.airTemp > hold.tempC - 0.35f ? false : heat;
    setRelay(HEATER, heat);
    bool pump = false;
    if (!isnan(s.distance)) {
      float depth = hold.emptyCm - hold.fullCm;
      float pct = 100.0f * constrain(hold.emptyCm - s.distance, 0.0f, depth) / depth;
      pump = pct < hold.refillBelow ? true : pct > hold.refillUntil ? false : relayOn[REFILL];
    }
    setRelay(REFILL, pump);
  }
  int hour = localHour();
  if (hour >= 0) {
    float lh = hold.valid ? hold.lightHours : FAILSAFE_LIGHT_HOURS;
    setRelay(LIGHT, lh > 0 && (hour - hold.lightsOnHour + 24) % 24 < lh);
  }
}

// ---------------- HTTP API (phone app) ----------------

bool staOn() { return cfg.staSsid.length() > 0; }
bool staUp() { return staOn() && WiFi.status() == WL_CONNECTED; }
int lastPostCode = 0;
uint32_t lastPostMs = 0;

void netToJson(JsonObject n) {
  n["ap_ssid"] = cfg.apSsid;
  n["ap_ip"] = WiFi.softAPIP().toString();
  n["clients"] = WiFi.softAPgetStationNum();
  n["sta_ssid"] = cfg.staSsid;
  n["sta_connected"] = staUp();
  if (staUp()) {
    n["sta_ip"] = WiFi.localIP().toString();
    n["rssi"] = WiFi.RSSI();
  }
  n["server_url"] = cfg.serverUrl;
  n["server_ok"] = serverConnected();
  if (lastPostMs) {
    n["server_code"] = lastPostCode;
    n["server_age_s"] = (millis() - lastPostMs) / 1000;
  }
}

const char *controller() { return phoneConnected() ? "phone" : serverConnected() ? "server" : "board"; }

// GET /api/readings?after=<seq>: the latest reading plus any buffered ones after `after`.
void handleReadings() {
  uint32_t after = web.hasArg("after") ? strtoul(web.arg("after").c_str(), nullptr, 10) : 0;
  uint32_t last = seqNext - 1;
  uint32_t oldest = last >= HISTORY_LEN ? last - HISTORY_LEN + 1 : 1;
  uint32_t from = max(after + 1, oldest);
  if (last - from + 1 > 120) from = last - 119;  // at most 120 per call; the phone asks again
  JsonDocument doc;
  doc["device_id"] = cfg.deviceId;
  doc["fw"] = FW_VERSION;
  doc["uptime_s"] = millis() / 1000;
  doc["interval_s"] = cfg.intervalS;
  doc["latest_seq"] = last;
  doc["oldest_seq"] = oldest;
  doc["holding"] = !phoneConnected();
  doc["controller"] = controller();
  doc["clients"] = WiFi.softAPgetStationNum();
  netToJson(doc["net"].to<JsonObject>());
  JsonObject sensors = doc["sensors"].to<JsonObject>();
  sensors["dht"] = cfg.dht;
  sensors["ultrasonic"] = cfg.ultrasonic;
  sensors["soil"] = cfg.soil;
  sensors["ph"] = cfg.ph;
  sensors["tds"] = cfg.tds;
  JsonObject acts = doc["actuators"].to<JsonObject>();
  for (int i = 0; i < N_RELAYS; i++) acts[RELAY_NAMES[i]] = relayOn[i];
  JsonArray arr = doc["readings"].to<JsonArray>();
  for (uint32_t q = from; q <= last && last > 0; q++) {
    const Sample &s = history[(q - 1) % HISTORY_LEN];
    JsonObject o = arr.add<JsonObject>();
    o["seq"] = s.seq;
    o["age_s"] = (millis() - s.ms) / 1000.0f;
    writeSample(o, s);
    JsonObject a = o["acts"].to<JsonObject>();
    for (int i = 0; i < N_RELAYS; i++) a[RELAY_NAMES[i]] = (bool)(s.acts & (1 << i));
  }
  String body;
  serializeJson(doc, body);
  web.send(200, "application/json", body);
}

// POST /api/actuators {"actuators": {...}, "time": epoch_s, "tz_offset_s": 19800, "hold": {...}}
void handleActuators() {
  JsonDocument doc;
  if (deserializeJson(doc, web.arg("plain"))) {
    web.send(400, "application/json", "{\"error\":\"bad json\"}");
    return;
  }
  if (doc["time"].is<double>()) {
    struct timeval tv = {(time_t)doc["time"].as<double>(), 0};
    settimeofday(&tv, nullptr);  // the phone is the only clock this board has offline
  }
  tzOffsetS = doc["tz_offset_s"] | tzOffsetS;
  JsonObject h = doc["hold"];
  if (!h.isNull()) {
    hold.tempC = h["air_temp_c"] | hold.tempC;
    hold.humidityPct = h["humidity_pct"] | hold.humidityPct;
    hold.lightHours = h["light_hours"] | hold.lightHours;
    hold.lightsOnHour = h["lights_on_hour"] | hold.lightsOnHour;
    hold.emptyCm = h["tank_empty_cm"] | hold.emptyCm;
    hold.fullCm = h["tank_full_cm"] | hold.fullCm;
    hold.refillBelow = h["refill_below_pct"] | hold.refillBelow;
    hold.refillUntil = h["refill_until_pct"] | hold.refillUntil;
    hold.valid = true;
  }
  applyCommands(doc["actuators"].as<JsonObjectConst>());
  if (doc["led_blink"].is<int>()) startBlink(doc["led_blink"]);
  lastPhoneMs = millis();
  phoneEver = true;
  JsonDocument out;
  out["ok"] = true;
  JsonObject a = out["actuators"].to<JsonObject>();
  for (int i = 0; i < N_RELAYS; i++) a[RELAY_NAMES[i]] = relayOn[i];
  String body;
  serializeJson(out, body);
  web.send(200, "application/json", body);
}

void handleGetConfig() {
  JsonDocument doc;
  configToJson(doc["config"].to<JsonObject>(), false);
  doc["fw"] = FW_VERSION;
  String body;
  serializeJson(doc, body);
  web.send(200, "application/json", body);
}

// POST /api/config {...any subset of the config keys...} -> saved to flash, then the board restarts so
// WiFi and pins come up clean. {"reset": true} goes back to the factory defaults.
void handlePostConfig() {
  JsonDocument doc;
  if (deserializeJson(doc, web.arg("plain"))) {
    web.send(400, "application/json", "{\"error\":\"bad json\"}");
    return;
  }
  bool reset = doc["reset"] | false;
  Config c = cfg;
  if (reset) c = Config();
  else configFromJson(c, doc.as<JsonObjectConst>());
  String err = validate(c);
  if (err.length()) {
    JsonDocument out;
    out["error"] = err;
    String body;
    serializeJson(out, body);
    web.send(400, "application/json", body);
    return;
  }
  cfg = c;
  if (reset) {
    prefs.begin("hydro", false);
    prefs.clear();
    prefs.end();
  } else {
    saveConfig();
  }
  JsonDocument out;
  out["ok"] = true;
  out["restarting"] = true;
  configToJson(out["config"].to<JsonObject>(), false);
  String body;
  serializeJson(out, body);
  web.send(200, "application/json", body);
  Serial.println("Settings saved from " + web.client().remoteIP().toString() + ", restarting");
  rebootAt = millis() + 1500;  // let the reply reach the phone first
}

void handleLed() {
  int times = web.hasArg("blink") ? web.arg("blink").toInt() : 5;
  startBlink(times);
  Serial.printf("LED blink x%d (from %s)\n", times, web.client().remoteIP().toString().c_str());
  web.send(200, "application/json", String("{\"ok\":true,\"blink\":") + times + ",\"uptime_s\":" + millis() / 1000 + "}");
}

// ---------------- Dashboard server (optional, over the router) ----------------

void reportToServer(const Sample &s) {
  if (!staUp() || cfg.serverUrl.isEmpty()) return;
  // A missing dashboard (laptop off or elsewhere) must not stall the board: after a failed POST, wait a minute.
  if (lastPostMs && lastPostCode != 200 && millis() - lastPostMs < 60000) return;
  JsonDocument doc;
  doc["device_id"] = cfg.deviceId;
  doc["rssi"] = WiFi.RSSI();
  doc["ip"] = WiFi.localIP().toString();
  doc["uptime_s"] = millis() / 1000;
  doc["fw"] = FW_VERSION;
  writeSample(doc.as<JsonObject>(), s);
  String body;
  serializeJson(doc, body);
  HTTPClient http;
  http.begin(cfg.serverUrl + "/api/readings");
  http.addHeader("Content-Type", "application/json");
  http.setConnectTimeout(2000);
  http.setTimeout(3000);
  lastPostCode = http.POST(body);
  lastPostMs = millis();
  if (lastPostCode == 200) {
    JsonDocument reply;
    if (!deserializeJson(reply, http.getStream())) {
      lastServerMs = millis();
      serverEver = true;
      JsonObject sp = reply["setpoints"];
      if (!sp.isNull()) {
        hold.tempC = sp["air_temp_c"] | hold.tempC;
        hold.humidityPct = sp["humidity_pct"] | hold.humidityPct;
        hold.lightHours = sp["light_hours"] | hold.lightHours;
        hold.valid = true;
      }
      if (!phoneConnected()) applyCommands(reply["actuators"].as<JsonObjectConst>());  // the phone outranks the server
      if (reply["led_blink"].is<int>()) startBlink(reply["led_blink"]);
    }
  } else {
    Serial.printf("dashboard POST failed: %d %s\n", lastPostCode, http.errorToString(lastPostCode).c_str());
  }
  http.end();
}

// ---------------- Setup / loop ----------------

// Router link, managed by hand instead of the core's auto-reconnect: while the ESP32 hunts for a router it
// keeps switching channels, which makes its own network drop phones. So try for STA_TRY_MS, then leave the
// router alone for STA_REST_MS with the board's own network steady, and try again.
#define STA_TRY_MS 20000UL
#define STA_REST_MS 120000UL
bool staTrying = false;
uint32_t staSince = 0;

void staBegin() {
  WiFi.begin(cfg.staSsid.c_str(), cfg.staPass.c_str());
  staTrying = true;
  staSince = millis();
}

void staTick() {
  if (!staOn() || WiFi.status() == WL_CONNECTED) {
    staTrying = false;
    return;
  }
  if (staTrying && millis() - staSince > STA_TRY_MS) {
    WiFi.disconnect(false, false);  // STA only; the board's own network stays up
    staTrying = false;
    staSince = millis();
    Serial.printf("Router \"%s\" not found, retrying in %lu s\n", cfg.staSsid.c_str(), STA_REST_MS / 1000);
  } else if (!staTrying && millis() - staSince > STA_REST_MS) {
    staBegin();
  }
}

void setupWifi() {
  WiFi.persistent(false);
  WiFi.mode(staOn() ? WIFI_AP_STA : WIFI_AP);
  WiFi.softAP(cfg.apSsid.c_str(), cfg.apPass.c_str(), AP_CHANNEL);
  Serial.printf("WiFi AP \"%s\" up, phone app address %s\n", cfg.apSsid.c_str(), WiFi.softAPIP().toString().c_str());
  if (staOn()) {
    WiFi.setAutoReconnect(false);
    staBegin();
    Serial.printf("Also joining \"%s\"\n", cfg.staSsid.c_str());
  }
}

void setup() {
  Serial.begin(115200);
  loadConfig();
  if (cfg.dht) {
    dht = new DHT(cfg.dhtPin, cfg.dhtType == 22 ? DHT22 : DHT11);
    dht->begin();
  }
  if (cfg.ultrasonic) {
    pinMode(cfg.trigPin, OUTPUT);
    pinMode(cfg.echoPin, INPUT);
  }
  analogReadResolution(12);
  for (int i = 0; i < N_RELAYS; i++)
    if (cfg.relayPins[i] >= 0) pinMode(cfg.relayPins[i], OUTPUT), setRelay(i, false);
  for (int i = 0; i < N_DOSERS; i++)
    if (cfg.doserPins[i] >= 0) pinMode(cfg.doserPins[i], OUTPUT), writePin(cfg.doserPins[i], false);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  setupWifi();
  web.on("/api/readings", HTTP_GET, handleReadings);
  web.on("/api/actuators", HTTP_POST, handleActuators);
  web.on("/api/config", HTTP_GET, handleGetConfig);
  web.on("/api/config", HTTP_POST, handlePostConfig);
  web.on("/led", handleLed);
  web.begin();
}

bool clockSynced = false;
bool wasStaUp = false;

void loop() {
  web.handleClient();
  updateLed();
  if (rebootAt && millis() > rebootAt) ESP.restart();
  staTick();
  if (staUp() != wasStaUp) {
    wasStaUp = staUp();
    if (wasStaUp) Serial.printf("Joined \"%s\", IP %s\n", cfg.staSsid.c_str(), WiFi.localIP().toString().c_str());
    else if (staOn()) Serial.println("Router link lost; the board's own network stays up");
  }
  if (wasStaUp && !clockSynced) {
    configTime(0, 0, "pool.ntp.org");  // UTC; localHour() applies the offset
    clockSynced = true;
  }
  if (lastSample != 0 && millis() - lastSample < (uint32_t)cfg.intervalS * 1000UL) {
    delay(10);
    return;
  }
  lastSample = millis();
  Sample s = takeSample();
  reportToServer(s);
  if (!phoneConnected() && !serverConnected()) holdLocally(s);
}
