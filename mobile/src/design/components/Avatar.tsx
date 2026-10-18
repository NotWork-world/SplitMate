import React from 'react';
import {StyleSheet, View} from 'react-native';
import {useTheme} from '../theme';
import {Text} from './Text';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return '?';
  }
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase();
}

function hsl(h: number, s: number, l: number) {
  return `hsl(${Math.round(h)}, ${s}%, ${l}%)`;
}

/** Initials on a two-tone gradient-ish disc derived from the person's hue. */
export function Avatar({
  name,
  hue = 260,
  size = 40,
  ring,
  selected,
}: {
  name: string;
  hue?: number;
  size?: number;
  ring?: boolean;
  selected?: boolean;
}) {
  const {colors, dark} = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: hsl(hue, 70, dark ? 32 : 88),
        borderWidth: ring || selected ? 2 : 0,
        borderColor: selected ? colors.accent : colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      <View
        style={[
          StyleSheet.absoluteFill,
          {backgroundColor: hsl(hue + 30, 80, dark ? 45 : 75), opacity: 0.35, transform: [{translateY: size * 0.55}]},
        ]}
      />
      <Text
        style={{fontSize: size * 0.38, lineHeight: size * 0.46}}
        variant="bodyStrong"
        color={dark ? hsl(hue, 90, 88) : hsl(hue, 60, 28)}>
        {initials(name)}
      </Text>
    </View>
  );
}

export function AvatarStack({
  people,
  size = 28,
  max = 4,
}: {
  people: Array<{name: string; hue?: number}>;
  size?: number;
  max?: number;
}) {
  const {colors} = useTheme();
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <View
      style={{flexDirection: 'row'}}
      accessible
      accessibilityLabel={`${people.length} people: ${people.map(p => p.name).join(', ')}`}>
      {shown.map((p, i) => (
        <View key={`${p.name}-${i}`} style={{marginLeft: i ? -size * 0.32 : 0}}>
          <Avatar name={p.name} hue={p.hue} size={size} ring />
        </View>
      ))}
      {extra > 0 ? (
        <View
          style={{
            marginLeft: -size * 0.32,
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.surfaceStrong,
            borderWidth: 2,
            borderColor: colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text variant="caption" tone="muted">
            +{extra}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
