// The treatment plans in Hindi must say exactly what the English says (same numbers: doses, prices, days),
// and the text-to-speech rewriting must read amounts as words.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TREATMENTS, type L } from '../src/data/treatments';
import { chunks, speakable } from '../src/lib/speechText';

const DEVANAGARI = /[ऀ-ॿ]/;
const numbers = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, '')).sort();

function* strings(x: unknown, path = ''): Generator<[string, L]> {
  if (x && typeof x === 'object') {
    if ('en' in x && 'hi' in x && Object.keys(x).length === 2) yield [path, x as L];
    else for (const [k, v] of Object.entries(x)) yield* strings(v, `${path}.${k}`);
  }
}

test('every treatment string has English and Hindi with the same numbers', () => {
  let n = 0;
  for (const [path, s] of strings(TREATMENTS)) {
    n++;
    assert.ok(s.en.trim() && s.hi.trim(), `${path} is empty`);
    assert.ok(!DEVANAGARI.test(s.en), `${path}.en contains Hindi`);
    if (/[A-Za-z]{4,}/.test(s.en.replace(/\b(WP|SC|WG|TNAU|CIB&RC|CIB|KVK|FRAC|CO|COH|M)\b/g, '')) && !/^[₹\d\s.,–()+·-]+$/.test(s.en))
      assert.ok(DEVANAGARI.test(s.hi), `${path}.hi is not in Hindi: ${s.hi}`);
    assert.deepEqual(numbers(s.hi), numbers(s.en), `${path}: numbers differ\n en: ${s.en}\n hi: ${s.hi}`);
  }
  assert.ok(n > 80, `only ${n} strings checked`);
});

test('amounts are read as words', () => {
  assert.equal(speakable('₹240–365 per acre', 'en'), '240 to 365 rupees per acre');
  assert.equal(speakable('₹240–365 प्रति एकड़', 'hi'), '240 से 365 रुपये प्रति एकड़');
  assert.equal(speakable('≈ ₹1,050 (₹1,305 for the 250 ml bottle)', 'en'), 'about 1050 rupees (1305 rupees for the 250 millilitres bottle)');
  assert.equal(speakable('1 ml/L', 'en'), '1 millilitre per litre');
  assert.equal(speakable('Ergon at 1 ml per litre (CIB&RC; TNAU).', 'en'), 'Ergon at 1 millilitre per litre.');
  assert.equal(speakable('1 मिली/लीटर', 'hi'), '1 मिली प्रति लीटर');
  assert.equal(speakable('60 × 25 cm', 'en'), '60 by 25 centimetres');
  assert.equal(speakable('KVK से पूछें', 'hi'), 'के वी के से पूछें');
});

test('long advice is split at sentence ends under the engine limit', () => {
  const text = Array.from({ length: 40 }, (_, i) => `वाक्य संख्या ${i} यहाँ है।`).join(' ');
  const parts = chunks(text, 120);
  assert.ok(parts.every((p) => p.length <= 120));
  assert.equal(parts.join(' '), text);
});
