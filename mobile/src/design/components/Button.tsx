import React from 'react';
import {ActivityIndicator, Pressable, StyleProp, StyleSheet, View, ViewStyle} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withSpring} from 'react-native-reanimated';
import type {LucideIcon} from 'lucide-react-native';
import {haptics} from '../haptics';
import {useTheme} from '../theme';
import {radius, space, touch} from '../tokens';
import {Gradient} from './Surface';
import {Text} from './Text';

type Variant = 'primary' | 'food' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg' | 'sm';
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  testID?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function usePressScale() {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({transform: [{scale: scale.value}]}));
  return {
    style,
    onPressIn: () => {
      scale.value = withSpring(0.97, {damping: 20, stiffness: 400});
    },
    onPressOut: () => {
      scale.value = withSpring(1, {damping: 14, stiffness: 300});
    },
  };
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon: Icon,
  loading,
  disabled,
  size = 'md',
  style,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const {colors} = useTheme();
  const press = usePressScale();
  const inactive = disabled || loading;
  const height = size === 'lg' ? 56 : size === 'sm' ? 40 : touch;
  const filled = variant === 'primary' || variant === 'food' || variant === 'danger';
  const fg = filled ? '#FFFFFF' : variant === 'secondary' ? colors.text : colors.accentText;
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{disabled: !!inactive, busy: !!loading}}
      disabled={inactive}
      onPress={() => {
        haptics.tap();
        onPress?.();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={size === 'sm' ? 4 : 0}
      style={[
        styles.base,
        {height, minHeight: Math.max(height, 40), opacity: inactive ? 0.5 : 1},
        variant === 'secondary' && {backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1},
        variant === 'danger' && {backgroundColor: colors.negative},
        press.style,
        style,
      ]}>
      {variant === 'primary' && <Gradient colors={colors.gradient} angle="horizontal" />}
      {variant === 'food' && <Gradient colors={colors.gradientFood} angle="horizontal" />}
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <>
            {Icon ? <Icon size={size === 'sm' ? 16 : 18} color={fg} strokeWidth={2.2} /> : null}
            <Text variant={size === 'sm' ? 'smallStrong' : 'bodyStrong'} color={fg} numberOfLines={1}>
              {label}
            </Text>
          </>
        )}
      </View>
    </AnimatedPressable>
  );
}

export function IconButton({
  icon: Icon,
  onPress,
  label,
  tone,
  size = 44,
  filled,
  disabled,
  testID,
}: {
  icon: LucideIcon;
  onPress: () => void;
  label: string;
  tone?: string;
  size?: number;
  filled?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const {colors} = useTheme();
  const press = usePressScale();
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={Math.max(0, (touch - size) / 2)}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: filled ? colors.surfaceStrong : 'transparent',
          borderWidth: filled ? StyleSheet.hairlineWidth : 0,
          borderColor: colors.border,
          opacity: disabled ? 0.4 : 1,
        },
        press.style,
      ]}>
      <Icon size={20} color={tone ?? colors.text} strokeWidth={2.1} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  content: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm},
});
