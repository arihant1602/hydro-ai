// Shared shapes for the on-phone engine. Field names match the Python server so the ESP32 JSON is unchanged.

export interface Reading {
  ts: number; // epoch seconds
  device_id?: string;
  air_temp?: number | null;
  humidity?: number | null;
  water_distance_cm?: number | null;
  water_level_pct?: number | null;
  water_liters?: number | null;
  water_temp?: number | null;
  ph?: number | null;
  ec?: number | null;
  light_lux?: number | null;
  soil_raw?: number | null; // soil probe, raw 12-bit ADC (higher = drier)
}

export type Actuators = Record<string, boolean | number>;

export interface Settings {
  crop: string;
  planted_at: number;
  tank_empty_distance_cm: number;
  tank_full_distance_cm: number;
  tank_area_cm2: number;
  refill_below_pct: number;
  refill_until_pct: number;
  explore: boolean;
  ml_enabled: boolean;
  /** ESP32 address; 192.168.4.1 when the phone joins the board's own WiFi. */
  device_host: string;
  poll_s: number;
  /** Soil probe calibration: raw reading in dry air and in water (most probes read lower when wet). */
  soil_dry_raw: number;
  soil_wet_raw: number;
}

export const DEFAULT_SETTINGS: Omit<Settings, 'planted_at'> = {
  crop: 'maize',
  tank_empty_distance_cm: 30,
  tank_full_distance_cm: 5,
  tank_area_cm2: 900,
  refill_below_pct: 40,
  refill_until_pct: 90,
  explore: true,
  ml_enabled: true,
  device_host: '192.168.4.1',
  poll_s: 10,
  soil_dry_raw: 4095,
  soil_wet_raw: 1500,
};

/** Soil moisture 0-100 % from the raw probe reading and its two calibration points. */
export function soilPct(raw: number | null | undefined, s: Pick<Settings, 'soil_dry_raw' | 'soil_wet_raw'>): number | null {
  if (raw == null || s.soil_dry_raw === s.soil_wet_raw) return null;
  const pct = (100 * (s.soil_dry_raw - raw)) / (s.soil_dry_raw - s.soil_wet_raw);
  return Math.round(Math.min(100, Math.max(0, pct)));
}

export type Severity = 'warning' | 'critical';
export type Found = Record<string, [Severity, string]>;

export interface AlertRow {
  id: number;
  ts: number;
  key: string;
  severity: Severity;
  message: string;
  active: number;
  cleared_ts: number | null;
}
