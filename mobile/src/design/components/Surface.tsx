import React from 'react';
import {StyleProp, StyleSheet, View, ViewProps, ViewStyle} from 'react-native';
import Svg, {Defs, LinearGradient, RadialGradient, Rect, Stop} from 'react-native-svg';
import {useTheme} from '../theme';
import {radius, space} from '../tokens';

let gradientSeq = 0;
const useGradientId = () => React.useRef(`g${++gradientSeq}`).current;

/** Absolutely-filled linear gradient (react-native-svg, no extra native module). */
export function Gradient({
  colors,
  angle = 'diagonal',
  style,
  opacity = 1,
}: {
  colors: [string, string];
  angle?: 'diagonal' | 'vertical' | 'horizontal';
  style?: StyleProp<ViewStyle>;
  opacity?: number;
}) {
  const id = useGradientId();
  const end = angle === 'vertical' ? {x2: '0', y2: '1'} : angle === 'horizontal' ? {x2: '1', y2: '0'} : {x2: '1', y2: '1'};
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" {...end}>
            <Stop offset="0" stopColor={colors[0]} stopOpacity={opacity} />
            <Stop offset="1" stopColor={colors[1]} stopOpacity={opacity} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** Soft coloured glow used behind hero areas. Decorative only. */
export function Glow({color, size = 360, style}: {color: string; size?: number; style?: StyleProp<ViewStyle>}) {
  const id = useGradientId();
  return (
    <View pointerEvents="none" style={[{position: 'absolute', width: size, height: size}, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={0.45} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export interface CardProps extends ViewProps {
  padded?: boolean;
  strong?: boolean;
  tint?: string; // optional coloured wash, e.g. colors.foodSoft
  style?: StyleProp<ViewStyle>;
}

/** Translucent layered "glass" card with a hairline border. Readability first: no blur behind text. */
export function Card({padded = true, strong, tint, style, children, ...rest}: CardProps) {
  const {colors, dark} = useTheme();
  return (
    <View
      {...rest}
      style={[
        styles.card,
        {
          backgroundColor: tint ?? (strong ? colors.surfaceStrong : colors.surface),
          borderColor: colors.border,
          shadowColor: dark ? '#000' : '#4F46E5',
          shadowOpacity: dark ? 0.35 : 0.08,
        },
        padded && {padding: space.lg},
        style,
      ]}>
      {children}
    </View>
  );
}

export function Divider({inset = 0}: {inset?: number}) {
  const {colors} = useTheme();
  return <View style={{height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: inset}} />;
}

export function Row({style, ...rest}: ViewProps) {
  return <View {...rest} style={[{flexDirection: 'row', alignItems: 'center'}, style]} />;
}

export function Spacer({size = space.md, flex}: {size?: number; flex?: boolean}) {
  return <View style={flex ? {flex: 1} : {height: size, width: size}} />;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: {width: 0, height: 10},
    shadowRadius: 24,
    elevation: 0,
  },
});
