// The phone-side replacement for hydro/server.py: ingest ESP32 readings, run the ML setpoints and the
// controller, keep alerts, and answer the screens' questions. Everything here runs locally.
import * as alertRules from '../engine/alerts';
import { decide } from '../engine/controller';
import { dailyTable, fit, recommend, type ActRow, type Day, type Fit, type ReadingRow, type Recommendation } from '../engine/optimizer';
import { dayOfGrow, load as loadProfile, stageFor } from '../engine/profiles';
import * as suitability from '../engine/suitability';
import type { Actuators, AlertRow, Found, Reading, Settings } from '../engine/types';
import { first, getMeta, getSettings, putMeta, query, run } from './db';
import { localAddresses } from '../../modules/wifi-bind/src/WifiBindModule';
import { fetchReadings, probeBoard, sendActuators, type DeviceReport, type Hold } from './device';
import { notifyCritical } from './notify';

export function waterLevel(distance: number | null | undefined, s: Settings): [number | null, number | null] {
  if (distance == null) return [null, null];
  const depth = s.tank_empty_distance_cm - s.tank_full_distance_cm;
  const waterCm = Math.min(Math.max(s.tank_empty_distance_cm - distance, 0), depth);
  return [Math.round((1000 * waterCm) / depth) / 10, Math.round((waterCm * s.tank_area_cm2) / 1000 * 1000) / 1000];
}

async function sensorsPresent(): Promise<Set<string>> {
  const rows = await query<{ ph: number | null; ec: number | null }>('SELECT ph, ec FROM readings ORDER BY ts DESC LIMIT 5');
  const out = new Set<string>();
  for (const r of rows) {
    if (r.ph != null) out.add('ph');
    if (r.ec != null) out.add('ec_ms_cm');
  }
  return out;
}

export async function lastActuators(): Promise<Actuators> {
  const r = await first<{ states: string }>('SELECT states FROM actuator_log ORDER BY ts DESC LIMIT 1');
  return r ? JSON.parse(r.states) : {};
}

// ---- Optimizer: complete days are summarised once and cached, so the fit never rescans months of data ----

const SETTLE_S = 4 * 3600; // the board can backfill ~3 h of readings, so only cache days older than that

async function completeDays(s: Settings, now: number): Promise<Day[]> {
  const cached = await query<{ day: number; row: string | null }>(
    'SELECT day, row FROM day_cache WHERE planted_at=? ORDER BY day', s.planted_at);
  const have = new Map(cached.map((c) => [c.day, c.row]));
  const lastClosed = Math.floor((now - SETTLE_S - s.planted_at) / 86400) - 1;
  for (let d = 0; d <= lastClosed; d++) {
    if (have.has(d)) continue;
    const t0 = s.planted_at + d * 86400;
    const readings = await query<ReadingRow>(
      'SELECT ts, air_temp, humidity, ph, ec, water_liters FROM readings WHERE ts >= ? AND ts < ? ORDER BY ts', t0, t0 + 86400);
    const acts = (await query<{ ts: number; states: string }>(
      'SELECT ts, states FROM actuator_log WHERE ts >= ? AND ts < ? ORDER BY ts', t0, t0 + 86400))
      .map((a) => ({ ts: a.ts, states: JSON.parse(a.states) }) as ActRow);
    const row = dailyTable(s.crop, s.planted_at, readings, acts)[0] ?? null;
    const json = row ? JSON.stringify(row) : null;
    await run('INSERT OR REPLACE INTO day_cache(planted_at, day, row) VALUES(?,?,?)', s.planted_at, d, json);
    have.set(d, json);
  }
  return [...have.entries()]
    .filter(([d, row]) => d <= lastClosed && row)
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => {
      const day = JSON.parse(row!) as Day;
      for (const k of Object.keys(day)) if (day[k] === null) day[k] = NaN; // JSON turns NaN into null
      return day;
    });
}

let fitCache: { key: string; fit: Fit } | null = null;

async function getFit(s: Settings, day: number, now: number): Promise<Fit> {
  const key = `${s.crop}|${s.planted_at}|${Math.floor(day)}`;
  if (fitCache?.key !== key) fitCache = { key, fit: fit(await completeDays(s, now)) };
  return fitCache.fit;
}

export async function context(ts: number) {
  const s = await getSettings();
  const day = dayOfGrow(s.planted_at, ts);
  const f = s.ml_enabled ? await getFit(s, day, ts) : { n_days: 0, model: null };
  const rec = recommend(s.crop, day, await sensorsPresent(), f, s.explore);
  return { s, day, rec };
}

