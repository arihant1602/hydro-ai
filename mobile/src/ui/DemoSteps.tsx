// The guided demo's steps (route: src/app/demo.tsx). Each step runs the real thing against the board that is
// linked right now: no recorded data. "Highlight" here means the theme's own: the item being explained turns
// soft black, the rest stay ivory.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';

import { LEAF_SAMPLES } from '../data/leaf_samples';
import { Advisor, type AdviceResult } from '../engine/advisor';
import { DISEASES } from '../engine/leafModel';
import { load as loadProfile } from '../engine/profiles';
import { soilPct, type Actuators } from '../engine/types';
import { blinkLed, sendActuators } from '../lib/device';
import { holdFor, type LinkState, type Status } from '../lib/hydro';
import { analyseSample, type Photo } from '../lib/photos';
import { useHydro } from '../lib/store';
import { ago, verdictWord } from './format';
import { Icon, type IconName } from './icons';
import { Button, Card, Slab } from './kit';
import { StageRibbon, stageName } from './StageRibbon';
import { C, F, RADIUS, T } from './theme';

export interface StepProps {
  st: Status;
  link: LinkState;
  /** The sample leaf analysed in the leaf step, handed on to the advisor step. */
  leaf: Photo | null;
  setLeaf: (p: Photo) => void;
  goTo: (i: number) => void;
}

export interface Step {
  key: string;
  kicker: string;
  title: string;
  body: string;
  View: (p: StepProps) => ReactNode;
}

// ---------------- shared pieces ----------------

const fmt = (v: number | null | undefined, digits: number, unit = '') => (v == null ? '–' : `${v.toFixed(digits)}${unit}`);

/** Steps through `n` items on a timer so each gets its turn in the spotlight; tapping one jumps to it. */
function useSpotlight(n: number, ms = 2200) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (n <= 1) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, ms]);
  return [n ? i % n : 0, setI] as const;
}

