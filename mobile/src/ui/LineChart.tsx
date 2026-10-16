// One-series time chart on an ivory card: 2px soft-black line, the stage target range shaded behind it,
// recessive gridlines, and press-and-drag to read exact values.
import { useMemo, useState } from 'react';
import { Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { C, F, T } from './theme';

export interface Point {
  t: number; // epoch s
  v: number | null;
}

const H = 150;
const PAD = { l: 36, r: 10, t: 10, b: 22 };

function fmtTime(t: number, spanH: number) {
  const d = new Date(t * 1000);
  if (spanH > 48) return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function LineChart({
  title,
  unit,
  points,
  band,
  digits = 1,
  caption,
}: {
  title: string;
  unit: string;
  points: Point[];
  band?: [number, number];
  digits?: number;
  /** Replaces the default line under the title (target band / "Latest reading"). */
  caption?: string;
}) {
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const pts = points.filter((p): p is { t: number; v: number } => p.v != null);

  const geo = useMemo(() => {
    if (pts.length < 2 || !w) return null;
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    let lo = Math.min(...pts.map((p) => p.v), band?.[0] ?? Infinity);
    let hi = Math.max(...pts.map((p) => p.v), band?.[1] ?? -Infinity);
    const padV = (hi - lo || 1) * 0.12;
    lo -= padV;
    hi += padV;
    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (w - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    let d = '';
    pts.forEach((p, i) => {
      // Break the line across gaps (phone away and nothing buffered) instead of drawing a false straight run.
      const gap = i > 0 && p.t - pts[i - 1].t > ((t1 - t0) / pts.length) * 6;
      d += `${i === 0 || gap ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    });
    // A flat series gives three identical ticks; keep one.
    const ticks = [...new Set([lo + padV, (lo + hi) / 2, hi - padV].map((v) => +v.toFixed(4)))];
    return { x, y, d, ticks, t0, t1, spanH: (t1 - t0) / 3600 };
  }, [pts, w, band]);

  const latest = pts[pts.length - 1];
  const shown = hover != null ? pts[hover] : latest;

  const scrub = (e: GestureResponderEvent) => {
    if (!geo) return;
    const px = e.nativeEvent.locationX;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(geo.x(pts[i].t) - px) < Math.abs(geo.x(pts[best].t) - px)) best = i;
    setHover(best);
  };

  return (
    <View style={{ backgroundColor: C.ivory, borderRadius: 22, padding: 16, gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={[T.h3, { color: C.soot }]}>{title}</Text>
        <Text style={{ fontFamily: F.display, fontSize: 22, color: C.soot }}>
          {shown ? `${shown.v.toFixed(digits)}${unit}` : '–'}
        </Text>
      </View>
      <Text style={[T.tiny, { color: C.sootDim, marginTop: -6 }]}>
        {hover != null && shown
          ? new Date(shown.t * 1000).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
          : caption ?? (band ? `Shaded: stage target ${band[0]}–${band[1]}${unit}` : 'Latest reading')}
      </Text>
      <View
        onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={scrub}
        onResponderMove={scrub}
        onResponderRelease={() => setHover(null)}
        onResponderTerminate={() => setHover(null)}
        style={{ height: H }}
        accessibilityLabel={`${title} chart, latest ${latest ? latest.v.toFixed(digits) + unit : 'no data'}`}
      >
        {geo ? (
          <Svg width={w} height={H}>
            {band && (
              <Rect
                x={PAD.l}
                width={w - PAD.l - PAD.r}
                y={geo.y(band[1])}
                height={Math.max(0, geo.y(band[0]) - geo.y(band[1]))}
                fill={C.emberSoft}
                opacity={0.22}
                rx={4}
              />
            )}
            {geo.ticks.map((v) => (
              <Line key={v} x1={PAD.l} x2={w - PAD.r} y1={geo.y(v)} y2={geo.y(v)} stroke={C.sootLine} strokeWidth={1} />
            ))}
            <Path d={geo.d} stroke={C.soot} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {hover != null && (
              <>
                <Line x1={geo.x(pts[hover].t)} x2={geo.x(pts[hover].t)} y1={PAD.t} y2={H - PAD.b} stroke={C.sootDim} strokeWidth={1} />
                <Circle cx={geo.x(pts[hover].t)} cy={geo.y(pts[hover].v)} r={5} fill={C.ember} stroke={C.ivory} strokeWidth={2} />
              </>
            )}
          </Svg>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={[T.bodySm, { color: C.sootDim }]}>Not enough readings in this range yet.</Text>
          </View>
        )}
        {geo &&
          geo.ticks.map((v) => (
            <Text key={v} style={{ position: 'absolute', left: 0, top: geo.y(v) - 8, width: PAD.l - 6, textAlign: 'right', fontFamily: F.body, fontSize: 11, color: C.sootDim }}>
              {v.toFixed(geo.ticks[geo.ticks.length - 1] - geo.ticks[0] < 6 ? Math.max(1, Math.min(digits, 2)) : 0)}
            </Text>
          ))}
        {geo && (
          <>
            <Text style={{ position: 'absolute', left: PAD.l, bottom: 0, fontFamily: F.body, fontSize: 11, color: C.sootDim }}>{fmtTime(geo.t0, geo.spanH)}</Text>
            <Text style={{ position: 'absolute', right: PAD.r, bottom: 0, fontFamily: F.body, fontSize: 11, color: C.sootDim }}>{fmtTime(geo.t1, geo.spanH)}</Text>
          </>
        )}
      </View>
    </View>
  );
}
