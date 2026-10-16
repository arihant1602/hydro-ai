// "What to do" under a disease result: numbered steps with costs, products with doses, prevention, sources.
// English or Hindi (the choice is remembered), and a Listen button that reads the plan aloud.
// Drawn on an ivory card. Data: src/data/treatments.ts.
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { PRICES_CHECKED, TREATMENT_SOURCES, TREATMENTS, type Lang, type Product, type TreatmentPlan as Plan } from '../data/treatments';
import { getMeta, putMeta } from '../lib/db';
import { Icon } from './icons';
import { SpeakButton } from './SpeakButton';
import { C, F, T } from './theme';

const UI: Record<Lang, Record<string, string>> = {
  en: {
    title: 'What to do',
    step: 'Step',
    cost: 'Cost',
    products: 'Products, doses and prices',
    nextSeason: 'Next season',
    perLitre: 'Per litre',
    perTank: 'Per 16 L tank',
    perAcre: 'Per acre',
    costAcre: 'Cost / acre / spray',
    pack: 'Pack price',
    wait: 'Stop before harvest',
    noWait: 'no limit listed',
    days: 'days',
    registered: 'Registered',
    seeScreen: 'Product doses and prices are on the screen.',
    disclaimer:
      'Use only products registered for maize and follow the label. Doses: CIB&RC registrations and TNAU. Prices are online listings checked {date}; confirm with your local dealer. Ask your KVK or agriculture officer if unsure.',
  },
  hi: {
    title: 'क्या करें',
    step: 'कदम',
    cost: 'खर्च',
    products: 'दवाएँ, मात्रा और दाम',
    nextSeason: 'अगले मौसम में',
    perLitre: 'प्रति लीटर',
    perTank: 'प्रति 16 लीटर टंकी',
    perAcre: 'प्रति एकड़',
    costAcre: 'खर्च / एकड़ / छिड़काव',
    pack: 'पैक का दाम',
    wait: 'कटाई से पहले बंद करें',
    noWait: 'कोई सीमा नहीं लिखी',
    days: 'दिन',
    registered: 'पंजीकृत',
    seeScreen: 'दवाओं की मात्रा और दाम स्क्रीन पर लिखे हैं।',
    disclaimer:
      'सिर्फ़ मक्का के लिए पंजीकृत दवाएँ लें और लेबल के अनुसार डालें। मात्रा: CIB&RC पंजीकरण और TNAU। दाम ऑनलाइन दुकानों से {date} को देखे गए; अपने स्थानीय विक्रेता से पुष्टि करें। संदेह हो तो KVK या कृषि अधिकारी से पूछें।',
  },
};

/** Everything the Listen button reads, in reading order. */
function spokenParts(plan: Plan, lang: Lang): string[] {
  const u = UI[lang];
  return [
    `${plan.disease[lang]}.`,
    plan.urgency[lang],
    ...(plan.caution ? [plan.caution[lang]] : []),
    ...plan.steps.map((s, i) => `${u.step} ${i + 1}. ${s.title[lang]}. ${s.detail[lang]}${s.cost ? ` ${u.cost}: ${s.cost[lang]}.` : ''}`),
    `${u.nextSeason}. ${plan.prevention.map((p) => p[lang]).join(' ')}`,
    u.seeScreen,
  ];
}

