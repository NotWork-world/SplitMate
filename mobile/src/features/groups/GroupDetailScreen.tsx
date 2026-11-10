import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {Plus, Settings2, Utensils} from 'lucide-react-native';
import {useExpensesQuery, useGroupBalancesQuery, useGroupQuery} from '../../api/endpoints';
import {
  Avatar,
  AvatarStack,
  Button,
  Card,
  EmptyState,
  GROUP_TYPE_META,
  Header,
  IconButton,
  Money,
  Screen,
  SectionTitle,
  Segmented,
  Text,
  space,
  useTheme,
} from '../../design';
import type {AppScreen} from '../../navigation/types';
import {QueryView} from '../common/QueryView';
import {ExpenseRow, formatDate} from '../common/rows';

export function GroupDetailScreen({route, navigation}: AppScreen<'GroupDetail'>) {
  const {groupId} = route.params;
  const {colors} = useTheme();
  const group = useGroupQuery(groupId, {refetchOnFocus: true});
  const [tab, setTab] = useState<'expenses' | 'balances' | 'people'>('expenses');
  const [offset, setOffset] = useState(0);
  const expenses = useExpensesQuery({groupId, offset}, {refetchOnFocus: true});
  const balances = useGroupBalancesQuery(groupId, {refetchOnFocus: true});
  const g = group.data;

  return (
    <Screen
      header={
        <Header
          title={g?.name ?? ''}
          subtitle={g ? `${g.members.length} people · ${GROUP_TYPE_META[g.type]?.label ?? ''}` : undefined}
          right={g ? <IconButton icon={Settings2} label="Group settings" onPress={() => navigation.navigate('GroupSettings', {groupId})} /> : null}
        />
      }
      refreshing={group.isFetching && !group.isLoading}
      onRefresh={() => {
        group.refetch();
        expenses.refetch();
        balances.refetch();
      }}>
      <QueryView query={group}>
        {gr => (
          <>
            <Card strong style={{alignItems: 'center', paddingVertical: space.xl}}>
              <Text style={{fontSize: 40, lineHeight: 50}}>{gr.emoji || GROUP_TYPE_META[gr.type]?.emoji}</Text>
              <View style={{marginTop: space.sm}}>
                <AvatarStack people={gr.members.map(m => ({name: m.display_name, hue: m.avatar_hue}))} size={30} max={6} />
              </View>
              {gr.start_date ? (
                <Text variant="small" tone="muted" style={{marginTop: space.sm}}>
                  {formatDate(gr.start_date)}
                  {gr.end_date ? ` – ${formatDate(gr.end_date)}` : ''}
                </Text>
              ) : null}
              <View style={{marginTop: space.md, alignItems: 'center'}}>
                {gr.my_balances.length === 0 ? (
                  <Text variant="bodyStrong" tone="muted">
                    You're settled up here
                  </Text>
                ) : (
                  gr.my_balances.map(b => (
                    <Text key={b.currency} variant="bodyStrong" tone={b.amount_minor > 0 ? 'positive' : 'negative'}>
                      {b.amount_minor > 0 ? 'You are owed ' : 'You owe '}
                      <Money minor={b.amount_minor} currency={b.currency} signed variant="bodyStrong" />
                    </Text>
                  ))
                )}
              </View>
              <View style={{flexDirection: 'row', gap: space.sm, marginTop: space.lg, alignSelf: 'stretch'}}>
                <Button
                  label="Split a bill"
                  icon={Utensils}
                  variant="food"
                  style={{flex: 1}}
                  onPress={() => navigation.navigate('StartExpense', {groupId, mode: 'itemized'})}
                  testID="group-split-bill"
                />
                <Button
                  label="Expense"
                  icon={Plus}
                  variant="secondary"
                  style={{flex: 1}}
                  onPress={() => navigation.navigate('StartExpense', {groupId, mode: 'simple'})}
                  testID="group-add-expense"
                />
              </View>
            </Card>

            <View style={{marginTop: space.lg}}>
              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  {value: 'expenses', label: 'Expenses'},
                  {value: 'balances', label: 'Balances'},
                  {value: 'people', label: 'People'},
                ]}
              />
            </View>

            {tab === 'expenses' ? (
              <QueryView query={expenses}>
                {page =>
                  page.items.length ? (
                    <Card padded={false} style={{paddingHorizontal: space.sm, marginTop: space.md}}>
                      {page.items.map(e => (
                        <ExpenseRow key={e.id} e={e} onPress={() => navigation.navigate('ExpenseDetail', {expenseId: e.id})} />
                      ))}
                      {page.next_offset !== null ? (
                        <Button
                          label="Load more"
                          variant="ghost"
                          loading={expenses.isFetching}
                          onPress={() => setOffset(page.next_offset ?? 0)}
                        />
                      ) : null}
                    </Card>
                  ) : (
                    <EmptyState emoji="🧾" title="No expenses yet" body="Split a bill dish by dish, or add rent, fuel or tickets with a quick split." />
                  )
                }
              </QueryView>
            ) : null}

            {tab === 'balances' ? (
              <QueryView query={balances}>
                {b =>
                  b.balances.length === 0 ? (
                    <EmptyState emoji="✅" title="All settled" body="Nobody owes anyone in this group." />
                  ) : (
                    <>
                      {b.balances.map(cur => (
                        <View key={cur.currency}>
                          <SectionTitle title={`Suggested payments · ${cur.currency}`} />
                          <Card padded={false} style={{paddingHorizontal: space.md}}>
                            {cur.suggestions.length === 0 ? (
                              <Text variant="small" tone="muted" style={{padding: space.md}}>
                                Everyone is settled in {cur.currency}.
                              </Text>
                            ) : (
                              cur.suggestions.map((s, i) => {
                                const mine = s.from.is_me || s.to.is_me;
                                return (
                                  <Pressable
                                    key={i}
                                    disabled={!mine}
                                    accessibilityRole={mine ? 'button' : undefined}
                                    onPress={() =>
                                      navigation.navigate('SettleUp', {
                                        groupId,
                                        memberId: s.from.is_me ? s.to.id : s.from.id,
                                        currency: cur.currency,
                                        amount: s.amount_minor,
                                        mode: s.from.is_me ? 'record' : 'request',
                                      })
                                    }
                                    style={({pressed}) => ({
                                      flexDirection: 'row',
                                      alignItems: 'center',
                                      gap: space.sm,
                                      paddingVertical: space.md,
                                      opacity: pressed ? 0.7 : 1,
                                    })}>
                                    <Avatar name={s.from.display_name} hue={s.from.avatar_hue} size={30} />
                                    <Text variant="small" tone="muted">
                                      →
                                    </Text>
                                    <Avatar name={s.to.display_name} hue={s.to.avatar_hue} size={30} />
                                    <Text variant="bodyStrong" style={{flex: 1}} numberOfLines={2}>
                                      {s.from.is_me ? 'You' : s.from.display_name} pay{s.from.is_me ? '' : 's'} {s.to.is_me ? 'you' : s.to.display_name}
                                    </Text>
                                    <Money minor={s.amount_minor} currency={cur.currency} variant="amountSmall" />
                                  </Pressable>
                                );
                              })
                            )}
                          </Card>
                          <SectionTitle title="Net balances" />
                          <Card padded={false} style={{paddingHorizontal: space.md}}>
                            {cur.members.map(m => (
                              <Pressable
                                key={m.member.id}
                                disabled={m.member.is_me}
                                accessibilityRole={m.member.is_me ? undefined : 'button'}
                                accessibilityHint="Shows every line between you and this person"
                                onPress={() => navigation.navigate('MemberLedger', {groupId, memberId: m.member.id, name: m.member.display_name})}
                                style={{flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md}}>
                                <Avatar name={m.member.display_name} hue={m.member.avatar_hue} size={34} />
                                <Text variant="bodyStrong" style={{flex: 1}}>
                                  {m.member.is_me ? 'You' : m.member.display_name}
                                </Text>
                                <Money minor={m.net_minor} currency={cur.currency} signed showPlus variant="amountSmall" />
                              </Pressable>
                            ))}
                          </Card>
                          <Text variant="caption" tone="faint" align="center" style={{marginTop: space.sm}}>
                            Balances add up to {cur.total_check_minor === 0 ? 'zero ✓' : 'a mismatch — please report this'}
                          </Text>
                        </View>
                      ))}
                      <Button label="Repayment history" variant="ghost" onPress={() => navigation.navigate('Repayments', {groupId})} style={{marginTop: space.md}} />
                    </>
                  )
                }
              </QueryView>
            ) : null}

            {tab === 'people' ? (
              <>
                {/* Whom to pay and who owes you, after the group's own autocut. */}
                {balances.data?.balances.length ? (
                  <Card style={{marginTop: space.md, gap: space.xs}}>
                    <Text variant="bodyStrong">Who pays whom in this group</Text>
                    {balances.data.balances.flatMap(cur => {
                      const mine = cur.suggestions.filter(s => s.from.is_me || s.to.is_me);
                      if (!mine.length) {
                        return [
                          <Text key={cur.currency} variant="small" tone="muted">
                            Everyone is settled in {cur.currency}.
                          </Text>,
                        ];
                      }
                      return mine.map((s, i) => {
                        const iPay = s.from.is_me;
                        const other = iPay ? s.to : s.from;
                        return (
                          <Pressable
                            key={`${cur.currency}-${i}`}
                            accessibilityRole="button"
                            onPress={() =>
                              navigation.navigate('SettleUp', {
                                groupId,
                                memberId: other.id,
                                currency: cur.currency,
                                amount: s.amount_minor,
                                mode: iPay ? 'record' : 'request',
                              })
                            }
                            style={({pressed}) => ({
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: space.md,
                              paddingVertical: space.xs,
                              opacity: pressed ? 0.7 : 1,
                            })}>
                            <Avatar name={other.display_name} hue={other.avatar_hue} size={32} />
                            <View style={{flex: 1}}>
                              <Text variant="bodyStrong" numberOfLines={1}>
                                {iPay ? `You pay ${other.display_name}` : `${other.display_name} pays you`}
                              </Text>
                              <Text variant="caption" tone={iPay ? 'negative' : 'positive'}>
                                after autocut · tap to {iPay ? 'record it' : 'request it'}
                              </Text>
                            </View>
                            <Money minor={s.amount_minor} currency={cur.currency} variant="amountSmall" />
                          </Pressable>
                        );
                      });
                    })}
                  </Card>
                ) : null}
                <Card padded={false} style={{paddingHorizontal: space.md, marginTop: space.md}}>
                {gr.members.map(m => (
                  <View key={m.id} style={{flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md}}>
                    <Avatar name={m.display_name} hue={m.avatar_hue} size={38} />
                    <View style={{flex: 1}}>
                      <Text variant="bodyStrong">
                        {m.display_name}
                        {m.is_me ? ' (you)' : ''}
                      </Text>
                      <Text variant="small" tone="muted">
                        {m.role === 'owner' ? 'Owner' : m.role === 'admin' ? 'Admin' : m.is_registered ? 'On SplitMate' : 'Not on SplitMate yet'}
                      </Text>
                    </View>
                  </View>
                ))}
                <Button
                  label="Add or invite people"
                  variant="ghost"
                  icon={Plus}
                  onPress={() => navigation.navigate('GroupSettings', {groupId})}
                  style={{marginVertical: space.sm}}
                />
                </Card>
              </>
            ) : null}
            <View style={{height: space.xl, borderColor: colors.border}} />
          </>
        )}
      </QueryView>
    </Screen>
  );
}
