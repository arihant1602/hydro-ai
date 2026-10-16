// One speech session at a time for the whole app, spoken one sentence after another.
//
// Why not hand the engine the whole text at once (what expo-speech's queue does): stopping fires a "stopped"
// event for every queued sentence of the old session, which reset the button of the *new* session; sentences
// queued while the engine was still starting were never cancelled by stop and played later. Here every session
// has an id, each sentence is sent only after the previous one finished, and any event from an older session
// is ignored. The engine is injected so this is unit-tested with a fake (test/speech.test.ts).

export type SpeechLang = 'en' | 'hi';
export type Status = 'idle' | 'starting' | 'speaking';
export type SpeechError = 'no_voice' | 'failed' | null;

export interface Voice {
  identifier: string;
  name: string;
  language: string;
}

export interface Engine {
  /** Resolves once the engine is initialised (expo-speech only answers getVoices after init). */
  getVoices(): Promise<Voice[]>;
  speak(
    text: string,
    opts: { language: string; voice?: string; rate: number; onStart: () => void; onDone: () => void; onError: () => void },
  ): void;
  stop(): Promise<void>;
  keepAwake(on: boolean): void;
}

export interface State {
  key: string | null; // which button's text is being read
  status: Status;
  error: SpeechError;
  errorKey: string | null;
}

/** First sentence: the Hindi voice model can take several seconds to load. */
export const FIRST_START_MS = 15000;
export const NEXT_START_MS = 8000;

/**
 * Best installed voice for the language. Google TTS names voices "hi-in-x-hia-local" (installed) or
 * "...-network" (streamed: fails offline, and stalls behind a WiFi login page), so prefer local ones.
 * English: an Indian English voice if there is one.
 */
export function pickVoice(voices: Voice[], lang: SpeechLang): Voice | null {
  const mine = voices.filter((v) => v.language.toLowerCase().startsWith(lang));
  if (!mine.length) return null;
  const score = (v: Voice) => {
    const n = v.name.toLowerCase();
    return (n.includes('local') ? 4 : 0) + (n.includes('network') ? -4 : 0) + (v.language.toLowerCase().replace('_', '-') === `${lang}-in` ? 2 : 0);
  };
  return [...mine].sort((a, b) => score(b) - score(a))[0];
}

export function createSpeechController(engine: Engine) {
  let state: State = { key: null, status: 'idle', error: null, errorKey: null };
  let session = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  let voices: Promise<Voice[]> | null = null;

  const set = (s: Partial<State>) => {
    state = { ...state, ...s };
    listeners.forEach((l) => l());
  };
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const loadVoices = () => (voices ??= engine.getVoices().catch(() => [] as Voice[]));

  function finish(s: number, error: SpeechError = null) {
    if (s !== session) return;
    session++; // anything still in flight from this session is now stale
    clearTimer();
    engine.keepAwake(false);
    set({ key: null, status: 'idle', error, errorKey: error ? state.key : null });
    if (error) void engine.stop();
  }

  async function start(key: string, sentences: string[], lang: SpeechLang) {
    const s = ++session;
    clearTimer();
    set({ key, status: 'starting', error: null, errorKey: null });
    engine.keepAwake(true);
    await engine.stop();
    const voice = pickVoice(await loadVoices(), lang);
    if (s !== session) return;
    if (!voice) return finish(s, 'no_voice');

    let i = 0;
    let retried = false;
    let attempt = 0; // a retry makes the earlier attempt's late callbacks stale too
    const sayNext = () => {
      if (s !== session) return;
      if (i >= sentences.length) return finish(s);
      const text = sentences[i];
      const a = ++attempt;
      const live = () => s === session && a === attempt;
      let started = false;
      clearTimer();
      // If the engine never starts this sentence (dropped request, voice still loading), try it once more.
      timer = setTimeout(
        () => {
          if (!live() || started) return;
          if (!retried) {
            retried = true;
            void engine.stop().then(sayNext);
          } else finish(s, 'failed');
        },
        i === 0 ? FIRST_START_MS : NEXT_START_MS,
      );
      engine.speak(text, {
        language: lang,
        voice: voice.identifier,
        rate: lang === 'hi' ? 0.9 : 1.0,
        onStart: () => {
          if (!live()) return;
          started = true;
          clearTimer();
          if (state.status !== 'speaking') set({ status: 'speaking' });
        },
        onDone: () => {
          if (!live()) return;
          i++;
          retried = false;
          sayNext();
        },
        onError: () => {
          if (!live()) return;
          if (!retried) {
            retried = true;
            sayNext();
          } else finish(s, 'failed');
        },
      });
    };
    sayNext();
  }

  return {
    getState: () => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Start the engine early so the first press doesn't wait for it. */
    warmUp: () => void loadVoices(),
    /** Tap on a button: stop if this text is being read (or is starting), otherwise read it. */
    toggle(key: string, sentences: string[], lang: SpeechLang) {
      if (state.key === key && state.status !== 'idle') this.stop();
      else if (sentences.length) void start(key, sentences, lang);
    },
    stop() {
      if (state.status === 'idle' && !state.error) return;
      finish(session);
      void engine.stop();
    },
    /** Stop only if `key` is the one being read (a button going away mustn't stop another one). */
    stopIf(key: string) {
      if (state.key === key && state.status !== 'idle') this.stop();
    },
  };
}

export type SpeechController = ReturnType<typeof createSpeechController>;