/** One row of an explanation. `on` = in the spotlight (soft black), otherwise an ivory card. */
export function Beat({
  n,
  icon,
  title,
  detail,
  value,
  on,
  onPress,
}: {
  n?: number;
  icon?: IconName;
  title: string;
  detail?: string;
  value?: string;
  on: boolean;
  onPress?: () => void;
}) {
  const fg = on ? C.ivory : C.soot;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityState={{ selected: on }}
      accessibilityLabel={[title, value, detail].filter(Boolean).join(', ')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: on ? C.soot : C.ivory, borderRadius: RADIUS.card, padding: 16 }}
    >
      {n != null ? (
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ivory, borderWidth: 1.5, borderColor: on ? C.ivory : C.sootLine }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.soot }}>{n}</Text>
        </View>
      ) : icon ? (
        <Icon name={icon} color={fg} size={22} />
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 16, lineHeight: 21, color: fg }}>{title}</Text>
        {detail ? <Text style={[T.bodySm, { color: on ? C.ivoryDim : C.sootDim }]}>{detail}</Text> : null}
      </View>
      {value ? <Text style={{ fontFamily: F.display, fontSize: 20, color: fg }}>{value}</Text> : null}
    </Pressable>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <Text style={T.bodySm}>{children}</Text>;
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: 'rgba(230,213,189,0.14)' }}>
      <Text style={[T.label, { color: 'rgba(230,213,189,0.7)' }]}>{label}</Text>
      <Text style={{ fontFamily: F.bodyMid, fontSize: 14, color: C.ivory, flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

// ---------------- 0. intro ----------------

function Intro({ st, link, goTo }: StepProps) {
  return (
    <>
      <Slab style={{ gap: 6 }}>
        <Text style={[T.tiny, { color: 'rgba(230,213,189,0.7)' }]}>LINKED</Text>
        <Text style={[T.h2, { color: C.ivory }]}>{link.report?.device_id ?? 'ESP32'}</Text>
        <Text style={[T.bodySm, { color: C.ivory }]}>
          at {link.host} · {st.cropName}, day {Math.floor(st.day)}
        </Text>
      </Slab>
      <View style={{ gap: 8 }}>
        {STEPS.slice(1, -1).map((s, i) => (
          <Beat key={s.key} n={i + 1} title={s.title} on={false} onPress={() => goTo(i + 1)} />
        ))}
      </View>
    </>
  );
}

// ---------------- 1. the board ----------------

function uptime(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

function Board({ link }: StepProps) {
  const r = link.report;
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Slab style={{ gap: 2 }}>
        <Text style={[T.h2, { color: C.ivory, marginBottom: 8 }]}>{r?.device_id ?? 'ESP32'}</Text>
        <KV label="Address" value={link.host ?? '–'} />
        <KV label="Firmware" value={r?.fw ?? '–'} />
        <KV label="Running for" value={r ? uptime(r.uptime_s) : '–'} />
        <KV label="Reply time" value={link.rttMs != null ? `${link.rttMs} ms` : '–'} />
        {r?.net && <KV label="Its WiFi" value={`${r.net.ap_ssid} · ${r.net.clients} connected`} />}
        <KV label="Reads sensors every" value={r ? `${r.interval_s} s` : '–'} />
        <KV label="In control" value={r?.controller === 'server' ? 'web dashboard' : r?.controller === 'board' ? 'the board itself' : 'this phone'} />
      </Slab>
      <Button
        kind="quiet"
        label="Blink the board's LED"
        busy={busy}
        onPress={async () => {
          if (!link.host) return;
          setBusy(true);
          try {
            await blinkLed(link.host, 6);
            setMsg('Look at the board: its blue LED is blinking.');
          } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      {msg ? <Note>{msg}</Note> : null}
    </>
  );
}

// ---------------- 2. sensors ----------------

type SensorKey = 'dht' | 'ultrasonic' | 'soil' | 'ph' | 'tds';

function sensorRows(st: Status, link: LinkState) {
  const l = st.latest;
  const fitted = (k: SensorKey, v: unknown) => (link.report?.sensors ? link.report.sensors[k] : v != null);
  const soil = soilPct(l?.soil_raw, st.settings);
  const rows: { key: SensorKey; icon: IconName; name: string; reads: string; value: string; fitted: boolean }[] = [
    { key: 'dht', icon: 'thermo', name: 'Air sensor (DHT)', reads: 'Air temperature and humidity', value: `${fmt(l?.air_temp, 1, '°C')} · ${fmt(l?.humidity, 0, '%')}`, fitted: fitted('dht', l?.air_temp) },
    { key: 'ultrasonic', icon: 'drop', name: 'Ultrasonic sensor', reads: 'Distance down to the water', value: fmt(l?.water_distance_cm, 1, ' cm'), fitted: fitted('ultrasonic', l?.water_distance_cm) },
    { key: 'soil', icon: 'soil', name: 'Soil probe', reads: `Moisture, raw ${fmt(l?.soil_raw, 0)}`, value: soil == null ? '–' : `${soil}%`, fitted: fitted('soil', l?.soil_raw) },
    { key: 'ph', icon: 'bolt', name: 'pH probe', reads: 'Acidity of the nutrient water', value: fmt(l?.ph, 2), fitted: fitted('ph', l?.ph) },
    { key: 'tds', icon: 'bolt', name: 'TDS probe', reads: 'Nutrient strength (EC)', value: fmt(l?.ec, 2, ' mS'), fitted: fitted('tds', l?.ec) },
  ];
  return rows;
}

function Sensors({ st, link }: StepProps) {
  const rows = sensorRows(st, link);
  const fitted = rows.filter((r) => r.fitted);
  const missing = rows.filter((r) => !r.fitted);
  const [i, setI] = useSpotlight(fitted.length);
  return (
    <>
      <Text style={T.tiny}>
        Reading #{link.report?.latest_seq ?? '–'} · {st.latest ? `updated ${ago(st.latest.ts)}` : 'no reading yet'}
      </Text>
      <View style={{ gap: 8 }}>
        {fitted.map((r, k) => (
          <Beat key={r.key} icon={r.icon} title={r.name} detail={r.reads} value={r.value} on={k === i} onPress={() => setI(k)} />
        ))}
      </View>
      {missing.length > 0 && <Note>Not fitted on this board: {missing.map((r) => r.name).join(', ')}. The app hides what isn’t there.</Note>}
    </>
  );
}

// ---------------- 3. water tank ----------------

function Tank({ st }: StepProps) {
  const l = st.latest;
  const s = st.settings;
  const [i, setI] = useSpotlight(4);
  if (l?.water_distance_cm == null) return <Card><Text style={[T.body, { color: C.soot }]}>No water-level sensor reading on this board. Skip ahead.</Text></Card>;
  const pct = l.water_level_pct ?? 0;
  const beats = [
    { title: 'The sensor measures', detail: 'Ultrasonic echo from the lid down to the water surface.', value: fmt(l.water_distance_cm, 1, ' cm') },
    { title: 'The phone turns it into a level', detail: `With your calibration: empty at ${s.tank_empty_distance_cm} cm, full at ${s.tank_full_distance_cm} cm.`, value: fmt(l.water_level_pct, 0, '%') },
    { title: 'And into litres', detail: `Water depth × tank floor of ${s.tank_area_cm2} cm².`, value: fmt(l.water_liters, 1, ' L') },
    { title: 'Refill rule', detail: `Below ${s.refill_below_pct}% the pump tops up from the jug until ${s.refill_until_pct}%.`, value: st.actuators.refill_pump ? 'filling' : 'idle' },
  ];
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 16, alignItems: 'stretch' }}>
        <View style={{ width: 92, height: 180, borderRadius: 18, backgroundColor: C.ivory, padding: 6, justifyContent: 'flex-end' }}>
          {/* refill threshold */}
          <View style={{ position: 'absolute', left: 6, right: 6, bottom: 6 + (168 * s.refill_below_pct) / 100, height: 2, backgroundColor: C.ember }} />
          <View style={{ height: `${Math.max(2, Math.min(100, pct))}%`, borderRadius: 13, backgroundColor: C.soot }} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: 4 }}>
          <Text style={T.tiny}>TANK</Text>
          <Text style={{ fontFamily: F.display, fontSize: 56, lineHeight: 58, letterSpacing: -1.5, color: C.ivory }}>{fmt(l.water_level_pct, 0, '%')}</Text>
          <Text style={T.bodySm}>{fmt(l.water_liters, 1, ' litres')} · orange line = refill point</Text>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        {beats.map((b, k) => (
          <Beat key={b.title} n={k + 1} {...b} on={k === i} onPress={() => setI(k)} />
        ))}
      </View>
    </>
  );
}

