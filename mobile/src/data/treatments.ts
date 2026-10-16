// What a farmer should do when Leaf check finds a maize leaf disease: steps in order, products with dose and
// cost, prevention for the next crop. In English and Hindi. Shown (and read aloud) under a disease result.
//
// Doses and waiting periods: CIB&RC "Major Uses of Pesticides: Fungicides" (registered uses, as on
// 30.09.2026) and the Tamil Nadu Crop Production Guide for maize (TNAU). Per-acre amounts use 200 L of
// spray water per acre (the 500 L/ha the registrations assume); a 16 L knapsack tank is 1/12.5 of that.
// Prices: retailer listings in INR, checked 14 Oct 2026. They change often; confirm with a local dealer.

export type Lang = 'en' | 'hi';
/** A farmer-facing string in both languages. */
export type L = Record<Lang, string>;

export const PRICES_CHECKED: L = { en: '14 Oct 2026', hi: '14 अक्टूबर 2026' };

export interface Product {
  /** Active ingredient(s) and formulation, as registered. */
  ingredient: L;
  /** Common brand(s) in India (brand names stay as printed on the pack). */
  brands: string;
  /** Fungicide resistance group (FRAC): don't use the same group more than twice in a row. */
  frac: L;
  perLitre: L;
  perTank: L; // 16 L knapsack
  perAcre: L;
  /** What the farmer pays for one acre, one spray. */
  costPerAcre: L;
  /** Pack and price behind costPerAcre. */
  price: L;
  /** Days from the last spray to harvest (CIB&RC). */
  waitDays: number | null;
  /** The registered use on maize this relies on. */
  registered: L;
}

export interface Step {
  title: L;
  detail: L;
  cost?: L;
}

export interface TreatmentPlan {
  disease: L;
  /** One line a farmer reads first. */
  urgency: L;
  steps: Step[];
  products: Product[];
  prevention: L[];
  /** Anything the farmer must know about the evidence (e.g. no product registered for this disease). */
  caution?: L;
}

// ---------------- Products (registered on maize, CIB&RC MUP 30.09.2026) ----------------

const MANCOZEB: Product = {
  ingredient: { en: 'Mancozeb 75% WP', hi: 'मैंकोज़ेब 75% WP' },
  brands: 'Indofil M-45, Dithane M-45',
  frac: { en: 'M3 (contact, low resistance risk)', hi: 'M3 (संपर्क दवा, प्रतिरोध का खतरा कम)' },
  perLitre: { en: '2.5 g', hi: '2.5 ग्राम' },
  perTank: { en: '40 g', hi: '40 ग्राम' },
  perAcre: { en: '600–800 g in 300 L water', hi: '600–800 ग्राम, 300 लीटर पानी में' },
  costPerAcre: { en: '₹240–365', hi: '₹240–365' },
  price: { en: '1 kg ₹400–450', hi: '1 किलो ₹400–450' },
  waitDays: null,
  registered: { en: 'Maize leaf blight, downy mildew: 1.5–2 kg/ha', hi: 'मक्का का पत्ती झुलसा, डाउनी मिल्ड्यू: 1.5–2 किलो/हेक्टेयर' },
};

const KRESOXIM: Product = {
  ingredient: { en: 'Kresoxim-methyl 44.3% SC', hi: 'क्रेसोक्सिम-मिथाइल 44.3% SC' },
  brands: 'Tata Ergon',
  frac: { en: '11 (strobilurin)', hi: '11 (स्ट्रोबिल्यूरिन)' },
  perLitre: { en: '1 ml', hi: '1 मिली' },
  perTank: { en: '16 ml', hi: '16 मिली' },
  perAcre: { en: '200 ml', hi: '200 मिली' },
  costPerAcre: { en: '≈ ₹1,050 (₹1,305 for the 250 ml bottle)', hi: 'लगभग ₹1,050 (250 मिली की बोतल ₹1,305)' },
  price: { en: '250 ml ₹1,305', hi: '250 मिली ₹1,305' },
  waitDays: 25,
  registered: { en: 'Maize turcicum leaf blight and rust: 500 ml/ha', hi: 'मक्का का टर्सिकम पत्ती झुलसा और रतुआ: 500 मिली/हेक्टेयर' },
};

