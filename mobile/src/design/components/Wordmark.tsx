import React from 'react';
import {View} from 'react-native';
import Svg, {Defs, G, Line, LinearGradient, Path, Rect, Stop} from 'react-native-svg';
import {useTheme} from '../theme';
import {Accent, Text} from './Text';

export const LOGO_GOLD: [string, string] = ['#CDA86E', '#9A7240'];

/**
 * The SplitMate mark: an "S" and a "C" either side of a thin divider, with an
 * arrow running through both — money moving from one side to the other.
 * Drawn from circles and lines so the icon script (scripts/make-icons.py) can
 * reproduce exactly the same geometry. `framed` adds the rounded-square frame.
 */
export function LogoMark({size = 56, framed, color}: {size?: number; framed?: boolean; color?: string}) {
  const stroke = color ?? 'url(#logo-gold)';
  const w = 6.5;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="SplitMate logo">
      <Defs>
        <LinearGradient id="logo-gold" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={LOGO_GOLD[0]} />
          <Stop offset="1" stopColor={LOGO_GOLD[1]} />
        </LinearGradient>
      </Defs>
      {framed ? <Rect x="2" y="2" width="60" height="60" rx="13" stroke={stroke} strokeWidth={2.4} fill="none" /> : null}
      <G stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* S */}
        <Path d="M27 14 H18 A8 8 0 0 0 18 30 H20 A10 10 0 0 1 20 50 H10" />
        {/* C */}
        <Path d="M55 14 H44 A8 8 0 0 0 36 22 V42 A8 8 0 0 0 44 50 H55" />
      </G>
      <Line x1="32" y1="7" x2="32" y2="57" stroke={stroke} strokeWidth={1.6} />
      <Line x1="7" y1="32" x2="47" y2="32" stroke={stroke} strokeWidth={4.2} strokeLinecap="round" />
      <Path d="M45 24.5 L57 32 L45 39.5 Z" fill={stroke} />
    </Svg>
  );
}

export function Wordmark({size = 30, subtitle}: {size?: number; subtitle?: string}) {
  const {colors} = useTheme();
  const t = {fontSize: size * 1.15, lineHeight: size * 1.35};
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: size * 0.3}}>
      <LogoMark size={size * 1.3} />
      <Text variant="hero" style={t}>
        Split<Accent>Mate</Accent>
        {subtitle ? (
          <Text variant="small" color={colors.textFaint} style={{fontSize: size * 0.55}}>
            {'   '}
            {subtitle}
          </Text>
        ) : null}
      </Text>
    </View>
  );
}
