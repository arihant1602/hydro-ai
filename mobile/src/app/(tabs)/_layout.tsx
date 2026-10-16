import { Tabs } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHydro } from '../../lib/store';
import { Icon, type IconName } from '../../ui/icons';
import { C, F } from '../../ui/theme';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'sprout' },
  { name: 'trends', title: 'Trends', icon: 'trend' },
  { name: 'leaf', title: 'Leaf check', icon: 'leaf' },
  { name: 'ask', title: 'Ask', icon: 'ask' },
  { name: 'settings', title: 'Settings', icon: 'rig' },
];

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.ember } }} tabBar={(p) => <TabBar {...p} />}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title }} />
      ))}
    </Tabs>
  );
}

// Ivory bar; the current tab is a soft-black pill. The Grow tab carries a dot while an alert is active.
function TabBar({ state, navigation }: { state: { index: number; routes: { key: string; name: string }[] }; navigation: { navigate: (n: string) => void } }) {
  const insets = useSafeAreaInsets();
  const { status } = useHydro();
  const alerting = (status?.alerts.length ?? 0) > 0;
  return (
    <View style={{ backgroundColor: C.ivory, paddingBottom: insets.bottom + 6, paddingTop: 8, paddingHorizontal: 8, flexDirection: 'row' }}>
      {state.routes.map((route, i) => {
        const tab = TABS.find((t) => t.name === route.name)!;
        const focused = state.index === i;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.title}
            onPress={() => navigation.navigate(route.name)}
            style={{ flex: 1, alignItems: 'center', gap: 3 }}
          >
            {/* Always a real background (ivory = the bar) rather than 'transparent': on Android a background that
                first appears on re-render can lose its corner radius, which left the active pill square. */}
            <View style={{ backgroundColor: focused ? C.soot : C.ivory, borderRadius: 17, overflow: 'hidden', paddingHorizontal: 16, paddingVertical: 6 }}>
              <Icon name={tab.icon} color={focused ? C.ivory : C.emberDeep} size={22} />
              {tab.name === 'index' && alerting && (
                <View style={{ position: 'absolute', top: 3, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: C.ember, borderWidth: 1.5, borderColor: focused ? C.soot : C.ivory }} />
              )}
            </View>
            <Text style={{ fontFamily: focused ? F.bodyBold : F.bodyMid, fontSize: 12, color: focused ? C.soot : C.emberDeep }}>{tab.title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
