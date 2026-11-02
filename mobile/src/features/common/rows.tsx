import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import type {ExpenseSummary, Group, Repayment} from '../../api/types';
import {AvatarStack, CATEGORY_META, GROUP_TYPE_META, Money, Text, radius, space, useTheme} from '../../design';
import {formatMoney} from '../../money/currency';

export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  return `${d} ${months[m - 1]}${y !== now.getFullYear() ? ` ${y}` : ''}`;
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) {
    return 'just now';
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)} min ago`;
  }
  if (s < 86400) {
    return `${Math.floor(s / 3600)} h ago`;
  }
  if (s < 7 * 86400) {
    return `${Math.floor(s / 86400)} d ago`;
  }
  return formatDate(iso);
}

export function ExpenseRow({e, onPress, showGroup}: {e: ExpenseSummary; onPress: () => void; showGroup?: boolean}) {
  const {colors} = useTheme();
  const meta = CATEGORY_META[e.category] ?? CATEGORY_META.other;
  const net = e.my_net_minor;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${e.title}, ${e.total_minor !== null ? formatMoney(e.total_minor, e.currency) : 'draft'}`}
      style={({pressed}) => [styles.row, pressed && {backgroundColor: colors.surfacePressed}]}>
      <View style={[styles.icon, {backgroundColor: e.category === 'food' ? colors.foodSoft : colors.accentSoft}]}>
        <Text style={{fontSize: 20, lineHeight: 26}}>{meta.emoji}</Text>
      </View>
      <View style={{flex: 1}}>
        <Text variant="bodyStrong" numberOfLines={1} style={e.status === 'cancelled' && {textDecorationLine: 'line-through'}}>
          {e.title}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {e.status === 'draft'
            ? 'Draft · not counted in balances'
            : e.status === 'cancelled'
            ? 'Cancelled'
            : `${e.paid_by.join(' & ') || 'Someone'} paid · ${formatDate(e.expense_date)}${showGroup ? ` · ${e.group_name}` : ''}`}
        </Text>
      </View>
      <View style={{alignItems: 'flex-end'}}>
        {e.total_minor !== null ? <Money minor={e.total_minor} currency={e.currency} variant="amountSmall" /> : null}
        {net !== null && e.status === 'finalized' ? (
          <Text variant="caption" tone={net > 0 ? 'positive' : net < 0 ? 'negative' : 'faint'}>
            {net > 0 ? `you lent ${formatMoney(net, e.currency)}` : net < 0 ? `you owe ${formatMoney(-net, e.currency)}` : 'settled'}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export const STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested',
  MARKED_SENT: 'Marked as sent',
  AWAITING_CONFIRMATION: 'Awaiting confirmation',
  CONFIRMED: 'Confirmed',
  DISPUTED: 'Disputed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
  REVERTED: 'Confirmed then taken back',
};

export function RepaymentRow({r, onPress}: {r: Repayment; onPress: () => void}) {
  const {colors} = useTheme();
  const fromMe = r.i_am === 'debtor';
  const other = fromMe ? r.creditor : r.debtor;
  const tone =
    r.status === 'CONFIRMED' ? colors.positive : r.status === 'DISPUTED' || r.status === 'REJECTED' ? colors.negative : colors.warning;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({pressed}) => [styles.row, pressed && {backgroundColor: colors.surfacePressed}]}>
      <View style={[styles.icon, {backgroundColor: colors.accentSoft}]}>
        <Text style={{fontSize: 18}}>{fromMe ? '↗' : '↙'}</Text>
      </View>
      <View style={{flex: 1}}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {r.i_am === 'other' ? `${r.debtor.display_name} → ${r.creditor.display_name}` : fromMe ? `You → ${other.display_name}` : `${other.display_name} → You`}
        </Text>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
          <View style={[styles.dot, {backgroundColor: tone}]} />
          <Text variant="small" tone="muted" numberOfLines={1}>
            {STATUS_LABEL[r.status]} · {r.group_name}
          </Text>
        </View>
      </View>
      <Money minor={r.amount_minor} currency={r.currency} variant="amountSmall" />
    </Pressable>
  );
}

export function GroupCard({g, onPress}: {g: Group; onPress: () => void}) {
  const {colors} = useTheme();
  const meta = GROUP_TYPE_META[g.type] ?? GROUP_TYPE_META.other;
  const bal = g.my_balances;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${g.name}, ${g.members.length} members`}
      style={({pressed}) => [
        styles.groupCard,
        {backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border},
      ]}>
      <View style={[styles.groupEmoji, {backgroundColor: colors.accentSoft}]}>
        <Text style={{fontSize: 24, lineHeight: 30}}>{g.emoji || meta.emoji}</Text>
      </View>
      <View style={{flex: 1, gap: 4}}>
        <Text variant="subheading" numberOfLines={1}>
          {g.name}
        </Text>
        <AvatarStack people={g.members.map(m => ({name: m.display_name, hue: m.avatar_hue}))} size={22} max={5} />
      </View>
      <View style={{alignItems: 'flex-end'}}>
        {bal.length === 0 ? (
          <Text variant="small" tone="faint">
            settled up
          </Text>
        ) : (
          bal.map(b => (
            <View key={b.currency} style={{alignItems: 'flex-end'}}>
              <Text variant="caption" tone={b.amount_minor > 0 ? 'positive' : 'negative'}>
                {b.amount_minor > 0 ? 'you are owed' : 'you owe'}
              </Text>
              <Money minor={b.amount_minor} currency={b.currency} signed variant="amountSmall" />
            </View>
          ))
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.xs, borderRadius: radius.md},
  icon: {width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  dot: {width: 7, height: 7, borderRadius: 4},
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: space.sm,
  },
  groupEmoji: {width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
});
