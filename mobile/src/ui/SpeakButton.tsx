// "Listen" button: reads advice aloud in English or Hindi through the app-wide speech controller, so only
// one thing is ever read at a time. Tap to start, tap again (also while the voice is still starting) to stop.
// If the phone has no voice for the language, it says so and opens the voice settings.
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { openVoiceSettings, sentences, speech, type SpeechLang } from '../lib/speech';
import { Icon } from './icons';
import { C, F, T } from './theme';

const LABELS: Record<SpeechLang, { listen: string; stop: string; starting: string; noVoice: string; failed: string; install: string }> = {
  en: {
    listen: 'Listen',
    stop: 'Stop',
    starting: 'Starting voice…',
    noVoice: 'This phone has no English text-to-speech voice. Install one in the voice settings.',
    failed: 'The voice didn’t start. Try again; if it keeps failing, check the voice in the voice settings.',
    install: 'Open voice settings',
  },
  hi: {
    listen: 'सुनें',
    stop: 'रोकें',
    starting: 'आवाज़ शुरू हो रही है…',
    noVoice: 'इस फ़ोन में हिंदी आवाज़ नहीं है। आवाज़ की सेटिंग में "हिंदी" आवाज़ डाउनलोड करें।',
    failed: 'आवाज़ शुरू नहीं हुई। दोबारा दबाएँ; बार-बार न चले तो आवाज़ की सेटिंग जाँचें।',
    install: 'आवाज़ की सेटिंग खोलें',
  },
};

export function SpeakButton({ parts, lang, onDark = false }: { parts: string[]; lang: SpeechLang; onDark?: boolean }) {
  const state = useSyncExternalStore(speech.subscribe, speech.getState);
  const L = LABELS[lang];
  const fg = onDark ? C.ivory : C.soot;
  // Identify this advice by its text, not by the array (screens rebuild `parts` on every render).
  const key = `${lang}|${parts.join('\u0001')}`;
  const lines = useMemo(() => sentences(parts, lang), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = state.key === key;
  const status = mine ? state.status : 'idle';
  const error = state.errorKey === key ? state.error : null;
  const lastTap = useRef(0);

  // Stop reading this advice if it changes (new result, other language) or the screen goes away.
  useEffect(() => () => speech.stopIf(key), [key]);

  const press = () => {
    const now = Date.now();
    if (now - lastTap.current < 400) return; // a double tap is one tap
    lastTap.current = now;
    speech.toggle(key, lines, lang);
  };

  const active = status !== 'idle';
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={press}
        accessibilityRole="button"
        accessibilityLabel={active ? L.stop : L.listen}
        accessibilityState={{ busy: status === 'starting' }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 8,
          paddingVertical: 9,
          paddingHorizontal: 14,
          borderRadius: 999,
          borderWidth: 1.5,
          borderColor: fg,
          backgroundColor: active ? fg : pressed ? (onDark ? 'rgba(230,213,189,0.15)' : C.sootLine) : 'transparent',
        })}
      >
        {status === 'starting' ? (
          <ActivityIndicator size="small" color={onDark ? C.soot : C.ivory} />
        ) : (
          <Icon name={active ? 'stop' : 'speaker'} color={active ? (onDark ? C.soot : C.ivory) : fg} size={18} />
        )}
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: active ? (onDark ? C.soot : C.ivory) : fg }}>
          {status === 'starting' ? L.starting : active ? L.stop : L.listen}
        </Text>
      </Pressable>
      {error && (
        <View style={{ gap: 6 }}>
          <Text style={[T.bodySm, { color: fg }]}>{error === 'no_voice' ? L.noVoice : L.failed}</Text>
          <Text onPress={openVoiceSettings} style={[T.bodySm, { color: fg, fontFamily: F.bodyBold, textDecorationLine: 'underline' }]}>
            {L.install}
          </Text>
        </View>
      )}
    </View>
  );
}