// ---- Alerts (one active alert per key; persistence so noisy readings don't spam) ----

const firstSeen: Record<string, number> = {};

async function syncAlerts(found: Found, ts: number) {
  const active = Object.fromEntries(
    (await query<AlertRow>('SELECT * FROM alerts WHERE active=1')).map((a) => [a.key, a]));
  for (const k of Object.keys(firstSeen)) if (!(k in found)) delete firstSeen[k];
  for (const [key, [sev, msg]] of Object.entries(found)) {
    const f = (firstSeen[key] ??= ts);
    if (!(key in active) && ts - f < alertRules.PERSIST_S && sev !== 'critical') continue;
    if (!(key in active)) {
      await run('INSERT INTO alerts(ts, key, severity, message) VALUES(?,?,?,?)', ts, key, sev, msg);
      if (sev === 'critical') notifyCritical(msg);
    } else if (active[key].message !== msg) {
      await run('UPDATE alerts SET message=?, severity=? WHERE id=?', msg, sev, active[key].id);
    }
  }
  for (const [key, a] of Object.entries(active))
    if (!(key in found) && key !== 'offline' && !key.startsWith('vision_'))
      await run('UPDATE alerts SET active=0, cleared_ts=? WHERE id=?', ts, a.id);
}

/** Raise/clear alerts whose keys start with `prefix` (photo analysis), independent of sensor readings. */
export async function syncAlertGroup(prefix: string, found: Found, ts: number) {
  const active = Object.fromEntries(
    (await query<AlertRow>('SELECT * FROM alerts WHERE active=1 AND key LIKE ?', prefix + '%')).map((a) => [a.key, a]));
  for (const [key, [sev, msg]] of Object.entries(found)) {
    if (!(key in active)) await run('INSERT INTO alerts(ts, key, severity, message) VALUES(?,?,?,?)', ts, key, sev, msg);
    else if (active[key].message !== msg) await run('UPDATE alerts SET message=?, severity=? WHERE id=?', msg, sev, active[key].id);
  }
  for (const [key, a] of Object.entries(active))
    if (!(key in found)) await run('UPDATE alerts SET active=0, cleared_ts=? WHERE id=?', ts, a.id);
}

async function setOffline(offline: boolean, now: number) {
  const active = await first<{ id: number }>("SELECT id FROM alerts WHERE active=1 AND key='offline'");
  if (offline && !active) {
    const msg = 'Lost contact with the ESP32. Is the phone still on its WiFi?';
    await run("INSERT INTO alerts(ts, key, severity, message) VALUES(?, 'offline', 'critical', ?)", now, msg);
    notifyCritical(msg);
  } else if (!offline && active) {
    await run("UPDATE alerts SET active=0, cleared_ts=? WHERE key='offline' AND active=1", now);
  }
}

// ---- One control cycle: pull readings from the board, store them, decide, push commands ----

export interface LinkState {
  online: boolean;
  /** The address the board answered on last (see candidateHosts). */
  host: string | null;
  lastSeen: number | null;
  error: string | null;
  report: Omit<DeviceReport, 'readings'> | null;
  rttMs: number | null;
}

/** The board's own WiFi always puts it here. */
export const BOARD_AP_HOST = '192.168.4.1';

/** Addresses to try, best first: the one that answered last, the saved one, the board's own WiFi, and the
 *  address the board last reported on a router or this phone's hotspot. So the phone finds the board whether
 *  it has joined the board's WiFi or the board has joined the phone's hotspot, with no settings to change. */
async function candidateHosts(s: Settings): Promise<string[]> {
  const active = await getMeta<string | null>('_active_host', null);
  const sta = await getMeta<string | null>('_board_sta_ip', null);
  return [...new Set([active, s.device_host, BOARD_AP_HOST, sta].filter((h): h is string => !!h))];
}

const SCAN_EVERY_S = 20;
let lastScan = 0;

/** The board joined this phone's hotspot (or a router) but its address there isn't known or has changed:
 *  Android picks a new random hotspot subnet each time it's switched on, and DHCP hands out new addresses.
 *  Ask every address in the hotspot's /24 (and a small joined WiFi's) whether it is the board. */
