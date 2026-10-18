import React from 'react';
import {Pressable, View} from 'react-native';
import {useMemberLedgerQuery} from '../../api/endpoints';
import {Card, EmptyState, Header, Money, Screen, Text, space} from '../../design';
import type {AppScreen} from '../../navigation/types';
import {QueryView} from '../common/QueryView';
import {timeAgo} from '../common/rows';

const KIND_LABEL = {expense: 'Expense', reversal: 'Edit / cancellation', repayment: 'Confirmed repayment'};

/** Every ledger line between you and one person: the explanation behind the balance. */
export function MemberLedgerScreen({route, navigation}: AppScreen<'MemberLedger'>) {
  const {groupId, memberId, name} = route.params;
  const q = useMemberLedgerQuery({groupId, memberId});
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
