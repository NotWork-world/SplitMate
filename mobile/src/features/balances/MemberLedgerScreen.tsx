import React from 'react';
import {Pressable, View} from 'react-native';
import {Bell, MessageCircle} from 'lucide-react-native';
import {errorMessage, useGroupQuery, useMemberLedgerQuery, useRemindMutation} from '../../api/endpoints';
import {Button, Card, EmptyState, Header, Money, Screen, Text, space, useToast} from '../../design';
import {formatMoney} from '../../money/currency';
import type {AppScreen} from '../../navigation/types';
import {normalizePhone, sendOnWhatsApp} from '../../people/invite';
import {QueryView} from '../common/QueryView';
import {timeAgo} from '../common/rows';

const KIND_LABEL = {expense: 'Expense', reversal: 'Edit / cancellation', repayment: 'Confirmed repayment'};

/** Every ledger line between you and one person: the explanation behind the balance. */
export function MemberLedgerScreen({route, navigation}: AppScreen<'MemberLedger'>) {
  const {groupId, memberId, name} = route.params;
  const toast = useToast();
  const q = useMemberLedgerQuery({groupId, memberId});
  const group = useGroupQuery(groupId);
  const other = group.data?.members.find(m => m.id === memberId);
  const [remind, {isLoading: reminding}] = useRemindMutation();

  const owedToMe = Object.entries(
    (q.data?.items ?? []).reduce((acc, l) => {
      acc[l.currency] = (acc[l.currency] ?? 0) + l.effect_minor;
      return acc;
    }, {} as Record<string, number>),
  ).filter(([, v]) => v > 0);

  const sendReminder = async (currency: string) => {
    try {
      await remind({group_id: groupId, other_member_id: memberId, currency}).unwrap();
      toast(`${name} has been reminded in the app`, 'positive');
    } catch (e) {
      toast(errorMessage(e), 'negative');
    }
  };

  const nudgeOnWhatsApp = (currency: string, amount: number) => {
    const text = `Hi ${name.split(' ')[0]}! Friendly reminder from SplitMate: you owe me ${formatMoney(amount, currency)}. You can settle it right in the app 🙂`;
    sendOnWhatsApp(normalizePhone(other?.phone ?? ''), text).catch(() => toast("WhatsApp couldn't be opened", 'negative'));
  };

  return (
    <Screen header={<Header title={`You & ${name}`} subtitle="Every change to your balance" />}>
      <QueryView query={q}>
        {page => {
          if (!page.items.length) {
            return <EmptyState emoji="🤝" title="Nothing between you yet" />;
          }
          const totals: Record<string, number> = {};
          for (const l of page.items) {
            totals[l.currency] = (totals[l.currency] ?? 0) + l.effect_minor;
          }
          return (
            <>
              <Card strong>
                {Object.entries(totals).map(([cur, v]) => (
                  <View key={cur} style={{flexDirection: 'row', alignItems: 'center'}}>
                    <Text variant="bodyStrong" style={{flex: 1}}>
                      {v > 0 ? `${name} owes you` : v < 0 ? `You owe ${name}` : 'Settled'}
                    </Text>
                    <Money minor={v} currency={cur} signed variant="amount" />
                  </View>
                ))}
                {page.next_offset !== null ? (
                  <Text variant="caption" tone="faint" style={{marginTop: space.xs}}>
                    Showing the latest lines only.
                  </Text>
                ) : null}
              </Card>
              {owedToMe.map(([cur, v]) => (
                <View key={cur} style={{flexDirection: 'row', gap: space.sm, marginTop: space.md}}>
                  <Button label="Remind in the app" icon={Bell} variant="secondary" style={{flex: 1}} loading={reminding} onPress={() => sendReminder(cur)} testID={`ledger-remind-${cur}`} />
                  {other?.phone ? (
                    <Button label="WhatsApp" icon={MessageCircle} variant="secondary" onPress={() => nudgeOnWhatsApp(cur, v)} testID={`ledger-whatsapp-${cur}`} />
                  ) : null}
                </View>
              ))}
              <Card padded={false} style={{paddingHorizontal: space.md, marginTop: space.lg}}>
                {page.items.map(l => (
                  <Pressable
                    key={l.id}
                    disabled={!l.expense_id && !l.repayment_id}
                    onPress={() =>
                      l.expense_id
                        ? navigation.navigate('ExpenseDetail', {expenseId: l.expense_id})
                        : l.repayment_id
                        ? navigation.navigate('RepaymentDetail', {repaymentId: l.repayment_id})
                        : undefined
                    }
                    style={{flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, gap: space.md}}>
                    <View style={{flex: 1}}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {l.expense_title ?? KIND_LABEL[l.kind]}
                      </Text>
                      <Text variant="small" tone="muted">
                        {KIND_LABEL[l.kind]}
                        {l.expense_version ? ` · v${l.expense_version}` : ''} · {timeAgo(l.created_at)}
                      </Text>
                    </View>
                    <Money minor={l.effect_minor} currency={l.currency} signed showPlus variant="amountSmall" />
                  </Pressable>
                ))}
              </Card>
              <Text variant="caption" tone="faint" style={{marginTop: space.md}}>
                + means {name} owes you more; − means you owe {name} more.
              </Text>
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}
