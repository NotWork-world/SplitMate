import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {Bell, ScanLine, Utensils, Wallet} from 'lucide-react-native';
import {useSummaryQuery} from '../../api/endpoints';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Gradient,
  IconButton,
  Money,
  Screen,
  SectionTitle,
  Text,
  radius,
  space,
  useTheme,
} from '../../design';
import {useAppSelector} from '../../store';
import {QueryView} from '../common/QueryView';
import {ExpenseRow, RepaymentRow} from '../common/rows';

export function HomeScreen() {
  const nav = useNavigation();
  const {colors} = useTheme();
  const user = useAppSelector(s => s.auth.user);
  const q = useSummaryQuery(undefined, {refetchOnFocus: true, refetchOnMountOrArgChange: 30});
  const firstName = user?.display_name.split(' ')[0] ?? '';

  return (
    <Screen refreshing={q.isFetching && !q.isLoading} onRefresh={q.refetch}>
      <View style={styles.top}>
        <Avatar name={user?.display_name ?? '?'} hue={user?.avatar_hue} size={42} />
        <View style={{flex: 1, marginLeft: space.md}}>
          <Text variant="small" tone="muted">
            Hello{firstName ? ',' : ''}
          </Text>
          <Text variant="heading" numberOfLines={1}>
            {firstName || 'there'}
          </Text>
        </View>
        <View>
          <IconButton icon={Bell} label="Notifications" filled onPress={() => nav.navigate('Notifications')} />
          {q.data?.unread_notifications ? (
            <View style={[styles.badge, {backgroundColor: colors.food}]}>
              <Text variant="caption" tone="inverse">
                {Math.min(q.data.unread_notifications, 99)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <QueryView query={q} loadingLabel="Loading your balances">
        {s => (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel="Open balances" onPress={() => nav.navigate('Balances')}>
              <View style={[styles.hero, {borderColor: colors.borderStrong}]}>
                <Gradient colors={[colors.accent, '#2B1F7A']} />
                <Text variant="caption" color="rgba(255,255,255,0.75)" style={{textTransform: 'uppercase'}}>
                  Your balance
                </Text>
                <View style={styles.heroRow}>
                  <View style={{flex: 1}}>
                    <Text variant="small" color="rgba(255,255,255,0.8)">
                      You are owed
                    </Text>
                    {s.owed_to_me.length ? (
                      s.owed_to_me.map(b => <Money key={b.currency} minor={b.amount_minor} currency={b.currency} variant="title" color="#FFFFFF" />)
                    ) : (
                      <Money minor={0} currency={user?.default_currency ?? 'INR'} variant="title" color="#FFFFFF" />
                    )}
                  </View>
                  <View style={[styles.heroDivider]} />
                  <View style={{flex: 1, alignItems: 'flex-end'}}>
                    <Text variant="small" color="rgba(255,255,255,0.8)">
                      You owe
                    </Text>
                    {s.i_owe.length ? (
                      s.i_owe.map(b => <Money key={b.currency} minor={b.amount_minor} currency={b.currency} variant="title" color="#FFD6CC" />)
                    ) : (
                      <Money minor={0} currency={user?.default_currency ?? 'INR'} variant="title" color="#FFFFFF" />
                    )}
                  </View>
                </View>
                <Text variant="small" color="rgba(255,255,255,0.75)" style={{marginTop: space.md}}>
                  Tap to see who owes whom and settle up →
                </Text>
              </View>
            </Pressable>

            <View style={styles.actions}>
              <QuickAction icon={Utensils} label="Split a bill" tone={colors.food} onPress={() => nav.navigate('StartExpense', {mode: 'itemized'})} />
              <QuickAction icon={Wallet} label="Add expense" tone={colors.accentText} onPress={() => nav.navigate('StartExpense', {mode: 'simple'})} />
              <QuickAction icon={ScanLine} label="Scan receipt" tone={colors.positive} onPress={() => nav.navigate('StartExpense', {mode: 'itemized'})} />
            </View>

            {s.needs_my_action.length ? (
              <>
                <SectionTitle title="Waiting for you" />
                <Card padded={false} style={{paddingHorizontal: space.sm}}>
                  {s.needs_my_action.map(r => (
                    <RepaymentRow key={r.id} r={r} onPress={() => nav.navigate('RepaymentDetail', {repaymentId: r.id})} />
                  ))}
                </Card>
              </>
            ) : null}

            {s.drafts.length ? (
              <>
                <SectionTitle title="Drafts" />
                <Card padded={false} style={{paddingHorizontal: space.sm}}>
                  {s.drafts.map(e => (
                    <ExpenseRow key={e.id} e={e} showGroup onPress={() => nav.navigate('ExpenseDetail', {expenseId: e.id})} />
                  ))}
                </Card>
              </>
            ) : null}

            <SectionTitle title="Recent" />
            {s.recent_expenses.length ? (
              <Card padded={false} style={{paddingHorizontal: space.sm}}>
                {s.recent_expenses.map(e => (
                  <ExpenseRow key={e.id} e={e} showGroup onPress={() => nav.navigate('ExpenseDetail', {expenseId: e.id})} />
                ))}
              </Card>
            ) : s.group_count === 0 ? (
              <EmptyState
                emoji="🍽️"
                title="Start with a group"
                body="Make a group for your flat, a trip or tonight's dinner. Friends don't need the app to be added."
                action={{label: 'Create a group', onPress: () => nav.navigate('CreateGroup')}}
              />
            ) : (
              <Card>
                <Text variant="bodyStrong">No expenses yet</Text>
                <Text variant="small" tone="muted" style={{marginTop: 4}}>
                  Add the first one and SplitMate will work out who owes whom.
                </Text>
                <Button label="Add an expense" variant="secondary" style={{marginTop: space.md}} onPress={() => nav.navigate('StartExpense', {})} />
              </Card>
            )}
          </>
        )}
      </QueryView>
    </Screen>
  );
}

function QuickAction({icon: Icon, label, tone, onPress}: {icon: any; label: string; tone: string; onPress: () => void}) {
  const {colors} = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({pressed}) => [styles.quick, {backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border}]}>
      <Icon size={22} color={tone} />
      <Text variant="smallStrong" align="center" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: {flexDirection: 'row', alignItems: 'center', marginBottom: space.lg, marginTop: space.sm},
  badge: {position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4},
  hero: {borderRadius: radius.xl, padding: space.xl, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth},
  heroRow: {flexDirection: 'row', alignItems: 'flex-end', marginTop: space.md},
  heroDivider: {width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: space.md},
  actions: {flexDirection: 'row', gap: space.sm, marginTop: space.lg},
  quick: {flex: 1, alignItems: 'center', gap: space.sm, paddingVertical: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, minHeight: 84},
});