export async function scanForBoard(): Promise<string | null> {
  if (Date.now() / 1000 - lastScan < SCAN_EVERY_S) return null;
  lastScan = Date.now() / 1000;
  const nets = (await localAddresses()).filter(
    (a) =>
      (a.tether || a.prefix >= 24) &&
      !a.address.startsWith('192.168.4.') &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address),
  );
  const hosts: string[] = [];
  for (const n of [...nets].sort((a, b) => Number(b.tether) - Number(a.tether))) {
    const base = n.address.split('.').slice(0, 3).join('.');
    for (let i = 1; i < 255; i++) if (`${base}.${i}` !== n.address) hosts.push(`${base}.${i}`);
  }
  let found: string | null = null;
  let next = 0;
  const worker = async () => {
    while (!found && next < hosts.length) {
      const h = hosts[next++];
      if (await probeBoard(h, 1500)) found ??= h;
    }
  };
  await Promise.all(Array.from({ length: 48 }, worker));
  return found;
}

/** What the board should hold by itself if the phone goes quiet: today's targets and the tank calibration. */
export function holdFor(s: Settings, rec: Recommendation): Hold {
  return {
    air_temp_c: rec.setpoints.air_temp_c,
    humidity_pct: rec.setpoints.humidity_pct,
    light_hours: rec.setpoints.light_hours,
    lights_on_hour: loadProfile(s.crop).lights_on_hour,
    tank_empty_cm: s.tank_empty_distance_cm,
    tank_full_cm: s.tank_full_distance_cm,
    refill_below_pct: s.refill_below_pct,
    refill_until_pct: s.refill_until_pct,
  };
}

export async function cycle(prevLink: LinkState): Promise<LinkState> {
  const s = await getSettings();
  const now = Date.now() / 1000;
  let lastSeq = await getMeta<number>('_device_seq', 0);
  let report: DeviceReport | null = null;
  let host = '';
  const t0 = Date.now();
  try {
    const hosts = await candidateHosts(s);
    let firstError: unknown = null;
    for (const h of hosts) {
      try {
        report = await fetchReadings(h, lastSeq, h === hosts[0] ? 6000 : 3500);
        host = h;
        break;
      } catch (e) {
        firstError ??= e;
      }
    }
    if (!report) {
      const found = await scanForBoard();
      if (found) {
        report = await fetchReadings(found, lastSeq);
        host = found;
      }
    }
    if (!report) throw firstError ?? new Error('no board address to try');
    // Board rebooted (boot time moved, or its sequence went backwards): numbering restarted, take everything.
    const bootAt = now - report.uptime_s;
    const knownBoot = await getMeta<number | null>('_device_boot', null);
    if (report.latest_seq < lastSeq || (knownBoot != null && Math.abs(bootAt - knownBoot) > 60)) {
      lastSeq = 0;
      report = await fetchReadings(host, 0);
    }
    await putMeta('_device_boot', bootAt);
    await putMeta('_active_host', host);
    if (report.net?.sta_connected && report.net.sta_ip) await putMeta('_board_sta_ip', report.net.sta_ip);
    // Catch up on readings buffered while the phone was away (the board sends at most 120 per call).
    let more = report;
    while (more.readings.length && more.readings[more.readings.length - 1].seq < more.latest_seq) {
      await store(more, s, now, false);
      more = await fetchReadings(host, more.readings[more.readings.length - 1].seq);
    }
    report = more;
  } catch (e) {
    const lastSeen = prevLink.lastSeen;
    await setOffline(lastSeen != null && now - lastSeen > alertRules.OFFLINE_AFTER_S, now);
    return { ...prevLink, online: false, error: e instanceof Error ? e.message : String(e) };
  }
  const rttMs = Date.now() - t0;
  const latest = await store(report, s, now, true);
  await setOffline(false, now);
  const { readings: _, ...meta } = report;
  if (!latest) return { online: true, host, lastSeen: now, error: null, report: meta, rttMs };

  const { rec } = await context(latest.ts);
  await syncAlerts(alertRules.evaluate(latest, rec.stage), latest.ts);
  const profile = loadProfile(s.crop);
  const acts = decide(latest, rec.setpoints, s, await lastActuators(), profile.lights_on_hour, latest.ts);
  await run('INSERT INTO actuator_log(ts, states) VALUES(?, ?)', latest.ts, JSON.stringify(acts));
  try {
    await sendActuators(host, acts, holdFor(s, rec));
  } catch (e) {
    return { online: true, host, lastSeen: now, error: `Readings arrived but the command failed: ${e instanceof Error ? e.message : e}`, report: meta, rttMs };
  }
  return { online: true, host, lastSeen: now, error: null, report: { ...meta, actuators: acts }, rttMs };
}

