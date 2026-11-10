import React from 'react';
import {Pressable, StyleSheet, useWindowDimensions, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import Svg, {Circle, Line, Path} from 'react-native-svg';
import {ArrowUpRight, Bell, ScanLine, Users, Utensils, Wallet} from 'lucide-react-native';
import {useMyBalancesQuery, useSummaryQuery} from '../../api/endpoints';
import type {MyBalances} from '../../api/types';
import {Accent, Avatar, Button, IconButton, LogoMark, Screen, Text, radius, space, useTheme} from '../../design';
import {formatMoney} from '../../money/currency';
import {useAppSelector} from '../../store';
import {QueryView} from '../common/QueryView';

export function HomeScreen() {
  const nav = useNavigation();
  const {colors} = useTheme();
  const user = useAppSelector(s => s.auth.user);
  const q = useSummaryQuery(undefined, {refetchOnFocus: true, refetchOnMountOrArgChange: 30});
  const balances = useMyBalancesQuery(undefined, {refetchOnFocus: true});
  const currency = user?.default_currency ?? 'INR';
  const compact = useWindowDimensions().height < 760;

  return (
    <Screen
      refreshing={q.isFetching && !q.isLoading}
      onRefresh={() => {
        q.refetch();
        balances.refetch();
      }}
      // The dashboard is a single page: content is sized to fit, so it never scrolls or jumps.
      contentStyle={{flexGrow: 1, paddingBottom: space.md}}
      scrollProps={{overScrollMode: 'never', showsVerticalScrollIndicator: false}}>
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
          // Net per person across groups (autocut) once the breakdown is loaded, so the
          // gauge shows what would really change hands instead of double-counted flows.
          const netted = balances.data ? netPerPerson(balances.data, currency) : null;
          const owed = netted ? netted.owed : (s.owed_to_me.find(b => b.currency === currency)?.amount_minor ?? 0);
          const owe = netted ? netted.owe : (s.i_owe.find(b => b.currency === currency)?.amount_minor ?? 0);
          const net = owed - owe;
          return (
            <>
              <Text variant="hero" align="center" style={{alignSelf: 'stretch', marginTop: compact ? 0 : space.sm}}>
                Your <Accent>balance</Accent>
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Net balance ${formatMoney(net, currency)}. Open balances.`} onPress={() => nav.navigate('Balances')}>
                <BalanceGauge owed={owed} owe={owe} currency={currency} width={compact ? 250 : 290} />
              </Pressable>

              <View style={[styles.actions, {marginTop: compact ? space.sm : space.lg}]}>
                <Button label="Split a bill" icon={Utensils} variant="food" style={{flex: 1}} onPress={() => nav.navigate('StartExpense', {mode: 'itemized'})} />
                <Button label="Add expense" icon={Wallet} style={{flex: 1}} onPress={() => nav.navigate('StartExpense', {mode: 'simple'})} />
              </View>

              <View style={[styles.grid, {marginTop: compact ? space.md : space.lg}]}>
                <Tile label="Owed to you" value={formatMoney(owed, currency)} chip={s.owed_to_me.length > 1 ? `+${s.owed_to_me.length - 1} currency` : undefined} tone="positive" onPress={() => nav.navigate('Balances')} />
                <Tile label="You owe" value={formatMoney(owe, currency)} tone="negative" onPress={() => nav.navigate('Balances')} />
              </View>

              <PeopleCard waiting={s.needs_my_action.length} rows={compact ? 2 : 3} />

              {/* One wide card: start here if there are no groups, otherwise scan a bill. */}
              <Pressable
                accessibilityRole="button"
                onPress={() => (s.group_count === 0 ? nav.navigate('CreateGroup') : nav.navigate('ReceiptScan', {}))}
                style={[styles.scan, {backgroundColor: colors.highlight}]}>
                {s.group_count === 0 ? <Users size={22} color={colors.highlightText} /> : <ScanLine size={22} color={colors.highlightText} />}
                <View style={{flex: 1}}>
                  <Text variant="bodyStrong" color={colors.highlightText}>
                    {s.group_count === 0 ? 'Start with a group' : 'Scan a receipt'}
                  </Text>
                  <Text variant="small" color={colors.highlightText} numberOfLines={1}>
                    {s.group_count === 0 ? 'Your flat, a trip or tonight’s dinner' : 'Check every line, then split it'}
                  </Text>
                </View>
                <ArrowUpRight size={20} color={colors.highlightText} />
              </Pressable>
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}

/**
 * Net one person's balances across every group (autocut) in a currency: owing you ₹25 in
 * one group while you owe them ₹100 in another is one "you pay ₹75". Returns the sums
 * over the per-person nets so the gauge doesn't double-count cancelled-out flows.
 */
function netPerPerson(data: MyBalances, currency: string): {owed: number; owe: number} {
  const per = new Map<string, number>();
  for (const g of data.groups) {
    if (g.currency !== currency) {
      continue;
    }
    for (const p of g.people) {
      if (p.amount_minor === 0) {
        continue;
      }
      // Friends without a SplitMate account can't be netted across groups.
      const key = p.member.user_id ?? `${g.group_id}-${p.member.id}`;
      per.set(key, (per.get(key) ?? 0) + p.amount_minor);
    }
  }
  let owed = 0;
  let owe = 0;
  for (const v of per.values()) {
    if (v > 0) {
      owed += v;
    } else if (v < 0) {
      owe += -v;
    }
  }
  return {owed, owe};
}

interface NetRow {
  key: string;
  name: string;
  hue: number;
  amount: number; // net across groups: + they owe me, − I owe them
  currency: string;
  groupCount: number;
  firstGroup: {groupId: string; memberId: string};
  singleGroupName: string;
}

/**
 * Who owes you and whom you owe, netted per person across groups (autocut), largest
 * first. Money still settles per group, so a netted row opens Balances where each
 * group has its own settle action; single-group rows settle directly.
 */
function PeopleCard({waiting, rows}: {waiting: number; rows: number}) {
  const nav = useNavigation();
  const {colors} = useTheme();
  const q = useMyBalancesQuery(undefined, {refetchOnFocus: true, refetchOnMountOrArgChange: 30});
  const people = (() => {
    const net = new Map<string, NetRow>();
    for (const g of q.data?.groups ?? []) {
      for (const p of g.people) {
        if (p.amount_minor === 0) {
          continue;
        }
        const key = p.member.user_id ? `${p.member.user_id}-${g.currency}` : `${g.group_id}-${p.member.id}`;
        const row = net.get(key);
        if (row) {
          row.amount += p.amount_minor;
          row.groupCount += 1;
        } else {
          net.set(key, {
            key,
            name: p.member.display_name,
            hue: p.member.avatar_hue,
            amount: p.amount_minor,
            currency: g.currency,
            groupCount: 1,
            firstGroup: {groupId: g.group_id, memberId: p.member.id},
            singleGroupName: g.group_name,
          });
        }
      }
    }
    return [...net.values()]
      .filter(r => r.amount !== 0)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  })();
  return (
    <View style={[styles.people, {backgroundColor: colors.surface, borderColor: colors.border}]}>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
        <Text variant="bodyStrong">People</Text>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => nav.navigate('Balances')} testID="home-people-all">
          <Text variant="smallStrong" tone="accent">
            See all
          </Text>
        </Pressable>
      </View>
      {waiting ? (
        <Pressable accessibilityRole="button" onPress={() => nav.navigate('Repayments', {})} style={[styles.waiting, {backgroundColor: colors.warningSoft}]}>
          <Text variant="smallStrong" tone="warning" style={{flex: 1}}>
            {waiting} payment{waiting > 1 ? 's' : ''} waiting for you
          </Text>
          <ArrowUpRight size={16} color={colors.warning} />
        </Pressable>
      ) : null}
      {people.length === 0 ? (
        <Text variant="small" tone="muted" style={{marginTop: space.sm}}>
          {q.isLoading ? 'Loading…' : 'Nobody owes anybody. You’re all settled up.'}
        </Text>
      ) : (
        people.slice(0, rows).map(p => {
          const owesMe = p.amount > 0;
          const netted = p.groupCount > 1;
          return (
            <View key={p.key} style={styles.personRow}>
              <Avatar name={p.name} hue={p.hue} size={34} />
              <View style={{flex: 1}}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {p.name}
                </Text>
                <Text variant="caption" tone={owesMe ? 'positive' : 'negative'} numberOfLines={1}>
                  {owesMe ? 'owes you' : 'you owe'} {formatMoney(Math.abs(p.amount), p.currency)} · {netted ? `net across ${p.groupCount} groups` : p.singleGroupName}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${owesMe ? 'Request' : 'Pay'} ${p.name}`}
                onPress={() =>
                  netted
                    ? nav.navigate('Balances')
                    : nav.navigate('SettleUp', {
                        groupId: p.firstGroup.groupId,
                        memberId: p.firstGroup.memberId,
                        currency: p.currency,
                        amount: Math.abs(p.amount),
                        mode: owesMe ? 'request' : 'record',
                      })
                }
                style={[styles.settle, {backgroundColor: owesMe ? colors.highlight : colors.text}]}>
                <Text variant="smallStrong" color={owesMe ? colors.highlightText : colors.bg}>
                  {owesMe ? 'Request' : 'Pay'}
                </Text>
              </Pressable>
            </View>
          );
        })
      )}
    </View>
  );
}

