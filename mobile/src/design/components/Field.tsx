import React, {forwardRef, useEffect, useState} from 'react';
import {StyleProp, StyleSheet, TextInput, TextInputProps, View, ViewStyle} from 'react-native';
import {getCurrency, parseMoney, toInputText} from '../../money/currency';
import {useTheme} from '../theme';
import {fonts, radius, space, touch} from '../tokens';
import {Text} from './Text';

export interface FieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string;
  prefix?: string;
  suffix?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

export const TextField = forwardRef<React.ComponentRef<typeof TextInput>, FieldProps>(function TextFieldImpl(
  {label, error, hint, prefix, suffix, containerStyle, style, editable = true, ...rest},
  ref,
) {
  const {colors} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="smallStrong" tone="muted" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.box,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.negative : focused ? colors.borderStrong : colors.border,
            opacity: editable ? 1 : 0.6,
          },
        ]}>
        {prefix ? (
          <Text variant="bodyStrong" tone="muted" style={styles.affix}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          editable={editable}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.accent}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          onFocus={e => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={e => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          {...rest}
          style={[styles.input, {color: colors.text}, style]}
        />
        {suffix ? (
          <Text variant="smallStrong" tone="muted" style={styles.affix}>
            {suffix}
          </Text>
        ) : null}
      </View>
      {error ? (
        <Text variant="small" tone="negative" style={styles.below} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small" tone="faint" style={styles.below}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

/**
 * Money input that never touches floats: text is parsed straight to minor units.
 * Calls onChange(null) while the text isn't a valid amount for the currency.
 */
export function MoneyField({
  value,
  onChange,
  currency,
  allowNegative,
  ...rest
}: Omit<FieldProps, 'value' | 'onChange'> & {
  value: number | null;
  onChange: (minor: number | null) => void;
  currency: string;
  allowNegative?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : toInputText(value, currency));
  const [neg, setNeg] = useState(value !== null && value < 0);
  const exp = getCurrency(currency)?.exponent ?? 2;

  useEffect(() => {
    // Accept outside changes (e.g. edit from another screen) without fighting the user's typing.
    const parsed = parseMoney(text, currency);
    const current = parsed === null ? null : neg ? -parsed : parsed;
    if (value !== current) {
      setText(value === null ? '' : toInputText(Math.abs(value), currency));
      setNeg(value !== null && value < 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency]);

  return (
    <TextField
      {...rest}
      prefix={(neg ? '−' : '') + (getCurrency(currency)?.symbol.trim() ?? currency)}
      keyboardType={exp ? 'decimal-pad' : 'number-pad'}
      inputMode="decimal"
      value={text}
      onChangeText={t => {
        let isNeg = neg;
        if (allowNegative && t.includes('-')) {
          isNeg = !neg;
          t = t.replace(/-/g, '');
        }
        const cleaned = t.replace(/[^\d.]/g, '');
        setText(cleaned);
        setNeg(isNeg);
        const parsed = parseMoney(cleaned, currency);
        onChange(parsed === null ? null : isNeg ? -parsed : parsed);
      }}
      placeholder={exp ? '0.' + '0'.repeat(exp) : '0'}
    />
  );
}

const styles = StyleSheet.create({
  label: {marginBottom: space.xs + 2},
  box: {
    minHeight: touch + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md + 2,
  },
  input: {flex: 1, fontFamily: fonts.bodyMedium, fontSize: 16, paddingVertical: space.md},
  affix: {marginRight: space.xs},
  below: {marginTop: space.xs},
});
