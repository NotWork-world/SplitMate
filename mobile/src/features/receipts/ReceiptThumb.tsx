import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Image, Modal, Pressable, View} from 'react-native';
import {api} from '../../api/client';
import {Card, Text, radius, space, useTheme} from '../../design';

/** Shows a private receipt through a short-lived signed link fetched on demand. */
export function ReceiptThumb({receiptId}: {receiptId: string}) {
  const {colors} = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<{url: string}>(`/receipts/${receiptId}/url`)
      .then(r => alive && setUrl(r.url))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [receiptId]);

  if (error) {
    return (
      <Card>
        <Text variant="small" tone="muted">
          The receipt photo couldn't be loaded. It may have been removed.
        </Text>
      </Card>
    );
  }
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel="Receipt photo, tap to enlarge" onPress={() => url && setOpen(true)}>
        <View style={{height: 180, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center'}}>
          {url ? <Image source={{uri: url}} style={{width: '100%', height: '100%'}} resizeMode="cover" onError={() => setError(true)} /> : <ActivityIndicator color={colors.accent} />}
        </View>
      </Pressable>
      <Modal visible={open} transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', padding: space.lg}} onPress={() => setOpen(false)} accessibilityLabel="Close">
          {url ? <Image source={{uri: url}} style={{flex: 1}} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </>
  );
}