// ---------------- 4. today's targets ----------------

function Targets({ st }: StepProps) {
  const { rec, settings } = st;
  const sp = rec.setpoints;
  const stage = rec.stage;
  const rows = [
    { key: 'air_temp_c', icon: 'thermo' as const, title: 'Air temperature', detail: `stage range ${stage.air_temp_c[0]}–${stage.air_temp_c[1]} °C`, value: fmt(sp.air_temp_c, 1, '°C') },
    { key: 'humidity_pct', icon: 'humidity' as const, title: 'Humidity', detail: `stage range ${stage.humidity_pct[0]}–${stage.humidity_pct[1]}%`, value: fmt(sp.humidity_pct, 0, '%') },
    { key: 'light_hours', icon: 'sun' as const, title: 'Light', detail: `from ${loadProfile(settings.crop).lights_on_hour}:00 each day`, value: fmt(sp.light_hours, 1, ' h') },
    { key: 'ph', icon: 'bolt' as const, title: 'pH', detail: `stage range ${stage.ph[0]}–${stage.ph[1]}`, value: fmt(sp.ph, 2) },
    { key: 'ec_ms_cm', icon: 'bolt' as const, title: 'EC', detail: `stage range ${stage.ec_ms_cm[0]}–${stage.ec_ms_cm[1]} mS/cm`, value: fmt(sp.ec_ms_cm, 2) },
  ].filter((r) => sp[r.key] != null);
  const [i, setI] = useSpotlight(rows.length);
  return (
    <>
      <Slab style={{ gap: 12 }}>
        <Text style={[T.tiny, { color: 'rgba(230,213,189,0.7)' }]}>
          {st.cropName.toUpperCase()} · DAY {Math.floor(st.day)}
        </Text>
        <Text style={[T.h2, { color: C.ivory }]}>{stageName(stage.name)}</Text>
        <StageRibbon stages={loadProfile(settings.crop).stages} day={st.day} onDark />
      </Slab>
      <View style={{ gap: 8 }}>
        {rows.map((r, k) => (
          <Beat key={r.key} icon={r.icon} title={r.title} detail={r.detail} value={r.value} on={k === i} onPress={() => setI(k)} />
        ))}
      </View>
      <Note>
        {rec.source === 'model+prior'
          ? `Learned from ${rec.n_days} complete days of this plant, weighted ${Math.round(rec.model_weight * 100)}% against the biology targets.`
          : `Biology targets for now (${rec.n_days} complete days logged). Once there are enough days the phone learns better targets from this plant.`}
      </Note>
    </>
  );
}