/** Store new readings; returns the newest as a Reading (only the fields the board sent), or null. */
async function store(report: DeviceReport, s: Settings, now: number, isFinal: boolean): Promise<Reading | null> {
  let latest: Reading | null = null;
  const rs = report.readings;
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    const ts = Math.round((now - r.age_s) * 1000) / 1000;
    const [pct, liters] = waterLevel(r.water_distance_cm, s);
    await run(
      'INSERT INTO readings(ts, received_at, device_id, seq, air_temp, humidity, water_distance_cm, water_level_pct,' +
        ' water_liters, ph, ec, soil_raw) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      ts, now, report.device_id, r.seq, r.air_temp ?? null, r.humidity ?? null, r.water_distance_cm ?? null,
      pct, liters, r.ph ?? null, r.ec ?? null, r.soil_raw ?? null);
    const isLatest = isFinal && i === rs.length - 1;
    // Backfilled readings: log what the board itself was doing (needed for refill segmentation and light hours).
    if (!isLatest) await run('INSERT INTO actuator_log(ts, states) VALUES(?, ?)', ts, JSON.stringify(r.acts));
    else {
      const { seq: _s, age_s: _a, acts: _x, ...fields } = r;
      latest = { ...fields, ts, water_level_pct: pct };
    }
  }
  if (rs.length) await putMeta('_device_seq', rs[rs.length - 1].seq);
  return latest;
}

// ---- Read models for the screens ----

export interface Status {
  settings: Settings;
  cropName: string;
  day: number;
  rec: Recommendation;
  latest: (Reading & { received_at: number }) | null;
  actuators: Actuators;
  suitability: { score: number | null; note: string };
  alerts: AlertRow[];
}

export async function status(): Promise<Status> {
  const latest = await first<Reading & { received_at: number }>('SELECT * FROM readings ORDER BY ts DESC LIMIT 1');
  const { s, day, rec } = await context(Date.now() / 1000);
  const stage = rec.stage;
  let suit: Status['suitability'] = { score: null, note: 'no data yet' };
  if (latest) {
    const [score, note] = suitability.score(s.crop, latest.air_temp, latest.humidity, latest.ph, (stage.ph[0] + stage.ph[1]) / 2);
    suit = { score, note };
  }
  return {
    settings: s,
    cropName: loadProfile(s.crop).display_name,
    day,
    rec,
    latest,
    actuators: await lastActuators(),
    suitability: suit,
    alerts: await query<AlertRow>('SELECT * FROM alerts WHERE active=1 ORDER BY ts DESC'),
  };
}

export type SeriesKey = 'air_temp' | 'humidity' | 'water_level_pct' | 'water_distance_cm' | 'soil_raw' | 'ph' | 'ec';
export type SeriesRow = { ts: number } & Record<SeriesKey, number | null>;

const SERIES_COLS = 'air_temp, humidity, water_level_pct, water_distance_cm, soil_raw, ph, ec';

/** Readings over the last `hours`, averaged into at most `points` buckets so a week of 10 s readings stays
 *  light. Short windows come back unaveraged, one row per reading. */
export async function series(hours: number, points = 120): Promise<SeriesRow[]> {
  const end = Date.now() / 1000;
  const start = end - hours * 3600;
  const n = (await first<{ n: number }>('SELECT COUNT(*) AS n FROM readings WHERE ts >= ?', start))?.n ?? 0;
  if (n <= points) return query<SeriesRow>(`SELECT ts, ${SERIES_COLS} FROM readings WHERE ts >= ? ORDER BY ts`, start);
  const avg = SERIES_COLS.split(', ').map((k) => `AVG(${k}) AS ${k}`).join(', ');
  return query<SeriesRow>(
    `SELECT AVG(ts) AS ts, ${avg} FROM readings WHERE ts >= ? GROUP BY CAST((ts - ?) / ? AS INTEGER) ORDER BY ts`,
    start, start, (hours * 3600) / points);
}

export async function alertHistory(limit = 50) {
  return query<AlertRow>('SELECT * FROM alerts ORDER BY ts DESC LIMIT ?', limit);
}

export async function dailyHistory() {
  const s = await getSettings();
  return completeDays(s, Date.now() / 1000);
}

export async function addObservation(heightCm: number | null, notes: string) {
  await run('INSERT INTO observations(ts, height_cm, notes) VALUES(?,?,?)', Date.now() / 1000, heightCm, notes);
}

export async function observations(limit = 10) {
  return query<{ ts: number; height_cm: number | null; notes: string }>(
    'SELECT ts, height_cm, notes FROM observations ORDER BY ts DESC LIMIT ?', limit);
}

export function stageNow(s: Settings) {
  return stageFor(s.crop, dayOfGrow(s.planted_at, Date.now() / 1000));
}
