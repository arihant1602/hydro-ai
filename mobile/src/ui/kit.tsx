// Building blocks shared by the screens.
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C, F, GUTTER, RADIUS, T } from './theme';

export function Screen({
  children,
  onRefresh,
  refreshing = false,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.ember }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: C.ember }}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 32, paddingHorizontal: GUTTER, gap: 20 }}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.ivory} colors={[C.soot]} />
          ) : undefined
        }
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {/* Scrim so scrolled content doesn't run under the status bar icons. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: C.ember }}
      />
    </View>
  );
}

/** Ivory card on the orange ground. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

/** The soft-black slab: reserved for the live readings, the thing to look at first. */
export function Slab({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.slab, style]}>{children}</View>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <View style={s.sectionRow}>
      <Text style={T.h3}>{children}</Text>
      {aside}
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'quiet' | 'onCard';
  busy?: boolean;
  disabled?: boolean;
}) {
  const fg = kind === 'primary' ? C.ivory : C.soot;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.button,
        kind === 'primary' && { backgroundColor: pressed ? '#2a2a2a' : C.soot },
        kind === 'quiet' && { backgroundColor: pressed ? C.ivoryDim : C.ivory },
        kind === 'onCard' && { borderWidth: 1.5, borderColor: C.soot, backgroundColor: pressed ? C.sootLine : 'transparent' },
        (disabled || busy) && { opacity: 0.55 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityState={{ selected: on }}
      style={[s.chip, on ? { backgroundColor: C.soot, borderColor: C.soot } : { borderColor: C.ivoryLine }]}
    >
      <Text style={[s.chipText, { color: on ? C.ivory : C.ivoryDim }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[T.label, { color: C.sootDim }]}>{label}</Text>
      <TextInput placeholderTextColor={C.sootDim} {...props} style={[s.input, props.style]} />
      {hint ? <Text style={[T.tiny, { color: C.sootDim }]}>{hint}</Text> : null}
    </View>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={s.toggleRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.body, { color: C.soot, fontFamily: F.bodyMid }]}>{label}</Text>
        {hint ? <Text style={[T.tiny, { color: C.sootDim }]}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: C.sootLine, true: C.soot }}
        thumbColor={value ? C.ember : '#f6efe4'}
      />
    </View>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <Card style={{ gap: 6 }}>
      <Text style={[T.h3, { color: C.soot }]}>{title}</Text>
      <Text style={[T.bodySm, { color: C.sootDim }]}>{body}</Text>
    </Card>
  );
}

export const s = StyleSheet.create({
  card: { backgroundColor: C.ivory, borderRadius: RADIUS.card, padding: 18 },
  slab: { backgroundColor: C.soot, borderRadius: RADIUS.slab, padding: 20 },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: -8 },
  button: { minHeight: 52, borderRadius: RADIUS.chip, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  buttonText: { fontFamily: F.bodyBold, fontSize: 16 },
  chip: {
    borderWidth: 1.5,
    borderRadius: RADIUS.chip,
    paddingVertical: 9,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipText: { fontFamily: F.bodyMid, fontSize: 14 },
  input: {
    backgroundColor: '#f2e7d6',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: F.body,
    fontSize: 16,
    color: C.soot,
    borderWidth: 1,
    borderColor: C.sootLine,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
});
