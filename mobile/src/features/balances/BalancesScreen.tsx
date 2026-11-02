import React from 'react';
import {Pressable, View} from 'react-native';
import {Bell, MessageCircle} from 'lucide-react-native';
import {errorMessage, useMyBalancesQuery, useRemindMutation} from '../../api/endpoints';
import type {MyBalances} from '../../api/types';
import {Avatar, Card, EmptyState, Header, Money, Screen, SectionTitle, Text, space, useTheme, useToast} from '../../design';
import {formatMoney} from '../../money/currency';
import type {AppScreen} from '../../navigation/types';
import {normalizePhone, sendOnWhatsApp} from '../../people/invite';
import {QueryView} from '../common/QueryView';

export function BalancesScreen({navigation}: AppScreen<'Balances'>) {
  const q = useMyBalancesQuery(undefined, {refetchOnMountOrArgChange: true});
  const {colors} = useTheme();
  const toast = useToast();
  const [remind, {isLoading: reminding}] = useRemindMutation();

  const sendReminder = async (g: MyBalances['groups'][number], p: {member: {id: string; display_name: string}; amount_minor: number}) => {
    try {
      await remind({group_id: g.group_id, other_member_id: p.member.id, currency: g.currency}).unwrap();
      toast(`${p.member.display_name} has been reminded in the app`, 'positive');
    } catch (e) {
      toast(errorMessage(e), 'negative');
    }
  };

  const nudgeOnWhatsApp = (g: MyBalances['groups'][number], p: {member: {display_name: string; phone?: string | null}; amount_minor: number}) => {
    const first = p.member.display_name.split(' ')[0];
    const text = `Hi ${first}! Friendly reminder from SplitMate: you owe me ${formatMoney(
      Math.abs(p.amount_minor),
      g.currency,
    )} in "${g.group_name}". You can settle it right in the app 🙂`;
    sendOnWhatsApp(normalizePhone(p.member.phone ?? ''), text).catch(() => toast("WhatsApp couldn't be opened", 'negative'));
  };

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
                      <View key={p.member.id} style={{flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md}}>
                        <Pressable
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
                          style={({pressed}) => ({flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1, opacity: pressed ? 0.7 : 1})}>
                          <Avatar name={p.member.display_name} hue={p.member.avatar_hue} size={38} />
                          <View style={{flex: 1}}>
                            <Text variant="bodyStrong">{p.member.display_name}</Text>
                            <Text variant="small" tone={p.amount_minor > 0 ? 'positive' : 'negative'}>
                              {p.amount_minor > 0 ? 'owes you · tap to request' : 'you owe · tap to record a payment'}
                            </Text>
                          </View>
                          <Money minor={p.amount_minor} currency={g.currency} signed variant="amount" />
                        </Pressable>
                        {p.amount_minor > 0 ? (
                          <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remind ${p.member.display_name} to pay`}
                              disabled={reminding}
                              onPress={() => sendReminder(g, p)}
                              testID={`remind-${p.member.id}`}
                              style={({pressed}) => ({
                                width: 36,
                                height: 36,
                                borderRadius: 18,
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderWidth: 1,
                                borderColor: colors.border,
                                backgroundColor: pressed ? colors.surfacePressed : colors.surface,
                              })}>
                              <Bell size={16} color={colors.accentText} />
                            </Pressable>
                            {p.member.phone ? (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Nudge ${p.member.display_name} on WhatsApp`}
                                onPress={() => nudgeOnWhatsApp(g, p)}
                                style={({pressed}) => ({
                                  width: 36,
                                  height: 36,
                                  borderRadius: 18,
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  borderWidth: 1,
                                  borderColor: colors.border,
                                  backgroundColor: pressed ? colors.surfacePressed : colors.surface,
                                })}>
                                <MessageCircle size={16} color="#22c55e" />
                              </Pressable>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
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
