// Out-of-range / hardware alert rules. Port of hydro/alerts.py.
// `evaluate` is pure; the store applies the result (one active alert per key, cleared when resolved).
import type { Stage } from './profiles';
import type { Found, Reading } from './types';

const LABELS: Record<string, [string, keyof Stage, string]> = {
  air_temp: ['Air temperature', 'air_temp_c', '°C'],
  humidity: ['Humidity', 'humidity_pct', '%'],
  ph: ['pH', 'ph', ''],
  ec: ['EC', 'ec_ms_cm', ' mS/cm'],
};
// How far outside the stage range before it counts as critical rather than a warning.
const CRITICAL_MARGIN: Record<string, number> = { air_temp: 3.0, humidity: 10.0, ph: 0.4, ec: 0.4 };

/** A condition must last this long before it alerts, so noisy readings don't spam. */
export const PERSIST_S = 300;
export const OFFLINE_AFTER_S = 90;

export function evaluate(reading: Reading, stage: Stage): Found {
  const found: Found = {};
  for (const [field, [label, key, unit]] of Object.entries(LABELS)) {
    const v = reading[field as keyof Reading] as number | null | undefined;
    if (v == null) continue;
    const [lo, hi] = stage[key] as [number, number];
    if (v < lo || v > hi) {
      const off = v < lo ? lo - v : v - hi;
      const sev = off > CRITICAL_MARGIN[field] ? 'critical' : 'warning';
      const word = v < lo ? 'low' : 'high';
      found[`${field}_${word}`] = [sev, `${label} ${word}: ${v.toFixed(1)}${unit} (target ${lo}–${hi}${unit}, ${stage.name})`];
    }
  }
  const lvl = reading.water_level_pct;
  if (lvl != null && lvl < 20) found.water_low = ['critical', `Reservoir at ${lvl.toFixed(0)}%. Check the refill jug and pump.`];
  for (const field of ['air_temp', 'humidity'] as const) {
    if (field in reading && reading[field] == null)
      found.dht_fail = ['warning', 'Air sensor (DHT) returned no data. Check its wiring and pull-up resistor.'];
  }
  if ('water_distance_cm' in reading && reading.water_distance_cm == null)
    found.ultrasonic_fail = ['warning', 'Water-level sensor returned no echo. Check the ECHO divider and mounting.'];
  return found;
}
