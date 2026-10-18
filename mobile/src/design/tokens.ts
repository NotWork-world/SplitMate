// SplitMate design tokens — calm, editorial look: warm cream background, deep
// forest green and soft lime, white rounded cards, pastel dish cards, and a
// serif display face (Instrument Serif) with italic accents.

export const palette = {
  cream: '#F6F7EC',
  creamDeep: '#ECEFD8',
  white: '#FFFFFF',
  forest: '#1F3B2D',
  forestSoft: '#2F5240',
  lime: '#D9E99A',
  limeSoft: '#EEF5CF',
  ink: '#1A2620',
  inkMuted: '#5D6B63',
  inkFaint: '#97A39B',
  line: 'rgba(31,59,45,0.10)',
  rose: '#C2413A',
  roseSoft: '#F8E1DC',
  amber: '#A86A12',
  amberSoft: '#F7EBCF',
  sage: '#3E5D49',
  sky: '#B9D6EE',
  lavender: '#E4D2F3',
  peach: '#F6D2BE',
};

/** Pastel card colours for stacked dish cards and tiles (text on them is always ink). */
export const pastels = ['#D9E99A', '#B9D6EE', '#E4D2F3', '#F6D2BE', '#CFE3D4'];

export interface ThemeColors {
  bg: string;
  bgElevated: string;
  surface: string;
  surfaceStrong: string;
  surfacePressed: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string; // primary actions (forest green)
  accentText: string;
  accentSoft: string;
  highlight: string; // lime
  highlightText: string;
  food: string;
  foodSoft: string;
  positive: string;
  positiveSoft: string;
  negative: string;
  negativeSoft: string;
  warning: string;
  warningSoft: string;
  gradient: [string, string];
  gradientFood: [string, string];
  overlay: string;
  statusBar: 'light-content' | 'dark-content';
}

export const lightColors: ThemeColors = {
  bg: palette.cream,
  bgElevated: palette.white,
  surface: palette.white,
  surfaceStrong: palette.white,
  surfacePressed: palette.limeSoft,
  border: palette.line,
  borderStrong: 'rgba(31,59,45,0.35)',
  text: palette.ink,
  textMuted: palette.inkMuted,
  textFaint: palette.inkFaint,
  accent: palette.forest,
  accentText: palette.forest,
  accentSoft: palette.limeSoft,
  highlight: palette.lime,
  highlightText: palette.forest,
  food: '#B5541F',
  foodSoft: palette.peach,
  positive: '#2E7D4F',
  positiveSoft: '#E1F0E4',
  negative: palette.rose,
  negativeSoft: palette.roseSoft,
  warning: palette.amber,
  warningSoft: palette.amberSoft,
  gradient: [palette.forest, palette.forest],
  gradientFood: [palette.lime, palette.lime],
  overlay: 'rgba(26,38,32,0.40)',
  statusBar: 'dark-content',
};

export const darkColors: ThemeColors = {
  bg: '#101914',
  bgElevated: '#18241D',
  surface: '#18241D',
  surfaceStrong: '#1F2E25',
  surfacePressed: '#26382D',
  border: 'rgba(217,233,154,0.12)',
  borderStrong: 'rgba(217,233,154,0.40)',
  text: '#EEF2E6',
  textMuted: '#AAB6AD',
  textFaint: '#748278',
  accent: palette.lime,
  accentText: palette.lime,
  accentSoft: 'rgba(217,233,154,0.12)',
  highlight: palette.lime,
  highlightText: palette.forest,
  food: '#F0A27A',
  foodSoft: 'rgba(246,210,190,0.14)',
  positive: '#8FD3A3',
  positiveSoft: 'rgba(143,211,163,0.14)',
  negative: '#F08A80',
  negativeSoft: 'rgba(240,138,128,0.14)',
  warning: '#E9C46A',
  warningSoft: 'rgba(233,196,106,0.14)',
  gradient: [palette.lime, palette.lime],
  gradientFood: [palette.lime, palette.lime],
  overlay: 'rgba(0,0,0,0.6)',
  statusBar: 'light-content',
};

export const space = {xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48};
export const radius = {sm: 12, md: 16, lg: 22, xl: 30, pill: 999};
export const touch = 48;

export const fonts = {
  serif: 'InstrumentSerif-Regular',
  serifItalic: 'InstrumentSerif-Italic',
  display: 'InstrumentSerif-Regular',
  heading: 'Inter-SemiBold',
  headingMedium: 'Inter-Medium',
  body: 'Inter-Regular',
  bodyMedium: 'Inter-Medium',
  bodySemi: 'Inter-SemiBold',
  bodyBold: 'Inter-Bold',
};

export const type = {
  hero: {fontFamily: fonts.serif, fontSize: 42, lineHeight: 48},
  title: {fontFamily: fonts.serif, fontSize: 30, lineHeight: 36},
  heading: {fontFamily: fonts.heading, fontSize: 17, lineHeight: 24},
  subheading: {fontFamily: fonts.headingMedium, fontSize: 15, lineHeight: 20},
  body: {fontFamily: fonts.body, fontSize: 15, lineHeight: 22},
  bodyStrong: {fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 22},
  small: {fontFamily: fonts.body, fontSize: 13, lineHeight: 18},
  smallStrong: {fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 18},
  caption: {fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 14, letterSpacing: 0.4},
  amountHero: {fontFamily: fonts.serif, fontSize: 52, lineHeight: 58},
  amount: {fontFamily: fonts.bodySemi, fontSize: 17, lineHeight: 22},
  amountSmall: {fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 18},
} as const;

export type TypeVariant = keyof typeof type;

/** Kept for screens that pair two summaries; now soft tiles rather than coloured headers. */
export const panelHeaders = {
  owe: [palette.roseSoft, palette.roseSoft] as [string, string],
  owed: [palette.limeSoft, palette.limeSoft] as [string, string],
  neutral: [palette.creamDeep, palette.creamDeep] as [string, string],
};