// ---------------- 5. one control cycle ----------------

const RELAYS: { key: string; label: string; icon: IconName }[] = [
  { key: 'fan', label: 'Fan', icon: 'fan' },
  { key: 'light', label: 'Light', icon: 'sun' },
  { key: 'refill_pump', label: 'Pump', icon: 'drop' },
  { key: 'mister', label: 'Mister', icon: 'mist' },
  { key: 'heater', label: 'Heater', icon: 'heat' },
];

function onList(a: Actuators) {
  const on = RELAYS.filter((r) => a[r.key]).map((r) => r.label.toLowerCase());
  return on.length ? `${on.join(', ')} on` : 'everything off';
}

function Cycle({ st, link }: StepProps) {
  const l = st.latest;
  const sp = st.rec.setpoints;
  const [i, setI] = useSpotlight(5, 2000);
  const beats = [
    { title: 'Ask the board', detail: `GET ${link.host}/api/readings, answered in ${link.rttMs ?? '–'} ms over its own WiFi.` },
    { title: 'Store on the phone', detail: `Reading #${link.report?.latest_seq ?? '–'} saved in the phone’s database: ${fmt(l?.air_temp, 1, ' °C')}, ${fmt(l?.humidity, 0, '%')}${l?.water_level_pct != null ? `, tank ${fmt(l.water_level_pct, 0, '%')}` : ''}.` },
    { title: 'Work out targets', detail: `${stageName(st.rec.stage.name)}: hold ${fmt(sp.air_temp_c, 1, ' °C')} and ${fmt(sp.humidity_pct, 0, '%')}.` },
    { title: 'Decide', detail: `Compare reading with target, with a dead band so relays don’t chatter: ${onList(st.actuators)}.` },
    { title: 'Command the board', detail: 'POST /api/actuators. The board switches its relays and keeps today’s targets itself if the phone goes quiet for a minute.' },
  ];
  return (
    <>
      <View style={{ gap: 8 }}>
        {beats.map((b, k) => (
          <Beat key={b.title} n={k + 1} {...b} on={k === i} onPress={() => setI(k)} />
        ))}
      </View>
      <Note>This loop runs every {st.settings.poll_s} s while the app is open (every 4 s during the demo). Last one {link.lastSeen ? ago(link.lastSeen) : '–'}.</Note>
    </>
  );
}

// ---------------- 6. decisions ----------------

