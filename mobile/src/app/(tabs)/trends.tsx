// Trends: every sensor on its own chart (one scale per chart), stage target shaded. "Live" shows the last
// 15 minutes reading by reading and redraws as each new reading lands.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import type { Day } from '../../engine/optimizer';
import { soilPct } from '../../engine/types';
import { dailyHistory, series, type SeriesKey, type SeriesRow } from '../../lib/hydro';
import { growthSeries } from '../../lib/photos';
import { useHydro } from '../../lib/store';
import { ago } from '../../ui/format';
import { LineChart, type Point } from '../../ui/LineChart';
import { Chip, Empty, Screen, SectionTitle } from '../../ui/kit';
import { C, T } from '../../ui/theme';

const RANGES = [
  { label: 'Live', hours: 0.25 },
  { label: '1 h', hours: 1 },
  { label: '24 h', hours: 24 },
  { label: '7 days', hours: 168 },
];

export default function Trends() {
  const { status, link } = useHydro();
  const [hours, setHours] = useState(0.25);
  const [rows, setRows] = useState<SeriesRow[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [growth, setGrowth] = useState<{ ts: number; canopy_pct: number }[]>([]);

  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const latestTs = status?.latest?.ts;
  // Reload on focus, on a range change, and whenever a new reading lands while this tab is open.
  useEffect(() => {
    if (!focused) return;
    let live = true;
    void (async () => {
      const [r, d, g] = await Promise.all([series(hours), dailyHistory(), growthSeries()]);
      if (!live) return;
      setRows(r);
      setDays(d);
      setGrowth(g);
    })();
    return () => {
      live = false;
    };
  }, [focused, hours, latestTs]);

  if (!status) return <Screen>{null}</Screen>;
  const { settings: s, rec } = status;
  const stage = rec.stage;
  const pts = (k: SeriesKey, f: (v: number) => number | null = (v) => v): Point[] =>
    rows.map((r) => ({ t: r.ts, v: r[k] == null ? null : f(r[k]!) }));
  const has = (k: SeriesKey) => rows.some((r) => r[k] != null);
  const lastRaw = (k: SeriesKey) => [...rows].reverse().find((r) => r[k] != null)?.[k] ?? null;
  const plantedAt = s.planted_at;
  const isLive = hours < 1;

  return (
    <Screen>
      <Text style={T.h1}>Trends</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {RANGES.map((r) => (
          <Chip key={r.hours} label={r.label} on={hours === r.hours} onPress={() => setHours(r.hours)} />
        ))}
      </View>
      {isLive && (
        <Text style={T.tiny}>
          {link.online ? `Live · new reading every ${link.report?.interval_s ?? s.poll_s} s · last ${ago(latestTs)}` : `Board offline · last reading ${ago(latestTs)}`}
        </Text>
      )}

      {rows.length < 2 ? (
        <Empty
          title={isLive ? 'Waiting for readings' : 'Nothing to chart yet'}
          body={
            link.online
              ? 'The board is linked. A chart needs two readings, so give it a few seconds.'
              : 'Charts fill in once the phone is linked to the board. Check the connection in Settings.'
          }
        />
      ) : (
        <>
          {has('air_temp') && <LineChart title="Air temperature" unit="°C" points={pts('air_temp')} band={stage.air_temp_c} />}
          {has('humidity') && <LineChart title="Humidity" unit="%" digits={0} points={pts('humidity')} band={stage.humidity_pct} />}
          {has('water_level_pct') && (
            <LineChart
              title="Water tank"
              unit="%"
              digits={0}
              points={pts('water_level_pct')}
              caption={`Sensor to water ${lastRaw('water_distance_cm')?.toFixed(1) ?? '–'} cm · refills below ${s.refill_below_pct}%`}
            />
          )}
          {has('soil_raw') && (
            <LineChart
              title="Soil moisture"
              unit="%"
              digits={0}
              points={pts('soil_raw', (v) => soilPct(v, s))}
              caption={`Probe reads ${Math.round(lastRaw('soil_raw') ?? 0)} raw · dry ${s.soil_dry_raw}, wet ${s.soil_wet_raw}`}
            />
          )}
          {has('ph') && <LineChart title="pH" unit="" digits={2} points={pts('ph')} band={stage.ph} />}
          {has('ec') && <LineChart title="EC" unit=" mS/cm" digits={2} points={pts('ec')} band={stage.ec_ms_cm} />}
        </>
      )}

      {days.length >= 2 && (
        <>
          <SectionTitle>Water drunk per day</SectionTitle>
          <LineChart title="Uptake" unit=" L" digits={2} points={days.map((d) => ({ t: plantedAt + (d.day + 0.5) * 86400, v: d.uptake_l }))} />
        </>
      )}
      {growth.length >= 2 && (
        <LineChart title="Canopy cover (photos)" unit="%" points={growth.map((g) => ({ t: g.ts, v: g.canopy_pct }))} />
      )}
      <Text style={[T.tiny, { color: C.ivoryDim }]}>Press and drag on a chart to read exact values.</Text>
    </Screen>
  );
}
