import React, {useEffect, useState} from 'react';
import {Linking, Pressable, View} from 'react-native';
import {ChevronRight} from 'lucide-react-native';
import {Banner, Sheet, Text, radius, space, useTheme} from '../design';
import QRCode from 'react-native-qrcode-svg';
import {installedUpiApps, UPI_APPS, upiPayUrl, type UpiAppKey} from './upi';

/**
 * Asks which UPI app to pay with, then opens that app on its pay screen with the
 * payee's UPI ID and the amount filled in (some UPI apps refuse to let you type it if it's missing).
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
  qr,
  onLaunched,
}: {
  visible: boolean;
  onClose: () => void;
  upiId: string;
  name: string;
  note?: string;
  amount?: string; // decimal text like "100.00"
  amountLabel?: string; // formatted, like "₹100.00"
  qr?: string | null; // their own UPI QR text, shown unchanged when they added one
  onLaunched: () => void;
}) {
  const {colors} = useTheme();
  const [installed, setInstalled] = useState<Set<UpiAppKey> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    if (visible) {
      setError(null);
      installedUpiApps().then(setInstalled);
    }
  }, [visible]);

  const open = async (base: string, label: string) => {
    setError(null);
    try {
      await Linking.openURL(upiPayUrl(base, {upiId, name, note, amount}));
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
            Amount: <Text variant="smallStrong">{amountLabel}</Text>
          </Text>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => setShowQr(s => !s)} style={{marginTop: space.sm}} testID="upi-show-qr">
          <Text variant="smallStrong" tone="accent">
            {showQr ? 'Hide QR code' : `Show ${name}'s QR code`}
          </Text>
        </Pressable>
        {showQr ? (
          <View style={{alignItems: 'center', marginTop: space.sm}}>
            <View style={{padding: space.md, backgroundColor: '#FFFFFF', borderRadius: radius.md}}>
              <QRCode value={qr || upiPayUrl('upi://pay', {upiId, name, note, amount})} size={180} />
            </View>
            <Text variant="caption" tone="faint" align="center" style={{marginTop: space.xs}}>
              {qr ? `${name}'s own UPI QR. Scan it from another phone.` : 'Scan from another phone to pay.'}
            </Text>
          </View>
        ) : null}
      </View>
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
