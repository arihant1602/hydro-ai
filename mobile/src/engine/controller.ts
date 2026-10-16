// Turns ML setpoints + the latest reading into actuator commands. Port of hydro/controller.py.
//
// The ML layer decides *where* to hold the environment; this layer holds it there with hysteresis
// (so relays don't chatter). Every actuator is optional: the ESP32 ignores commands for hardware it
// doesn't have.
import type { Actuators, Reading, Settings } from './types';

const TEMP_BAND = 0.7; // +/- °C around the temperature setpoint
const HUM_BAND = 4.0; // +/- % RH around the humidity setpoint
const DOSE_COOLDOWN = 600; // s between pH/nutrient doses so the reservoir can mix
const DOSE_MS = 800; // peristaltic pump pulse length

const lastDose: Record<string, number> = {};

function hyst(prev: boolean, value: number | null | undefined, onAbove: number, offBelow: number): boolean {
  if (value == null) return prev;
  if (value > onAbove) return true;
  if (value < offBelow) return false;
  return prev;
}

const neg = (v: number | null | undefined) => (v == null ? null : -v);

export function decide(
  reading: Reading,
  sp: Record<string, number>,
  settings: Settings,
  prev: Actuators,
  lightsOnHour: number,
  now = reading.ts,
): Actuators {
  const t = reading.air_temp;
  const h = reading.humidity;
  const out: Actuators = {};

  // Cooling: exhaust fan / evaporative cooler. Also vents excess humidity.
  const hot = hyst(!!prev.fan, t, sp.air_temp_c + TEMP_BAND, sp.air_temp_c - TEMP_BAND);
  const humid = h != null && h > sp.humidity_pct + HUM_BAND;
  out.fan = hot || humid;
  // Heater only if one is fitted; mirrored hysteresis below the setpoint.
  out.heater =
    !out.fan && hyst(!!prev.heater, neg(t), -(sp.air_temp_c - 2 * TEMP_BAND), -(sp.air_temp_c - TEMP_BAND / 2));
  // Humidifier / mister below the band.
  out.mister = hyst(!!prev.mister, neg(h), -(sp.humidity_pct - HUM_BAND), -(sp.humidity_pct + 1));
  if (out.fan) out.mister = false;
  // A dead DHT must not leave heat/moisture running blind.
  if (t == null) out.heater = false;
  if (h == null) out.mister = false;

  // Grow lights on a photoperiod schedule from the setpoint.
  const d = new Date(now * 1000);
  const hour = d.getHours() + d.getMinutes() / 60;
  const lh = sp.light_hours ?? 0;
  out.light = lh > 0 && (((hour - lightsOnHour) % 24) + 24) % 24 < lh;

  // Reservoir top-up from a fresh-water jug.
  const lvl = reading.water_level_pct;
  out.refill_pump = hyst(!!prev.refill_pump, neg(lvl), -settings.refill_below_pct, -settings.refill_until_pct);
  // Nutrient solution too strong (water evaporated/drunk faster than salts): dilute with fresh water.
  const ec = reading.ec;
  if (ec != null && sp.ec_ms_cm != null && ec > sp.ec_ms_cm + 0.3 && lvl != null && lvl < 98) out.refill_pump = true;

  // Dosing pulses (only meaningful once pH / EC probes exist).
  const doses: Record<string, number> = {};
  const ph = reading.ph;
  if (ph != null && sp.ph != null) {
    if (ph > sp.ph + 0.2) doses.ph_down_ms = DOSE_MS;
    else if (ph < sp.ph - 0.2) doses.ph_up_ms = DOSE_MS;
  }
  if (ec != null && sp.ec_ms_cm != null && ec < sp.ec_ms_cm - 0.15) doses.nutrient_ms = DOSE_MS;
  for (const k of Object.keys(doses)) {
    if (now - (lastDose[k] ?? 0) < DOSE_COOLDOWN) delete doses[k];
    else lastDose[k] = now;
  }
  return { ...out, ...doses };
}
