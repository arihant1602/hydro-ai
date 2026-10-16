// Settings: everything is configured from here, nothing needs a rebuild or a reflash.
//   Connection   where the board is, how often to read it
//   Board        the ESP32's own settings (WiFi, router + dashboard, sensors, pins), saved in its flash
//   Calibration  water tank and soil probe, with "use the current reading"
//   Grow         grow clock and learning; plant notes
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { soilPct, type Settings } from '../../engine/types';
import { clearLogs, getMeta, putMeta, setSettings } from '../../lib/db';
import {
  blinkLed,
  getBoardConfig,
  RELAY_KEYS,
  resetBoardConfig,
  saveBoardConfig,
  type BoardConfig,
  type RelayKey,
} from '../../lib/device';
import { addObservation, observations } from '../../lib/hydro';
import { useHydro } from '../../lib/store';
import { ago } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Button, Card, Field, Screen, SectionTitle, ToggleRow } from '../../ui/kit';
import { C, F, T } from '../../ui/theme';

const KEEP_AWAKE_TAG = 'controller';

export default function SettingsScreen() {
  const { status, link, refresh, pollNow } = useHydro();
  const s = status?.settings;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [keepAwake, setKeepAwake] = useState(false);

  useEffect(() => {
    void getMeta('_keep_awake', false).then((v) => {
      setKeepAwake(v);
      if (v) void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    });
  }, []);

  if (!s) return <Screen>{null}</Screen>;

  const val = (k: keyof Settings) => draft[k] ?? String(s[k]);
  const edit = (k: keyof Settings) => (t: string) => setDraft({ ...draft, [k]: t });
  const note = (section: string, text: string) => setMsg((m) => ({ ...m, [section]: text }));

  const save = async (section: string, keys: (keyof Settings)[], extra: Partial<Settings> = {}) => {
    const out: Partial<Settings> = { ...extra };
    for (const k of keys) {
      if (draft[k] == null) continue;
      if (typeof s[k] === 'number') {
        const n = Number(draft[k].replace(',', '.'));
        if (!Number.isFinite(n)) return note(section, `"${draft[k]}" isn't a number.`);
        (out as Record<string, number>)[k] = n;
      } else (out as Record<string, string>)[k] = draft[k].trim();
    }
    const full = out.tank_full_distance_cm ?? s.tank_full_distance_cm;
    const empty = out.tank_empty_distance_cm ?? s.tank_empty_distance_cm;
    if (full >= empty) return note(section, 'The full-tank distance must be shorter than the empty-tank distance.');
    if ((out.soil_dry_raw ?? s.soil_dry_raw) === (out.soil_wet_raw ?? s.soil_wet_raw))
      return note(section, 'Dry and wet soil readings must differ.');
    if (out.poll_s != null && out.poll_s < 3) return note(section, 'Read at most every 3 seconds.');
    await setSettings(out);
    if (out.device_host) await putMeta('_active_host', out.device_host); // try the new address first
    setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k as keyof Settings))));
    note(section, 'Saved.');
    await refresh();
    void pollNow();
  };

  const latest = status.latest;
  const r = link.report;
  const host = link.host ?? s.device_host; // where the board actually answered (it may differ from the saved one)
  const staIp = r?.net?.sta_connected ? r.net.sta_ip : undefined;

  return (
    <Screen>
      <Text style={T.h1}>Settings</Text>

      {/* ---------------- Connection ---------------- */}
      <SectionTitle>Connection</SectionTitle>
      <Card style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: link.online ? C.soot : 'transparent', borderWidth: 2, borderColor: C.soot }} />
          <Text style={[T.h3, { color: C.soot, flex: 1 }]}>{link.online ? `Linked to ${r?.device_id ?? 'the board'} at ${link.host}` : 'Not linked'}</Text>
        </View>
        {r && link.online ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
            <Info label="Firmware" value={r.fw} />
            <Info label="Up for" value={uptime(r.uptime_s)} />
            <Info label="Reply time" value={link.rttMs != null ? `${link.rttMs} ms` : '–'} />
            {r.net && <Info label="Board WiFi" value={`${r.net.ap_ssid} · ${r.net.clients} connected`} />}
            {r.net?.sta_ssid ? <Info label="Router" value={r.net.sta_connected ? `${r.net.sta_ssid} · ${r.net.sta_ip}` : `${r.net.sta_ssid} · not joined`} /> : null}
            {r.net?.server_url ? <Info label="Web dashboard" value={r.net.server_ok ? 'receiving' : 'not reachable'} /> : null}
          </View>
        ) : (
          <Text style={[T.bodySm, { color: C.sootDim }]}>
            {link.error ? `${link.error}. ` : ''}Join the board’s WiFi (HydroAI-…) in your phone’s WiFi settings; if Android says there’s no internet, choose to stay connected.
            {'\n'}Or, if the board has joined your router, use its router address below.
          </Text>
        )}
        <Field label="Board address" hint="The app also tries 192.168.4.1 and searches this phone's hotspot for the board by itself." value={val('device_host')} onChangeText={edit('device_host')} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: -6 }}>
          <CardChip label="Board WiFi · 192.168.4.1" on={val('device_host') === '192.168.4.1'} onPress={() => setDraft({ ...draft, device_host: '192.168.4.1' })} />
          {staIp && <CardChip label={`Router · ${staIp}`} on={val('device_host') === staIp} onPress={() => setDraft({ ...draft, device_host: staIp })} />}
        </View>
        <Field label="Read every (seconds)" value={val('poll_s')} onChangeText={edit('poll_s')} keyboardType="numeric" />
        <Button label="Save connection" onPress={() => save('conn', ['device_host', 'poll_s'])} />
        <Msg text={msg.conn} />
        <BlinkButton host={host} />
        <ToggleRow
          label="Keep screen on"
          hint="For a phone that stays at the rig as its controller. When the app is closed the board holds today's targets itself."
          value={keepAwake}
          onChange={async (v) => {
            setKeepAwake(v);
            await putMeta('_keep_awake', v);
            if (v) await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
            else deactivateKeepAwake(KEEP_AWAKE_TAG);
          }}
        />
      </Card>

      {/* ---------------- Board ---------------- */}
      <SectionTitle>Board</SectionTitle>
      <BoardPanel host={host} online={link.online} fw={r?.fw} onSaved={() => setTimeout(() => void pollNow(), 8000)} />

      {/* ---------------- Calibration ---------------- */}
      <SectionTitle>Calibration</SectionTitle>
      <Card style={{ gap: 14 }}>
        <Text style={[T.h3, { color: C.soot }]}>Water tank</Text>
        <Text style={[T.bodySm, { color: C.sootDim }]}>
          Distance from the ultrasonic sensor down to the water.
          {latest?.water_distance_cm != null ? ` Right now: ${latest.water_distance_cm.toFixed(1)} cm.` : ''}
        </Text>
        <Row>
          <Field label="Empty tank (cm)" value={val('tank_empty_distance_cm')} onChangeText={edit('tank_empty_distance_cm')} keyboardType="numeric" />
          <Field label="Full tank (cm)" value={val('tank_full_distance_cm')} onChangeText={edit('tank_full_distance_cm')} keyboardType="numeric" />
        </Row>
        {latest?.water_distance_cm != null && (
          <Row>
            <Button kind="onCard" label="Use now as empty" onPress={() => setDraft({ ...draft, tank_empty_distance_cm: latest.water_distance_cm!.toFixed(1) })} />
            <Button kind="onCard" label="Use now as full" onPress={() => setDraft({ ...draft, tank_full_distance_cm: latest.water_distance_cm!.toFixed(1) })} />
          </Row>
        )}
        <Field label="Tank floor area (cm²)" value={val('tank_area_cm2')} onChangeText={edit('tank_area_cm2')} keyboardType="numeric" hint="Inside length × width, e.g. 30 × 30 = 900." />
        <Row>
          <Field label="Refill below (%)" value={val('refill_below_pct')} onChangeText={edit('refill_below_pct')} keyboardType="numeric" />
          <Field label="Refill until (%)" value={val('refill_until_pct')} onChangeText={edit('refill_until_pct')} keyboardType="numeric" />
        </Row>
        <Button
          label="Save water tank"
          onPress={() => save('tank', ['tank_empty_distance_cm', 'tank_full_distance_cm', 'tank_area_cm2', 'refill_below_pct', 'refill_until_pct'])}
        />
        <Msg text={msg.tank} />

        <View style={{ height: 1, backgroundColor: C.sootLine, marginVertical: 4 }} />
        <Text style={[T.h3, { color: C.soot }]}>Soil probe</Text>
        <Text style={[T.bodySm, { color: C.sootDim }]}>
          Hold the probe in dry air and tap “Use now as dry”, then put it in a glass of water and tap “Use now as wet”.
          {latest?.soil_raw != null ? ` Right now: ${Math.round(latest.soil_raw)} raw (${soilPct(latest.soil_raw, s) ?? '–'}%).` : ''}
        </Text>
        <Row>
          <Field label="Dry reading" value={val('soil_dry_raw')} onChangeText={edit('soil_dry_raw')} keyboardType="numeric" />
          <Field label="Wet reading" value={val('soil_wet_raw')} onChangeText={edit('soil_wet_raw')} keyboardType="numeric" />
        </Row>
        {latest?.soil_raw != null && (
          <Row>
            <Button kind="onCard" label="Use now as dry" onPress={() => setDraft({ ...draft, soil_dry_raw: String(Math.round(latest.soil_raw!)) })} />
            <Button kind="onCard" label="Use now as wet" onPress={() => setDraft({ ...draft, soil_wet_raw: String(Math.round(latest.soil_raw!)) })} />
          </Row>
        )}
        <Button label="Save soil probe" onPress={() => save('soil', ['soil_dry_raw', 'soil_wet_raw'])} />
        <Msg text={msg.soil} />
      </Card>

      {/* ---------------- Grow ---------------- */}
      <SectionTitle>Grow</SectionTitle>
      <Card style={{ gap: 12 }}>
        <Text style={[T.body, { color: C.soot }]}>
          Planted {new Date(s.planted_at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} ({ago(s.planted_at)}).
        </Text>
        <Button
          kind="onCard"
          label="I planted today: restart the grow clock"
          onPress={() =>
            Alert.alert('Start a new grow?', 'Day 0 becomes today. Logged readings and alerts are cleared; photos are kept.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Start new grow',
                style: 'destructive',
                onPress: async () => {
                  await clearLogs();
                  await setSettings({ planted_at: Date.now() / 1000 });
                  await refresh();
                },
              },
            ])
          }
        />
        <ToggleRow
          label="Learn targets from this plant"
          hint="Off = fixed biology targets only (useful as a comparison run)."
          value={s.ml_enabled}
          onChange={async (v) => {
            await setSettings({ ml_enabled: v });
            await refresh();
          }}
        />
        <ToggleRow
          label="Daily small nudges"
          hint="Shifts targets a little each day so the model has variation to learn from."
          value={s.explore}
          onChange={async (v) => {
            await setSettings({ explore: v });
            await refresh();
          }}
        />
      </Card>

      <SectionTitle>Plant notes</SectionTitle>
      <Notes />
    </Screen>
  );
}