const AZOXY_DIFENO: Product = {
  ingredient: { en: 'Azoxystrobin 18.2% + Difenoconazole 11.4% SC', hi: 'एज़ॉक्सीस्ट्रोबिन 18.2% + डाइफेनोकोनाज़ोल 11.4% SC' },
  brands: 'Syngenta Amistar Top',
  frac: { en: '11 + 3 (strobilurin + triazole)', hi: '11 + 3 (स्ट्रोबिल्यूरिन + ट्राइएज़ोल)' },
  perLitre: { en: '1 ml', hi: '1 मिली' },
  perTank: { en: '16 ml', hi: '16 मिली' },
  perAcre: { en: '200 ml', hi: '200 मिली' },
  costPerAcre: { en: '≈ ₹1,070', hi: 'लगभग ₹1,070' },
  price: { en: '200 ml ₹1,071 · 500 ml ₹2,114', hi: '200 मिली ₹1,071 · 500 मिली ₹2,114' },
  waitDays: 26,
  registered: { en: 'Maize blight and downy mildew: 1 ml/L (500 ml/ha)', hi: 'मक्का का झुलसा और डाउनी मिल्ड्यू: 1 मिली/लीटर (500 मिली/हेक्टेयर)' },
};

const AZOXY_CYPRO: Product = {
  ingredient: { en: 'Azoxystrobin 18.2% + Cyproconazole 7.3% SC', hi: 'एज़ॉक्सीस्ट्रोबिन 18.2% + साइप्रोकोनाज़ोल 7.3% SC' },
  brands: 'Syngenta Amistar Xtra',
  frac: { en: '11 + 3 (strobilurin + triazole)', hi: '11 + 3 (स्ट्रोबिल्यूरिन + ट्राइएज़ोल)' },
  perLitre: { en: '2 ml', hi: '2 मिली' },
  perTank: { en: '32 ml', hi: '32 मिली' },
  perAcre: { en: '400 ml', hi: '400 मिली' },
  costPerAcre: { en: '≈ ₹1,620–1,690 (₹2,081 for the 500 ml bottle)', hi: 'लगभग ₹1,620–1,690 (500 मिली की बोतल ₹2,081)' },
  price: { en: '500 ml ₹2,081 · 1 L ₹4,007', hi: '500 मिली ₹2,081 · 1 लीटर ₹4,007' },
  waitDays: 52,
  registered: {
    en: 'Maize turcicum leaf blight and rust: 1 L/ha (TNAU guide, CIB recommendation)',
    hi: 'मक्का का टर्सिकम पत्ती झुलसा और रतुआ: 1 लीटर/हेक्टेयर (TNAU गाइड, CIB सिफ़ारिश)',
  },
};

const TEBU_TRIFLOX: Product = {
  ingredient: { en: 'Tebuconazole 50% + Trifloxystrobin 25% WG', hi: 'टेबुकोनाज़ोल 50% + ट्राइफ्लॉक्सीस्ट्रोबिन 25% WG' },
  brands: 'Bayer Nativo',
  frac: { en: '3 + 11 (triazole + strobilurin)', hi: '3 + 11 (ट्राइएज़ोल + स्ट्रोबिल्यूरिन)' },
  perLitre: { en: '0.7 g', hi: '0.7 ग्राम' },
  perTank: { en: '11 g', hi: '11 ग्राम' },
  perAcre: { en: '140 g', hi: '140 ग्राम' },
  costPerAcre: { en: '≈ ₹1,040 (₹1,243 for a 100 g + 50 g pack)', hi: 'लगभग ₹1,040 (100 ग्राम + 50 ग्राम का पैक ₹1,243)' },
  price: { en: '100 g ₹788 · 250 g ₹1,823', hi: '100 ग्राम ₹788 · 250 ग्राम ₹1,823' },
  waitDays: 15,
  registered: { en: 'Maize leaf blight: 350 g/ha', hi: 'मक्का का पत्ती झुलसा: 350 ग्राम/हेक्टेयर' },
};

// ---------------- Steps shared by every plan ----------------

