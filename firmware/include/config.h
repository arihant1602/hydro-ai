#pragma once
// Factory defaults. Everything here (except the behaviour constants at the bottom) can be changed from the
// phone app (Settings -> Board) without reflashing: the board stores its settings in flash (NVS) and these
// values are only used the first time, or after "Reset board settings".
// WiFi credentials and the dashboard URL defaults live in secrets.h (copy secrets.example.h).

// ---------------- Air / water-level / soil sensors ----------------
#define DEF_DHT 1
#define DEF_DHT_TYPE 11          // 11 = DHT11 (blue), 22 = DHT22 (white)
#define DEF_DHT_PIN 4

// HC-SR04 ultrasonic on the reservoir lid, pointing straight down at the water.
// ECHO outputs 5 V: put it through a divider (1k from ECHO, 2k to GND, tap in the middle) before the pin.
#define DEF_ULTRASONIC 1
#define DEF_US_TRIG_PIN 5
#define DEF_US_ECHO_PIN 18

// Soil moisture probe, analog out (AO). Raw 12-bit ADC: higher = drier on most probes.
#define DEF_SOIL 1
#define DEF_SOIL_PIN 34

// ---------------- Probes for later ----------------
// Analog probes must be on ADC1 pins (32-39): ADC2 stops working while WiFi is on.
#define DEF_PH 0
#define DEF_PH_PIN 33
#define DEF_PH_NEUTRAL_V 2.50f       // calibrate: probe voltage in pH 7 buffer
#define DEF_PH_VOLTS_PER_UNIT 0.18f  // calibrate: (V@pH4 - V@pH7) / 3
#define DEF_TDS 0
#define DEF_TDS_PIN 35

// ---------------- Actuators (relay module inputs) ----------------
// -1 = not fitted; the command is then just logged.
#define DEF_RELAY_ACTIVE_LOW 1       // most cheap blue relay boards switch on LOW
#define DEF_PIN_FAN 25
#define DEF_PIN_LIGHT 26
#define DEF_PIN_REFILL_PUMP 27
#define DEF_PIN_MISTER 32
#define DEF_PIN_HEATER -1
#define DEF_PIN_PH_DOWN -1
#define DEF_PIN_PH_UP -1
#define DEF_PIN_NUTRIENT -1

#define DEF_INTERVAL_S 10

// ---------------- Behaviour (fixed) ----------------
// Built-in LED (blue on most ESP32 DevKit boards); "Blink the board LED" in the app drives it.
#define LED_PIN 2
#define AP_CHANNEL 6             // used while not joined to a router (the AP follows the router's channel otherwise)
#define PHONE_TIMEOUT_S 60       // no command from the phone for this long -> server or local hold takes over
#define SERVER_TIMEOUT_S 60      // same for the dashboard server
#define HISTORY_LEN 1080         // readings buffered for the phone to backfill (3 h at 10 s)
#define FAILSAFE_TEMP_MAX 30.0f  // fan on above this when no setpoints have ever been received
#define FAILSAFE_LIGHT_ON_HOUR 6
#define FAILSAFE_LIGHT_HOURS 16
#define TZ_OFFSET_S (5 * 3600 + 1800)  // IST
