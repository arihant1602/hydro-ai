// Leaf check: photograph a leaf (or pick a photo, or try a bundled sample). The phone runs the colour analysis
// and the leaf disease model on the spot and shows what it saw. Nothing leaves the phone.
import { useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { LEAF_SAMPLES, SAMPLE_CREDIT, type LeafSample } from '../../data/leaf_samples';
import { CONFIDENT, DISEASES, diseaseOf, MODEL_INFO } from '../../engine/leafModel';
import { addPhoto, analyseSample, deletePhoto, listPhotos, type Photo } from '../../lib/photos';
import { useHydro } from '../../lib/store';
import { CameraSheet } from '../../ui/CameraSheet';
import { ago, verdictWord } from '../../ui/format';
import { Button, Card, Empty, Screen, SectionTitle } from '../../ui/kit';
import { stageName } from '../../ui/StageRibbon';
import { TreatmentPlan } from '../../ui/TreatmentPlan';
import { C, F, T } from '../../ui/theme';

export default function LeafCheck() {
  const { refresh } = useHydro();
  const [perm, requestPerm] = useCameraPermissions();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selected, setSelected] = useState<Photo | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [aspect, setAspect] = useState<Record<string, number>>({});
  // Set while the result on screen is a bundled sample (it isn't in the photo history).
  const [sample, setSample] = useState<LeafSample | null>(null);
  const [sampleBusy, setSampleBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const ps = await listPhotos();
    setPhotos(ps);
    setSelected((cur) => (cur?.id === -1 ? cur : cur ? (ps.find((p) => p.id === cur.id) ?? ps[0] ?? null) : (ps[0] ?? null)));
  }, []);
  useFocusEffect(
    useCallback(() => {
      void reload();
      return () => setCameraOpen(false); // release the camera when leaving the tab
    }, [reload]),
  );

  // Shared by the camera and the gallery: analyse, show the result, refresh alerts.
  const analyse = async (uri: string, w: number, h: number) => {
    const p = await addPhoto(uri, w, h);
    setSample(null);
    setSelected(p);
    setShowOverlay(false);
    await reload();
    await refresh();
  };

  const openCamera = async () => {
    setError(null);
    if (!perm?.granted) {
      const r = await requestPerm();
      if (!r.granted) {
        setError(r.canAskAgain ? 'Camera permission is needed to take a photo.' : 'Camera is blocked for this app. Allow it in system settings.');
        return;
      }
    }
    setCameraOpen(true);
  };

  const pickFromGallery = async () => {
    setError(null);
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const a = r.canceled ? null : r.assets[0];
    if (!a) return;
    setCameraOpen(false);
    setImporting(true);
    try {
      await analyse(a.uri, a.width, a.height);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const trySample = async (s: LeafSample) => {
    setError(null);
    setSampleBusy(s.id);
    try {
      const p = await analyseSample(s);
      setSample(s);
      setSelected(p);
      setShowOverlay(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSampleBusy(null);
    }
  };

  const a = selected?.analysis;
  const shown = selected ? (showOverlay && selected.overlay ? selected.overlay : selected.file) : null;
  const blocked = perm?.granted === false && !perm.canAskAgain;

  return (
    <Screen>
      <Text style={T.h1}>Leaf check</Text>
      <Text style={T.bodySm}>
        One leaf filling the frame, light behind you. The phone checks leaf colour (yellowing, purpling, pale leaves) and a disease model looks
        for common rust, northern leaf blight and gray leaf spot.
      </Text>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label={blocked ? 'Allow camera in settings' : 'Take photo'} onPress={blocked ? () => void Linking.openSettings() : openCamera} />
        </View>
        <Button label="Gallery" kind="quiet" onPress={pickFromGallery} busy={importing} />
      </View>
      {error && (
        <Card style={{ backgroundColor: C.soot }}>
          <Text style={[T.body, { color: C.ivory }]}>{error}</Text>
        </Card>
      )}

      <SectionTitle aside={<Text style={T.tiny}>dataset leaves the model never trained on</Text>}>Try a sample</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} style={{ marginHorizontal: -20 }}>
        <View style={{ width: 10 }} />
        {LEAF_SAMPLES.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => trySample(s)}
            disabled={sampleBusy != null}
            accessibilityRole="button"
            accessibilityLabel={`Sample: ${DISEASES[s.truth].name}`}
            style={{ width: 96, gap: 6 }}
          >
            <View style={{ width: 96, height: 96, borderRadius: 16, overflow: 'hidden', borderWidth: 3, borderColor: sample?.id === s.id ? C.soot : 'transparent' }}>
              <Image source={{ uri: `data:image/jpeg;base64,${s.jpeg}` }} style={{ flex: 1 }} />
              {sampleBusy === s.id && (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(16,16,16,0.5)', alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator color={C.ivory} />
                </View>
              )}
            </View>
            <Text style={[T.tiny, { color: C.ivory }]} numberOfLines={2}>
              {DISEASES[s.truth].name}
            </Text>
          </Pressable>
        ))}
        <View style={{ width: 10 }} />
      </ScrollView>

      {selected && a ? (
        <Card style={{ gap: 14 }}>
          <Image
            source={{ uri: shown! }}
            style={{ width: '100%', aspectRatio: aspect[selected.file] ?? 3 / 4, borderRadius: 16, backgroundColor: C.soot }}
            resizeMode="cover"
            onLoad={(e) => {
              const { width, height } = e.nativeEvent.source;
              if (width && height && !aspect[selected.file]) setAspect((m) => ({ ...m, [selected.file]: width / height }));
            }}
            accessibilityLabel={showOverlay ? 'What the analyser classified' : 'Plant photo'}
          />
          {selected.overlay && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <ToggleChip label="Photo" on={!showOverlay} onPress={() => setShowOverlay(false)} />
              <ToggleChip label="What it saw" on={showOverlay} onPress={() => setShowOverlay(true)} />
            </View>
          )}
          {showOverlay && (
            <Text style={[T.tiny, { color: C.sootDim }]}>Green: healthy leaf · yellow: chlorosis · red: brown or lesions · violet: purpling</Text>
          )}
          <View>
            <Text style={[T.tiny, { color: C.sootDim }]}>
              {sample && selected.id === -1
                ? `Sample leaf · the dataset labels it ${DISEASES[sample.truth].name.toLowerCase()}`
                : `Day ${Math.floor(selected.day)}, ${stageName(selected.stage)} · ${ago(selected.ts)}`}
            </Text>
            <Text style={{ fontFamily: F.display, fontSize: 30, color: C.soot, letterSpacing: -0.5 }}>{verdictWord(a.verdict)}</Text>
          </View>
          {a.canopy_pct != null && a.green_pct != null && a.green_pct >= 1 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
              <Metric label="Canopy" value={`${a.canopy_pct.toFixed(1)}%`} />
              <Metric label="Yellow" value={pct(a.yellow_frac)} />
              <Metric label="Brown" value={pct(a.brown_frac)} />
              <Metric label="Purple" value={pct(a.purple_frac)} />
              <Metric label="Greenness" value={a.dgci != null ? a.dgci.toFixed(2) : '–'} />
            </View>
          )}
          {a.issues.map(([k, msg]) => (
            <Text key={k} style={[T.body, { color: C.soot }]}>
              {msg}
            </Text>
          ))}
          {(() => {
            // A treatment plan only when the app confidently named a disease (leafModel.withModel adds the issue).
            const named = a.issues.find(([k]) => k.startsWith('disease_'))?.[0].slice('disease_'.length);
            return named ? <TreatmentPlan disease={named} /> : null;
          })()}
          {a.disease && <ModelPanel probs={a.disease.probs} />}
          {selected.id === -1 ? (
            <Text style={[T.tiny, { color: C.sootDim }]}>{SAMPLE_CREDIT}. Samples aren’t saved to your plant’s history.</Text>
          ) : (
            <Button
              label="Delete this photo"
              kind="onCard"
              onPress={async () => {
                await deletePhoto(selected);
                setSelected(null);
                await reload();
                await refresh();
              }}
            />
          )}
        </Card>
      ) : (
        <Empty title="No photos yet" body="Take one a day from the same spot and Trends turns canopy cover into a growth curve." />
      )}

      {photos.length > 1 && (
        <>
          <SectionTitle>Earlier photos</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {photos.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  setSample(null);
                  setSelected(p);
                  setShowOverlay(false);
                }}
                accessibilityLabel={`Photo from day ${Math.floor(p.day)}`}
                style={{ width: '31.5%', aspectRatio: 1, borderRadius: 14, overflow: 'hidden', borderWidth: 3, borderColor: selected?.id === p.id ? C.soot : 'transparent' }}
              >
                <Image source={{ uri: p.file }} style={{ flex: 1 }} />
                <Text style={{ position: 'absolute', left: 6, bottom: 4, fontFamily: F.bodyBold, fontSize: 12, color: C.ivory, textShadowColor: C.soot, textShadowRadius: 4 }}>
                  day {Math.floor(p.day)}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <CameraSheet
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onGallery={pickFromGallery}
        onCapture={async (uri, w, h) => {
          await analyse(uri, w, h); // throws (and the sheet shows it) on a black frame or a failed save
          setCameraOpen(false);
        }}
      />
    </Screen>
  );
}