const SAFETY: Step = {
  title: { en: 'Spray safely', hi: 'सुरक्षित छिड़काव करें' },
  detail: {
    en: 'Wear gloves, mask, goggles and full sleeves; spray in the morning or evening with no wind or rain; never eat, drink or smoke while spraying; wash hands and clothes after. Use only the dose on the label.',
    hi: 'दस्ताने, मास्क, चश्मा और पूरी बाँह के कपड़े पहनें; सुबह या शाम को छिड़काव करें, जब हवा या बारिश न हो; छिड़काव करते समय कुछ न खाएँ, न पिएँ, न धूम्रपान करें; बाद में हाथ और कपड़े धोएँ। लेबल पर लिखी मात्रा ही डालें।',
  },
  cost: {
    en: 'Gloves + mask about ₹200–500, or a full Kisan Kavach suit ₹3,880 (one-time)',
    hi: 'दस्ताने + मास्क लगभग ₹200–500, या पूरा किसान कवच सूट ₹3,880 (एक बार का खर्च)',
  },
};

const SPRAYER: Step = {
  title: { en: 'Sprayer', hi: 'स्प्रेयर' },
  detail: {
    en: 'A 16-litre knapsack sprayer covers an acre in about 12–13 tank-loads (200 L). Rent one from a neighbour or the KVK if you don’t own one.',
    hi: '16 लीटर का पीठ पर टाँगने वाला स्प्रेयर लगभग 12–13 टंकी (200 लीटर) में एक एकड़ कर देता है। अपना न हो तो पड़ोसी या KVK से किराए पर लें।',
  },
  cost: { en: '₹1,750–3,800 to buy (one-time)', hi: 'खरीदने पर ₹1,750–3,800 (एक बार का खर्च)' },
};

