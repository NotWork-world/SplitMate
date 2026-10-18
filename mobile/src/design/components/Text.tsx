import React from 'react';
import {Text as RNText, TextProps, TextStyle} from 'react-native';
import {useTheme} from '../theme';
import {fonts, type as typeScale, TypeVariant} from '../tokens';

type Tone = 'default' | 'muted' | 'faint' | 'accent' | 'positive' | 'negative' | 'food' | 'warning' | 'inverse';

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  tone?: Tone;
  color?: string;
  align?: TextStyle['textAlign'];
  tabular?: boolean;
}

export function Text({variant = 'body', tone = 'default', color, align, tabular, style, ...rest}: AppTextProps) {
  const {colors} = useTheme();
  const toneColor: Record<Tone, string> = {
    default: colors.text,
    muted: colors.textMuted,
    faint: colors.textFaint,
    accent: colors.accentText,
    positive: colors.positive,
    negative: colors.negative,
    food: colors.food,
    warning: colors.warning,
    inverse: '#FFFFFF',
  };
  const isAmount = variant.startsWith('amount');
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[
        typeScale[variant],
        {color: color ?? toneColor[tone], textAlign: align},
        (tabular || isAmount) && {fontVariant: ['tabular-nums']},
        style,
      ]}
    />
  );
}

/** Italic serif accent inside a serif headline: <Text variant="hero">Split <Accent>only</Accent> what you shared</Text>. */
export function Accent({children, color}: {children: React.ReactNode; color?: string}) {
  return <RNText style={{fontFamily: fonts.serifItalic, color}}>{children}</RNText>;
}
