import React from 'react';
import {StyleProp, StyleSheet, View, ViewProps, ViewStyle} from 'react-native';
import Svg, {Defs, LinearGradient, RadialGradient, Rect, Stop} from 'react-native-svg';
import {useTheme} from '../theme';
import {radius, space} from '../tokens';
import {Text} from './Text';

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
          shadowColor: '#1F3B2D',
          shadowOpacity: dark ? 0 : 0.04,
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


/**
 * Night-city bokeh behind every screen: soft red, teal and amber light pools
 * on near-black, like the out-of-focus street in the reference. Pure SVG, so
 * it costs no image download and stays crisp on any screen size.
 */
export function Backdrop({dark}: {dark: boolean}) {
  const lights: Array<[number, number, number, string, number]> = dark
    ? [
        [-0.15, 0.08, 0.75, '#E5484D', 0.42],
        [1.1, 0.18, 0.7, '#14B8A6', 0.32],
        [0.85, 0.62, 0.55, '#3B82F6', 0.22],
        [-0.1, 0.78, 0.6, '#FF7A59', 0.26],
        [0.55, 1.05, 0.6, '#14B8A6', 0.2],
      ]
    : [
        [-0.1, 0.05, 0.7, '#14B8A6', 0.16],
        [1.1, 0.3, 0.6, '#FF7A59', 0.12],
      ];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 100 200" preserveAspectRatio="xMidYMid slice">
        <Defs>
          {lights.map(([, , , color, op], i) => (
            <RadialGradient key={i} id={`bk${i}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={color} stopOpacity={op} />
              <Stop offset="0.55" stopColor={color} stopOpacity={op * 0.35} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {lights.map(([x, y, r], i) => (
          <Rect key={i} x={x * 100 - r * 100} y={y * 200 - r * 100} width={r * 200} height={r * 200} fill={`url(#bk${i})`} />
        ))}
      </Svg>
    </View>
  );
}

/** Soft tinted tile with a small title, used for paired summaries. */
export function Panel({
  title,
  colors: tint,
  children,
  style,
  footer,
}: {
  title: string;
  colors: [string, string];
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  footer?: React.ReactNode;
}) {
  const {colors, dark} = useTheme();
  return (
    <View style={[styles.panel, {backgroundColor: dark ? colors.surface : tint[0], borderColor: colors.border}, style]}>
      <Text variant="smallStrong" tone="muted" accessibilityRole="header" style={{paddingHorizontal: space.lg, paddingTop: space.lg}}>
        {title}
      </Text>
      <View style={{padding: space.lg, paddingTop: space.sm, flexGrow: 1}}>{children}</View>
      {footer ? <View style={[styles.panelFooter, {borderColor: colors.border}]}>{footer}</View> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: {borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden'},
  panelFooter: {borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, paddingVertical: space.sm},
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: {width: 0, height: 4},
    shadowRadius: 12,
    elevation: 0,
  },
});
