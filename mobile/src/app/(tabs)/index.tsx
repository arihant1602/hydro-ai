// Home: how the plant is doing right now. One verdict, one tile per sensor, the last leaf check, and what
// the rig is switching. Everything else lives on Trends / Settings.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { load as loadProfile } from '../../engine/profiles';
import { soilPct } from '../../engine/types';
import { listPhotos, type Photo } from '../../lib/photos';
import { useHydro } from '../../lib/store';
import { ago, verdictWord } from '../../ui/format';
import { Icon, type IconName } from '../../ui/icons';
import { Card, Screen, SectionTitle } from '../../ui/kit';
import { StageRibbon, stageName } from '../../ui/StageRibbon';
import { C, F, T } from '../../ui/theme';

const RELAYS: { key: string; label: string; icon: IconName }[] = [
  { key: 'fan', label: 'Fan', icon: 'fan' },
  { key: 'light', label: 'Light', icon: 'sun' },
  { key: 'refill_pump', label: 'Pump', icon: 'drop' },
  { key: 'mister', label: 'Mister', icon: 'mist' },
  { key: 'heater', label: 'Heater', icon: 'heat' },
];

export default function Home() {
  const { status, link, pollNow } = useHydro();
  const [refreshing, setRefreshing] = useState(false);
  const [leaf, setLeaf] = useState<Photo | null>(null);
  const [leafFresh, setLeafFresh] = useState(false);
  useFocusEffect(
    useCallback(() => {
      void listPhotos(1).then((p) => {
        setLeaf(p[0] ?? null);
        setLeafFresh(!!p[0]?.analysis && Date.now() / 1000 - p[0].ts < 3 * 86400); // only a recent check counts
      });
    }, []),
  );
  if (!status) return <Screen>{null}</Screen>;

  const { rec, latest, day, settings } = status;
  const stage = rec.stage;
  const sensors = link.report?.sensors;
  const fitted = (k: 'dht' | 'ultrasonic' | 'soil' | 'ph' | 'tds', v: unknown) => (sensors ? sensors[k] : v != null);

  const tiles: TileSpec[] = [];
  if (latest) {
    if (fitted('dht', latest.air_temp)) {
      tiles.push({ field: 'air_temp', label: 'Air', icon: 'thermo', value: latest.air_temp, unit: '°C', digits: 1, range: stage.air_temp_c });
      tiles.push({ field: 'humidity', label: 'Humidity', icon: 'humidity', value: latest.humidity, unit: '%', digits: 0, range: stage.humidity_pct });
    }
    if (fitted('ultrasonic', latest.water_distance_cm))
      tiles.push({
        field: 'water',
        label: 'Water tank',
        icon: 'drop',
        value: latest.water_level_pct,
        unit: '%',
        digits: 0,
        range: [settings.refill_below_pct, 100],
        note: latest.water_liters != null ? `${latest.water_liters.toFixed(1)} L` : undefined,
      });
    if (fitted('soil', latest.soil_raw))
      tiles.push({
        field: 'soil',
        label: 'Soil moisture',
        icon: 'soil',
        value: soilPct(latest.soil_raw, settings),
        unit: '%',
        digits: 0,
        note: latest.soil_raw != null ? `raw ${Math.round(latest.soil_raw)}` : undefined,
      });
    if (fitted('ph', latest.ph)) tiles.push({ field: 'ph', label: 'pH', icon: 'bolt', value: latest.ph, unit: '', digits: 2, range: stage.ph });
    if (fitted('tds', latest.ec)) tiles.push({ field: 'ec', label: 'EC', icon: 'bolt', value: latest.ec, unit: ' mS', digits: 2, range: stage.ec_ms_cm });
  }

  // Readings out of range right now, unless an alert already says so (alert keys start with the field name).
  const alerted = (f: string) => status.alerts.some((a) => a.key.startsWith(f));
  const offTiles = tiles
    .filter((t) => t.value != null && t.range && (t.value < t.range[0] || t.value > t.range[1]) && !alerted(t.field))
    .map((t) => `${t.label} ${t.value!.toFixed(t.digits)}${t.unit.trim() === '' ? '' : t.unit.trim()} is ${t.value! < t.range![0] ? 'below' : 'above'} ${t.range![0]}–${t.range![1]}.`);
  const state = plantState(status, leafFresh ? leaf : null, link.online, offTiles);

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await pollNow();
        setRefreshing(false);
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={T.label}>
          {status.cropName} · day {Math.floor(day)} · {stageName(stage.name)}
        </Text>
        <LinkPill online={link.online} lastSeen={link.lastSeen} />
      </View>

      <View style={{ backgroundColor: C.soot, borderRadius: 28, padding: 22, gap: 14 }} accessibilityLiveRegion="polite">
        <Text style={[T.tiny, { color: 'rgba(230,213,189,0.7)' }]}>YOUR PLANT</Text>
        <Text style={{ fontFamily: F.display, fontSize: 44, lineHeight: 46, letterSpacing: -1.2, color: state.tone === 'bad' ? C.emberSoft : C.ivory }}>
          {state.word}
        </Text>
        {state.reasons.map((r) => (
          <Text key={r} style={[T.bodySm, { color: C.ivory }]}>
            {r}
          </Text>
        ))}
        <View style={{ marginTop: 4 }}>
          <StageRibbon stages={loadProfile(settings.crop).stages} day={day} onDark />
        </View>
      </View>

      {tiles.length > 0 && (
        <>
          <SectionTitle aside={<Text style={T.tiny}>{latest ? `updated ${ago(latest.ts)}` : ''}</Text>}>Right now</SectionTitle>
          <View style={{ gap: 10 }}>
            {Array.from({ length: Math.ceil(tiles.length / 2) }, (_, i) => tiles.slice(2 * i, 2 * i + 2)).map((pair) => (
              <View key={pair[0].label} style={{ flexDirection: 'row', gap: 10 }}>
                {pair.map((t) => (
                  <Tile key={t.label} {...t} />
                ))}
                {pair.length === 1 && <View style={{ flex: 1 }} />}
              </View>
            ))}
          </View>
        </>
      )}

      <Pressable onPress={() => router.navigate('/leaf')} accessibilityRole="button" accessibilityLabel="Leaf check">
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {leaf ? (
            <Image source={{ uri: leaf.file }} style={{ width: 64, height: 64, borderRadius: 14, backgroundColor: C.soot }} />
          ) : (
            <View style={{ width: 64, height: 64, borderRadius: 14, backgroundColor: C.soot, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="camera" color={C.ivory} size={26} />
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[T.tiny, { color: C.sootDim }]}>Leaf check{leaf ? ` · ${ago(leaf.ts)}` : ''}</Text>
            <Text style={{ fontFamily: F.display, fontSize: 20, color: C.soot }}>
              {leaf?.analysis ? verdictWord(leaf.analysis.verdict) : 'Photograph the leaves'}
            </Text>
          </View>
          <Icon name="chevron" color={C.soot} size={20} />
        </Card>
      </Pressable>

      <Pressable onPress={() => router.push('/demo')} accessibilityRole="button" accessibilityLabel="Run the demo">
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 64, height: 64, borderRadius: 14, backgroundColor: C.soot, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="play" color={C.ivory} size={26} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[T.tiny, { color: C.sootDim }]}>Demo · {link.online ? 'board linked' : 'link the board first'}</Text>
            <Text style={{ fontFamily: F.display, fontSize: 20, color: C.soot }}>See it all, step by step</Text>
          </View>
          <Icon name="chevron" color={C.soot} size={20} />
        </Card>
      </Pressable>

      <SectionTitle aside={<Text style={T.tiny}>{controllerText(link.report?.controller, link.online)}</Text>}>Equipment</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {RELAYS.map((r) => {
          const on = !!status.actuators[r.key];
          return (
            <View
              key={r.key}
              accessibilityLabel={`${r.label} ${on ? 'on' : 'off'}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: on ? C.soot : 'transparent',
                borderWidth: 1.5,
                borderColor: on ? C.soot : C.ivoryLine,
              }}
            >
              <Icon name={r.icon} color={on ? C.ivory : C.ivoryDim} size={16} />
              <Text style={{ fontFamily: F.bodyMid, fontSize: 13, color: on ? C.ivory : C.ivoryDim }}>{r.label}</Text>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

type Tone = 'good' | 'warn' | 'bad' | 'idle';

function plantState(
  status: NonNullable<ReturnType<typeof useHydro>['status']>,
  leaf: Photo | null,
  online: boolean,
  outOfRange: string[],
): { word: string; tone: Tone; reasons: string[] } {
  if (!status.latest)
    return {
      word: 'Waiting for data',
      tone: 'idle',
      reasons: [
        online
          ? 'The board is linked; its first reading is on the way.'
          : "Not linked to the board yet. Join its WiFi (HydroAI-…) or set its address in Settings.",
      ],
    };
  const crit = status.alerts.filter((a) => a.severity === 'critical');
  const warn = status.alerts.filter((a) => a.severity !== 'critical');
  const leafBad = leaf?.analysis?.verdict === 'needs attention';
  const reasons = [...crit.map((a) => a.message), ...outOfRange, ...warn.map((a) => a.message)];
  if (leafBad) reasons.push(leaf!.analysis!.issues[0]?.[1] ?? 'The last leaf check found a problem.');
  const top = [...new Set(reasons)].slice(0, 3);
  if (crit.length) return { word: 'Needs you now', tone: 'bad', reasons: top };
  if (warn.length || leafBad || outOfRange.length) return { word: 'Needs attention', tone: 'warn', reasons: top };
  return {
    word: 'Doing well',
    tone: 'good',
    reasons: [`Everything is inside the ${stageName(status.rec.stage.name).toLowerCase()} targets.`],
  };
}

interface TileSpec {
  field: string;
  label: string;
  icon: IconName;
  value: number | null | undefined;
  unit: string;
  digits: number;
  range?: [number, number];
  note?: string;
}

function Tile({ label, icon, value, unit, digits, range, note }: Omit<TileSpec, 'field'>) {
  const low = value != null && range && value < range[0];
  const high = value != null && range && value > range[1];
  const off = low || high;
  const fg = off ? C.ivory : C.soot;
  const dim = off ? C.ivoryDim : C.sootDim;
  const sub = value == null ? 'no reading' : low ? `low · aim ${range![0]}–${range![1]}` : high ? `high · aim ${range![0]}–${range![1]}` : range ? `ok · ${range[0]}–${range[1]}` : (note ?? '');
  return (
    <Pressable
      onPress={() => router.navigate('/trends')}
      accessibilityLabel={`${label} ${value == null ? 'no reading' : value.toFixed(digits) + unit}`}
      style={{ flex: 1, backgroundColor: off ? C.soot : C.ivory, borderRadius: 22, padding: 16, gap: 6 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={icon} color={dim} size={16} />
        <Text style={[T.tiny, { color: dim }]}>{label}</Text>
      </View>
      <Text style={{ fontFamily: F.display, fontSize: 36, lineHeight: 38, letterSpacing: -1, color: fg }}>
        {value == null ? '–' : value.toFixed(digits)}
        <Text style={{ fontSize: 18 }}>{unit}</Text>
      </Text>
      <Text style={[T.tiny, { color: off ? C.emberSoft : dim }]} numberOfLines={1}>
        {sub}
        {range && note && !off ? ` · ${note}` : ''}
      </Text>
    </Pressable>
  );
}

function LinkPill({ online, lastSeen }: { online: boolean; lastSeen: number | null }) {
  return (
    <Pressable
      onPress={() => router.navigate('/settings')}
      accessibilityLabel={online ? 'Board linked' : 'Board not linked'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: online ? C.soot : 'transparent', borderWidth: 1.5, borderColor: online ? C.soot : C.ivoryLine }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: online ? '#7ad36b' : C.ivoryDim }} />
      <Text style={{ fontFamily: F.bodyMid, fontSize: 12, color: C.ivory }}>{online ? 'Live' : lastSeen ? `Offline · ${ago(lastSeen)}` : 'Offline'}</Text>
    </Pressable>
  );
}

function controllerText(c: string | undefined, online: boolean) {
  if (!online) return 'board runs on its own';
  return c === 'server' ? 'run by the web dashboard' : 'run by this phone';
}