// ---------------- Board settings (stored on the ESP32) ----------------

type Draft = Record<string, string | boolean>;

const PIN_FIELDS: [string, string][] = [
  ['dht_pin', 'DHT data pin'],
  ['trig_pin', 'Ultrasonic TRIG pin'],
  ['echo_pin', 'Ultrasonic ECHO pin'],
  ['soil_pin', 'Soil probe pin (32-39)'],
  ['ph_pin', 'pH probe pin (32-39)'],
  ['tds_pin', 'TDS probe pin (32-39)'],
];
const RELAY_LABELS: Record<RelayKey, string> = {
  fan: 'Fan',
  light: 'Grow light',
  refill_pump: 'Refill pump',
  mister: 'Mister',
  heater: 'Heater',
  ph_down_ms: 'pH down pump',
  ph_up_ms: 'pH up pump',
  nutrient_ms: 'Nutrient pump',
};

function BoardPanel({ host, online, fw, onSaved }: { host: string; online: boolean; fw?: string; onSaved: () => void }) {
  const [cfg, setCfg] = useState<BoardConfig | null>(null);
  const [d, setD] = useState<Draft>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const supported = fw != null && Number.parseFloat(fw) >= 3;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCfg(await getBoardConfig(host));
      setD({});
    } catch (e) {
      setMsg(`Couldn't read the board's settings: ${e instanceof Error ? e.message : e}`);
    } finally {
      setLoading(false);
    }
  }, [host]);
  useFocusEffect(
    useCallback(() => {
      if (online && supported && !cfg) void load();
    }, [online, supported, cfg, load]),
  );

  if (!online)
    return (
      <Card>
        <Text style={[T.bodySm, { color: C.sootDim }]}>Link to the board to change its WiFi, sensors and pins.</Text>
      </Card>
    );
  if (!supported)
    return (
      <Card>
        <Text style={[T.bodySm, { color: C.sootDim }]}>
          This board runs firmware {fw ?? '?'}. Flash firmware 3.0 or newer once, and every board setting can be changed from here.
        </Text>
      </Card>
    );
  if (!cfg)
    return (
      <Card style={{ gap: 10 }}>
        <Text style={[T.bodySm, { color: C.sootDim }]}>{loading ? 'Reading the board’s settings…' : (msg ?? '')}</Text>
        {!loading && <Button kind="onCard" label="Try again" onPress={load} />}
      </Card>
    );

  const get = (k: string): string | boolean => {
    if (k in d) return d[k];
    if (k.startsWith('relay.')) return String(cfg.relay_pins[k.slice(6) as RelayKey]);
    const v = (cfg as unknown as Record<string, unknown>)[k];
    return typeof v === 'boolean' ? v : v == null ? '' : String(v);
  };
  const str = (k: string) => String(get(k));
  const set = (k: string) => (v: string | boolean) => setD((x) => ({ ...x, [k]: v }));
  const changed = Object.keys(d).length > 0;

  const submit = async () => {
    const out: Record<string, unknown> = {};
    const pins: Partial<Record<RelayKey, number>> = {};
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === 'boolean') out[k] = v;
      else if (k.startsWith('relay.')) {
        const n = Number.parseInt(v, 10);
        if (!Number.isFinite(n)) return setMsg(`${RELAY_LABELS[k.slice(6) as RelayKey]} pin must be a number (-1 = not fitted).`);
        pins[k.slice(6) as RelayKey] = n;
      } else if (typeof (cfg as unknown as Record<string, unknown>)[k] === 'number') {
        const n = Number(v.replace(',', '.'));
        if (!Number.isFinite(n)) return setMsg(`"${v}" isn't a number.`);
        out[k] = n;
      } else out[k] = v.trim();
    }
    if (Object.keys(pins).length) out.relay_pins = { ...cfg.relay_pins, ...pins };
    const apChanged = 'ap_ssid' in out || ('ap_pass' in out && out.ap_pass !== '');
    setSaving(true);
    setMsg(null);
    try {
      const next = await saveBoardConfig(host, out as Partial<BoardConfig>);
      setCfg(next);
      setD({});
      setMsg(
        apChanged
          ? `Saved. The board is restarting with WiFi "${next.ap_ssid}". Reconnect your phone to it in WiFi settings.`
          : 'Saved. The board is restarting; it will be back in about 10 seconds.',
      );
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const group = (id: string, title: string, summary: string, body: ReactNode) => (
    <View style={{ borderTopWidth: 1, borderTopColor: C.sootLine }}>
      <Pressable
        onPress={() => setOpen(open === id ? null : id)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open === id }}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 10 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[T.body, { color: C.soot, fontFamily: F.bodyBold }]}>{title}</Text>
          <Text style={[T.tiny, { color: C.sootDim }]} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        <View style={{ transform: [{ rotate: open === id ? '90deg' : '0deg' }] }}>
          <Icon name="chevron" color={C.soot} size={18} />
        </View>
      </Pressable>
      {open === id && <View style={{ gap: 12, paddingBottom: 16 }}>{body}</View>}
    </View>
  );

  const sensorsOn = (['dht', 'ultrasonic', 'soil', 'ph', 'tds'] as const).filter((k) => get(k) === true);

  return (
    <Card style={{ gap: 0 }}>
      <Text style={[T.bodySm, { color: C.sootDim, marginBottom: 10 }]}>
        Saved in the board’s memory. Saving restarts the board (about 10 s); wrong pins are refused before anything changes.
      </Text>

      {group(
        'ap',
        'Board WiFi',
        `${str('ap_ssid')} · the network the phone joins`,
        <>
          <Field label="Network name" value={str('ap_ssid')} onChangeText={set('ap_ssid')} autoCapitalize="none" autoCorrect={false} />
          <Field label="Password" value={str('ap_pass')} onChangeText={set('ap_pass')} placeholder="unchanged" secureTextEntry autoCapitalize="none" hint="At least 8 characters. After saving, rejoin the board's WiFi with the new details." />
        </>,
      )}

      {group(
        'sta',
        'Router or hotspot',
        cfg.sta_ssid ? `${cfg.sta_ssid}${cfg.server_url ? ' · dashboard ' + cfg.server_url : ''}` : 'off',
        <>
          <Text style={[T.tiny, { color: C.sootDim }]}>
            Optional. The board also joins this 2.4 GHz WiFi (a router, or this phone’s hotspot) while its own network keeps working, so the phone can reach it either way. Leave the name empty to turn it off.
          </Text>
          <Field label="Router WiFi name" value={str('sta_ssid')} onChangeText={set('sta_ssid')} autoCapitalize="none" autoCorrect={false} />
          <Field label="Router password" value={str('sta_pass')} onChangeText={set('sta_pass')} placeholder={cfg.sta_pass_set ? 'unchanged' : ''} secureTextEntry autoCapitalize="none" />
          <Field label="Dashboard address (optional)" value={str('server_url')} onChangeText={set('server_url')} placeholder="http://192.168.1.50:8000" autoCapitalize="none" autoCorrect={false} keyboardType="url" hint="Optional: a computer running the Hydro AI web dashboard. Leave empty; the app does everything itself." />
        </>,
      )}

      {group(
        'sensors',
        'Sensors',
        sensorsOn.length ? `${sensorsOn.join(', ')} · every ${str('interval_s')} s` : 'none fitted',
        <>
          <ToggleRow label="Air sensor (DHT)" value={get('dht') === true} onChange={set('dht')} />
          {get('dht') === true && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <CardChip label="DHT11 (blue)" on={str('dht_type') === '11'} onPress={() => set('dht_type')('11')} />
              <CardChip label="DHT22 (white)" on={str('dht_type') === '22'} onPress={() => set('dht_type')('22')} />
            </View>
          )}
          <ToggleRow label="Water level (ultrasonic)" value={get('ultrasonic') === true} onChange={set('ultrasonic')} />
          <ToggleRow label="Soil moisture probe" value={get('soil') === true} onChange={set('soil')} />
          <ToggleRow label="pH probe" value={get('ph') === true} onChange={set('ph')} />
          {get('ph') === true && (
            <Row>
              <Field label="Volts at pH 7" value={str('ph_neutral_v')} onChangeText={set('ph_neutral_v')} keyboardType="numeric" />
              <Field label="Volts per pH unit" value={str('ph_volts_per_unit')} onChangeText={set('ph_volts_per_unit')} keyboardType="numeric" />
            </Row>
          )}
          <ToggleRow label="TDS / EC probe" value={get('tds') === true} onChange={set('tds')} />
          <Field label="Take a reading every (seconds)" value={str('interval_s')} onChangeText={set('interval_s')} keyboardType="numeric" />
        </>,
      )}

      {group(
        'pins',
        'Wiring (GPIO pins)',
        `DHT ${str('dht_pin')} · TRIG ${str('trig_pin')} · ECHO ${str('echo_pin')} · soil ${str('soil_pin')}`,
        <>
          <Text style={[T.tiny, { color: C.sootDim }]}>The number printed next to D on the board (D18 = 18). Analog probes need 32-39.</Text>
          {PIN_FIELDS.map(([k, label]) => (
            <Field key={k} label={label} value={str(k)} onChangeText={set(k)} keyboardType="numeric" />
          ))}
        </>,
      )}

      {group(
        'relays',
        'Relays',
        RELAY_KEYS.filter((k) => cfg.relay_pins[k] >= 0).map((k) => `${RELAY_LABELS[k]} ${cfg.relay_pins[k]}`).join(' · ') || 'none fitted',
        <>
          <ToggleRow label="Relay board switches on LOW" hint="True for most blue relay modules. Flip it if everything is on when it should be off." value={get('relay_active_low') === true} onChange={set('relay_active_low')} />
          {RELAY_KEYS.map((k) => (
            <Field key={k} label={`${RELAY_LABELS[k]} pin (-1 = not fitted)`} value={str(`relay.${k}`)} onChangeText={set(`relay.${k}`)} keyboardType="numbers-and-punctuation" />
          ))}
        </>,
      )}

      <View style={{ gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.sootLine }}>
        <Button label={changed ? 'Save to board' : 'No changes'} onPress={submit} busy={saving} disabled={!changed} />
        {changed && <Button kind="onCard" label="Discard changes" onPress={() => setD({})} />}
        <Msg text={msg ?? undefined} />
        <Pressable
          onPress={() =>
            Alert.alert('Reset board settings?', 'WiFi, sensors and pins go back to what the firmware was built with. The board restarts.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Reset',
                style: 'destructive',
                onPress: async () => {
                  try {
                    setCfg(await resetBoardConfig(host));
                    setD({});
                    setMsg('Reset. The board is restarting.');
                    onSaved();
                  } catch (e) {
                    setMsg(e instanceof Error ? e.message : String(e));
                  }
                },
              },
            ])
          }
          style={{ alignSelf: 'center', padding: 8 }}
        >
          <Text style={[T.tiny, { color: C.sootDim, textDecorationLine: 'underline' }]}>Reset board settings</Text>
        </Pressable>
      </View>
    </Card>
  );
}

