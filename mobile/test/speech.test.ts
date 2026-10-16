// The speech controller against a fake engine: the situations that broke Hindi read-aloud on the phone
// (rapid taps while the voice was starting, late events from a stopped session, a dropped sentence).
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { createSpeechController, FIRST_START_MS, pickVoice, type Engine, type Voice } from '../src/lib/speechController';

const VOICES: Voice[] = [
  { identifier: 'en-us-x-iog-local', name: 'en-us-x-iog-local', language: 'en-US' },
  { identifier: 'en-in-x-ene-local', name: 'en-in-x-ene-local', language: 'en-IN' },
  { identifier: 'hi-in-x-hid-network', name: 'hi-in-x-hid-network', language: 'hi-IN' },
  { identifier: 'hi-in-x-hia-local', name: 'hi-in-x-hia-local', language: 'hi-IN' },
];

type Call = { text: string; voice?: string; onStart: () => void; onDone: () => void; onError: () => void };

function fakeEngine(voices = VOICES) {
  const calls: Call[] = [];
  const awake: boolean[] = [];
  let stops = 0;
  let releaseVoices: () => void = () => {};
  const ready = new Promise<void>((r) => (releaseVoices = r));
  const engine: Engine = {
    getVoices: async () => {
      await ready; // like expo-speech: answers only once the engine has initialised
      return voices;
    },
    speak: (text, o) => calls.push({ text, voice: o.voice, onStart: o.onStart, onDone: o.onDone, onError: o.onError }),
    stop: async () => {
      stops++;
    },
    keepAwake: (on) => awake.push(on),
  };
  return { engine, calls, awake, ready: () => releaseVoices(), stops: () => stops };
}

const flush = () => new Promise((r) => setImmediate(r));

/** Let the engine say the last requested sentence. */
async function sayLast(calls: Call[]) {
  const c = calls[calls.length - 1];
  c.onStart();
  c.onDone();
  await flush();
}

test('reads every sentence once, in order, keeping the screen awake only while speaking', async () => {
  const f = fakeEngine();
  const sp = createSpeechController(f.engine);
  f.ready();
  sp.toggle('a', ['one.', 'two.', 'three.'], 'hi');
  await flush();
  assert.equal(sp.getState().status, 'starting');
  for (let i = 0; i < 3; i++) await sayLast(f.calls);
  assert.deepEqual(f.calls.map((c) => c.text), ['one.', 'two.', 'three.']);
  assert.ok(f.calls.every((c) => c.voice === 'hi-in-x-hia-local'), 'installed Hindi voice, not the network one');
  assert.equal(sp.getState().status, 'idle');
  assert.deepEqual(f.awake, [true, false]);
});

test('tap, tap, tap while the engine is still starting: only the last session is read', async () => {
  const f = fakeEngine();
  const sp = createSpeechController(f.engine);
  sp.toggle('a', ['old 1.', 'old 2.'], 'hi'); // engine not ready yet
  sp.toggle('a', ['old 1.', 'old 2.'], 'hi'); // second tap = stop
  sp.toggle('a', ['new 1.', 'new 2.'], 'hi'); // third tap = start again
  f.ready();
  await flush();
  await flush();
  assert.deepEqual(f.calls.map((c) => c.text), ['new 1.'], 'nothing from the cancelled session is queued');
  await sayLast(f.calls);
  await sayLast(f.calls);
  assert.deepEqual(f.calls.map((c) => c.text), ['new 1.', 'new 2.']);
  assert.equal(sp.getState().status, 'idle');
});

test('late events from a stopped session do not touch the new one', async () => {
  const f = fakeEngine();
  const sp = createSpeechController(f.engine);
  f.ready();
  sp.toggle('a', ['a1.', 'a2.'], 'en');
  await flush();
  const old = f.calls[0];
  old.onStart();
  sp.toggle('a', [], 'en'); // stop
  assert.equal(sp.getState().status, 'idle');
  sp.toggle('a', ['b1.', 'b2.'], 'en');
  await flush();
  assert.equal(sp.getState().status, 'starting');
  old.onDone(); // the engine reports the old sentence finishing late
  old.onError();
  await flush();
  assert.deepEqual(f.calls.map((c) => c.text), ['a1.', 'b1.'], 'old callback did not advance the new session');
  assert.equal(sp.getState().status, 'starting');
  await sayLast(f.calls);
  assert.equal(sp.getState().status, 'speaking');
  await sayLast(f.calls);
  assert.equal(sp.getState().status, 'idle');
});

test('a sentence the engine silently drops is retried once, then reported', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const f = fakeEngine();
    const sp = createSpeechController(f.engine);
    f.ready();
    sp.toggle('a', ['one.', 'two.'], 'hi');
    await flush();
    assert.equal(f.calls.length, 1);
    mock.timers.tick(FIRST_START_MS + 1); // no onStart: retry
    await flush();
    assert.deepEqual(f.calls.map((c) => c.text), ['one.', 'one.']);
    f.calls[0].onDone(); // the dropped attempt waking up late must not advance anything
    await flush();
    assert.equal(f.calls.length, 2);
    mock.timers.tick(FIRST_START_MS + 1); // still nothing: give up with a message
    await flush();
    assert.equal(sp.getState().status, 'idle');
    assert.equal(sp.getState().error, 'failed');
    assert.equal(sp.getState().errorKey, 'a');
    assert.equal(f.awake.at(-1), false);
  } finally {
    mock.timers.reset();
  }
});

test('reading another advice stops the first; a button going away only stops its own', async () => {
  const f = fakeEngine();
  const sp = createSpeechController(f.engine);
  f.ready();
  sp.toggle('a', ['a1.', 'a2.'], 'en');
  await flush();
  sp.toggle('b', ['b1.'], 'hi');
  await flush();
  assert.equal(sp.getState().key, 'b');
  sp.stopIf('a'); // e.g. the plan screen unmounting
  assert.equal(sp.getState().key, 'b');
  await sayLast(f.calls);
  assert.deepEqual(f.calls.map((c) => c.text), ['a1.', 'b1.']);
  assert.equal(sp.getState().status, 'idle');
});

test('no voice for the language: a clear error instead of reading Hindi with an English voice', async () => {
  const f = fakeEngine(VOICES.filter((v) => !v.language.startsWith('hi')));
  const sp = createSpeechController(f.engine);
  f.ready();
  sp.toggle('a', ['नमस्ते।'], 'hi');
  await flush();
  await flush();
  assert.equal(f.calls.length, 0);
  assert.equal(sp.getState().error, 'no_voice');
});

test('voice choice prefers installed, Indian voices', () => {
  assert.equal(pickVoice(VOICES, 'hi')?.name, 'hi-in-x-hia-local');
  assert.equal(pickVoice(VOICES, 'en')?.name, 'en-in-x-ene-local');
  assert.equal(pickVoice([{ identifier: 'x', name: 'hi-in-x-hid-network', language: 'hi-IN' }], 'hi')?.name, 'hi-in-x-hid-network');
  assert.equal(pickVoice(VOICES, 'hi' as never) && pickVoice([], 'hi'), null);
});
