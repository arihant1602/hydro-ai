// The grow timeline: one segment per stage, sized by its length in days, with today's position marked.
import { Text, View } from 'react-native';

import type { Stage } from '../engine/profiles';
import { C, F } from './theme';

const NICE: Record<string, string> = {
  germination: 'Germination',
  seedling: 'Seedling',
  vegetative: 'Vegetative',
  reproductive: 'Tassel & silk',
  grain_fill: 'Grain fill',
};
export const stageName = (n: string) => NICE[n] ?? n.replace(/_/g, ' ');

/** `onDark`: ivory bars for use on the soft-black slab (the default is drawn for the orange ground). */
export function StageRibbon({ stages, day, onDark = false }: { stages: Stage[]; day: number; onDark?: boolean }) {
  const track = onDark ? 'rgba(230,213,189,0.26)' : 'rgba(16,16,16,0.22)';
  const done = onDark ? 'rgba(230,213,189,0.5)' : 'rgba(16,16,16,0.55)';
  const now = onDark ? C.ivory : C.soot;
  const total = stages[stages.length - 1].end_day + 1;
  const at = Math.min(day / total, 1);
  return (
    <View accessibilityLabel={`Day ${Math.floor(day)} of about ${total}`} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', height: 14, gap: 3 }}>
        {stages.map((s) => {
          const len = s.end_day - s.start_day + 1;
          const past = day > s.end_day + 1;
          const current = day >= s.start_day && day <= s.end_day + 0.999;
          const fill = current ? Math.min(1, (day - s.start_day) / len) : past ? 1 : 0;
          return (
            <View key={s.name} style={{ flex: len, borderRadius: 4, backgroundColor: track, overflow: 'hidden' }}>
              <View style={{ width: `${fill * 100}%`, height: '100%', backgroundColor: current ? now : done }} />
            </View>
          );
        })}
      </View>
      <View style={{ height: 16 }}>
        <Text
          style={{
            position: 'absolute',
            left: `${Math.min(at * 100, 82)}%`,
            fontFamily: F.bodyMid,
            fontSize: 12,
            color: C.ivory,
          }}
        >
          ▲ day {Math.floor(day)} of ~{total}
        </Text>
      </View>
    </View>
  );
}
