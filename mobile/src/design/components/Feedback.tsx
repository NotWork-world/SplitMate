import React, {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';
import Animated, {
  FadeInDown,
  FadeOutDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {AlertTriangle, CheckCircle2, Info, WifiOff, type LucideIcon} from 'lucide-react-native';
import {useTheme} from '../theme';
import {radius, space} from '../tokens';
import {Button} from './Button';
import {Text} from './Text';

export function EmptyState({
  emoji,
  title,
  body,
  action,
}: {
  emoji?: string;
  title: string;
  body?: string;
  action?: {label: string; onPress: () => void};
}) {
  const {colors} = useTheme();
  return (
    <View style={styles.center}>
      {emoji ? (
        <View style={[styles.emojiDisc, {backgroundColor: colors.accentSoft}]}>
          <Text style={{fontSize: 34, lineHeight: 42}}>{emoji}</Text>
        </View>
      ) : null}
      <Text variant="heading" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="muted" align="center" style={{marginTop: space.xs, maxWidth: 300}}>
          {body}
        </Text>
      ) : null}
      {action ? <Button label={action.label} onPress={action.onPress} style={{marginTop: space.xl}} /> : null}
    </View>
  );
}

export function ErrorState({message, onRetry, offline}: {message: string; onRetry?: () => void; offline?: boolean}) {
  const {colors} = useTheme();
  const Icon = offline ? WifiOff : AlertTriangle;
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <View style={[styles.emojiDisc, {backgroundColor: colors.negativeSoft}]}>
        <Icon size={30} color={colors.negative} />
      </View>
      <Text variant="heading" align="center">
        {offline ? "You're offline" : "Couldn't load this"}
      </Text>
      <Text variant="body" tone="muted" align="center" style={{marginTop: space.xs, maxWidth: 300}}>
        {message}
      </Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} style={{marginTop: space.xl}} /> : null}
    </View>
  );
}

export function LoadingState({label}: {label?: string}) {
  const {colors} = useTheme();
  return (
    <View style={styles.center} accessibilityLabel={label ?? 'Loading'}>
      <ActivityIndicator color={colors.accent} size="large" />
      {label ? (
        <Text variant="small" tone="muted" style={{marginTop: space.md}}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function Skeleton({height = 16, width = '100%', radiusSize = radius.sm}: {height?: number; width?: number | `${number}%`; radiusSize?: number}) {
  const {colors} = useTheme();
  const o = useSharedValue(0.5);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, {duration: 800}), -1, true);
  }, [o]);
  const style = useAnimatedStyle(() => ({opacity: o.value}));
  return <Animated.View style={[{height, width, borderRadius: radiusSize, backgroundColor: colors.surfaceStrong}, style]} />;
}

type BannerTone = 'info' | 'warning' | 'negative' | 'positive';

export function Banner({tone = 'info', title, body, icon}: {tone?: BannerTone; title: string; body?: string; icon?: LucideIcon}) {
  const {colors} = useTheme();
  const map = {
    info: [colors.accentSoft, colors.accentText, Info],
    warning: [colors.warningSoft, colors.warning, AlertTriangle],
    negative: [colors.negativeSoft, colors.negative, AlertTriangle],
    positive: [colors.positiveSoft, colors.positive, CheckCircle2],
  } as const;
  const [bg, fg, DefaultIcon] = map[tone];
  const Icon = icon ?? DefaultIcon;
  return (
    <View style={[styles.banner, {backgroundColor: bg}]} accessibilityRole="alert">
      <Icon size={18} color={fg} style={{marginTop: 2}} />
      <View style={{flex: 1}}>
        <Text variant="smallStrong" color={fg}>
          {title}
        </Text>
        {body ? (
          <Text variant="small" tone="muted" style={{marginTop: 2}}>
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ toasts

type Toast = {id: number; message: string; tone: 'positive' | 'negative' | 'info'};
const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({children}: {children: React.ReactNode}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  const show = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = ++seq.current;
    setToasts(t => [...t.slice(-2), {id, message, tone}]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <View pointerEvents="none" style={[styles.toastWrap, {bottom: insets.bottom + 90}]}>
        {toasts.map(t => (
          <Animated.View
            key={t.id}
            entering={FadeInDown.springify().damping(18)}
            exiting={FadeOutDown}
            accessibilityLiveRegion="polite"
            style={[
              styles.toast,
              {
                backgroundColor: colors.bgElevated,
                borderColor: t.tone === 'negative' ? colors.negative : t.tone === 'positive' ? colors.positive : colors.border,
              },
            ]}>
            <Text variant="smallStrong">{t.message}</Text>
          </Animated.View>
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = StyleSheet.create({
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, minHeight: 260},
  emojiDisc: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  banner: {flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md},
  toastWrap: {position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center', gap: space.sm},
  toast: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: 420,
  },
});
