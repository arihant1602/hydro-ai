// Full-screen camera for the leaf check: framing guide, torch, flip, gallery, and a big shutter.
// The parent does the analysis in onCapture; the sheet shows "Analysing…" until that promise settles.
import { CameraView, type CameraType } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from './icons';
import { C, F } from './theme';

export function CameraSheet(props: {
  visible: boolean;
  onClose: () => void;
  onCapture: (uri: string, width: number, height: number) => Promise<void>;
  onGallery: () => void;
}) {
  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose} statusBarTranslucent navigationBarTranslucent>
      {props.visible && <CameraBody {...props} />}
    </Modal>
  );
}

function CameraBody({
  onClose,
  onCapture,
  onGallery,
}: {
  onClose: () => void;
  onCapture: (uri: string, width: number, height: number) => Promise<void>;
  onGallery: () => void;
}) {
  const insets = useSafeAreaInsets();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [error, setError] = useState<string | null>(null);

  const shoot = async () => {
    if (!cam.current || !ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const pic = await cam.current.takePictureAsync({
        quality: 0.9,
        exif: false,
        shutterSound: false,
      });
      await onCapture(pic.uri, pic.width, pic.height);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        ref={cam}
        style={StyleSheet.absoluteFill}
        facing={facing}
        enableTorch={torch}
        animateShutter
        // Give auto-exposure a moment after the stream starts; an instant capture can come back black.
        onCameraReady={() => setTimeout(() => setReady(true), 600)}
        onMountError={(e) => setError(e.message)}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <Round icon="close" label="Close camera" onPress={onClose} />
        <Text style={styles.title}>Leaf check</Text>
        <Round icon="torch" label={torch ? 'Torch off' : 'Torch on'} onPress={() => setTorch((t) => !t)} on={torch} />
      </View>

      <View pointerEvents="none" style={styles.guideWrap}>
        <View style={styles.guide}>
          {(['tl', 'tr', 'bl', 'br'] as const).map((k) => (
            <View key={k} style={[styles.corner, cornerStyle[k]]} />
          ))}
        </View>
        <Text style={styles.hint}>{busy ? ' ' : 'Fill the square with leaves · light behind you'}</Text>
      </View>

      {error && (
        <View style={[styles.toast, { bottom: insets.bottom + 150 }]}>
          <Text style={styles.toastText}>{error}</Text>
        </View>
      )}

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
        <Round icon="image" label="Pick from gallery" onPress={onGallery} size={54} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          onPress={shoot}
          disabled={!ready || busy}
          style={({ pressed }) => [styles.shutter, (!ready || busy) && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.94 }] }]}
        >
          <View style={styles.shutterInner}>{busy && <ActivityIndicator color={C.soot} />}</View>
        </Pressable>
        <Round icon="flip" label="Switch camera" onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} size={54} />
      </View>

      {busy && (
        <View style={styles.busy} pointerEvents="none">
          <Text style={styles.busyText}>Analysing…</Text>
        </View>
      )}
    </View>
  );
}

function Round({
  icon,
  label,
  onPress,
  on = false,
  size = 44,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  on?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: on ? C.ivory : pressed ? 'rgba(255,255,255,0.28)' : 'rgba(16,16,16,0.45)',
      })}
    >
      <Icon name={icon} color={on ? C.soot : C.ivory} size={size * 0.48} />
    </Pressable>
  );
}

const CORNER = 34;
const cornerStyle = {
  tl: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 22,
  },
  tr: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 22,
  },
  bl: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 22,
  },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 22,
  },
};

const styles = StyleSheet.create({
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
  },
  title: {
    fontFamily: F.bodyBold,
    fontSize: 16,
    color: C.ivory,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  guideWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  guide: { width: '78%', aspectRatio: 1 },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: C.ivory,
  },
  hint: {
    fontFamily: F.bodyMid,
    fontSize: 14,
    color: C.ivory,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 6,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 22,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  shutter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: C.ivory,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: C.ivory,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: C.soot,
    borderRadius: 16,
    padding: 14,
  },
  toastText: {
    fontFamily: F.body,
    fontSize: 14,
    lineHeight: 20,
    color: C.ivory,
  },
  busy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyText: { fontFamily: F.display, fontSize: 28, color: C.ivory },
});