export const TREATMENTS: Record<string, TreatmentPlan> = {
  northern_leaf_blight: {
    disease: { en: 'Northern (turcicum) leaf blight', hi: 'उत्तरी (टर्सिकम) पत्ती झुलसा' },
    urgency: {
      en: 'Act this week: blight spreads leaf to leaf in humid weather and can cut yield badly if it reaches the ear leaf before flowering.',
      hi: 'इसी हफ़्ते कदम उठाएँ: नमी वाले मौसम में झुलसा एक पत्ती से दूसरी पत्ती पर फैलता है, और फूल आने से पहले भुट्टे वाली पत्ती तक पहुँच जाए तो पैदावार बहुत घटा सकता है।',
    },
    steps: [
      {
        title: { en: 'Remove the worst leaves today', hi: 'सबसे ख़राब पत्तियाँ आज ही हटाएँ' },
        detail: {
          en: 'Cut off lower leaves covered in long grey-tan lesions. Burn or bury them; don’t leave them in the field or the compost pit.',
          hi: 'लंबे भूरे-मटमैले धब्बों से भरी निचली पत्तियाँ काट दें। उन्हें जला दें या ज़मीन में गाड़ दें; खेत या खाद के गड्ढे में न छोड़ें।',
        },
        cost: { en: '₹0', hi: '₹0' },
      },
      {
        title: { en: 'First spray: mancozeb (cheapest)', hi: 'पहला छिड़काव: मैंकोज़ेब (सबसे सस्ता)' },
        detail: {
          en: 'Mancozeb 75% WP at 2.5 g per litre (40 g per 16 L tank) as soon as lesions appear. Repeat after 10 days if new lesions keep coming (TNAU).',
          hi: 'धब्बे दिखते ही मैंकोज़ेब 75% WP, 2.5 ग्राम प्रति लीटर (16 लीटर की टंकी में 40 ग्राम) डालें। नए धब्बे आते रहें तो 10 दिन बाद दोबारा छिड़कें (TNAU)।',
        },
        cost: { en: '₹240–365 per acre per spray', hi: 'हर छिड़काव में ₹240–365 प्रति एकड़' },
      },
      {
        title: { en: 'If it keeps spreading: a systemic fungicide', hi: 'फिर भी फैले तो: अंतःप्रवाही (सिस्टमिक) फफूंदनाशक' },
        detail: {
          en: 'Switch to Amistar Top (1 ml/L), Ergon (1 ml/L) or Nativo (0.7 g/L). Alternate them; don’t spray the same group (see FRAC) more than twice in a row.',
          hi: 'अमिस्टार टॉप (1 मिली/लीटर), एर्गन (1 मिली/लीटर) या नेटिवो (0.7 ग्राम/लीटर) पर जाएँ। इन्हें बदल-बदल कर डालें; एक ही समूह (FRAC देखें) लगातार दो बार से ज़्यादा न छिड़कें।',
        },
        cost: { en: '≈ ₹1,040–1,070 per acre per spray', hi: 'हर छिड़काव में लगभग ₹1,040–1,070 प्रति एकड़' },
      },
      {
        title: { en: 'Respect the waiting period', hi: 'कटाई से पहले की रोक मानें' },
        detail: {
          en: 'Stop spraying before harvest: Nativo 15 days, Ergon 25, Amistar Top 26, Amistar Xtra 52.',
          hi: 'कटाई से इतने दिन पहले छिड़काव बंद करें: नेटिवो 15 दिन, एर्गन 25, अमिस्टार टॉप 26, अमिस्टार एक्स्ट्रा 52।',
        },
        cost: { en: '₹0', hi: '₹0' },
      },
      {
        title: { en: 'Lower the leaf wetness', hi: 'पत्तियों को गीला कम रखें' },
        detail: {
          en: 'Water at the roots in the morning, not over the leaves; improve airflow. On the rig, lower the humidity target in Settings.',
          hi: 'सुबह जड़ों में पानी दें, पत्तियों पर नहीं; हवा का बहाव बढ़ाएँ। रिग पर Settings में नमी का लक्ष्य कम करें।',
        },
        cost: { en: '₹0', hi: '₹0' },
      },
      SPRAYER,
      SAFETY,
    ],
    products: [MANCOZEB, AZOXY_DIFENO, KRESOXIM, TEBU_TRIFLOX, AZOXY_CYPRO],
    prevention: [
      {
        en: 'Next crop, sow a resistant hybrid. In Tamil Nadu, CO 6 and COH(M) 8 resist turcicum blight; ask your agriculture office or KVK for local ones.',
        hi: 'अगली फसल में रोग-रोधी संकर (हाइब्रिड) बोएँ। तमिलनाडु में CO 6 और COH(M) 8 टर्सिकम झुलसे को सहते हैं; अपने इलाके के लिए कृषि कार्यालय या KVK से पूछें।',
      },
      {
        en: 'Treat seed with Pseudomonas fluorescens at 10 g per kg of seed (≈ 80 g per acre, about ₹32; 1 kg ≈ ₹400) (TNAU).',
        hi: 'बीज को स्यूडोमोनास फ्लोरेसेंस से उपचारित करें, 10 ग्राम प्रति किलो बीज (एक एकड़ में लगभग 80 ग्राम, लगभग ₹32; 1 किलो लगभग ₹400) (TNAU)।',
      },
      {
        en: 'Rotate with a non-cereal crop and plough crop residue under after harvest: the fungus survives on old leaves.',
        hi: 'अनाज के अलावा कोई दूसरी फसल बदल कर लें और कटाई के बाद फसल के अवशेष जुताई करके मिट्टी में दबा दें: फफूंद पुरानी पत्तियों पर ज़िंदा रहती है।',
      },
      {
        en: 'Keep 60 × 25 cm spacing so the canopy dries out after rain (TNAU).',
        hi: '60 × 25 सेमी की दूरी रखें ताकि बारिश के बाद पौधे जल्दी सूखें (TNAU)।',
      },
    ],
  },

  common_rust: {
    disease: { en: 'Common rust', hi: 'सामान्य रतुआ (रस्ट)' },
    urgency: {
      en: 'Spray early: rust is easiest to stop while the pustules are few and below the ear.',
      hi: 'जल्दी छिड़काव करें: जब फफोले कम हों और भुट्टे से नीचे हों, तभी रतुआ को रोकना सबसे आसान है।',
    },
    steps: [
      {
        title: { en: 'Remove heavily infected leaves', hi: 'ज़्यादा संक्रमित पत्तियाँ हटाएँ' },
        detail: {
          en: 'If only a few lower leaves have the cinnamon-brown pustules, pick them off and destroy them.',
          hi: 'अगर सिर्फ़ कुछ निचली पत्तियों पर दालचीनी जैसे भूरे फफोले हैं, तो उन्हें तोड़ कर नष्ट कर दें।',
        },
        cost: { en: '₹0', hi: '₹0' },
      },
      {
        title: { en: 'Spray kresoxim-methyl (registered for maize rust)', hi: 'क्रेसोक्सिम-मिथाइल छिड़कें (मक्का के रतुआ के लिए पंजीकृत)' },
        detail: {
          en: 'Ergon (kresoxim-methyl 44.3% SC) at 1 ml per litre (16 ml per 16 L tank) as soon as pustules appear (CIB&RC; TNAU).',
          hi: 'फफोले दिखते ही एर्गन (क्रेसोक्सिम-मिथाइल 44.3% SC), 1 मिली प्रति लीटर (16 लीटर की टंकी में 16 मिली) (CIB&RC; TNAU)।',
        },
        cost: { en: '≈ ₹1,050 per acre per spray', hi: 'हर छिड़काव में लगभग ₹1,050 प्रति एकड़' },
      },
      {
        title: { en: 'Second spray only if it spreads', hi: 'दूसरा छिड़काव तभी, जब रोग फैले' },
        detail: {
          en: 'If fresh pustules appear after about 15 days, use a different product: Amistar Xtra (azoxystrobin + cyproconazole) at 2 ml per litre, also registered for maize rust.',
          hi: 'अगर लगभग 15 दिन बाद नए फफोले आएँ, तो दूसरी दवा लें: अमिस्टार एक्स्ट्रा (एज़ॉक्सीस्ट्रोबिन + साइप्रोकोनाज़ोल), 2 मिली प्रति लीटर; यह भी मक्का के रतुआ के लिए पंजीकृत है।',
        },
        cost: { en: '≈ ₹1,620–1,690 per acre per spray', hi: 'हर छिड़काव में लगभग ₹1,620–1,690 प्रति एकड़' },
      },
      {
        title: { en: 'Respect the waiting period', hi: 'कटाई से पहले की रोक मानें' },
        detail: {
          en: 'Stop spraying before harvest: Ergon 25 days, Amistar Xtra 52.',
          hi: 'कटाई से इतने दिन पहले छिड़काव बंद करें: एर्गन 25 दिन, अमिस्टार एक्स्ट्रा 52।',
        },
        cost: { en: '₹0', hi: '₹0' },
      },
      {
        title: { en: 'Lower humidity', hi: 'नमी कम करें' },
        detail: {
          en: 'Rust likes cool, humid nights. Improve airflow and avoid wetting the leaves; on the rig, lower the humidity target.',
          hi: 'रतुआ को ठंडी, नमी वाली रातें पसंद हैं। हवा का बहाव बढ़ाएँ और पत्तियों को गीला न करें; रिग पर नमी का लक्ष्य कम करें।',
        },
        cost: { en: '₹0', hi: '₹0' },
      },
      SPRAYER,
      SAFETY,
    ],
    products: [KRESOXIM, AZOXY_CYPRO],
    prevention: [
      {
        en: 'Sow a rust-tolerant hybrid (COH(M) 8 is moderately resistant to polysora rust in Tamil Nadu trials); ask your KVK for local ones.',
        hi: 'रतुआ सहने वाला संकर बोएँ (तमिलनाडु के परीक्षणों में COH(M) 8 पॉलीसोरा रतुआ के प्रति मध्यम रोधी है); अपने इलाके के लिए KVK से पूछें।',
      },
      {
        en: 'Remove volunteer maize plants between seasons: rust only survives on living maize.',
        hi: 'दो फसलों के बीच अपने-आप उगे मक्का के पौधे हटा दें: रतुआ सिर्फ़ ज़िंदा मक्का पर बचता है।',
      },
      {
        en: 'Avoid very dense planting; keep 60 × 25 cm spacing.',
        hi: 'बहुत घनी बुवाई न करें; 60 × 25 सेमी की दूरी रखें।',
      },
    ],
  },

  gray_leaf_spot: {
    disease: { en: 'Gray leaf spot', hi: 'धूसर पत्ती धब्बा (ग्रे लीफ स्पॉट)' },
    urgency: {
      en: 'Watch it closely: gray leaf spot climbs from the lower leaves; it matters most if it reaches the ear leaf before tasseling.',
      hi: 'ध्यान से नज़र रखें: धूसर पत्ती धब्बा नीचे की पत्तियों से ऊपर चढ़ता है; नर मंजरी (झंडा) निकलने से पहले भुट्टे वाली पत्ती तक पहुँचे तो सबसे ज़्यादा नुकसान करता है।',
    },
    caution: {
      en: 'No fungicide is registered in India specifically for gray leaf spot of maize (CIB&RC list as on 30.09.2026). Start with the free steps below and ask your KVK or agriculture officer before spraying.',
      hi: 'भारत में मक्का के धूसर पत्ती धब्बे के लिए कोई भी फफूंदनाशक ख़ास तौर पर पंजीकृत नहीं है (CIB&RC सूची, 30.09.2026 तक)। नीचे के मुफ़्त कदमों से शुरू करें और छिड़काव से पहले अपने KVK या कृषि अधिकारी से पूछें।',
    },
    steps: [
      {
        title: { en: 'Remove infected lower leaves', hi: 'संक्रमित निचली पत्तियाँ हटाएँ' },
        detail: {
          en: 'Cut off leaves with the narrow rectangular grey-tan spots between the veins and destroy them.',
          hi: 'जिन पत्तियों पर नसों के बीच पतले, आयताकार भूरे-धूसर धब्बे हों, उन्हें काट कर नष्ट कर दें।',
        },
        cost: { en: '₹0', hi: '₹0' },
      },
      {
        title: { en: 'Cut leaf wetness and humidity', hi: 'पत्तियों का गीलापन और नमी घटाएँ' },
        detail: {
          en: 'The fungus needs long wet, humid periods. Water at the roots in the morning, open up the canopy, and on the rig lower the humidity target.',
          hi: 'इस फफूंद को लंबे समय तक गीलापन और नमी चाहिए। सुबह जड़ों में पानी दें, पौधों के बीच हवा आने दें, और रिग पर नमी का लक्ष्य कम करें।',
        },
        cost: { en: '₹0', hi: '₹0' },
      },
      {
        title: { en: 'If it reaches the ear leaf: ask before spraying', hi: 'भुट्टे वाली पत्ती तक पहुँचे तो: छिड़काव से पहले पूछें' },
        detail: {
          en: 'Triazole + strobilurin fungicides control gray leaf spot in field trials. In India, Amistar Top (azoxystrobin + difenoconazole, 1 ml/L) is registered on maize for blight; use it for gray leaf spot only if your KVK or agriculture officer advises it.',
          hi: 'खेत के परीक्षणों में ट्राइएज़ोल + स्ट्रोबिल्यूरिन फफूंदनाशक धूसर पत्ती धब्बे को रोकते हैं। भारत में अमिस्टार टॉप (एज़ॉक्सीस्ट्रोबिन + डाइफेनोकोनाज़ोल, 1 मिली/लीटर) मक्का के झुलसे के लिए पंजीकृत है; इसे धूसर पत्ती धब्बे पर तभी डालें जब KVK या कृषि अधिकारी सलाह दें।',
        },
        cost: { en: '≈ ₹1,070 per acre per spray, if advised', hi: 'सलाह मिलने पर, हर छिड़काव में लगभग ₹1,070 प्रति एकड़' },
      },
      SPRAYER,
      SAFETY,
    ],
    products: [AZOXY_DIFENO],
    prevention: [
      {
        en: 'Rotate away from maize for at least one season and plough the old residue under: the fungus survives on it.',
        hi: 'कम से कम एक मौसम मक्का की जगह दूसरी फसल लें और पुराने अवशेष जुताई करके दबा दें: फफूंद उन्हीं पर ज़िंदा रहती है।',
      },
      {
        en: 'Choose a hybrid rated tolerant to gray leaf spot for your region (ask your KVK).',
        hi: 'अपने इलाके के लिए धूसर पत्ती धब्बा सहने वाला संकर चुनें (KVK से पूछें)।',
      },
      {
        en: 'Keep 60 × 25 cm spacing and avoid evening irrigation.',
        hi: '60 × 25 सेमी की दूरी रखें और शाम को सिंचाई न करें।',
      },
    ],
  },
};

export const TREATMENT_SOURCES = [
  { label: 'CIB&RC Major Uses of Pesticides: Fungicides (30.09.2026)', url: 'https://ppqs.gov.in/divisions/cib-rc/major-uses-of-pesticides' },
  { label: 'TNAU Crop Production Guide: Maize', url: 'https://tnagriculture.in/dashboard/CPG/02_%20Maize.pdf' },
  { label: 'TNAU Agritech: maize diseases', url: 'https://agritech.tnau.ac.in/crop_protection/maize_disease/maize_4.html' },
  { label: 'Ward et al. 1997, chemical control of maize grey leaf spot', url: 'https://www.sciencedirect.com/science/article/abs/pii/S026121949600097X' },
  { label: 'Prices: BigHaat, Agriplex, GeM, IndiaMART listings', url: 'https://www.bighaat.com' },
];
