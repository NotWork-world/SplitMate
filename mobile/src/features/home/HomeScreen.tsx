import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import Svg, {Circle, Line, Path} from 'react-native-svg';
import {ArrowUpRight, Bell, ScanLine, Utensils, Wallet} from 'lucide-react-native';
import {useSpendingQuery, useSummaryQuery} from '../../api/endpoints';
import {
  Accent,
  Button,
  Card,
  EmptyState,
  IconButton,
  LogoMark,
  Screen,
  SectionTitle,
  Text,
  radius,
  space,
  useTheme,
} from '../../design';
import {formatMoney} from '../../money/currency';
import {useAppSelector} from '../../store';
import {QueryView} from '../common/QueryView';
import {ExpenseRow, RepaymentRow} from '../common/rows';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function HomeScreen() {
  const nav = useNavigation();
  const {colors} = useTheme();
  const user = useAppSelector(s => s.auth.user);
  const q = useSummaryQuery(undefined, {refetchOnFocus: true, refetchOnMountOrArgChange: 30});
  const spending = useSpendingQuery(2, {refetchOnFocus: true});
  const currency = user?.default_currency ?? 'INR';

  return (
    <Screen
      refreshing={q.isFetching && !q.isLoading}
      onRefresh={() => {
        q.refetch();
        spending.refetch();
      }}>
      <View style={styles.top}>
        <View style={[styles.logoPill, {borderColor: colors.text}]}>
          <LogoMark size={22} />
          <Text variant="smallStrong">SplitMate</Text>
        </View>
        <View>
          <IconButton icon={Bell} label="Notifications" filled onPress={() => nav.navigate('Notifications')} />
          {q.data?.unread_notifications ? (
            <View style={[styles.badge, {backgroundColor: colors.accent}]}>
              <Text variant="caption" color={colors.bg}>
                {Math.min(q.data.unread_notifications, 99)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <QueryView query={q} loadingLabel="Loading your balances">
        {s => {
          const owed = s.owed_to_me.find(b => b.currency === currency)?.amount_minor ?? 0;
          const owe = s.i_owe.find(b => b.currency === currency)?.amount_minor ?? 0;
          const net = owed - owe;
          const months = spending.data?.months ?? [];
          const thisMonth = months[months.length - 1];
          const lastMonth = months[months.length - 2];
          const change = thisMonth && lastMonth && lastMonth.amount_minor ? Math.round(((thisMonth.amount_minor - lastMonth.amount_minor) / lastMonth.amount_minor) * 100) : null;
          return (
            <>
              <Text variant="hero" align="center" style={{alignSelf: 'stretch', marginTop: space.md}}>
                Your <Accent>balance</Accent>
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Net balance ${formatMoney(net, currency)}. Open balances.`} onPress={() => nav.navigate('Balances')}>
                <BalanceGauge owed={owed} owe={owe} currency={currency} />
              </Pressable>

              <View style={styles.actions}>
                <Button label="Split a bill" icon={Utensils} variant="food" style={{flex: 1}} onPress={() => nav.navigate('StartExpense', {mode: 'itemized'})} />
                <Button label="Add expense" icon={Wallet} style={{flex: 1}} onPress={() => nav.navigate('StartExpense', {mode: 'simple'})} />
              </View>

              <Text variant="title" style={{marginTop: space.xxl, marginBottom: space.md}}>
                Your <Accent>information</Accent>
              </Text>
              <View style={styles.grid}>
                <Tile label="Owed to you" value={formatMoney(owed, currency)} chip={s.owed_to_me.length > 1 ? `+${s.owed_to_me.length - 1} currency` : undefined} tone="positive" onPress={() => nav.navigate('Balances')} />
                <Tile label="You owe" value={formatMoney(owe, currency)} tone="negative" onPress={() => nav.navigate('Balances')} />
                <Tile
                  label={thisMonth ? `Spent in ${MONTHS[Number(thisMonth.month.slice(5)) - 1]}` : 'This month'}
                  value={formatMoney(thisMonth?.amount_minor ?? 0, spending.data?.currency ?? currency)}
                  chip={change !== null ? `${change > 0 ? '+' : ''}${change}%` : undefined}
                  tone={change !== null && change > 0 ? 'negative' : 'positive'}
                  onPress={() => nav.navigate('Tabs', {screen: 'Activity'})}
                />
                <Tile
                  label="Waiting for you"
                  value={`${s.needs_my_action.length}`}
                  chip={s.drafts.length ? `${s.drafts.length} draft${s.drafts.length > 1 ? 's' : ''}` : undefined}
                  tone="neutral"
                  onPress={() => nav.navigate('Repayments', {})}
                />
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() => nav.navigate('StartExpense', {mode: 'itemized'})}
                style={[styles.scan, {backgroundColor: colors.highlight}]}>
                <ScanLine size={22} color={colors.highlightText} />
                <View style={{flex: 1}}>
                  <Text variant="bodyStrong" color={colors.highlightText}>
                    Scan a receipt
                  </Text>
                  <Text variant="small" color={colors.highlightText}>
                    Read the bill on your phone, check every line, then split it.
                  </Text>
                </View>
                <ArrowUpRight size={20} color={colors.highlightText} />
              </Pressable>

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
                </Card>
              )}
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}

/**
 * Semicircle gauge: how the money you're owed compares with what you owe.
 * Full right = everything is coming back to you; full left = you owe it all.
 */
function BalanceGauge({owed, owe, currency}: {owed: number; owe: number; currency: string}) {
  const {colors} = useTheme();
  const net = owed - owe;
  const share = owed + owe === 0 ? 0.5 : owed / (owed + owe);
  const W = 300;
  const cx = W / 2;
  const cy = 160;
  const R = 128;
  const point = (t: number, r: number) => {
    const a = Math.PI * (1 - t); // t=0 left, t=1 right
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const [ex, ey] = point(share, R);
  const [sx, sy] = point(0, R);
  const large = share > 0.5 ? 1 : 0;
  return (
    <View style={{alignItems: 'center', marginTop: space.sm}}>
      <Svg width={W} height={178}>
        <Path d={`M ${sx} ${sy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} stroke={colors.border} strokeWidth={4} fill="none" />
        {Array.from({length: 13}).map((_, i) => {
          const [x1, y1] = point(i / 12, R + 10);
          const [x2, y2] = point(i / 12, R + (i % 3 === 0 ? 22 : 16));
          return <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={colors.textFaint} strokeWidth={1.5} />;
        })}
        {share > 0.001 ? (
          <Path d={`M ${sx} ${sy} A ${R} ${R} 0 ${large} 1 ${ex} ${ey}`} stroke="#C3D96A" strokeWidth={8} strokeLinecap="round" fill="none" />
        ) : null}
        <Circle cx={ex} cy={ey} r={9} fill={colors.bg} stroke="#C3D96A" strokeWidth={4} />
        <Circle cx={cx} cy={cy - 6} r={92} fill={colors.surface} />
      </Svg>
      <View style={styles.gaugeCenter} pointerEvents="none">
        <Text variant="small" tone="muted">
          Net balance
        </Text>
        <Text variant="amountHero" numberOfLines={1} adjustsFontSizeToFit style={{maxWidth: 170}}>
          {formatMoney(Math.abs(net), currency)}
        </Text>
        <View style={[styles.chip, {backgroundColor: net >= 0 ? colors.positiveSoft : colors.negativeSoft}]}>
          <Text variant="caption" tone={net >= 0 ? 'positive' : 'negative'}>
            {net > 0 ? 'coming back to you' : net < 0 ? 'you owe overall' : 'all settled'}
          </Text>
        </View>
      </View>
      <View style={styles.gaugeLabels}>
        <Text variant="caption" tone="faint">
          You owe
        </Text>
        <Text variant="caption" tone="faint">
          Owed to you
        </Text>
      </View>
    </View>
  );
}

function Tile({
  label,
  value,
  chip,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  chip?: string;
  tone: 'positive' | 'negative' | 'neutral';
  onPress: () => void;
}) {
  const {colors} = useTheme();
  const chipBg = tone === 'positive' ? colors.positiveSoft : tone === 'negative' ? colors.negativeSoft : colors.accentSoft;
  const chipFg = tone === 'positive' ? colors.positive : tone === 'negative' ? colors.negative : colors.accentText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={({pressed}) => [styles.tile, {backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border}]}>
      <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
        <Text variant="small" tone="muted" numberOfLines={1} style={{flex: 1}}>
          {label}
        </Text>
        <ArrowUpRight size={16} color={colors.textMuted} />
      </View>
      <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: space.lg, flexWrap: 'wrap'}}>
        <Text variant="title" numberOfLines={1} adjustsFontSizeToFit style={{flexShrink: 1}}>
          {value}
        </Text>
        {chip ? (
          <View style={[styles.chip, {backgroundColor: chipBg, marginBottom: 6}]}>
            <Text variant="caption" color={chipFg}>
              {chip}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm},
  logoPill: {flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.2, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6},
  badge: {position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4},
  gaugeCenter: {position: 'absolute', top: 70, alignItems: 'center'},
  gaugeLabels: {flexDirection: 'row', justifyContent: 'space-between', width: 300, marginTop: -6},
  chip: {paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, marginTop: 4},
  actions: {flexDirection: 'row', gap: space.sm, marginTop: space.xl},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm},
  tile: {width: '48.6%', borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, minHeight: 124},
  scan: {flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, padding: space.lg, marginTop: space.md},
});
