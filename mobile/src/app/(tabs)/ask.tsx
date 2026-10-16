// Ask: describe a crop problem (English, Hinglish or Hindi); the advisor combines it with the latest photo
// and sensor readings and answers with likely causes, what to do, and what not to do. Runs on the phone.
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Advisor, type AdviceResult } from '../../engine/advisor';
import { kb } from '../../engine/advisor/kb';
import type { Lang } from '../../engine/advisor/pipeline';
import { dayOfGrow, stageFor } from '../../engine/profiles';
import { recentAnalysis } from '../../lib/photos';
import { useHydro } from '../../lib/store';
import { Button, Card, Chip, Screen, SectionTitle, ToggleRow } from '../../ui/kit';
import { SpeakButton } from '../../ui/SpeakButton';
import { C, F, T } from '../../ui/theme';

const advisor = new Advisor();

const WEATHER: [string, string, string][] = [
  ['heavy_rain', 'Heavy rain', 'भारी बारिश'],
  ['humid', 'Humid / foggy', 'नमी / कोहरा'],
  ['hot', 'Very hot', 'बहुत गर्मी'],
  ['cold', 'Cold nights', 'ठंडी रातें'],
  ['frost', 'Frost', 'पाला'],
  ['dry', 'Dry spell', 'सूखा'],
];

const KIND: Record<string, [string, string]> = {
  check: ['Check first', 'पहले जाँचें'],
  cultural: ['Change how you grow', 'खेती का तरीका'],
  mechanical: ['By hand', 'हाथ से'],
  biological: ['Biological', 'जैविक'],
  nutrient: ['Nutrients', 'पोषक तत्व'],
  chemical: ['Chemical (last resort)', 'रासायनिक (आखिरी उपाय)'],
  escalate: ['Get help', 'मदद लें'],
};

