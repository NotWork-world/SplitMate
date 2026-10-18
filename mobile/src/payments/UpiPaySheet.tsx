import React, {useEffect, useState} from 'react';
import {Linking, Pressable, View} from 'react-native';
import {ChevronRight} from 'lucide-react-native';
import {Banner, Chip, Sheet, Text, radius, space, useTheme} from '../design';
import {installedUpiApps, UPI_APPS, upiPayUrl, type UpiAppKey} from './upi';

/**
 * Asks which UPI app to pay with, then opens that app on its pay screen with the
 * payee's UPI ID already filled in. The payer types the amount (or opts in to prefill).
 * SplitMate can't see the result, so the caller asks them to mark it paid afterwards.
 */
export function UpiPaySheet({
  visible,
  onClose,
  upiId,
  name,
  note,
  amount,
  amountLabel,
  onLaunched,
}: {
  visible: boolean;
  onClose: () => void;
  upiId: string;
  name: string;
  note?: string;
  amount?: string; // decimal text like "100.00"
  amountLabel?: string; // formatted, like "₹100.00"
  onLaunched: () => void;
}) {
  const {colors} = useTheme();
  const [installed, setInstalled] = useState<Set<UpiAppKey> | null>(null);
  const [prefill, setPrefill] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setError(null);
      installedUpiApps().then(setInstalled);
    }
  }, [visible]);

  const open = async (base: string, label: string) => {
    setError(null);
    try {
      await Linking.openURL(upiPayUrl(base, {upiId, name, note, amount: prefill ? amount : undefined}));
      onLaunched();
      onClose();
    } catch {
      setError(`${label} couldn't be opened. Is it installed?`);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Pay with which app?">
      <View style={{backgroundColor: colors.surfacePressed, borderRadius: radius.md, padding: space.md}}>
        <Text variant="small" tone="muted">
          Paying {name}
        </Text>
        <Text variant="bodyStrong" selectable>
          {upiId}
        </Text>
        {amountLabel ? (
          <Text variant="small" tone="muted" style={{marginTop: 4}}>
            Amount to enter: <Text variant="smallStrong">{amountLabel}</Text>
          </Text>
        ) : null}
      </View>
      {amount ? (
        <View style={{flexDirection: 'row', marginTop: space.sm}}>
          <Chip label={`Fill in ${amountLabel ?? amount} for me`} selected={prefill} onPress={() => setPrefill(p => !p)} />
        </View>
      ) : null}
      {error ? (
        <View style={{marginTop: space.sm}}>
          <Banner tone="negative" title={error} />
        </View>
      ) : null}
      <View style={{marginTop: space.md, gap: space.xs}}>
        {UPI_APPS.map(a => {
          const missing = installed !== null && a.key !== 'generic' && !installed.has(a.key);
          return (
            <Pressable
              key={a.key}
              accessibilityRole="button"
              accessibilityLabel={`Pay with ${a.label}${missing ? ', not installed' : ''}`}
              disabled={missing}
              onPress={() => open(a.base, a.label)}
              testID={`upi-app-${a.key}`}
              style={({pressed}) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                padding: space.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: pressed ? colors.surfacePressed : colors.surface,
                opacity: missing ? 0.45 : 1,
              })}>
              <View style={{width: 36, height: 36, borderRadius: 18, backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center'}}>
                <Text variant="bodyStrong" color={colors.highlightText}>
                  {a.key === 'generic' ? '₹' : a.label[0]}
                </Text>
              </View>
              <View style={{flex: 1}}>
                <Text variant="bodyStrong">{a.label}</Text>
                <Text variant="caption" tone="faint">
                  {missing ? 'Not installed' : a.key === 'generic' ? 'Choose from the apps on this phone' : 'Opens on the pay screen'}
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textMuted} />
            </Pressable>
          );
        })}
      </View>
      <Text variant="caption" tone="faint" style={{marginTop: space.md}}>
        After paying, come back and tap "I paid" so {name} can confirm it.
      </Text>
    </Sheet>
  );
}
