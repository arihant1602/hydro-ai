#pragma once
// Copy to secrets.h (gitignored) and fill in. These are first-boot defaults only: once the board is running,
// change any of them from the phone app (Settings -> Board).

// The network the board creates. Join it from the phone (password >= 8 characters).
#define AP_SSID "HydroAI-maize"
#define AP_PASS "change-me-123"

// Optional: a router the board also joins, so the laptop dashboard can receive readings at the same time.
// Leave WIFI_SSID empty ("") to skip. ESP32 only does 2.4 GHz WiFi.
#define WIFI_SSID "your-wifi"
#define WIFI_PASS "your-password"
// The laptop running the FastAPI dashboard (find its IP with `ip addr`). "" = don't report to a server.
#define SERVER_URL ""  // e.g. "http://192.168.1.50:8000"
#define DEVICE_ID "esp32-corn-1"
