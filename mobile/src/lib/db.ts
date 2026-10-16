// On-phone SQLite storage. Same tables as hydro/db.py, plus a per-day cache for the optimizer.
import * as SQLite from 'expo-sqlite';

import { DEFAULT_SETTINGS, type Settings } from '../engine/types';

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY,
  ts REAL NOT NULL, received_at REAL NOT NULL, device_id TEXT, seq INTEGER,
  air_temp REAL, humidity REAL,
  water_distance_cm REAL, water_level_pct REAL, water_liters REAL,
  water_temp REAL, ph REAL, ec REAL, light_lux REAL, soil_raw REAL
);
CREATE INDEX IF NOT EXISTS readings_ts ON readings(ts);
CREATE TABLE IF NOT EXISTS actuator_log (id INTEGER PRIMARY KEY, ts REAL NOT NULL, states TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS actuator_ts ON actuator_log(ts);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY, ts REAL NOT NULL, key TEXT NOT NULL, severity TEXT NOT NULL,
  message TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, cleared_ts REAL
);
CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY, ts REAL NOT NULL, height_cm REAL, notes TEXT);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY, ts REAL NOT NULL, file TEXT NOT NULL, overlay TEXT, day REAL, stage TEXT, analysis TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS day_cache (planted_at REAL NOT NULL, day INTEGER NOT NULL, row TEXT, PRIMARY KEY (planted_at, day));
`;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise)
    dbPromise = SQLite.openDatabaseAsync('hydro.db').then(async (d) => {
      await d.execAsync(SCHEMA);
      // Columns added after the first release (CREATE TABLE IF NOT EXISTS doesn't touch an existing table).
      const cols = new Set((await d.getAllAsync<{ name: string }>('PRAGMA table_info(readings)')).map((c) => c.name));
      if (!cols.has('soil_raw')) await d.execAsync('ALTER TABLE readings ADD COLUMN soil_raw REAL');
      return d;
    });
  return dbPromise;
}

export async function query<T>(sql: string, ...params: SQLite.SQLiteBindValue[]): Promise<T[]> {
  return (await db()).getAllAsync<T>(sql, params);
}

export async function first<T>(sql: string, ...params: SQLite.SQLiteBindValue[]): Promise<T | null> {
  return (await db()).getFirstAsync<T>(sql, params);
}

export async function run(sql: string, ...params: SQLite.SQLiteBindValue[]) {
  return (await db()).runAsync(sql, params);
}

// ---- Settings: user-facing values plus internal bookkeeping keys starting with "_" ----

export async function getSettings(): Promise<Settings> {
  const rows = await query<{ key: string; value: string }>('SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  const s = { ...DEFAULT_SETTINGS, planted_at: null, ...stored } as Omit<Settings, 'planted_at'> & { planted_at: number | null };
  if (s.planted_at == null) {
    s.planted_at = Date.now() / 1000;
    await setSettings({ planted_at: s.planted_at });
  }
  return s as Settings;
}

export async function setSettings(values: Partial<Settings>) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in DEFAULT_SETTINGS) && k !== 'planted_at') throw new Error(`unknown setting ${k}`);
    await putMeta(k, v);
  }
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const r = await first<{ value: string }>('SELECT value FROM settings WHERE key=?', key);
  return r ? (JSON.parse(r.value) as T) : fallback;
}

export async function putMeta(key: string, value: unknown) {
  await run(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key,
    JSON.stringify(value),
  );
}

/** Wipe all logged data (keeps settings). Used by "Start a new grow". */
export async function clearLogs() {
  await (await db()).execAsync(
    'DELETE FROM readings; DELETE FROM actuator_log; DELETE FROM alerts; DELETE FROM observations; DELETE FROM day_cache;',
  );
}
