import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {Check} from 'lucide-react-native';
import type {ExpensePayload, ItemPayload, Member, SplitKind} from '../../api/types';
import {Avatar, Card, MoneyField, Segmented, Text, TextField, space, useTheme} from '../../design';
import {formatBp, formatMoney, parseBp} from '../../money/currency';
import type {BillResult} from '../../money/types';
import {newItem} from './draft';

const MAIN = 'main';

/** Equal / exact / percent / shares split of one amount (rent, fuel, tickets…). */
export function SimpleSplit({
  payload,
  members,
  result,
  onChange,
}: {
  payload: ExpensePayload;
  members: Member[];
  result: BillResult;
  onChange: (p: Partial<ExpensePayload>) => void;
}) {
  const {colors} = useTheme();
  const item: ItemPayload = payload.items[0] ?? newItem({client_id: MAIN, name: payload.title || 'Expense'});
  const mode = payload.split_kind === 'itemized' ? 'equal' : payload.split_kind;
  const [pctText, setPctText] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.consumers.map(c => [c.member_id, item.split_mode === 'percent' ? formatBp(c.value).replace('%', '') : ''])),
  );
  const cur = payload.currency;

  const setItem = (changes: Partial<ItemPayload>, split?: SplitKind) => {
    const next = {...item, name: payload.title || 'Expense', ...changes};
    onChange({items: [next], split_kind: split ?? payload.split_kind});
  };
  const consumerValue = (id: string) => item.consumers.find(c => c.member_id === id)?.value;
  const included = (id: string) => item.consumers.some(c => c.member_id === id);
  const toggle = (id: string) => {
    const next = included(id)
      ? item.consumers.filter(c => c.member_id !== id)
      : [...item.consumers, {member_id: id, value: mode === 'shares' ? 1 : 0}];
    setItem({consumers: next});
  };
  const setValue = (id: string, value: number) =>
    setItem({consumers: item.consumers.map(c => (c.member_id === id ? {...c, value} : c))});

  const sumValues = item.consumers.reduce((a, c) => a + c.value, 0);
  const share = Object.fromEntries((result.items[0]?.shares ?? []).map(s => [s.member_id, s.total]));

  return (
    <View style={{gap: space.md}}>
      <MoneyField
        label="Amount"
        currency={cur}
        value={item.unit_price_minor || null}
        onChange={v => setItem({unit_price_minor: v ?? 0, quantity_milli: 1000})}
        testID="simple-amount"
      />
      <Segmented<SplitKind>
        value={mode}
        onChange={k => {
          const values = item.consumers.map(c => ({member_id: c.member_id, value: k === 'shares' ? 1 : 0}));
          setPctText({});
          setItem({split_mode: k as ItemPayload['split_mode'], consumers: values}, k);
        }}
        options={[
          {value: 'equal', label: 'Equally'},
          {value: 'exact', label: 'Exact'},
          {value: 'percent', label: '%'},
          {value: 'shares', label: 'Shares'},
        ]}
      />
      <Card padded={false} style={{paddingHorizontal: space.md}}>
        {members.map(m => {
          const on = included(m.id);
          return (
            <View key={m.id} style={{flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, minHeight: 56}}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{checked: on}}
                accessibilityLabel={m.display_name}
                onPress={() => toggle(m.id)}
                style={{flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1}}>
                <View>
                  <Avatar name={m.display_name} hue={m.avatar_hue} size={36} selected={on} />
                  {on ? (
                    <View style={{position: 'absolute', right: -2, bottom: -2, backgroundColor: colors.accent, borderRadius: 8, padding: 1}}>
                      <Check size={11} color="#fff" />
                    </View>
                  ) : null}
                </View>
                <View style={{flex: 1}}>
                  <Text variant="bodyStrong" tone={on ? 'default' : 'faint'} numberOfLines={1}>
                    {m.is_me ? 'You' : m.display_name}
                  </Text>
                  {on && share[m.id] !== undefined ? (
                    <Text variant="small" tone="muted">
                      {formatMoney(share[m.id], cur)}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              {on && mode === 'exact' ? (
                <MoneyField containerStyle={{width: 140}} currency={cur} value={consumerValue(m.id) || null} onChange={v => setValue(m.id, v ?? 0)} />
              ) : null}
              {on && mode === 'percent' ? (
                <TextField
                  containerStyle={{width: 96}}
                  keyboardType="decimal-pad"
                  suffix="%"
                  value={pctText[m.id] ?? ''}
                  onChangeText={t => {
                    setPctText({...pctText, [m.id]: t});
                    setValue(m.id, parseBp(t) ?? 0);
                  }}
                />
              ) : null}
              {on && mode === 'shares' ? (
                <View style={{flexDirection: 'row', alignItems: 'center', gap: space.xs}}>
                  <Stepper label="−" onPress={() => setValue(m.id, Math.max(1, (consumerValue(m.id) ?? 1) - 1))} />
                  <Text variant="bodyStrong" style={{minWidth: 24, textAlign: 'center'}}>
                    {consumerValue(m.id) ?? 1}
                  </Text>
                  <Stepper label="+" onPress={() => setValue(m.id, (consumerValue(m.id) ?? 1) + 1)} />
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>
      {mode === 'exact' ? (
        <Text variant="small" tone={sumValues === item.unit_price_minor ? 'positive' : 'warning'}>
          {formatMoney(sumValues, cur)} of {formatMoney(item.unit_price_minor, cur)} assigned
          {sumValues !== item.unit_price_minor ? ` · ${formatMoney(Math.abs(item.unit_price_minor - sumValues), cur)} ${sumValues < item.unit_price_minor ? 'left' : 'too much'}` : ' ✓'}
        </Text>
      ) : null}
      {mode === 'percent' ? (
        <Text variant="small" tone={sumValues === 10000 ? 'positive' : 'warning'}>
          {formatBp(sumValues)} of 100% {sumValues === 10000 ? '✓' : ''}
        </Text>
      ) : null}
    </View>
  );
}

function Stepper({label, onPress}: {label: string; onPress: () => void}) {
  const {colors} = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'More shares' : 'Fewer shares'}
      onPress={onPress}
      hitSlop={6}
      style={{width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceStrong}}>
      <Text variant="heading">{label}</Text>
    </Pressable>
  );
}
