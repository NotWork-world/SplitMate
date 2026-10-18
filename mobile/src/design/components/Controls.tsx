import React from 'react';
import {Pressable, StyleSheet, Switch, View} from 'react-native';
import {ChevronRight, type LucideIcon} from 'lucide-react-native';
import {haptics} from '../haptics';
import {useTheme} from '../theme';
import {radius, space, touch} from '../tokens';
import {Text} from './Text';

export function Chip({
  label,
  selected,
  onPress,
  icon: Icon,
  emoji,
  tone,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: LucideIcon;
  emoji?: string;
  tone?: 'food' | 'accent';
}) {
  const {colors} = useTheme();
  const active = tone === 'food' ? colors.food : colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected: !!selected}}
      accessibilityLabel={label}
      onPress={() => {
        haptics.tap();
        onPress?.();
      }}
      hitSlop={6}
      style={({pressed}) => [
        styles.chip,
        {
          backgroundColor: selected ? (tone === 'food' ? colors.foodSoft : colors.accentSoft) : colors.surface,
          borderColor: selected ? active : colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      {emoji ? <Text style={{fontSize: 14}}>{emoji}</Text> : null}
      {Icon ? <Icon size={15} color={selected ? active : colors.textMuted} /> : null}
      <Text variant="smallStrong" color={selected ? (tone === 'food' ? colors.food : colors.accentText) : colors.textMuted}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{value: T; label: string}>;
  value: T;
  onChange: (v: T) => void;
}) {
  const {colors} = useTheme();
  return (
    <View style={[styles.segment, {backgroundColor: colors.surface, borderColor: colors.border}]} accessibilityRole="tablist">
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{selected: on}}
            onPress={() => {
              haptics.tap();
              onChange(o.value);
            }}
            style={[styles.segmentItem, on && {backgroundColor: colors.accentSoft, borderColor: colors.borderStrong}]}>
            <Text variant="smallStrong" color={on ? colors.accentText : colors.textMuted} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  chevron = !!onPress,
  icon: Icon,
  destructive,
  testID,
}: {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  icon?: LucideIcon;
  destructive?: boolean;
  testID?: string;
}) {
  const {colors} = useTheme();
  return (
    <Pressable
      testID={testID}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({pressed}) => [styles.row, pressed && {backgroundColor: colors.surfacePressed}]}>
      {left}
      {Icon ? (
        <View style={[styles.iconDisc, {backgroundColor: destructive ? colors.negativeSoft : colors.accentSoft}]}>
          <Icon size={18} color={destructive ? colors.negative : colors.accentText} />
        </View>
      ) : null}
      <View style={{flex: 1}}>
        <Text variant="bodyStrong" tone={destructive ? 'negative' : 'default'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ? <ChevronRight size={18} color={colors.textFaint} /> : null}
    </Pressable>
  );
}

export function SwitchRow({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const {colors} = useTheme();
  return (
    <View style={styles.row}>
      <View style={{flex: 1}}>
        <Text variant="bodyStrong">{title}</Text>
        {subtitle ? (
          <Text variant="small" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        trackColor={{true: colors.accent, false: colors.surfaceStrong}}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

export function ProgressBar({value, color}: {value: number; color?: string}) {
  const {colors} = useTheme();
  return (
    <View style={[styles.track, {backgroundColor: colors.surfaceStrong}]}>
      <View style={[styles.fill, {width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color ?? colors.accent}]} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  segment: {flexDirection: 'row', padding: 4, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth},
  segmentItem: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: space.sm,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch + 8, paddingVertical: space.sm, paddingHorizontal: space.xs},
  iconDisc: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  track: {height: 6, borderRadius: 3, overflow: 'hidden'},
  fill: {height: 6, borderRadius: 3},
});
