// Text rewriting for read-aloud advice (pure: no native modules, so it is unit-tested under Node).
// "₹240–365" -> "240 से 365 रुपये", "1 ml/L" -> "1 millilitre per litre", source tags like "(TNAU)" dropped.

export type SpeechLang = 'en' | 'hi';

const W: Record<SpeechLang, { to: string; rupees: string; about: string; by: string; per: string }> = {
  en: { to: 'to', rupees: 'rupees', about: 'about', by: 'by', per: 'per' },
  hi: { to: 'से', rupees: 'रुपये', about: 'लगभग', by: 'गुणा', per: 'प्रति' },
};

/** Rewrite symbols and abbreviations so the TTS engine says them as words. */
export function speakable(text: string, lang: SpeechLang): string {
  const w = W[lang];
  let t = text;
  t = t.replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/(\d),(?=\d{3}\b)/g, '$1'); // 1,050 -> 1050 (twice: 1,00,000)
  t = t.replace(/\s*\((?:TNAU|CIB&RC[^)]*|CIB&RC; TNAU)\)/g, ''); // source tags are for reading, not listening
  t = t.replace(/₹\s?(\d+)\s*[–-]\s*(\d+)/g, `$1 ${w.to} $2 ${w.rupees}`);
  t = t.replace(/₹\s?(\d+)/g, `$1 ${w.rupees}`);
  t = t.replace(/(\d)\s*[–-]\s*(\d)/g, `$1 ${w.to} $2`);
  t = t.replace(/≈\s?/g, `${w.about} `);
  t = t.replace(/(\d)\s*×\s*(\d)/g, `$1 ${w.by} $2`);
  t = t.replace(/·/g, ',');
  if (lang === 'en') {
    t = t.replace(/\/L\b/g, ' per litre').replace(/\/ha\b/g, ' per hectare');
    const unit = (re: RegExp, word: string) => {
      t = t.replace(re, (_, n: string) => `${n} ${word}${n === '1' ? '' : 's'}`);
    };
    unit(/(\d+(?:\.\d+)?)\s*ml\b/g, 'millilitre');
    unit(/(\d+(?:\.\d+)?)\s*kg\b/g, 'kilogram');
    unit(/(\d+(?:\.\d+)?)\s*g\b/g, 'gram');
    unit(/(\d+(?:\.\d+)?)\s*L\b/g, 'litre');
    unit(/(\d+(?:\.\d+)?)\s*cm\b/g, 'centimetre');
    t = t.replace(/\bKVK\b/g, 'K V K');
  } else {
    t = t.replace(/\/(लीटर|हेक्टेयर|एकड़)/g, ` ${w.per} $1`);
    t = t.replace(/\bKVK\b/g, 'के वी के');
  }
  return t.replace(/\s{2,}/g, ' ').trim();
}

/** Split into pieces the engine accepts, at sentence ends where possible. */
export function chunks(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const s of text.split(/(?<=[.!?।])\s+/)) {
    if ((cur + ' ' + s).trim().length > max && cur) {
      out.push(cur.trim());
      cur = '';
    }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
    } else cur += ' ' + s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
