import React, {useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {ChevronDown, ChevronUp} from 'lucide-react-native';
import type {Member} from '../../api/types';
import {Avatar, Card, Divider, Money, Text, space, useTheme} from '../../design';
import {formatBp, formatMoney} from '../../money/currency';
import type {BillResult} from '../../money/types';

function Line({label, sub, minor, currency, negative, strong, tone}: {label: string; sub?: string; minor: number; currency: string; negative?: boolean; strong?: boolean; tone?: 'positive' | 'warning'}) {
  return (
    <View style={styles.line}>
      <View style={{flex: 1}}>
        <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? 'default' : 'muted'}>
          {label}
        </Text>
        {sub ? (
          <Text variant="caption" tone="faint">
            {sub}
          </Text>
        ) : null}
      </View>
      <Text variant={strong ? 'amount' : 'amountSmall'} tone={tone ?? (negative ? 'positive' : 'default')}>
        {negative ? '−' : ''}
        {formatMoney(minor, currency)}
      </Text>
    </View>
  );
}

/** The whole bill, explained. Works for both local previews and server snapshots. */
export function BillBreakdown({result: r}: {result: BillResult}) {
  const cur = r.currency;
  const pre = r.discounts.filter(d => d.stage === 'pre_tax' && d.amount);
  const post = r.discounts.filter(d => d.stage === 'post_tax' && d.amount);
  return (
    <Card>
      <Line label="Items" sub={`${r.items.length} item${r.items.length === 1 ? '' : 's'}`} minor={r.item_gross} currency={cur} />
      {r.item_discounts ? <Line label="Item discounts" minor={r.item_discounts} currency={cur} negative /> : null}
      {pre.map(d => (
        <Line
          key={d.id}
          label={d.label || 'Discount'}
          sub={`${d.kind === 'percent' ? formatBp(d.value) : 'Fixed'}${d.is_coupon ? ' coupon' : ''} · before tax · shared by item price`}
          minor={d.amount}
          currency={cur}
          negative
        />
      ))}
      {r.tax_lines.length ? (
        <>
          <Divider />
          <Line label="Taxable amount" sub="After discounts, before tax" minor={r.taxable_base} currency={cur} />
          {r.tax_lines.map((t, i) => (
            <Line
              key={`${t.component}-${t.group_rate_bp}-${t.inclusive}-${i}`}
              label={`${t.component} ${formatBp(t.component_rate_bp)}${t.inclusive ? ' (included in prices)' : ''}`}
              sub={`On ${formatMoney(t.taxable_base, cur)} · ${t.source === 'receipt' ? `from receipt${t.computed_amount !== t.amount ? ` (estimate ${formatMoney(t.computed_amount, cur)})` : ''}` : 'calculated from the rate you set'}`}
              minor={t.amount}
              currency={cur}
            />
          ))}
        </>
      ) : null}
      {r.charge_lines.length ? <Divider /> : null}
      {r.charge_lines.map(c => (
        <Line
          key={c.id}
          label={c.label || c.type}
          sub={`${c.kind === 'percent' ? formatBp(c.value) + ' of subtotal' : 'Fixed'}${c.tax ? ` · incl. ${formatMoney(c.tax, cur)} GST` : ''} · split ${c.allocation === 'equal' ? 'equally' : 'by order'}`}
          minor={c.total}
          currency={cur}
        />
      ))}
      {post.map(d => (
        <Line key={d.id} label={d.label || 'Coupon'} sub="On the final total" minor={d.amount} currency={cur} negative />
      ))}
      {r.rounding ? <Line label="Rounding" minor={Math.abs(r.rounding)} currency={cur} negative={r.rounding < 0} /> : null}
      <Divider />
      <View style={[styles.line, {paddingTop: space.md}]}>
        <Text variant="heading" style={{flex: 1}}>
          Total
        </Text>
        <Money minor={r.total} currency={cur} variant="title" testID="breakdown-total" />
      </View>
      {r.receipt_total !== null ? (
        <Text variant="small" tone={r.receipt_difference ? 'warning' : 'positive'} align="right">
          Receipt says {formatMoney(r.receipt_total, cur)} {r.receipt_difference ? `· differs by ${formatMoney(Math.abs(r.receipt_difference), cur)}` : '✓ matches'}
        </Text>
      ) : null}
    </Card>
  );
}