function why(key: string, st: Status): string {
  const l = st.latest;
  const sp = st.rec.setpoints;
  const s = st.settings;
  const on = !!st.actuators[key];
  const t = l?.air_temp;
  const h = l?.humidity;
  const hot = sp.air_temp_c + 0.7;
  const humid = sp.humidity_pct + 4;
  switch (key) {
    case 'fan':
      if (t == null && h == null) return 'No air reading.';
      if (!on) return `Air ${fmt(t, 1, ' °C')} is under ${hot.toFixed(1)} °C and humidity under ${humid.toFixed(0)}%.`;
      if (t != null && t > hot) return `Air ${fmt(t, 1, ' °C')} is above ${hot.toFixed(1)} °C: cooling.`;
      if (h != null && h > humid) return `Humidity ${fmt(h, 0, '%')} is above ${humid.toFixed(0)}%: venting.`;
      return `Cooling until the air drops below ${(sp.air_temp_c - 0.7).toFixed(1)} °C.`;
    case 'heater':
      if (t == null) return 'No air reading, so no heating blind.';
      return on ? `Air ${fmt(t, 1, ' °C')} is below target: warming.` : `Air ${fmt(t, 1, ' °C')} is warm enough (heats below ${(sp.air_temp_c - 1.4).toFixed(1)} °C).`;
    case 'mister':
      if (h == null) return 'No humidity reading, so no misting blind.';
      if (on) return `Humidity ${fmt(h, 0, '%')} is below target: misting.`;
      return st.actuators.fan ? 'Off while the fan runs.' : `Humidity ${fmt(h, 0, '%')} is fine (mists below ${(sp.humidity_pct - 4).toFixed(0)}%).`;
    case 'light': {
      const from = loadProfile(s.crop).lights_on_hour;
      return `${fmt(sp.light_hours, 1, ' h')} a day from ${from}:00; ${on ? 'inside' : 'outside'} that window now.`;
    }
    case 'refill_pump':
      if (l?.water_level_pct == null) return 'No water level, so the pump stays off.';
      return on ? `Tank at ${fmt(l.water_level_pct, 0, '%')}: filling to ${s.refill_until_pct}%.` : `Tank at ${fmt(l.water_level_pct, 0, '%')} (refills below ${s.refill_below_pct}%).`;
  }
  return '';
}

function Decisions({ st }: StepProps) {
  return (
    <>
      <View style={{ gap: 8 }}>
        {RELAYS.map((r) => (
          <Beat key={r.key} icon={r.icon} title={r.label} detail={why(r.key, st)} value={st.actuators[r.key] ? 'ON' : 'off'} on={!!st.actuators[r.key]} />
        ))}
      </View>
      <Note>Black rows are switched on right now. These are the commands the board received on the last cycle.</Note>
    </>
  );
}

// ---------------- 7. relay test ----------------