/**
 * Semicircle gauge: how the money you're owed compares with what you owe.
 * Full right = everything is coming back to you; full left = you owe it all.
 */
function BalanceGauge({owed, owe, currency, width: W}: {owed: number; owe: number; currency: string; width: number}) {
  const {colors} = useTheme();
  const net = owed - owe;
  const share = owed + owe === 0 ? 0.5 : owed / (owed + owe);
  const k = W / 300; // drawn at 300 wide, scaled to fit the screen
  const cx = W / 2;
  const cy = 160 * k;
  const R = 128 * k;
  const point = (t: number, r: number) => {
    const a = Math.PI * (1 - t); // t=0 left, t=1 right
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const [ex, ey] = point(share, R);
  const [sx, sy] = point(0, R);
  const large = share > 0.5 ? 1 : 0;
  return (
    <View style={{alignItems: 'center', marginTop: space.xs}}>
      <Svg width={W} height={178 * k}>
        <Path d={`M ${sx} ${sy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} stroke={colors.border} strokeWidth={4} fill="none" />
        {Array.from({length: 13}).map((_, i) => {
          const [x1, y1] = point(i / 12, R + 10 * k);
          const [x2, y2] = point(i / 12, R + (i % 3 === 0 ? 22 : 16) * k);
          return <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={colors.textFaint} strokeWidth={1.5} />;
        })}
        {share > 0.001 ? (
          <Path d={`M ${sx} ${sy} A ${R} ${R} 0 ${large} 1 ${ex} ${ey}`} stroke="#C3D96A" strokeWidth={8} strokeLinecap="round" fill="none" />
        ) : null}
        <Circle cx={ex} cy={ey} r={9} fill={colors.bg} stroke="#C3D96A" strokeWidth={4} />
        <Circle cx={cx} cy={cy - 6 * k} r={92 * k} fill={colors.surface} />
      </Svg>
      <View style={[styles.gaugeCenter, {top: 70 * k}]} pointerEvents="none">
        <Text variant="small" tone="muted">
          Net balance
        </Text>
        <Text variant="amountHero" numberOfLines={1} adjustsFontSizeToFit style={{maxWidth: 160 * k}}>
          {formatMoney(Math.abs(net), currency)}
        </Text>
        <View style={[styles.chip, {backgroundColor: net >= 0 ? colors.positiveSoft : colors.negativeSoft}]}>
          <Text variant="caption" tone={net >= 0 ? 'positive' : 'negative'}>
            {net > 0 ? 'coming back to you' : net < 0 ? 'you owe overall' : 'all settled'}
          </Text>
        </View>
      </View>
      <View style={[styles.gaugeLabels, {width: W}]}>
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
      <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: space.sm, flexWrap: 'wrap'}}>
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
  gaugeCenter: {position: 'absolute', alignItems: 'center'},
  gaugeLabels: {flexDirection: 'row', justifyContent: 'space-between', marginTop: -6},
  chip: {paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, marginTop: 4},
  actions: {flexDirection: 'row', gap: space.sm},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm},
  tile: {width: '48.6%', borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 92},
  people: {borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, paddingVertical: space.md, marginTop: space.sm},
  personRow: {flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm},
  settle: {paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill},
  waiting: {flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, marginTop: space.sm},
  scan: {flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md, marginTop: space.sm},
});
