import React, {useEffect} from 'react';
import {Pressable, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {CheckCheck} from 'lucide-react-native';
import {useActivityQuery, useMarkNotificationsReadMutation, useNotificationsQuery} from '../../api/endpoints';
import type {ActivityItem} from '../../api/types';
import {Card, EmptyState, Header, IconButton, Screen, Text, space, useTheme} from '../../design';
import {formatMoney} from '../../money/currency';
import {QueryView} from '../common/QueryView';
import {timeAgo} from '../common/rows';

export function describe(a: ActivityItem): {emoji: string; text: string} {
  const d = a.data ?? {};
  const amt = d.amount_minor !== undefined && d.currency ? formatMoney(d.amount_minor, d.currency) : '';
  const total = d.total_minor !== undefined && d.currency ? formatMoney(d.total_minor, d.currency) : '';
  switch (a.type) {
    case 'expense.finalized':
      return {emoji: '🧾', text: `${a.actor} added "${d.title}" · ${total}`};
    case 'expense.updated':
      return {emoji: '✏️', text: `${a.actor} edited "${d.title}" · now ${total}`};
    case 'expense.cancelled':
      return {emoji: '🚫', text: `${a.actor} cancelled "${d.title}"`};
    case 'repayment.requested':
      return {emoji: '🙏', text: `${a.actor} requested ${amt} from ${d.debtor}`};
    case 'repayment.marked_sent':
      return {emoji: '📤', text: `${d.debtor} marked ${amt} as sent to ${d.creditor}`};
    case 'repayment.confirmed':
      return {emoji: '✅', text: `${d.creditor} confirmed receiving ${amt} from ${d.debtor}`};
    case 'repayment.rejected':
      return {emoji: '❌', text: `${a.actor} rejected a ${amt} repayment`};
    case 'repayment.disputed':
      return {emoji: '⚠️', text: `${a.actor} disputed a ${amt} repayment${d.note ? `: "${d.note}"` : ''}`};
    case 'repayment.cancelled':
      return {emoji: '↩️', text: `${a.actor} cancelled a ${amt} repayment`};
    case 'repayment.resubmitted':
      return {emoji: '🔁', text: `${a.actor} asked to re-check a ${amt} repayment`};
    case 'member.joined':
      return {emoji: '👋', text: `${d.name} joined`};
    case 'member.added':
      return {emoji: '➕', text: `${a.actor} added ${d.name}`};
    case 'member.removed':
      return {emoji: '👤', text: d.left ? `${d.name} left` : `${a.actor} removed ${d.name}`};
    case 'group.created':
      return {emoji: '✨', text: `${a.actor} created "${d.name}"`};
    default:
      return {emoji: '•', text: `${a.actor} made a change`};
  }
}

function ActivityRow({a, unread}: {a: ActivityItem; unread?: boolean}) {
  const nav = useNavigation();
  const {colors} = useTheme();
  const {emoji, text} = describe(a);
  const open = () => {
    if (a.entity_type === 'expense' && a.entity_id) {
      nav.navigate('ExpenseDetail', {expenseId: a.entity_id});
    } else if (a.entity_type === 'repayment' && a.entity_id) {
      nav.navigate('RepaymentDetail', {repaymentId: a.entity_id});
    } else if (a.group_id) {
      nav.navigate('GroupDetail', {groupId: a.group_id});
    }
  };
  return (
    <Pressable accessibilityRole="button" onPress={open} style={({pressed}) => ({flexDirection: 'row', gap: space.md, paddingVertical: space.md, opacity: pressed ? 0.7 : 1})}>
      <View style={{width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft}}>
        <Text style={{fontSize: 18}}>{emoji}</Text>
      </View>
      <View style={{flex: 1}}>
        <Text variant={unread ? 'bodyStrong' : 'body'}>{text}</Text>
        <Text variant="caption" tone="faint">
          {a.group_name} · {timeAgo(a.created_at)}
        </Text>
      </View>
      {unread ? <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: colors.food, marginTop: 8}} /> : null}
    </Pressable>
  );
}

export function ActivityScreen() {
  const q = useActivityQuery(undefined, {refetchOnFocus: true});
  return (
    <Screen refreshing={q.isFetching && !q.isLoading} onRefresh={q.refetch}>
      <Text variant="title" style={{marginVertical: space.sm}} accessibilityRole="header">
        Activity
      </Text>
      <QueryView query={q}>
        {page =>
          page.items.length ? (
            <Card padded={false} style={{paddingHorizontal: space.md}}>
              {page.items.map(a => (
                <ActivityRow key={a.id} a={a} />
              ))}
            </Card>
          ) : (
            <EmptyState emoji="🕊️" title="Quiet so far" body="Expenses, edits, repayments and new members in your groups show up here." />
          )
        }
      </QueryView>
    </Screen>
  );
}

export function NotificationsScreen() {
  const q = useNotificationsQuery(undefined, {refetchOnMountOrArgChange: true});
  const [markRead] = useMarkNotificationsReadMutation();
  const hasUnread = q.data?.items.some(i => !i.read);
  useEffect(() => {
    // Opening the list counts as seeing them; mark after a short delay so the dots are visible first.
    if (hasUnread) {
      const t = setTimeout(() => markRead({}), 1500);
      return () => clearTimeout(t);
    }
  }, [hasUnread, markRead]);
  return (
    <Screen
      header={<Header title="Notifications" right={hasUnread ? <IconButton icon={CheckCheck} label="Mark all as read" onPress={() => markRead({})} /> : null} />}
      refreshing={q.isFetching && !q.isLoading}
      onRefresh={q.refetch}>
      <QueryView query={q}>
        {page =>
          page.items.length ? (
            <Card padded={false} style={{paddingHorizontal: space.md}}>
              {page.items.map(a => (
                <ActivityRow key={a.notification_id ?? a.id} a={a} unread={!a.read} />
              ))}
            </Card>
          ) : (
            <EmptyState emoji="🔔" title="No notifications" body="You'll hear about expenses that include you and repayments that need you." />
          )
        }
      </QueryView>
    </Screen>
  );
}