const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);

const ORDER = ['healthy', 'common_rust', 'northern_leaf_blight', 'gray_leaf_spot'];

// What the leaf disease model thinks: one bar per class, the likeliest one dark.
function ModelPanel({ probs }: { probs: Record<string, number> }) {
  const top = ORDER.reduce((b, k) => ((probs[k] ?? 0) > (probs[b] ?? 0) ? k : b), ORDER[0]);
  const d = diseaseOf({ label: top, p: probs[top], probs });
  const m = MODEL_INFO as { test_accuracy?: number; test_healthy_vs_diseased?: number; n_test?: number };
  const call = d.pSick >= CONFIDENT ? 'diseased' : 1 - d.pSick >= CONFIDENT ? 'healthy' : 'not sure';
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: C.sootLine, paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={[T.h3, { color: C.soot }]}>Leaf model</Text>
        <Text style={[T.tiny, { color: C.sootDim }]}>
          {call === 'not sure' ? 'not sure' : `${Math.round(Math.max(d.pSick, 1 - d.pSick) * 100)}% ${call}`}
        </Text>
      </View>
      {ORDER.map((k) => {
        const p = probs[k] ?? 0;
        return (
          <View key={k} style={{ gap: 3 }} accessibilityLabel={`${DISEASES[k].name} ${Math.round(p * 100)} percent`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[T.tiny, { color: C.soot, fontFamily: k === top ? F.bodyBold : F.bodyMid }]}>{DISEASES[k].name}</Text>
              <Text style={[T.tiny, { color: C.soot }]}>{Math.round(p * 100)}%</Text>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: C.sootLine, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(1, p * 100)}%`, height: '100%', backgroundColor: k === top ? C.soot : C.sootDim }} />
            </View>
          </View>
        );
      })}
      <Text style={[T.tiny, { color: C.sootDim }]}>
        Random forest on this phone, trained on PlantVillage maize leaves. On {m.n_test ?? '–'} unseen leaves it told healthy from diseased{' '}
        {m.test_healthy_vs_diseased != null ? `${(m.test_healthy_vs_diseased * 100).toFixed(1)}%` : '–'} of the time, and picked the exact class (healthy or which disease){' '}
        {m.test_accuracy != null ? `${(m.test_accuracy * 100).toFixed(1)}%` : '–'}. Works best on one leaf filling the frame.
      </Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={[T.tiny, { color: C.sootDim }]}>{label}</Text>
      <Text style={{ fontFamily: F.display, fontSize: 20, color: C.soot }}>{value}</Text>
    </View>
  );
}

// Chip variant for use on an ivory card.
function ToggleChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected: on }}
      style={{ borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', backgroundColor: on ? C.soot : 'transparent', borderWidth: 1.5, borderColor: C.soot }}
    >
      <Text style={{ fontFamily: F.bodyMid, fontSize: 14, color: on ? C.ivory : C.soot }}>{label}</Text>
    </Pressable>
  );
}