export function PeopleShares({
  result: r,
  members,
  paid,
}: {
  result: BillResult;
  members: Member[];
  paid: Record<string, number>;
}) {
  const {colors} = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  const byId = Object.fromEntries(members.map(m => [m.id, m]));
  const people = [...r.people].sort((a, b) => b.total - a.total);
  const payerIds = Object.keys(paid).filter(id => paid[id]);
  return (
    <Card padded={false} style={{paddingHorizontal: space.md}}>
      {people.map(p => {
        const m = byId[p.member_id];
        const name = m ? (m.is_me ? 'You' : m.display_name) : 'Former member';
        const expanded = open === p.member_id;
        const net = (paid[p.member_id] ?? 0) - p.total;
        return (
          <View key={p.member_id} style={{borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border}}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{expanded}}
              accessibilityLabel={`${name} ${m?.is_me ? 'pay' : 'pays'} ${formatMoney(p.total, r.currency)}`}
              onPress={() => setOpen(expanded ? null : p.member_id)}
              style={{flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md}}>
              <Avatar name={m?.display_name ?? '?'} hue={m?.avatar_hue} size={36} />
              <View style={{flex: 1}}>
                <Text variant="bodyStrong">{name}</Text>
                <Text variant="small" tone={net > 0 ? 'positive' : net < 0 ? 'negative' : 'muted'}>
                  {paid[p.member_id]
                    ? net > 0
                      ? `paid ${formatMoney(paid[p.member_id], r.currency)} · gets back ${formatMoney(net, r.currency)}`
                      : net < 0
                      ? `paid ${formatMoney(paid[p.member_id], r.currency)} · owes ${formatMoney(-net, r.currency)}`
                      : 'paid their share exactly'
                    : payerIds.length
                    ? `owes ${payerIds.map(id => (byId[id]?.is_me ? 'you' : byId[id]?.display_name ?? '?')).join(' & ')}`
                    : 'share'}
                </Text>
              </View>
              <Money minor={p.total} currency={r.currency} variant="amount" />
              {expanded ? <ChevronUp size={18} color={colors.textFaint} /> : <ChevronDown size={18} color={colors.textFaint} />}
            </Pressable>
            {expanded ? (
              <View style={{paddingBottom: space.md, paddingLeft: 48}}>
                {p.items.map(it => (
                  <View key={it.item_id} style={styles.subLine}>
                    <Text variant="small" tone="muted" style={{flex: 1}} numberOfLines={1}>
                      {it.name}
                    </Text>
                    <Text variant="small" tabular>
                      {formatMoney(it.amount, r.currency)}
                    </Text>
                  </View>
                ))}
                <SubLine label="of which item & bill discounts" minor={-(p.item_discounts + p.bill_discounts)} cur={r.currency} />
                <SubLine label="of which tax added" minor={p.tax_added} cur={r.currency} />
                {p.tax_included ? <SubLine label="tax included in prices" minor={p.tax_included} cur={r.currency} info /> : null}
                <SubLine label="Charges (service, tip, fees)" minor={p.charges} cur={r.currency} />
                <SubLine label="Coupons on total" minor={-p.post_tax_discounts} cur={r.currency} />
                <SubLine label="Rounding" minor={p.rounding} cur={r.currency} />
              </View>
            ) : null}
          </View>
        );
      })}
      {r.unallocated ? (
        <View style={{paddingVertical: space.md}}>
          <Text variant="smallStrong" tone="warning">
            {formatMoney(r.unallocated, r.currency)} isn't assigned to anyone yet
          </Text>
        </View>
      ) : (
        <Text variant="caption" tone="faint" style={{paddingVertical: space.md}}>
          Shares add up to {formatMoney(r.allocated_total, r.currency)} = the total ✓
        </Text>
      )}
    </Card>
  );
}

function SubLine({label, minor, cur, info}: {label: string; minor: number; cur: string; info?: boolean}) {
  if (!minor) {
    return null;
  }
  return (
    <View style={styles.subLine}>
      <Text variant="caption" tone="faint" style={{flex: 1}}>
        {label}
      </Text>
      <Text variant="caption" tone="faint" tabular>
        {info ? '' : minor > 0 ? '+' : '−'}
        {formatMoney(Math.abs(minor), cur)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: space.md},
  subLine: {flexDirection: 'row', alignItems: 'center', paddingVertical: 2},
});
