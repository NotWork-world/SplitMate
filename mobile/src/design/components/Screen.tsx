import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  ScrollViewProps,
  StatusBar,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import {ArrowLeft} from 'lucide-react-native';
import {useTheme} from '../theme';
import {space} from '../tokens';
import {IconButton} from './Button';
import {Glow} from './Surface';
import {Text} from './Text';

export function Screen({
  children,
  scroll = true,
  header,
  footer,
  refreshing,
  onRefresh,
  contentStyle,
  glow = true,
  keyboard,
  scrollProps,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  glow?: boolean;
  keyboard?: boolean;
  scrollProps?: ScrollViewProps;
}) {
  const {colors, dark} = useTheme();
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, {paddingBottom: space.huge + (footer ? 0 : insets.bottom)}, contentStyle]}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.bgElevated}
          />
        ) : undefined
      }
      {...scrollProps}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, {flex: 1}, contentStyle]}>{children}</View>
  );
  return (
    <View style={[styles.root, {backgroundColor: colors.bg, paddingTop: insets.top}]}>
      <StatusBar barStyle={colors.statusBar} />
      {glow && dark ? (
        <>
          <Glow color={colors.accent} size={420} style={{top: -200, right: -160}} />
          <Glow color={colors.food} size={300} style={{top: 120, left: -220}} />
        </>
      ) : null}
      {header}
      {keyboard ? (
        <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {body}
          {footer}
        </KeyboardAvoidingView>
      ) : (
        <>
          {body}
          {footer}
        </>
      )}
    </View>
  );
}

export function Header({
  title,
  subtitle,
  back = true,
  right,
  onBack,
}: {
  title?: string;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  const nav = useNavigation();
  return (
    <View style={styles.header}>
      {back ? (
        <IconButton icon={ArrowLeft} label="Back" onPress={onBack ?? (() => nav.goBack())} />
      ) : (
        <View style={{width: space.sm}} />
      )}
      <View style={{flex: 1, marginHorizontal: space.xs}}>
        {title ? (
          <Text variant="heading" numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text variant="small" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={{flexDirection: 'row', alignItems: 'center'}}>{right}</View>
    </View>
  );
}

/** Sticky bottom action area above the gesture bar. */
export function Footer({children}: {children: React.ReactNode}) {
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.footer,
        {paddingBottom: insets.bottom + space.md, backgroundColor: colors.bg, borderTopColor: colors.border},
      ]}>
      {children}
    </View>
  );
}

export function SectionTitle({title, action}: {title: string; action?: React.ReactNode}) {
  return (
    <View style={styles.section}>
      <Text variant="caption" tone="faint" style={{textTransform: 'uppercase'}}>
        {title}
      </Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, overflow: 'hidden'},
  content: {paddingHorizontal: space.lg, paddingTop: space.sm},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, minHeight: 56},
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xxl,
    marginBottom: space.sm,
    minHeight: 24,
  },
});
