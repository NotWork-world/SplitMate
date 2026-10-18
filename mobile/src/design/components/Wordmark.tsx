import React from 'react';
import {View} from 'react-native';
import Svg, {Circle, Defs, LinearGradient, Path, Stop} from 'react-native-svg';
import {useTheme} from '../theme';
import {Text} from './Text';

/** The SplitMate mark: two overlapping halves of a plate, split by a clean diagonal. */
export function LogoMark({size = 56}: {size?: number}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="SplitMate">
      <Defs>
        <LinearGradient id="lm-a" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#9479FF" />
          <Stop offset="1" stopColor="#4F46E5" />
        </LinearGradient>
        <LinearGradient id="lm-b" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FF946F" />
          <Stop offset="1" stopColor="#FF5E8A" />
        </LinearGradient>
      </Defs>
      <Path d="M30 6 A26 26 0 0 0 30 58 Z" fill="url(#lm-a)" />
      <Path d="M36 10 A22 22 0 0 1 36 54 Z" fill="url(#lm-b)" />
      <Circle cx="22" cy="32" r="6" fill="#FFFFFF" opacity={0.9} />
    </Svg>
  );
}

export function Wordmark({size = 30}: {size?: number}) {
  const {colors} = useTheme();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: size * 0.3}}>
      <LogoMark size={size * 1.25} />
      <Text variant="hero" style={{fontSize: size, lineHeight: size * 1.2}}>
        Split
        <Text variant="hero" style={{fontSize: size, lineHeight: size * 1.2}} color={colors.food}>
          Mate
        </Text>
      </Text>
    </View>
  );
}
