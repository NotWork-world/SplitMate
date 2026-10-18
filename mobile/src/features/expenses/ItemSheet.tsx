import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import {Trash2} from 'lucide-react-native';
import type {ItemPayload} from '../../api/types';
import {Button, Chip, DishVisual, MoneyField, Segmented, Sheet, SwitchRow, Text, TextField, space} from '../../design';
import {formatBp, formatMoney, formatQty, parseBp, parseQty} from '../../money/currency';
import {mulDivRoundHalfUp} from '../../money/allocate';

export const GST_RATES = [0, 500, 1200, 1800, 2800];

export function taxLabel(it: Pick<ItemPayload, 'tax_rate_bp' | 'tax_inclusive' | 'tax_scheme'>): string {
  if (!it.tax_rate_bp) {
    return 'No tax';
  }
  const scheme = it.tax_scheme === 'cgst_sgst' ? 'CGST+SGST' : it.tax_scheme === 'igst' ? 'IGST' : 'GST';
  return `${scheme} ${formatBp(it.tax_rate_bp)}${it.tax_inclusive ? ' incl.' : ''}`;
}

export function ItemSheet({
  item,
  currency,
  visible,
  onSave,
  onDelete,
  onClose,
}: {
  item: ItemPayload | null;
  currency: string;
  visible: boolean;
  onSave: (it: ItemPayload) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ItemPayload | null>(item);
  const [qtyText, setQtyText] = useState('1');
  const [price, setPrice] = useState<number | null>(null);
  const [discValue, setDiscValue] = useState<number | null>(null);
  const [discPct, setDiscPct] = useState('');
  const [customRate, setCustomRate] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (item && visible) {
      setDraft(item);
      setQtyText(formatQty(item.quantity_milli));
      setPrice(item.unit_price_minor || null);
      setDiscValue(item.discount?.kind === 'fixed' ? item.discount.value : null);
      setDiscPct(item.discount?.kind === 'percent' ? formatBp(item.discount.value).replace('%', '') : '');
      setCustomRate(GST_RATES.includes(item.tax_rate_bp) ? '' : formatBp(item.tax_rate_bp).replace('%', ''));
      setTouched(false);
    }
  }, [item, visible]);

  if (!draft) {
    return null;
  }
  const qty = parseQty(qtyText);
  const discKind = draft.discount?.kind ?? 'none';
  const gross = qty && price !== null ? mulDivRoundHalfUp(qty, price, 1000) : 0;
  const pctBp = discPct ? parseBp(discPct) : null;
  const discAmount = discKind === 'fixed' ? discValue ?? 0 : discKind === 'percent' && pctBp !== null ? mulDivRoundHalfUp(gross, pctBp, 10000) : 0;
  const customBp = customRate ? parseBp(customRate) : null;
  const errors = {
    name: !draft.name.trim() ? 'Name the item.' : null,
    qty: qty === null ? 'Enter a quantity like 1, 2 or 0.5.' : null,
    price: price === null ? 'Enter the price.' : null,
    discount:
      discKind === 'percent' && pctBp === null
        ? 'Enter a percentage up to 100.'
        : discAmount > gross
        ? "A discount can't be more than the item."
        : null,
    rate: customRate && customBp === null ? 'Enter a rate like 5 or 2.5.' : null,
  };
  const valid = !Object.values(errors).some(Boolean);

  const save = () => {
    setTouched(true);
    if (!valid || qty === null || price === null) {
      return;
    }
    onSave({
      ...draft,
      name: draft.name.trim(),
      quantity_milli: qty,
      unit_price_minor: price,
      tax_rate_bp: customBp ?? draft.tax_rate_bp,
      discount:
        discKind === 'fixed' && discValue
          ? {kind: 'fixed', value: discValue}
          : discKind === 'percent' && pctBp
          ? {kind: 'percent', value: pctBp}
          : null,
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item?.name ? 'Edit item' : 'Add item'}
      footer={
        <View style={{flexDirection: 'row', gap: space.sm}}>
          {onDelete ? <Button label="Delete" variant="secondary" icon={Trash2} onPress={onDelete} /> : null}
          <Button label="Save item" onPress={save} style={{flex: 1}} testID="item-save" />
        </View>
      }>
      <View style={{flexDirection: 'row', gap: space.md, alignItems: 'flex-end'}}>
        <DishVisual name={draft.name || ' '} size={52} />
        <TextField
          containerStyle={{flex: 1}}
          label="Item"
          placeholder="Chicken Biryani"
          value={draft.name}
          onChangeText={name => setDraft({...draft, name})}
          error={touched ? errors.name : null}
          autoFocus={!item?.name}
          testID="item-name"
        />
      </View>
      <View style={{flexDirection: 'row', gap: space.sm, marginTop: space.lg}}>
        <TextField
          containerStyle={{width: 96}}
          label="Qty"
          keyboardType="decimal-pad"
          value={qtyText}
          onChangeText={setQtyText}
          error={touched ? errors.qty : null}
          testID="item-qty"
        />
        <MoneyField
          containerStyle={{flex: 1}}
          label="Unit price"
          currency={currency}
          value={price}
          onChange={setPrice}
          error={touched ? errors.price : null}
          testID="item-price"
        />
      </View>
      {qty && price !== null ? (
        <Text variant="small" tone="muted" style={{marginTop: space.xs}}>
          Line amount {formatMoney(gross, currency)}
          {discAmount ? ` − ${formatMoney(discAmount, currency)} discount = ${formatMoney(gross - discAmount, currency)}` : ''}
        </Text>
      ) : null}

      <Text variant="smallStrong" tone="muted" style={{marginTop: space.lg, marginBottom: space.sm}}>
        Item discount
      </Text>
      <Segmented
        value={discKind}
        onChange={k =>
          setDraft({...draft, discount: k === 'none' ? null : {kind: k as 'fixed' | 'percent', value: draft.discount?.value ?? 0}})
        }
        options={[
          {value: 'none', label: 'None'},
          {value: 'fixed', label: 'Amount'},
          {value: 'percent', label: 'Percent'},
        ]}
      />
      {discKind === 'fixed' ? (
        <MoneyField containerStyle={{marginTop: space.sm}} currency={currency} value={discValue} onChange={setDiscValue} error={errors.discount} />
      ) : discKind === 'percent' ? (
        <TextField containerStyle={{marginTop: space.sm}} keyboardType="decimal-pad" suffix="%" value={discPct} onChangeText={setDiscPct} error={errors.discount} />
      ) : null}

      <Text variant="smallStrong" tone="muted" style={{marginTop: space.lg, marginBottom: space.sm}}>
        GST on this item (as printed on the bill)
      </Text>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
        {GST_RATES.map(r => (
          <Chip
            key={r}
            label={r ? formatBp(r) : 'None'}
            selected={!customRate && draft.tax_rate_bp === r}
            onPress={() => {
              setCustomRate('');
              setDraft({...draft, tax_rate_bp: r});
            }}
          />
        ))}
      </View>
      <TextField
        containerStyle={{marginTop: space.sm}}
        placeholder="Other rate, e.g. 2.5"
        keyboardType="decimal-pad"
        suffix="%"
        value={customRate}
        onChangeText={setCustomRate}
        error={errors.rate}
      />
      {(customBp ?? draft.tax_rate_bp) > 0 ? (
        <>
          <View style={{marginTop: space.md}}>
            <Segmented
              value={draft.tax_scheme}
              onChange={s => setDraft({...draft, tax_scheme: s})}
              options={[
                {value: 'cgst_sgst', label: 'CGST + SGST'},
                {value: 'igst', label: 'IGST'},
                {value: 'gst', label: 'GST'},
              ]}
            />
          </View>
          <SwitchRow
            title="Price already includes GST"
            subtitle={draft.tax_inclusive ? 'Tax is taken out of the price, not added again.' : 'Tax is added on top of the price.'}
            value={draft.tax_inclusive}
            onChange={v => setDraft({...draft, tax_inclusive: v})}
          />
        </>
      ) : null}
    </Sheet>
  );
}