function Relays({ st, link }: StepProps) {
  const { setManual } = useHydro();
  const [ready, setReady] = useState(false);
  const [acts, setActs] = useState<Actuators>(() => Object.fromEntries(RELAYS.map((r) => [r.key, !!st.actuators[r.key]])));
  const [board, setBoard] = useState<Actuators | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actsRef = useRef(acts);
  const host = link.host;

  const send = async (next: Actuators, which: string) => {
    if (!host) return;
    setBusy(which);
    setError(null);
    try {
      // Dosing pumps are left out on purpose: a demo shouldn't put acid or nutrients in the water.
      const res = await sendActuators(host, { ...next, ph_down_ms: 0, ph_up_ms: 0, nutrient_ms: 0 }, holdFor(st.settings, st.rec));
      actsRef.current = next;
      setActs(next);
      setBoard(res.actuators);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    let live = true;
    void setManual(true).then(() => live && setReady(true));
    // The board hands control back to itself after a minute without commands; keep it on ours.
    const keep = setInterval(() => {
      if (host) void sendActuators(host, actsRef.current, holdFor(st.settings, st.rec)).then((r) => live && setBoard(r.actuators), () => {});
    }, 20000);
    return () => {
      live = false;
      clearInterval(keep);
      void setManual(false); // automatic control takes over again (runs a cycle straight away)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Card style={{ gap: 4 }}>
        <Text style={[T.label, { color: C.soot, fontFamily: F.bodyBold }]}>{ready ? 'Automatic control paused' : 'Pausing automatic control…'}</Text>
        <Text style={[T.bodySm, { color: C.sootDim }]}>It takes over again as soon as you leave this step.</Text>
      </Card>
      <View style={{ gap: 8 }}>
        {RELAYS.map((r) => {
          const on = !!acts[r.key];
          const confirmed = board ? (board[r.key] ? 'board: on' : 'board: off') : 'tap to switch';
          return (
            <Beat
              key={r.key}
              icon={r.icon}
              title={r.label}
              detail={busy === r.key ? 'sending…' : confirmed}
              value={on ? 'ON' : 'off'}
              on={on}
              onPress={ready && !busy ? () => void send({ ...acts, [r.key]: !on }, r.key) : undefined}
            />
          );
        })}
      </View>
      <Button
        kind="quiet"
        label="Switch everything off"
        disabled={!ready || !!busy}
        onPress={() => void send(Object.fromEntries(RELAYS.map((r) => [r.key, false])), 'all')}
      />
      {error ? <Note>{error}</Note> : null}
      {busy ? <ActivityIndicator color={C.ivory} /> : null}
    </>
  );
}

// ---------------- 8. alerts ----------------

const WATCHED: { icon: IconName; title: string; detail: string }[] = [
  { icon: 'thermo', title: 'Air outside the stage range', detail: 'Temperature and humidity against this stage’s biology targets.' },
  { icon: 'bolt', title: 'pH and EC drifting', detail: 'When the probes are fitted.' },
  { icon: 'drop', title: 'Tank running dry', detail: 'Below 20% is critical: check the jug and pump.' },
  { icon: 'wifi', title: 'Board out of reach', detail: 'No contact for 90 s.' },
  { icon: 'rig', title: 'Sensor faults', detail: 'A DHT with no data, an ultrasonic with no echo.' },
  { icon: 'leaf', title: 'Leaf problems', detail: 'From the last leaf photo.' },
];

function Alerts({ st }: StepProps) {
  const [i, setI] = useSpotlight(WATCHED.length);
  return (
    <>
      {st.alerts.length ? (
        <View style={{ gap: 8 }}>
          {st.alerts.map((a) => (
            <Slab key={a.id} style={{ gap: 4, padding: 16, borderRadius: RADIUS.card }}>
              <Text style={[T.tiny, { color: C.emberSoft }]}>{a.severity === 'critical' ? 'CRITICAL' : 'WARNING'} · {ago(a.ts)}</Text>
              <Text style={[T.bodySm, { color: C.ivory }]}>{a.message}</Text>
            </Slab>
          ))}
        </View>
      ) : (
        <Card style={{ gap: 4 }}>
          <Text style={[T.h3, { color: C.soot }]}>All clear right now</Text>
          <Text style={[T.bodySm, { color: C.sootDim }]}>Nothing on the board is outside its targets.</Text>
        </Card>
      )}
      <Text style={T.h3}>What it watches</Text>
      <View style={{ gap: 8 }}>
        {WATCHED.map((w, k) => (
          <Beat key={w.title} {...w} on={k === i} onPress={() => setI(k)} />
        ))}
      </View>
      <Note>A problem must last 5 minutes before it alerts, so one noisy reading doesn’t. Critical ones notify the phone at once.</Note>
    </>
  );
}

// ---------------- 9. leaf check ----------------

const SAMPLE = LEAF_SAMPLES.find((s) => s.truth === 'common_rust') ?? LEAF_SAMPLES[0];

function Leaf({ leaf, setLeaf }: StepProps) {
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = leaf?.analysis;
  const probs = Object.entries(a?.disease?.probs ?? {}).sort((x, y) => y[1] - x[1]);
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Image source={{ uri: `data:image/jpeg;base64,${SAMPLE.jpeg}` }} style={{ width: '100%', aspectRatio: 1, borderRadius: 18, backgroundColor: C.soot }} />
          <Text style={T.tiny}>Sample leaf</Text>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          {leaf?.overlay ? (
            <Image source={{ uri: leaf.overlay }} style={{ width: '100%', aspectRatio: 1, borderRadius: 18, backgroundColor: C.soot }} />
          ) : (
            <View style={{ width: '100%', aspectRatio: 1, borderRadius: 18, borderWidth: 1.5, borderColor: C.ivoryLine, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="leaf" color={C.ivoryDim} size={28} />
            </View>
          )}
          <Text style={T.tiny}>What the phone saw</Text>
        </View>
      </View>
      {!a ? (
        <Button
          label="Run the leaf model"
          busy={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            const t0 = Date.now();
            try {
              setLeaf(await analyseSample(SAMPLE));
              setMs(Date.now() - t0);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : (
        <Slab style={{ gap: 10 }}>
          <Text style={[T.tiny, { color: 'rgba(230,213,189,0.7)' }]}>VERDICT{ms != null ? ` · ${ms} ms on this phone` : ''}</Text>
          <Text style={[T.h2, { color: C.ivory }]}>{verdictWord(a.verdict)}</Text>
          {probs.map(([k, p]) => (
            <View key={k} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[T.label, { color: C.ivory }]}>{DISEASES[k]?.name ?? k}</Text>
                <Text style={[T.label, { color: C.ivory }]}>{Math.round(p * 100)}%</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(230,213,189,0.18)', overflow: 'hidden' }}>
                <View style={{ width: `${p * 100}%`, height: '100%', backgroundColor: C.ivory }} />
              </View>
            </View>
          ))}
        </Slab>
      )}
      {error ? <Note>{error}</Note> : null}
      <Note>The sample is from the model’s held-out test set, labelled {SAMPLE.truth.replace(/_/g, ' ')}. It isn’t saved to your plant’s history. The Leaf check tab does the same with the camera.</Note>
    </>
  );
}

// ---------------- 10. advisor ----------------

const advisor = new Advisor();
const QUESTION = 'Small rusty brown powdery spots on the leaves';

function Ask({ st, link, leaf }: StepProps) {
  const [res, setRes] = useState<AdviceResult | null>(null);
  // The demo only runs while the board is live, so the latest reading is current.
  const sensors = link.online ? st.latest : null;
  const run = () => {
    const form: Record<string, unknown> = { crop: st.settings.crop, day: Math.floor(st.day), hydroponic: !!sensors };
    setRes(advisor.advise({ text: QUESTION, form, photo: leaf?.analysis ?? null, sensors, stageTargets: st.rec.stage, lang: 'en' }));
  };
  const inputs = [`“${QUESTION}”`, leaf?.analysis ? 'the leaf check from the last step' : null, sensors ? 'live readings from the board' : null].filter(Boolean);
  return (
    <>
      <Card style={{ gap: 6 }}>
        <Text style={[T.tiny, { color: C.sootDim }]}>THE FARMER ASKS</Text>
        <Text style={[T.h3, { color: C.soot }]}>{QUESTION}</Text>
        <Text style={[T.bodySm, { color: C.sootDim }]}>Combined with {inputs.slice(1).join(' and ') || 'nothing else'}.</Text>
      </Card>
      {!res ? (
        <Button label="Ask the advisor" onPress={run} />
      ) : (
        <>
          {res.likely?.length ? (
            <View style={{ gap: 8 }}>
              {res.likely.slice(0, 3).map((c, k) => (
                <Beat key={c.id} n={k + 1} title={c.name} detail={c.agreement} value={`${Math.round(c.score * 100)}%`} on={k === 0} />
              ))}
            </View>
          ) : (
            <Note>{res.message ?? res.needs?.en ?? 'No clear cause.'}</Note>
          )}
          {res.actions?.length ? (
            <Card style={{ gap: 8 }}>
              <Text style={[T.label, { color: C.soot, fontFamily: F.bodyBold }]}>What to do</Text>
              {res.actions.slice(0, 3).map((a, k) => (
                <Text key={k} style={[T.bodySm, { color: C.soot }]}>
                  {k + 1}. {a.text}
                </Text>
              ))}
              {res.avoid?.[0] ? <Text style={[T.bodySm, { color: C.sootDim }]}>Avoid: {res.avoid[0].text}</Text> : null}
            </Card>
          ) : null}
          <Note>Answered on the phone in {res.latency_ms ?? 0} ms, no internet. English, Hinglish or Hindi in the Ask tab.</Note>
        </>
      )}
    </>
  );
}

// ---------------- 11. done ----------------

function Done({ st, link }: StepProps) {
  const done = [
    `Linked to ${link.report?.device_id ?? 'the board'} over its own WiFi`,
    `Live readings stored on the phone, ${st.latest ? `last ${ago(st.latest.ts)}` : 'none yet'}`,
    `${stageName(st.rec.stage.name)} targets for day ${Math.floor(st.day)}`,
    `Relays decided and switched: ${onList(st.actuators)}`,
    st.alerts.length ? `${st.alerts.length} alert${st.alerts.length > 1 ? 's' : ''} active` : 'No alerts',
    'Leaf model and advisor run on the phone',
  ];
  return (
    <View style={{ gap: 8 }}>
      {done.map((d) => (
        <Beat key={d} icon="chevron" title={d} on={false} />
      ))}
    </View>
  );
}

export const STEPS: Step[] = [
  { key: 'intro', kicker: 'Demo', title: 'See the whole system work', body: 'One piece at a time, using the board in front of you. Nothing here needs internet. Tap any step to jump to it.', View: Intro },
  { key: 'board', kicker: 'The board', title: 'The ESP32', body: 'It reads the sensors, switches the relays and runs its own WiFi. The phone joins it and talks to it directly.', View: Board },
  { key: 'sensors', kicker: 'Sensors', title: 'Live readings', body: 'Straight from the board, refreshed every few seconds.', View: Sensors },
  { key: 'tank', kicker: 'Water', title: 'From echo to litres', body: 'How one distance becomes a tank level the pump can act on.', View: Tank },
  { key: 'targets', kicker: 'Targets', title: 'What the plant needs today', body: 'Maize needs different conditions as it grows. The phone picks today’s targets from the growth stage.', View: Targets },
  { key: 'cycle', kicker: 'Control loop', title: 'One cycle, start to end', body: 'Every few seconds the phone runs these five steps against the board.', View: Cycle },
  { key: 'decide', kicker: 'Decisions', title: 'Why each relay is on or off', body: 'The reason for every switch, worked out from the readings and the targets above.', View: Decisions },
  { key: 'relays', kicker: 'Hands on', title: 'Switch the relays yourself', body: 'Tap one and listen for the relay click. The board confirms each command.', View: Relays },
  { key: 'alerts', kicker: 'Alerts', title: 'What gets flagged', body: 'Each reading is checked against the stage targets and for hardware faults.', View: Alerts },
  { key: 'leaf', kicker: 'Leaf check', title: 'Spot disease from a photo', body: 'A model trained on maize leaves runs on the phone. Here it checks a sample leaf.', View: Leaf },
  { key: 'ask', kicker: 'Advisor', title: 'Ask about a problem', body: 'It joins the farmer’s words with the photo and the sensors, and answers with causes and what to do.', View: Ask },
  { key: 'done', kicker: 'Done', title: 'That’s Hydro AI', body: 'Everything you saw ran on this phone and the board, offline.', View: Done },
];
