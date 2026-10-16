// Design tokens. Burnt orange carries the app, warm ivory is the accent surface/ink on it, and soft black
// marks what matters right now (live values, things that are on, the primary action).
import { StyleSheet } from 'react-native';

export const C = {
  ember: '#D5360C', // majority: screen background
  emberDeep: '#A82A08', // pressed states, hairlines and quiet panels on ember
  emberSoft: '#E4643E', // target bands on ivory charts
  ivory: '#E6D5BD', // accent: cards, text on ember
  ivoryDim: 'rgba(230,213,189,0.88)', // secondary text on ember
  ivoryLine: 'rgba(230,213,189,0.28)',
  soot: '#101010', // highlight: live numbers, active state, primary buttons
  sootDim: 'rgba(16,16,16,0.62)', // secondary text on ivory
  sootLine: 'rgba(16,16,16,0.14)',
};

export const F = {
  display: 'BricolageGrotesque_800ExtraBold',
  displayMid: 'BricolageGrotesque_600SemiBold',
  body: 'InstrumentSans_400Regular',
  bodyMid: 'InstrumentSans_500Medium',
  bodyBold: 'InstrumentSans_700Bold',
};

// Type scale (pt): 12 / 14 / 16 / 20 / 28 / 44 / 112
export const T = StyleSheet.create({
  hero: { fontFamily: F.display, fontSize: 112, lineHeight: 104, letterSpacing: -4, color: C.ivory },
  h1: { fontFamily: F.display, fontSize: 44, lineHeight: 46, letterSpacing: -1.2, color: C.ivory },
  h2: { fontFamily: F.displayMid, fontSize: 28, lineHeight: 32, letterSpacing: -0.5, color: C.ivory },
  h3: { fontFamily: F.displayMid, fontSize: 20, lineHeight: 24, color: C.ivory },
  body: { fontFamily: F.body, fontSize: 16, lineHeight: 23, color: C.ivory },
  bodySm: { fontFamily: F.body, fontSize: 14, lineHeight: 20, color: C.ivoryDim },
  label: { fontFamily: F.bodyMid, fontSize: 14, lineHeight: 18, color: C.ivoryDim },
  tiny: { fontFamily: F.bodyMid, fontSize: 12, lineHeight: 16, color: C.ivoryDim },
});

export const GUTTER = 20;
export const RADIUS = { card: 22, chip: 999, slab: 28 };
