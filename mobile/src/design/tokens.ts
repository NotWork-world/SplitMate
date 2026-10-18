// SplitMate design tokens. Midnight navy + violet/indigo, lavender accents,
// coral for food and primary money actions, mint/rose for owed/owing.

export const palette = {
  midnight950: '#070A16',
  midnight900: '#0B0F1F',
  midnight850: '#10152A',
  midnight800: '#141A33',
  midnight700: '#1D2445',
  midnight600: '#2A3260',
  violet500: '#7C5CFF',
  violet400: '#9479FF',
  indigo600: '#4F46E5',
  indigo500: '#6366F1',
  lavender300: '#C4B5FD',
  lavender200: '#DDD6FE',
  coral500: '#FF7A59',
  coral400: '#FF946F',
  amber400: '#FFC260',
  mint400: '#34D399',
  mint300: '#6EE7B7',
  rose400: '#FB7185',
  rose300: '#FDA4AF',
  white: '#FFFFFF',
  ink900: '#0E1124',
  ink700: '#2B2F4A',
  ink500: '#5B6080',
  paper: '#F6F5FF',
};

export interface ThemeColors {
  bg: string;
  bgElevated: string;
  surface: string; // translucent "glass" card fill
  surfaceStrong: string;
  surfacePressed: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  food: string;
  foodSoft: string;
  positive: string; // you are owed
  positiveSoft: string;
  negative: string; // you owe
  negativeSoft: string;
  warning: string;
  warningSoft: string;
  gradient: [string, string];
  gradientFood: [string, string];
  overlay: string;
  statusBar: 'light-content' | 'dark-content';
}

export const darkColors: ThemeColors = {
  bg: palette.midnight900,
  bgElevated: palette.midnight850,
  surface: 'rgba(255,255,255,0.055)',
  surfaceStrong: 'rgba(255,255,255,0.09)',
  surfacePressed: 'rgba(255,255,255,0.13)',
  border: 'rgba(196,181,253,0.14)',
  borderStrong: 'rgba(196,181,253,0.32)',
  text: '#F4F2FF',
  textMuted: '#B3B0D3',
  textFaint: '#7E7BA3',
  accent: palette.violet500,
  accentText: palette.lavender300,
  accentSoft: 'rgba(124,92,255,0.18)',
  food: palette.coral500,
  foodSoft: 'rgba(255,122,89,0.16)',
  positive: palette.mint400,
  positiveSoft: 'rgba(52,211,153,0.14)',
  negative: palette.rose400,
  negativeSoft: 'rgba(251,113,133,0.14)',
  warning: palette.amber400,
  warningSoft: 'rgba(255,194,96,0.14)',
  gradient: [palette.violet500, palette.indigo600],
  gradientFood: [palette.coral500, '#FF5E8A'],
  overlay: 'rgba(4,6,15,0.72)',
  statusBar: 'light-content',
};

export const lightColors: ThemeColors = {
  bg: palette.paper,
  bgElevated: palette.white,
  surface: 'rgba(255,255,255,0.86)',
  surfaceStrong: palette.white,
  surfacePressed: 'rgba(124,92,255,0.08)',
  border: 'rgba(43,47,74,0.10)',
  borderStrong: 'rgba(79,70,229,0.30)',
  text: palette.ink900,
  textMuted: palette.ink500,
  textFaint: '#8C90AE',
  accent: palette.indigo600,
  accentText: palette.indigo600,
  accentSoft: 'rgba(99,102,241,0.12)',
  food: '#E8582F',
  foodSoft: 'rgba(255,122,89,0.14)',
  positive: '#059669',
  positiveSoft: 'rgba(5,150,105,0.10)',
  negative: '#E11D48',
  negativeSoft: 'rgba(225,29,72,0.09)',
  warning: '#B45309',
  warningSoft: 'rgba(245,158,11,0.14)',
  gradient: [palette.violet500, palette.indigo600],
  gradientFood: [palette.coral500, '#FF5E8A'],
  overlay: 'rgba(14,17,36,0.45)',
  statusBar: 'dark-content',
};

export const space = {xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48};
export const radius = {sm: 10, md: 14, lg: 20, xl: 28, pill: 999};
export const touch = 48;

export const fonts = {
  display: 'Manrope-ExtraBold',
  heading: 'Manrope-Bold',
  headingMedium: 'Manrope-SemiBold',
  body: 'Inter-Regular',
  bodyMedium: 'Inter-Medium',
  bodySemi: 'Inter-SemiBold',
  bodyBold: 'Inter-Bold',
};

export const type = {
  hero: {fontFamily: fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.6},
  title: {fontFamily: fonts.heading, fontSize: 24, lineHeight: 30, letterSpacing: -0.3},
  heading: {fontFamily: fonts.heading, fontSize: 18, lineHeight: 24, letterSpacing: -0.1},
  subheading: {fontFamily: fonts.headingMedium, fontSize: 15, lineHeight: 20},
  body: {fontFamily: fonts.body, fontSize: 15, lineHeight: 22},
  bodyStrong: {fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 22},
  small: {fontFamily: fonts.body, fontSize: 13, lineHeight: 18},
  smallStrong: {fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 18},
  caption: {fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 14, letterSpacing: 0.6},
  amountHero: {fontFamily: fonts.display, fontSize: 38, lineHeight: 44, letterSpacing: -0.8},
  amount: {fontFamily: fonts.heading, fontSize: 17, lineHeight: 22},
  amountSmall: {fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 18},
} as const;

export type TypeVariant = keyof typeof type;
