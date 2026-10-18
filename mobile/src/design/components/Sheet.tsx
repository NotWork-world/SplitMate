import React from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {radius, space} from '../tokens';
import {Button} from './Button';
import {Text} from './Text';
import {useKeyboardHeight} from '../useKeyboardHeight';

export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{flex: 1}}>
        <Pressable accessibilityLabel="Close" style={[StyleSheet.absoluteFill, {backgroundColor: colors.overlay}]} onPress={onClose} />
        <View style={{flex: 1}} pointerEvents="box-none" />
        <View
          style={[
            styles.sheet,
            {backgroundColor: colors.bgElevated, borderColor: colors.border, paddingBottom: (keyboard ? keyboard + insets.bottom : insets.bottom) + space.lg},
          ]}>
          <View style={[styles.handle, {backgroundColor: colors.borderStrong}]} />
          {title ? (
            <Text variant="heading" style={{marginBottom: space.md}} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={{maxHeight: keyboard ? 300 : 520}}>
            {children}
          </ScrollView>
          {footer ? <View style={{marginTop: space.lg, gap: space.sm}}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  destructive,
  loading,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const {colors} = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.center, {backgroundColor: colors.overlay}]}>
        <View style={[styles.dialog, {backgroundColor: colors.bgElevated, borderColor: colors.border}]} accessibilityViewIsModal>
          <Text variant="heading">{title}</Text>
          {body ? (
            <Text variant="body" tone="muted" style={{marginTop: space.sm}}>
              {body}
            </Text>
          ) : null}
          <View style={{flexDirection: 'row', gap: space.sm, marginTop: space.xl}}>
            <Button label="Cancel" variant="secondary" onPress={onCancel} style={{flex: 1}} />
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              onPress={onConfirm}
              loading={loading}
              style={{flex: 1}}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
  },
  handle: {alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: space.lg},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl},
  dialog: {width: '100%', maxWidth: 420, borderRadius: radius.xl, padding: space.xl, borderWidth: StyleSheet.hairlineWidth},
});