export function TreatmentPlan({ disease }: { disease: string }) {
  const plan = TREATMENTS[disease];
  const [lang, setLang] = useState<Lang>('en');
  const [showProducts, setShowProducts] = useState(false);
  useEffect(() => {
    void getMeta<Lang>('_advice_lang', 'en').then(setLang);
  }, []);
  const parts = useMemo(() => (plan ? spokenParts(plan, lang) : []), [plan, lang]);
  if (!plan) return null;
  const u = UI[lang];
  const choose = (l: Lang) => {
    setLang(l);
    void putMeta('_advice_lang', l);
  };

  return (
    <View style={{ gap: 12, borderTopWidth: 1, borderTopColor: C.sootLine, paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[T.h3, { color: C.soot }]}>{u.title}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }} accessibilityRole="radiogroup">
          <LangChip label="English" on={lang === 'en'} onPress={() => choose('en')} />
          <LangChip label="हिन्दी" on={lang === 'hi'} onPress={() => choose('hi')} />
        </View>
      </View>
      <Text style={[T.body, { color: C.soot, fontFamily: F.bodyBold }]}>{plan.disease[lang]}</Text>
      <SpeakButton parts={parts} lang={lang} />
      <Text style={[T.body, { color: C.soot, fontFamily: F.bodyMid }]}>{plan.urgency[lang]}</Text>
      {plan.caution && (
        <View style={{ backgroundColor: C.soot, borderRadius: 14, padding: 12 }}>
          <Text style={[T.bodySm, { color: C.ivory }]}>{plan.caution[lang]}</Text>
        </View>
      )}

      {plan.steps.map((s, i) => (
        <View key={s.title.en} style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.soot, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.ivory }}>{i + 1}</Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[T.body, { color: C.soot, fontFamily: F.bodyBold }]}>{s.title[lang]}</Text>
            <Text style={[T.bodySm, { color: C.soot }]}>{s.detail[lang]}</Text>
            {s.cost && (
              <Text style={[T.tiny, { color: C.emberDeep, fontFamily: F.bodyBold }]}>
                {u.cost}: {s.cost[lang]}
              </Text>
            )}
          </View>
        </View>
      ))}

      <Pressable
        onPress={() => setShowProducts((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showProducts }}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}
      >
        <Text style={[T.body, { color: C.soot, fontFamily: F.bodyBold }]}>
          {u.products} ({plan.products.length})
        </Text>
        <View style={{ transform: [{ rotate: showProducts ? '90deg' : '0deg' }] }}>
          <Icon name="chevron" color={C.soot} size={18} />
        </View>
      </Pressable>
      {showProducts && plan.products.map((p) => <ProductRow key={p.ingredient.en} p={p} lang={lang} />)}

      <Text style={[T.body, { color: C.soot, fontFamily: F.bodyBold }]}>{u.nextSeason}</Text>
      {plan.prevention.map((line) => (
        <View key={line.en} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={[T.bodySm, { color: C.soot }]}>•</Text>
          <Text style={[T.bodySm, { color: C.soot, flex: 1 }]}>{line[lang]}</Text>
        </View>
      ))}

      <Text style={[T.tiny, { color: C.sootDim }]}>{u.disclaimer.replace('{date}', PRICES_CHECKED[lang])}</Text>
      <View style={{ gap: 4 }}>
        {TREATMENT_SOURCES.map((s) => (
          <Text key={s.url} onPress={() => void Linking.openURL(s.url)} style={[T.tiny, { color: C.soot, textDecorationLine: 'underline' }]}>
            {s.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function LangChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      style={{ borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11, borderWidth: 1.5, borderColor: C.soot, backgroundColor: on ? C.soot : C.ivory }}
    >
      <Text style={{ fontFamily: F.bodyMid, fontSize: 13, color: on ? C.ivory : C.soot }}>{label}</Text>
    </Pressable>
  );
}

function ProductRow({ p, lang }: { p: Product; lang: Lang }) {
  const u = UI[lang];
  return (
    <View style={{ backgroundColor: '#f2e7d6', borderRadius: 14, padding: 12, gap: 6 }}>
      <Text style={[T.body, { color: C.soot, fontFamily: F.bodyBold }]}>{p.ingredient[lang]}</Text>
      <Text style={[T.tiny, { color: C.sootDim }]}>
        {p.brands} · FRAC {p.frac[lang]}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        <Fact label={u.perLitre} value={p.perLitre[lang]} />
        <Fact label={u.perTank} value={p.perTank[lang]} />
        <Fact label={u.perAcre} value={p.perAcre[lang]} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        <Fact label={u.costAcre} value={p.costPerAcre[lang]} />
        <Fact label={u.pack} value={p.price[lang]} />
        <Fact label={u.wait} value={p.waitDays == null ? u.noWait : `${p.waitDays} ${u.days}`} />
      </View>
      <Text style={[T.tiny, { color: C.sootDim }]}>
        {u.registered}: {p.registered[lang]}
      </Text>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ maxWidth: '100%' }}>
      <Text style={[T.tiny, { color: C.sootDim }]}>{label}</Text>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.soot }}>{value}</Text>
    </View>
  );
}
