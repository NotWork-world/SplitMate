import React from 'react';
import {formatMoney} from '../../money/currency';
import {Text, AppTextProps} from './Text';

/** Exact money display. `signed` colours by direction: positive = owed to you, negative = you owe. */
export function Money({
  minor,
  currency,
  signed,
  showPlus,
  variant = 'amount',
  ...rest
}: {minor: number; currency: string; signed?: boolean; showPlus?: boolean} & AppTextProps) {
  const tone = signed ? (minor > 0 ? 'positive' : minor < 0 ? 'negative' : 'muted') : rest.tone;
  const text = formatMoney(signed ? Math.abs(minor) : minor, currency, {sign: showPlus});
  return (
    <Text variant={variant} {...rest} tone={tone} accessibilityLabel={rest.accessibilityLabel ?? text}>
      {text}
    </Text>
  );
}
