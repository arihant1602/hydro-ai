// Guided demo: walks through the whole system one step at a time against the linked ESP32. It won't start
// until the board answers, and holds on the current step if the board drops out midway.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOARD_AP_HOST } from '../lib/hydro';
import type { Photo } from '../lib/photos';
import { useHydro } from '../lib/store';
import { Beat, STEPS } from '../ui/DemoSteps';
import { Icon } from '../ui/icons';
import { Button } from '../ui/kit';
import { C, F, GUTTER, T } from '../ui/theme';

const DEMO_POLL_MS = 4000;

export default function Demo() {
  const { status, link, pollNow } = useHydro();
  const insets = useSafeAreaInsets();
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [checking, setChecking] = useState(false);
  const [leaf, setLeaf] = useState<Photo | null>(null);
  const scroll = useRef<ScrollView>(null);

  // Readings every few seconds while the demo is open, whatever the normal interval is.
  useEffect(() => {
    void pollNow();
    const t = setInterval(() => void pollNow(), DEMO_POLL_MS);
    return () => clearInterval(t);
  }, [pollNow]);

  useEffect(() => scroll.current?.scrollTo({ y: 0, animated: false }), [step, started]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const check = async () => {
    setChecking(true);
    await pollNow();
    setChecking(false);
  };

  const ready = link.online && !!status?.latest;
  const cur = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: C.ember, paddingTop: insets.top + 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: GUTTER, paddingBottom: 12 }}>
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close demo"
          style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: C.ivoryLine, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="close" color={C.ivory} size={18} />
        </Pressable>
        <Text style={T.label}>{started ? `Step ${step + 1} of ${STEPS.length}` : 'Demo'}</Text>
      </View>

      {started && (
        <View style={{ flexDirection: 'row', gap: 3, paddingHorizontal: GUTTER, paddingBottom: 4 }} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <View key={s.key} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i === step ? C.ivory : i < step ? 'rgba(230,213,189,0.5)' : C.ivoryLine }} />
          ))}
        </View>
      )}

      {started && !link.online && (
        <View style={{ marginHorizontal: GUTTER, marginTop: 10, backgroundColor: C.soot, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name="wifi" color={C.ivory} size={20} />
          <Text style={[T.bodySm, { color: C.ivory, flex: 1 }]}>Lost the board. Rejoin its WiFi to carry on.</Text>
          <Pressable onPress={check} disabled={checking} accessibilityRole="button">
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.ivory, textDecorationLine: 'underline' }}>{checking ? 'Checking…' : 'Retry'}</Text>
          </Pressable>
        </View>
      )}

      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: 16, paddingBottom: 24, gap: 16 }}>
        {!started ? (
          <Gate online={link.online} hasReading={!!status?.latest} host={link.host} error={link.error} />
        ) : (
          status && (
            <>
              <View style={{ gap: 8 }}>
                <Text style={T.tiny}>{cur.kicker.toUpperCase()}</Text>
                <Text style={T.h1}>{cur.title}</Text>
                <Text style={T.body}>{cur.body}</Text>
              </View>
              <cur.View key={cur.key} st={status} link={link} leaf={leaf} setLeaf={setLeaf} goTo={setStep} />
            </>
          )
        )}
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: GUTTER, paddingTop: 12, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: C.ivoryLine }}>
        {!started ? (
          <View style={{ flex: 1 }}>
            {ready ? (
              <Button label="Start the demo" onPress={() => setStarted(true)} />
            ) : (
              <Button label={checking ? 'Looking for the board…' : 'Check again'} busy={checking} onPress={check} />
            )}
          </View>
        ) : (
          <>
            {step > 0 && (
              <View style={{ flex: 1 }}>
                <Button kind="quiet" label="Back" onPress={() => setStep(step - 1)} />
              </View>
            )}
            <View style={{ flex: 2 }}>
              <Button label={last ? 'Finish' : 'Next'} disabled={!last && !link.online} onPress={() => (last ? close() : setStep(step + 1))} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/** Shown until the board answers: what to do, and where the phone is looking. */
function Gate({ online, hasReading, host, error }: { online: boolean; hasReading: boolean; host: string | null; error: string | null }) {
  return (
    <>
      <View style={{ gap: 8 }}>
        <Text style={T.tiny}>DEMO</Text>
        <Text style={T.h1}>{online ? 'Board linked' : 'Connect the board first'}</Text>
        <Text style={T.body}>
          The demo runs live against the ESP32, so the phone has to reach it before it starts.
        </Text>
      </View>
      <View style={{ gap: 8 }}>
        <Beat n={1} title="Power the ESP32" detail="USB or the rig’s supply. Its WiFi comes up in a few seconds." on={false} />
        <Beat
          n={2}
          title="Join its WiFi"
          detail="HydroAI-… in the phone’s WiFi settings. If Android warns there’s no internet, choose to stay connected."
          on={!online}
        />
        <Beat
          n={3}
          title={online ? `Found it at ${host}` : 'Phone finds the board'}
          detail={
            online
              ? hasReading
                ? 'Linked and reading. Ready to start.'
                : 'Linked; waiting for its first reading.'
              : `Looking at ${host ?? BOARD_AP_HOST} and the board’s last address${error ? `: ${error}` : ''}.`
          }
          value={online ? 'live' : undefined}
          on={online}
        />
      </View>
    </>
  );
}
