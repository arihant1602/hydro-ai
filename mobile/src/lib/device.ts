// HTTP client for the ESP32. The phone reaches it on the board's own WiFi (192.168.4.1) or, when the board
// has also joined a router, on its router address. No internet involved.
import type { Actuators } from '../engine/types';

export interface DeviceReading {
  seq: number;
  age_s: number;
  air_temp?: number | null;
  humidity?: number | null;
  water_distance_cm?: number | null;
  soil_raw?: number | null;
  ph?: number | null;
  ec?: number | null;
  acts: Actuators;
}

export interface DeviceNet {
  ap_ssid: string;
  ap_ip: string;
  clients: number;
  sta_ssid: string;
  sta_connected: boolean;
  sta_ip?: string;
  rssi?: number;
  server_url: string;
  server_ok: boolean;
  server_code?: number;
  server_age_s?: number;
}

export interface DeviceReport {
  device_id: string;
  fw: string;
  uptime_s: number;
  interval_s: number;
  latest_seq: number;
  oldest_seq: number;
  holding: boolean; // board is running without the phone (no recent phone command)
  controller?: 'phone' | 'server' | 'board'; // firmware >= 3.0
  clients: number;
  net?: DeviceNet; // firmware >= 3.0
  sensors?: Record<'dht' | 'ultrasonic' | 'soil' | 'ph' | 'tds', boolean>; // firmware >= 3.0
  actuators: Actuators;
  readings: DeviceReading[];
}

export interface Hold {
  air_temp_c: number;
  humidity_pct: number;
  light_hours: number;
  lights_on_hour: number;
  tank_empty_cm: number;
  tank_full_cm: number;
  refill_below_pct: number;
  refill_until_pct: number;
}

export const RELAY_KEYS = ['fan', 'light', 'refill_pump', 'mister', 'heater', 'ph_down_ms', 'ph_up_ms', 'nutrient_ms'] as const;
export type RelayKey = (typeof RELAY_KEYS)[number];

/** Board settings stored in the ESP32's flash (GET/POST /api/config, firmware >= 3.0). */
export interface BoardConfig {
  device_id: string;
  ap_ssid: string;
  ap_pass?: string; // write-only; the board reports ap_pass_set instead
  ap_pass_set?: boolean;
  sta_ssid: string;
  sta_pass?: string; // write-only
  sta_pass_set?: boolean;
  server_url: string;
  interval_s: number;
  dht: boolean;
  dht_type: 11 | 22;
  dht_pin: number;
  ultrasonic: boolean;
  trig_pin: number;
  echo_pin: number;
  soil: boolean;
  soil_pin: number;
  ph: boolean;
  ph_pin: number;
  ph_neutral_v: number;
  ph_volts_per_unit: number;
  tds: boolean;
  tds_pin: number;
  relay_active_low: boolean;
  relay_pins: Record<RelayKey, number>;
}

async function call<T>(host: string, path: string, init?: RequestInit, timeoutMs = 6000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    // Never keep a connection for reuse: one opened while the app was bound to another WiFi can land on that
    // network's proxy or login page, and would keep answering for the board's address afterwards.
    const headers = { ...(init?.headers as Record<string, string> | undefined), Connection: 'close' };
    res = await fetch(`http://${host}${path}`, { ...init, headers, signal: ctrl.signal });
  } catch {
    if (ctrl.signal.aborted) throw new Error(`no answer from ${host} within ${timeoutMs / 1000} s`);
    throw new Error(`can't reach ${host}`);
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `board answered ${res.status}`);
  // Something answered, but not with the board's JSON: another device or a WiFi login page at that address.
  if (body == null || typeof body !== 'object') throw new Error(`${host} answered, but it isn't the Hydro AI board`);
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function fetchReadings(host: string, after: number, timeoutMs = 6000) {
  return call<DeviceReport>(host, `/api/readings?after=${after}`, undefined, timeoutMs);
}

export function sendActuators(host: string, actuators: Actuators, hold: Hold) {
  return call<{ ok: boolean; actuators: Actuators }>(
    host,
    '/api/actuators',
    json({ actuators, hold, time: Date.now() / 1000, tz_offset_s: -new Date().getTimezoneOffset() * 60 }),
  );
}

/** Cheap check that `host` is a Hydro AI board (used when scanning a subnet for it). */
export async function probeBoard(host: string, timeoutMs: number): Promise<boolean> {
  try {
    const r = await call<{ config?: { device_id?: string } }>(host, '/api/config', undefined, timeoutMs);
    return typeof r.config?.device_id === 'string';
  } catch {
    return false;
  }
}

export function blinkLed(host: string, times = 5) {
  return call<{ ok: boolean }>(host, `/led?blink=${times}`, undefined, 3000);
}

export async function getBoardConfig(host: string): Promise<BoardConfig> {
  return (await call<{ config: BoardConfig }>(host, '/api/config')).config;
}

/** Save settings on the board. It validates them (wrong pins etc. come back as an error) and restarts. */
export async function saveBoardConfig(host: string, changes: Partial<BoardConfig>): Promise<BoardConfig> {
  return (await call<{ config: BoardConfig }>(host, '/api/config', json(changes))).config;
}

export async function resetBoardConfig(host: string): Promise<BoardConfig> {
  return (await call<{ config: BoardConfig }>(host, '/api/config', json({ reset: true }))).config;
}