export default function Ask() {
  const { status } = useHydro();
  const [lang, setLang] = useState<Lang>('en');
  const [text, setText] = useState('');
  const [crop, setCrop] = useState<string | null>(null);
  const [weather, setWeather] = useState<string[]>([]);
  const [rain, setRain] = useState(false);
  const [wind, setWind] = useState(false);
  const [usePhoto, setUsePhoto] = useState(true);
  const [useSensors, setUseSensors] = useState(true);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<(AdviceResult & { inputs: { photo: boolean; sensors: boolean } }) | null>(null);
  const [busy, setBusy] = useState(false);
  const hi = lang === 'hi';

  const run = async (ans = answers) => {
    setBusy(true);
    try {
      const s = status?.settings;
      const latest = status?.latest;
      const fresh = latest && Date.now() / 1000 - latest.ts < 600;
      const sensors = useSensors && fresh ? latest : null;
      const photo = usePhoto ? await recentAnalysis() : null;
      const form: Record<string, unknown> = { crop, weather, rain_forecast: rain, wind_high: wind, hydroponic: !!sensors };
      let stageTargets = null;
      if (sensors && s) {
        const day = dayOfGrow(s.planted_at, sensors.ts);
        stageTargets = stageFor(s.crop, day);
        form.crop = crop ?? s.crop;
        form.day = Math.floor(day);
      }
      const r = advisor.advise({ text: text.trim(), form, photo, sensors, stageTargets, answers: ans, lang });
      setResult({ ...r, inputs: { photo: !!photo, sensors: !!sensors } });
    } finally {
      setBusy(false);
    }
  };

  const answer = (id: string, v: boolean) => {
    const next = { ...answers, [id]: v };
    setAnswers(next);
    void run(next);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <Text style={T.h1}>{hi ? 'पूछिए' : 'Ask'}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Chip label="English" on={!hi} onPress={() => setLang('en')} />
          <Chip label="हिंदी" on={hi} onPress={() => setLang('hi')} />
        </View>
      </View>
      <Text style={T.bodySm}>
        {hi
          ? 'फसल में क्या दिख रहा है, अपने शब्दों में लिखिए। सलाह इसी फ़ोन पर बनती है, इंटरनेट की ज़रूरत नहीं।'
          : 'Say what you see on the crop, in your own words (Hinglish is fine). The advice is worked out on this phone, no internet needed.'}
      </Text>

      <View style={{ backgroundColor: C.ivory, borderRadius: 22, padding: 6 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder={hi ? 'जैसे: मक्का के पत्ते सिरे से पीले हो रहे हैं' : 'e.g. makka ke patte peele ho rahe hain'}
          placeholderTextColor={C.sootDim}
          style={{ minHeight: 96, padding: 12, fontFamily: F.body, fontSize: 17, color: C.soot, textAlignVertical: 'top' }}
          accessibilityLabel="Describe the problem"
        />
      </View>

      <View style={{ gap: 10 }}>
        <Text style={T.label}>{hi ? 'फसल' : 'Crop'}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(kb.crops).map(([id, c]) => (
            <Chip key={id} label={hi ? c.name_hi : c.name_en} on={crop === id} onPress={() => setCrop(crop === id ? null : id)} />
          ))}
        </View>
        <Text style={T.label}>{hi ? 'मौसम' : 'Recent weather'}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {WEATHER.map(([id, en, hin]) => (
            <Chip
              key={id}
              label={hi ? hin : en}
              on={weather.includes(id)}
              onPress={() => setWeather(weather.includes(id) ? weather.filter((w) => w !== id) : [...weather, id])}
            />
          ))}
        </View>
      </View>

      <Card style={{ gap: 4, paddingVertical: 10 }}>
        <ToggleRow label={hi ? 'ताज़ा फोटो जोड़ें' : 'Use the latest leaf photo'} hint={hi ? 'पिछले 24 घंटे की' : 'From the last 24 h, if there is one'} value={usePhoto} onChange={setUsePhoto} />
        <ToggleRow label={hi ? 'सेंसर रीडिंग जोड़ें' : 'Use the rig sensors'} hint={hi ? 'हाइड्रोपोनिक सेटअप' : 'Marks the crop as hydroponic'} value={useSensors} onChange={setUseSensors} />
        <ToggleRow label={hi ? '24 घंटे में बारिश की संभावना' : 'Rain expected within 24 h'} value={rain} onChange={setRain} />
        <ToggleRow label={hi ? 'तेज़ हवा' : 'Strong wind'} value={wind} onChange={setWind} />
      </Card>

      <Button
        label={hi ? 'सलाह दें' : 'Get advice'}
        busy={busy}
        onPress={() => {
          setAnswers({});
          void run({});
        }}
      />

      {result && <Answer r={result} lang={lang} answers={answers} onAnswer={answer} onCrop={setCrop} />}
    </Screen>
  );
}

function Answer({
  r,
  lang,
  answers,
  onAnswer,
  onCrop,
}: {
  r: AdviceResult & { inputs: { photo: boolean; sensors: boolean } };
  lang: Lang;
  answers: Record<string, boolean>;
  onAnswer: (id: string, v: boolean) => void;
  onCrop: (c: string) => void;
}) {
  const hi = lang === 'hi';
  // What the Listen button reads: the warning, the likeliest cause, the steps, and what not to do.
  const spoken = [
    ...(r.safety ? [r.safety.message] : []),
    ...(r.likely?.length ? [`${hi ? 'सबसे संभावित कारण' : 'Most likely'}: ${r.likely[0].name}.`] : []),
    ...(r.actions ?? []).map((a, i) => `${hi ? 'कदम' : 'Step'} ${i + 1}. ${a.text}`),
    ...(r.avoid ?? []).map((a) => `${hi ? 'यह न करें' : "Don't"}: ${a.text}. ${a.reason}`),
  ];
  return (
    <View style={{ gap: 16 }}>
      {spoken.length > 0 && <SpeakButton parts={spoken} lang={lang} onDark />}
      {r.safety && (
        <View style={{ backgroundColor: C.soot, borderRadius: 22, padding: 18, gap: 6 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.emberSoft }}>{hi ? 'तुरंत ध्यान दें' : 'Urgent'}</Text>
          <Text style={[T.body, { color: C.ivory, fontSize: 17, lineHeight: 25 }]}>{r.safety.message}</Text>
        </View>
      )}
      {r.needs && (
        <Card style={{ gap: 10 }}>
          <Text style={[T.h3, { color: C.soot }]}>{hi ? r.needs.hi : r.needs.en}</Text>
          {r.needs.options && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {r.needs.options.map((c) => (
                <Button key={c} kind="onCard" label={hi ? kb.crops[c].name_hi : kb.crops[c].name_en} onPress={() => onCrop(c)} />
              ))}
            </View>
          )}
        </Card>
      )}
      {r.unrelated && (
        <Card>
          <Text style={[T.body, { color: C.soot }]}>{r.message}</Text>
        </Card>
      )}

      {r.likely && r.likely.length > 0 && (
        <Card style={{ gap: 12 }}>
          {r.likely.every((l) => l.agreement.startsWith('0/')) && (
            <Text style={[T.body, { color: C.soot, fontFamily: F.bodyMid }]}>
              {hi
                ? 'आपके विवरण से कोई साफ़ मेल नहीं मिला। नीचे के कारण सिर्फ़ मौसम/सेंसर से सुझाए गए हैं: लक्षण और विस्तार से लिखें या फोटो जोड़ें।'
                : "Your description didn't clearly match a problem. These come from the conditions only: describe the symptoms in more detail (which leaves, what colour, spots or insects) or add a photo."}
            </Text>
          )}
          <Text style={[T.tiny, { color: C.sootDim }]}>
            {hi ? 'संभावित कारण' : 'Most likely'} · {confidence(r.confidence, hi)} ·{' '}
            {[hi ? 'आपकी बात' : 'your words', r.inputs.photo && (hi ? 'फोटो' : 'photo'), r.inputs.sensors && (hi ? 'सेंसर' : 'sensors')]
              .filter(Boolean)
              .join(' + ')}
          </Text>
          {r.likely.map((l, i) => (
            <View key={l.id} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
              <Text style={{ fontFamily: F.display, fontSize: i === 0 ? 30 : 20, color: i === 0 ? C.soot : C.sootDim, flex: 1, letterSpacing: -0.4 }}>{l.name}</Text>
              <Text style={[T.tiny, { color: C.sootDim }]}>{l.agreement.replace('evidence channels', hi ? 'साक्ष्य' : 'views agree')}</Text>
            </View>
          ))}
          {r.notifiable && (
            <Text style={[T.bodySm, { color: C.emberDeep, fontFamily: F.bodyMid }]}>
              {hi ? 'यह सूचित करने योग्य कीट/रोग है: कृषि विभाग / KVK को बताएं।' : 'This is a notifiable pest or disease: tell your KVK or agriculture office.'}
            </Text>
          )}
        </Card>
      )}

      {r.questions && r.questions.length > 0 && (
        <Card style={{ gap: 12 }}>
          <Text style={[T.h3, { color: C.soot }]}>{hi ? 'दो सवाल, ताकि सही कारण पता चले' : 'Two quick checks to tell them apart'}</Text>
          {r.questions.map((q) => (
            <View key={q.id} style={{ gap: 8 }}>
              <Text style={[T.body, { color: C.soot }]}>{hi ? q.hi : q.en}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <YesNo label={hi ? 'हाँ' : 'Yes'} on={answers[q.id] === true} onPress={() => onAnswer(q.id, true)} />
                <YesNo label={hi ? 'नहीं' : 'No'} on={answers[q.id] === false} onPress={() => onAnswer(q.id, false)} />
              </View>
            </View>
          ))}
        </Card>
      )}

      {r.actions && r.actions.length > 0 && (
        <>
          <SectionTitle>{hi ? 'क्या करें, इसी क्रम में' : 'What to do, in this order'}</SectionTitle>
          <Card style={{ gap: 14 }}>
            {r.actions.map((a, i) => (
              <View key={`${a.strategy}-${i}`} style={{ flexDirection: 'row', gap: 12 }}>
                <Text style={{ fontFamily: F.display, fontSize: 18, color: C.emberDeep, width: 22 }}>{i + 1}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[T.tiny, { color: C.sootDim }]}>{(KIND[a.kind] ?? [a.kind, a.kind])[hi ? 1 : 0]}</Text>
                  <Text style={[T.body, { color: C.soot }]}>{a.text}</Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      {r.avoid && r.avoid.length > 0 && (
        <>
          <SectionTitle>{hi ? 'यह न करें' : "Don't do this"}</SectionTitle>
          <View style={{ backgroundColor: C.soot, borderRadius: 22, padding: 18, gap: 12 }}>
            {r.avoid.map((a) => (
              <View key={a.text + a.reason} style={{ gap: 2 }}>
                <Text style={[T.body, { color: C.ivory, fontFamily: F.bodyBold }]}>{a.text}</Text>
                <Text style={[T.bodySm, { color: 'rgba(230,213,189,0.8)' }]}>{a.reason}</Text>
              </View>
            ))}
          </View>
        </>
      )}
      {r.actions && (
        <Text style={T.tiny}>
          {hi
            ? 'दवा की मात्रा के लिए हमेशा लेबल पढ़ें या KVK से पूछें।'
            : 'Doses are never guessed: follow the product label or ask your KVK.'}
        </Text>
      )}
    </View>
  );
}

function confidence(c: string | undefined, hi: boolean) {
  const m: Record<string, [string, string]> = {
    high: ['fairly sure', 'काफ़ी भरोसा'],
    medium: ['probably', 'शायद'],
    low: ['not sure, check below', 'पक्का नहीं, नीचे जाँचें'],
    none: ['no match', 'कोई मेल नहीं'],
  };
  return (m[c ?? 'none'] ?? m.none)[hi ? 1 : 0];
}

function YesNo({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected: on }}
      style={{ minWidth: 76, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1.5, borderColor: C.soot, backgroundColor: on ? C.soot : 'transparent' }}
    >
      <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: on ? C.ivory : C.soot }}>{label}</Text>
    </Pressable>
  );
}
