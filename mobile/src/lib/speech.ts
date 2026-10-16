// Read advice aloud in English or Hindi with the phone's own text-to-speech (works offline with an installed
// voice). The app-wide controller is in speechController.ts; text rewriting for the ear in speechText.ts.
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Speech from 'expo-speech';
import { Linking, Platform } from 'react-native';

import { createSpeechController, type SpeechLang } from './speechController';
import { chunks, speakable } from './speechText';

export type { SpeechLang };

const KEEP_AWAKE_TAG = 'speech';

/** The one speech session for the whole app. */
export const speech = createSpeechController({
  getVoices: () => Speech.getAvailableVoicesAsync(),
  speak: (text, o) =>
    Speech.speak(text, {
      // Plain "hi"/"en": expo-speech builds Locale(code); the chosen installed voice then overrides it.
      language: o.language,
      voice: o.voice,
      rate: o.rate,
      onStart: o.onStart,
      onDone: o.onDone,
      onError: o.onError,
    }),
  stop: () => Speech.stop(),
  // The screen must not sleep (and pause the app) in the middle of the advice.
  keepAwake: (on) => {
    if (on) void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    else void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
  },
});

/** Advice parts -> short sentences, rewritten for the ear. Short utterances start fast and stop cleanly. */
export function sentences(parts: string[], lang: SpeechLang): string[] {
  return parts.flatMap((p) => chunks(speakable(p, lang), 300)).filter((s) => s.trim().length > 0);
}

/** The system screen where a voice (e.g. Hindi) can be downloaded. */
export function openVoiceSettings() {
  if (Platform.OS === 'android') void Linking.sendIntent('com.android.settings.TTS_SETTINGS').catch(() => Linking.openSettings());
  else void Linking.openSettings();
}