// ---------------- Small pieces ----------------

function Notes() {
  const [height, setHeight] = useState('');
  const [notes, setNotes] = useState('');
  const [obs, setObs] = useState<{ ts: number; height_cm: number | null; notes: string }[]>([]);
  useFocusEffect(
    useCallback(() => {
      void observations().then(setObs);
    }, []),
  );
  return (
    <Card style={{ gap: 12 }}>
      <Field label="Height (cm)" value={height} onChangeText={setHeight} keyboardType="numeric" />
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="New leaf, tip burn, moved the light…" multiline />
      <Button
        label="Add note"
        disabled={!height && !notes.trim()}
        onPress={async () => {
          const h = height ? Number(height.replace(',', '.')) : null;
          await addObservation(h != null && Number.isFinite(h) ? h : null, notes.trim());
          setHeight('');
          setNotes('');
          setObs(await observations());
        }}
      />
      {obs.map((o) => (
        <View key={o.ts} style={{ borderTopWidth: 1, borderTopColor: C.sootLine, paddingTop: 10 }}>
          <Text style={[T.tiny, { color: C.sootDim }]}>{ago(o.ts)}</Text>
          <Text style={[T.body, { color: C.soot }]}>
            {o.height_cm != null ? `${o.height_cm} cm. ` : ''}
            {o.notes}
          </Text>
        </View>
      ))}
    </Card>
  );
}

