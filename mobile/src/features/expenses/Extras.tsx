import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {Plus, Trash2} from 'lucide-react-native';
import type {ChargePayload, DiscountPayload, ExpensePayload, Member, ReportedTaxPayload} from '../../api/types';
import {
  Avatar,
  Button,
  Card,
  Chip,
  IconButton,
  ListRow,
  MoneyField,
  Segmented,
  Sheet,
  SwitchRow,
  Text,
  TextField,
  space,
  useTheme,
} from '../../design';
import {formatBp, formatMoney, parseBp} from '../../money/currency';
import type {BillResult, ChargeType} from '../../money/types';
import {newCharge, newDiscount} from './draft';

const CHARGE_TYPES: Array<{type: ChargeType; label: string}> = [
  {type: 'service', label: 'Service charge'},
  {type: 'packaging', label: 'Packaging'},
  {type: 'delivery', label: 'Delivery fee'},
  {type: 'tip', label: 'Tip'},
  {type: 'other', label: 'Other charge'},
  {type: 'adjustment', label: 'Adjustment'},
];

function valueLabel(kind: 'fixed' | 'percent', value: number, currency: string) {
  return kind === 'percent' ? formatBp(value) : formatMoney(value, currency);
}

// ------------------------------------------------------------------ discounts

function DiscountSheet({
  value,
  currency,
  items,
  onSave,
  onClose,
}: {
  value: DiscountPayload | null;
  currency: string;
  items: ExpensePayload['items'];
  onSave: (d: DiscountPayload) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<DiscountPayload | null>(value);
  const [pct, setPct] = useState(value && value.kind === 'percent' ? formatBp(value.value).replace('%', '') : '');
  React.useEffect(() => {
    setD(value);
    setPct(value && value.kind === 'percent' && value.value ? formatBp(value.value).replace('%', '') : '');
  }, [value]);
  if (!d) {
    return null;
  }
  const bp = parseBp(pct);
  const valid = d.kind === 'fixed' ? d.value > 0 : bp !== null && bp > 0;
  return (
    <Sheet
      visible={!!value}
      onClose={onClose}
      title="Bill discount"
      footer={<Button label="Save discount" disabled={!valid} onPress={() => onSave({...d, value: d.kind === 'percent' ? bp ?? 0 : d.value})} />}>
      <TextField label="Label" value={d.label} onChangeText={label => setD({...d, label})} placeholder="Discount, SAVE100, Happy hours…" />
      <View style={{marginTop: space.md}}>
        <Segmented
          value={d.kind}
          onChange={kind => setD({...d, kind, value: 0})}
          options={[
            {value: 'fixed', label: 'Amount'},
            {value: 'percent', label: 'Percent'},
          ]}
        />
      </View>
      {d.kind === 'fixed' ? (
        <MoneyField containerStyle={{marginTop: space.sm}} currency={currency} value={d.value || null} onChange={v => setD({...d, value: v ?? 0})} />
      ) : (
        <TextField containerStyle={{marginTop: space.sm}} keyboardType="decimal-pad" suffix="%" value={pct} onChangeText={setPct} />
      )}
      <SwitchRow title="It's a coupon / promo code" value={d.is_coupon} onChange={is_coupon => setD({...d, is_coupon})} />
      <Text variant="smallStrong" tone="muted" style={{marginTop: space.sm, marginBottom: space.sm}}>
        When is it applied?
      </Text>
      <Segmented
        value={d.stage}
        onChange={stage => setD({...d, stage, item_client_ids: stage === 'post_tax' ? null : d.item_client_ids})}
        options={[
          {value: 'pre_tax', label: 'Before tax'},
          {value: 'post_tax', label: 'On the final total'},
        ]}
      />
      <Text variant="small" tone="faint" style={{marginTop: space.xs}}>
        {d.stage === 'pre_tax'
          ? 'Reduces the taxable amount, so GST is lower (most restaurant discounts).'
          : 'Taken off after tax and charges, like an app coupon.'}
      </Text>
      {d.stage === 'pre_tax' ? (
        <>
          <Text variant="smallStrong" tone="muted" style={{marginTop: space.lg, marginBottom: space.sm}}>
            Applies to
          </Text>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
            <Chip label="All items" selected={!d.item_client_ids} onPress={() => setD({...d, item_client_ids: null})} />
            {items.map(it => {
              const on = !!d.item_client_ids?.includes(it.client_id);
              return (
                <Chip
                  key={it.client_id}
                  label={it.name || 'Item'}
                  selected={on}
                  onPress={() => {
                    const cur = d.item_client_ids ?? [];
                    const next = on ? cur.filter(x => x !== it.client_id) : [...cur, it.client_id];
                    setD({...d, item_client_ids: next.length ? next : null});
                  }}
                />
              );
            })}
          </View>
          <Text variant="small" tone="faint" style={{marginTop: space.xs}}>
            Shared across the chosen items in proportion to their price.
          </Text>
        </>
      ) : (
        <>
          <Text variant="smallStrong" tone="muted" style={{marginTop: space.lg, marginBottom: space.sm}}>
            Split the saving
          </Text>
          <Segmented
            value={d.allocation}
            onChange={allocation => setD({...d, allocation})}
            options={[
              {value: 'proportional', label: 'By what each spent'},
              {value: 'equal', label: 'Equally'},
            ]}
          />
        </>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ charges

function ChargeSheet({
  value,
  currency,
  onSave,
  onClose,
}: {
  value: ChargePayload | null;
  currency: string;
  onSave: (c: ChargePayload) => void;
  onClose: () => void;
}) {
  const [c, setC] = useState<ChargePayload | null>(value);
  const [pct, setPct] = useState('');
  const [rate, setRate] = useState('');
  React.useEffect(() => {
    setC(value);
    setPct(value && value.kind === 'percent' && value.value ? formatBp(value.value).replace('%', '') : '');
    setRate(value && value.tax_rate_bp ? formatBp(value.tax_rate_bp).replace('%', '') : '');
  }, [value]);
  if (!c) {
    return null;
  }
  const bp = parseBp(pct);
  const rateBp = rate ? parseBp(rate) : 0;
  const isAdj = c.type === 'adjustment';
  const valid = (c.kind === 'fixed' ? c.value !== 0 && (isAdj || c.value > 0) : bp !== null && bp > 0) && rateBp !== null;
  return (
    <Sheet
      visible={!!value}
      onClose={onClose}
      title="Charge"
      footer={
        <Button
          label="Save charge"
          disabled={!valid}
          onPress={() => onSave({...c, value: c.kind === 'percent' ? bp ?? 0 : c.value, tax_rate_bp: isAdj ? 0 : rateBp ?? 0})}
        />
      }>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
        {CHARGE_TYPES.map(t => (
          <Chip
            key={t.type}
            label={t.label}
            selected={c.type === t.type}
            onPress={() => setC({...c, type: t.type, label: t.label, kind: t.type === 'adjustment' ? 'fixed' : c.kind})}
          />
        ))}
      </View>
      <TextField containerStyle={{marginTop: space.md}} label="Label" value={c.label} onChangeText={label => setC({...c, label})} />
      {!isAdj ? (
        <View style={{marginTop: space.md}}>
          <Segmented
            value={c.kind}
            onChange={kind => setC({...c, kind, value: 0})}
            options={[
              {value: 'fixed', label: 'Amount'},
              {value: 'percent', label: '% of subtotal'},
            ]}
          />
        </View>
      ) : (
        <Text variant="small" tone="faint" style={{marginTop: space.md}}>
          Use an adjustment for a difference you've checked on the receipt. Type "-" for a negative amount.
        </Text>
      )}
      {c.kind === 'fixed' ? (
        <MoneyField
          containerStyle={{marginTop: space.sm}}
          currency={currency}
          allowNegative={isAdj}
          value={c.value || null}
          onChange={v => setC({...c, value: v ?? 0})}
        />
      ) : (
        <TextField containerStyle={{marginTop: space.sm}} keyboardType="decimal-pad" suffix="%" value={pct} onChangeText={setPct} hint="Percent of the item subtotal after discounts, before tax." />
      )}
      {!isAdj ? (
        <>
          <TextField
            containerStyle={{marginTop: space.md}}
            label="GST on this charge (if the bill shows it)"
            placeholder="0"
            keyboardType="decimal-pad"
            suffix="%"
            value={rate}
            onChangeText={setRate}
            error={rateBp === null ? 'Enter a rate like 5 or 18.' : null}
          />
          {rateBp ? (
            <View style={{marginTop: space.sm}}>
              <Segmented
                value={c.tax_scheme}
                onChange={tax_scheme => setC({...c, tax_scheme})}
                options={[
                  {value: 'cgst_sgst', label: 'CGST + SGST'},
                  {value: 'igst', label: 'IGST'},
                  {value: 'gst', label: 'GST'},
                ]}
              />
            </View>
          ) : null}
        </>
      ) : null}
      <Text variant="smallStrong" tone="muted" style={{marginTop: space.lg, marginBottom: space.sm}}>
        Split it
      </Text>
      <Segmented
        value={c.allocation}
        onChange={allocation => setC({...c, allocation})}
        options={[
          {value: 'proportional', label: 'By what each ordered'},
          {value: 'equal', label: 'Equally'},
        ]}
      />
    </Sheet>
  );
}

// ------------------------------------------------------------------ receipt tax lines

function ReportedTaxSheet({visible, currency, onSave, onClose}: {visible: boolean; currency: string; onSave: (t: ReportedTaxPayload[]) => void; onClose: () => void}) {
  const [component, setComponent] = useState<'CGST+SGST' | 'IGST' | 'GST'>('CGST+SGST');
  const [rate, setRate] = useState('');
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const bp = parseBp(rate);
  const valid = bp !== null && bp > 0 && a !== null && (component !== 'CGST+SGST' || b !== null);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Tax exactly as printed"
      footer={
        <Button
          label="Add tax lines"
          disabled={!valid}
          onPress={() => {
            onSave(
              component === 'CGST+SGST'
                ? [
                    {component: 'CGST', rate_bp: bp!, amount_minor: a!},
                    {component: 'SGST', rate_bp: bp!, amount_minor: b!},
                  ]
                : [{component, rate_bp: bp!, amount_minor: a!}],
            );
            setRate('');
            setA(null);
            setB(null);
          }}
        />
      }>
      <Text variant="small" tone="muted" style={{marginBottom: space.md}}>
        Use this when the receipt prints tax amounts. SplitMate uses the receipt's figures instead of its own estimate and labels them "from receipt".
      </Text>
      <Segmented
        value={component}
        onChange={setComponent}
        options={[
          {value: 'CGST+SGST', label: 'CGST + SGST'},
          {value: 'IGST', label: 'IGST'},
          {value: 'GST', label: 'GST'},
        ]}
      />
      <TextField
        containerStyle={{marginTop: space.md}}
        label={component === 'CGST+SGST' ? 'Rate of each (e.g. 2.5)' : 'Rate'}
        keyboardType="decimal-pad"
        suffix="%"
        value={rate}
        onChangeText={setRate}
      />
      <MoneyField containerStyle={{marginTop: space.md}} label={component === 'CGST+SGST' ? 'CGST amount' : 'Tax amount'} currency={currency} value={a} onChange={setA} />
      {component === 'CGST+SGST' ? (
        <MoneyField containerStyle={{marginTop: space.md}} label="SGST amount" currency={currency} value={b} onChange={setB} />
      ) : null}
    </Sheet>
  );
}

// ------------------------------------------------------------------ section

export function BillExtras({
  payload,
  result,
  onChange,
}: {
  payload: ExpensePayload;
  result: BillResult;
  onChange: (p: Partial<ExpensePayload>) => void;
}) {
  const {colors} = useTheme();
  const [disc, setDisc] = useState<DiscountPayload | null>(null);
  const [charge, setCharge] = useState<ChargePayload | null>(null);
  const [taxSheet, setTaxSheet] = useState(false);
  const cur = payload.currency;
  const discAmount = Object.fromEntries(result.discounts.map(d => [d.id, d.amount]));
  const chargeAmount = Object.fromEntries(result.charge_lines.map(c => [c.id, c]));

  return (
    <View style={{gap: space.md}}>
      <Card padded={false} style={{paddingHorizontal: space.sm}}>
        {payload.discounts.map(d => (
          <ListRow
            key={d.client_id}
            title={`${d.label}${d.is_coupon ? ' (coupon)' : ''}`}
            subtitle={`${valueLabel(d.kind, d.value, cur)} · ${d.stage === 'pre_tax' ? 'before tax' : 'on final total'}${d.item_client_ids ? ` · ${d.item_client_ids.length} item(s)` : ''}`}
            right={<Text variant="amountSmall" tone="positive">−{formatMoney(discAmount[d.client_id] ?? 0, cur)}</Text>}
            onPress={() => setDisc(d)}
          />
        ))}
        {payload.charges.map(c => (
          <ListRow
            key={c.client_id}
            title={c.label}
            subtitle={`${valueLabel(c.kind, c.value, cur)}${c.tax_rate_bp ? ` + ${formatBp(c.tax_rate_bp)} GST` : ''} · split ${c.allocation === 'equal' ? 'equally' : 'by order'}`}
            right={<Text variant="amountSmall">{formatMoney(chargeAmount[c.client_id]?.total ?? 0, cur)}</Text>}
            onPress={() => setCharge(c)}
          />
        ))}
        {payload.reported_taxes.length ? (
          <ListRow
            title="Tax from receipt"
            subtitle={payload.reported_taxes.map(t => `${t.component} ${formatBp(t.rate_bp)} ${formatMoney(t.amount_minor, cur)}`).join(' · ')}
            right={<IconButton icon={Trash2} label="Remove receipt tax lines" onPress={() => onChange({reported_taxes: []})} />}
            chevron={false}
          />
        ) : null}
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, padding: space.sm}}>
          <Chip label="Discount" icon={Plus} onPress={() => setDisc(newDiscount())} />
          <Chip label="Service / tip / fee" icon={Plus} onPress={() => setCharge(newCharge())} />
          <Chip label="Tax from receipt" icon={Plus} onPress={() => setTaxSheet(true)} />
        </View>
      </Card>

      <Card>
        <Text variant="smallStrong" tone="muted" style={{marginBottom: space.sm}}>
          Rounding
        </Text>
        <Segmented
          value={payload.rounding.mode}
          onChange={mode => onChange({rounding: {mode, amount_minor: mode === 'explicit' ? payload.rounding.amount_minor : 0}})}
          options={[
            {value: 'none', label: 'None'},
            {value: 'nearest_unit', label: 'Nearest ₹1'},
            {value: 'explicit', label: 'As on bill'},
          ]}
        />
        {payload.rounding.mode === 'explicit' ? (
          <MoneyField
            containerStyle={{marginTop: space.sm}}
            currency={cur}
            allowNegative
            label="Round off printed on the bill"
            hint='Type "-" for a negative round-off.'
            value={payload.rounding.amount_minor}
            onChange={v => onChange({rounding: {mode: 'explicit', amount_minor: v ?? 0}})}
          />
        ) : null}
        <MoneyField
          containerStyle={{marginTop: space.lg}}
          currency={cur}
          label="Total printed on the receipt (optional)"
          hint="If you enter it, SplitMate checks the bill adds up before you can finalise."
          value={payload.receipt_total_minor}
          onChange={v => onChange({receipt_total_minor: v})}
        />
        {result.receipt_difference ? (
          <Pressable
            onPress={() =>
              setCharge(newCharge({type: 'adjustment', label: 'Receipt adjustment', kind: 'fixed', value: -(result.receipt_difference ?? 0)}))
            }
            style={{marginTop: space.sm, padding: space.md, borderRadius: 12, backgroundColor: colors.warningSoft}}>
            <Text variant="smallStrong" tone="warning">
              Calculated total is {formatMoney(Math.abs(result.receipt_difference), cur)} {result.receipt_difference > 0 ? 'more' : 'less'} than the receipt.
            </Text>
            <Text variant="small" tone="muted">
              Check items, tax and charges. If the receipt is right, tap to add a labelled adjustment.
            </Text>
          </Pressable>
        ) : null}
      </Card>

      <DiscountSheet
        value={disc}
        currency={cur}
        items={payload.items}
        onClose={() => setDisc(null)}
        onSave={d => {
          const exists = payload.discounts.some(x => x.client_id === d.client_id);
          onChange({discounts: exists ? payload.discounts.map(x => (x.client_id === d.client_id ? d : x)) : [...payload.discounts, d]});
          setDisc(null);
        }}
      />
      <ChargeSheet
        value={charge}
        currency={cur}
        onClose={() => setCharge(null)}
        onSave={c => {
          const exists = payload.charges.some(x => x.client_id === c.client_id);
          onChange({charges: exists ? payload.charges.map(x => (x.client_id === c.client_id ? c : x)) : [...payload.charges, c]});
          setCharge(null);
        }}
      />
      <ReportedTaxSheet
        visible={taxSheet}
        currency={cur}
        onClose={() => setTaxSheet(false)}
        onSave={t => {
          onChange({reported_taxes: [...payload.reported_taxes.filter(x => !t.some(y => y.component === x.component && y.rate_bp === x.rate_bp)), ...t]});
          setTaxSheet(false);
        }}
      />
      {payload.discounts.length || payload.charges.length ? (
        <Button
          label="Remove all discounts and charges"
          variant="ghost"
          size="sm"
          onPress={() => onChange({discounts: [], charges: []})}
        />
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ payers

export function PayersSection({
  payload,
  members,
  total,
  onChange,
}: {
  payload: ExpensePayload;
  members: Member[];
  total: number;
  onChange: (p: Partial<ExpensePayload>) => void;
}) {
  const multi = payload.payers.length > 1 || (payload.payers.length === 1 && payload.payers[0].amount_minor !== null);
  const paidSum = payload.payers.reduce((a, p) => a + (p.amount_minor ?? 0), 0);
  return (
    <Card>
      <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: space.sm}}>
        <Text variant="smallStrong" tone="muted" style={{flex: 1}}>
          Who paid the bill?
        </Text>
        <Chip
          label={multi ? 'One payer' : 'Several payers'}
          onPress={() =>
            onChange({
              payers: multi
                ? payload.payers.slice(0, 1).map(p => ({member_id: p.member_id, amount_minor: null}))
                : payload.payers.map(p => ({member_id: p.member_id, amount_minor: total})),
            })
          }
        />
      </View>
      {!multi ? (
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
          {members.map(m => (
            <Chip
              key={m.id}
              label={m.is_me ? 'You' : m.display_name}
              selected={payload.payers[0]?.member_id === m.id}
              onPress={() => onChange({payers: [{member_id: m.id, amount_minor: null}]})}
            />
          ))}
        </View>
      ) : (
        <View style={{gap: space.sm}}>
          {members.map(m => {
            const p = payload.payers.find(x => x.member_id === m.id);
            return (
              <View key={m.id} style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}>
                <Avatar name={m.display_name} hue={m.avatar_hue} size={30} />
                <Text variant="bodyStrong" style={{flex: 1}} numberOfLines={1}>
                  {m.is_me ? 'You' : m.display_name}
                </Text>
                <MoneyField
                  containerStyle={{width: 150}}
                  currency={payload.currency}
                  value={p?.amount_minor ?? null}
                  onChange={v => {
                    const others = payload.payers.filter(x => x.member_id !== m.id);
                    onChange({payers: v ? [...others, {member_id: m.id, amount_minor: v}] : others});
                  }}
                />
              </View>
            );
          })}
          <Text variant="small" tone={paidSum === total ? 'positive' : 'warning'}>
            Paid {formatMoney(paidSum, payload.currency)} of {formatMoney(total, payload.currency)}
            {paidSum !== total ? ` · ${formatMoney(Math.abs(total - paidSum), payload.currency)} ${paidSum < total ? 'left' : 'too much'}` : ' ✓'}
          </Text>
        </View>
      )}
      <Text variant="small" tone="faint" style={{marginTop: space.sm}}>
        Paying the bill and eating from it are separate: the payer only pays for what they had.
      </Text>
    </Card>
  );
}
