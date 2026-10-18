import React from 'react';
import {Pressable, View} from 'react-native';
import {useMyBalancesQuery} from '../../api/endpoints';
import {Avatar, Card, EmptyState, Header, Money, Screen, SectionTitle, Text, space} from '../../design';
import type {AppScreen} from '../../navigation/types';
import {QueryView} from '../common/QueryView';

export function BalancesScreen({navigation}: AppScreen<'Balances'>) {
  const q = useMyBalancesQuery(undefined, {refetchOnMountOrArgChange: true});
  return (
    <Screen header={<Header title="Balances" subtitle="Who owes whom, and why" />} refreshing={q.isFetching && !q.isLoading} onRefresh={q.refetch}>
      <QueryView query={q}>
        {data =>
          data.groups.length === 0 ? (
            <EmptyState emoji="✅" title="You're all settled up" body="When someone owes you, or you owe someone, it shows up here." />
          ) : (
            <>
              {data.groups.map(g => (
                <View key={`${g.group_id}-${g.currency}`}>
                  <SectionTitle
                    title={`${g.group_emoji ?? ''} ${g.group_name} · ${g.currency}`}
                    action={<Money minor={g.net_minor} currency={g.currency} signed showPlus variant="amountSmall" />}
                  />
                  <Card padded={false} style={{paddingHorizontal: space.md}}>
                    {g.people.map(p => (
                      <Pressable
                        key={p.member.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${p.member.display_name}: ${p.amount_minor > 0 ? 'owes you' : 'you owe'}`}
                        onPress={() =>
                          navigation.navigate('SettleUp', {
                            groupId: g.group_id,
                            memberId: p.member.id,
                            currency: g.currency,
                            amount: Math.abs(p.amount_minor),
                            mode: p.amount_minor > 0 ? 'request' : 'record',
                          })
                        }
                        style={({pressed}) => ({flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, opacity: pressed ? 0.7 : 1})}>
                        <Avatar name={p.member.display_name} hue={p.member.avatar_hue} size={38} />
                        <View style={{flex: 1}}>
                          <Text variant="bodyStrong">{p.member.display_name}</Text>
                          <Text variant="small" tone={p.amount_minor > 0 ? 'positive' : 'negative'}>
                            {p.amount_minor > 0 ? 'owes you · tap to request' : 'you owe · tap to record a payment'}
                          </Text>
                        </View>
                        <Money minor={p.amount_minor} currency={g.currency} signed variant="amount" />
                      </Pressable>
                    ))}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => navigation.navigate('GroupDetail', {groupId: g.group_id})}
                      style={{paddingVertical: space.md}}>
                      <Text variant="smallStrong" tone="accent">
                        Group balances & suggested payments →
                      </Text>
                    </Pressable>
                  </Card>
                </View>
              ))}
              <Text variant="caption" tone="faint" style={{marginTop: space.lg}}>
                Balances are worked out from finalised expenses and confirmed repayments only. Drafts and unconfirmed payments never count.
              </Text>
            </>
          )
        }
      </QueryView>
    </Screen>
  );
}