function BlinkButton({ host }: { host: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Button
      kind="onCard"
      label={text ?? 'Blink the board LED'}
      onPress={async () => {
        setText('Blinking…');
        try {
          await blinkLed(host, 5);
          setText('Blinked? Then this is your board.');
        } catch (e) {
          setText(`No answer: ${e instanceof Error ? e.message : e}`);
        }
      }}
    />
  );
}

function Row({ children }: { children: ReactNode }) {
  const kids = Array.isArray(children) ? children : [children];
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      {kids.map((c, i) => (
        <View key={i} style={{ flex: 1 }}>
          {c}
        </View>
      ))}
    </View>
  );
}

function Msg({ text }: { text?: string }) {
  return text ? <Text style={[T.bodySm, { color: C.soot, fontFamily: F.bodyMid }]}>{text}</Text> : null;
}

// Chip for ivory cards (the kit Chip is styled for the orange background).
function CardChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected: on }}
      style={{ borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', backgroundColor: on ? C.soot : 'transparent', borderWidth: 1.5, borderColor: C.soot }}
    >
      <Text style={{ fontFamily: F.bodyMid, fontSize: 13, color: on ? C.ivory : C.soot }}>{label}</Text>
    </Pressable>
  );
}

function uptime(sec: number) {
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`;
  return `${(sec / 86400).toFixed(1)} d`;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={[T.tiny, { color: C.sootDim }]}>{label}</Text>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.soot }}>{value}</Text>
    </View>
  );
}

