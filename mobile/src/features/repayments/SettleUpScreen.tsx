import React, {useMemo, useState} from 'react';
import {Linking, View} from 'react-native';
import {newId} from '../../api/client';
import {errorMessage, useCreateRepaymentMutation, useGroupQuery} from '../../api/endpoints';
import {Avatar, Banner, Button, Card, Chip, Footer, Header, MoneyField, Screen, SectionTitle, Text, TextField, space, useToast} from '../../design';
import {formatMoney, toInputText} from '../../money/currency';
import type {AppScreen} from '../../navigation/types';

const METHODS = [
  {value: 'upi', label: 'UPI'},
  {value: 'cash', label: 'Cash'},
  {value: 'bank', label: 'Bank transfer'},
  {value: 'other', label: 'Other'},
] as const;

export function SettleUpScreen({route, navigation}: AppScreen<'SettleUp'>) {
  const {groupId, memberId, currency, amount: outstanding, mode} = route.params;
  const toast = useToast();
  const group = useGroupQuery(groupId);
  const [create, {isLoading}] = useCreateRepaymentMutation();
  const [amount, setAmount] = useState<number | null>(outstanding);
  const [method, setMethod] = useState<(typeof METHODS)[number]['value']>('upi');
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const idem = useMemo(() => newId('rep_'), []);
  const other = group.data?.members.find(m => m.id === memberId);
  const name = other?.display_name ?? 'them';
  const amountErr = amount === null || amount <= 0 ? 'Enter an amount.' : amount > outstanding ? `That's more than the ${formatMoney(outstanding, currency)} owed.` : null;

  const submit = async () => {
    if (amountErr || amount === null) {
      return;
    }
    setError(null);
    try {
      const rep = await create({
        group_id: groupId,
        currency,
        amount_minor: amount,
        mode,
        other_member_id: memberId,
        method,
        note: note.trim() || null,
        reference: reference.trim() || null,
        idempotencyKey: idem,
      }).unwrap();
      toast(mode === 'request' ? 'Request sent' : `Recorded · waiting for ${name} to confirm`, 'positive');
      navigation.replace('RepaymentDetail', {repaymentId: rep.id});
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen
      header={<Header title={mode === 'request' ? 'Request a repayment' : 'Record a payment'} />}
      keyboard
      footer={
        <Footer>
          <Button
            label={mode === 'request' ? `Request ${amount ? formatMoney(amount, currency) : ''}` : `I paid ${amount ? formatMoney(amount, currency) : ''}`}
            size="lg"
            onPress={submit}
            loading={isLoading}
            disabled={!!amountErr}
            testID="settle-submit"
          />
        </Footer>
      }>
      <Card strong style={{alignItems: 'center', paddingVertical: space.xl}}>
        <Avatar name={name} hue={other?.avatar_hue} size={56} />
        <Text variant="heading" style={{marginTop: space.sm}}>
          {mode === 'request' ? `${name} owes you` : `You owe ${name}`}
        </Text>
        <Text variant="amountHero">{formatMoney(outstanding, currency)}</Text>
      </Card>
      {error ? (
        <View style={{marginTop: space.md}}>
          <Banner tone="negative" title={error} />
        </View>
      ) : null}
      <SectionTitle title="Amount" />
      <MoneyField currency={currency} value={amount} onChange={setAmount} error={amountErr} hint="You can settle part of it now and the rest later." testID="settle-amount" />
      <View style={{flexDirection: 'row', gap: space.sm, marginTop: space.sm}}>
        <Chip label="Full amount" selected={amount === outstanding} onPress={() => setAmount(outstanding)} />
        <Chip label="Half" onPress={() => setAmount(Math.floor(outstanding / 2))} />
      </View>
      <SectionTitle title="How" />
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
        {METHODS.map(m => (
          <Chip key={m.value} label={m.label} selected={method === m.value} onPress={() => setMethod(m.value)} />
        ))}
      </View>
      {mode === 'record' && method === 'upi' && currency === 'INR' ? (
        other?.upi_id ? (
          <Button
            label={`Pay ${name} in my UPI app`}
            variant="secondary"
            disabled={!amount || !!amountErr}
            style={{marginTop: space.md}}
            onPress={() =>
              Linking.openURL(
                `upi://pay?pa=${encodeURIComponent(other.upi_id ?? '')}&pn=${encodeURIComponent(name)}&am=${toInputText(amount ?? 0, currency)}&cu=INR&tn=${encodeURIComponent(`SplitMate ${group.data?.name ?? ''}`)}`,
              ).catch(() => setError('No UPI app was found on this phone.'))
            }
          />
        ) : (
          <Text variant="small" tone="faint" style={{marginTop: space.sm}}>
            {name} hasn't added a UPI ID. Pay them your usual way, then record it here.
          </Text>
        )
      ) : null}
      {mode === 'record' && method === 'upi' ? (
        <Text variant="small" tone="faint" style={{marginTop: space.xs}}>
          SplitMate can't see whether a UPI payment went through. After paying, come back and tap "I paid".
        </Text>
      ) : null}
      {mode === 'record' ? (
        <TextField containerStyle={{marginTop: space.md}} label="Reference (optional)" placeholder="UPI ref / UTR" value={reference} onChangeText={setReference} />
      ) : null}
      <TextField containerStyle={{marginTop: space.md}} label="Note (optional)" value={note} onChangeText={setNote} />
      <Text variant="small" tone="faint" style={{marginTop: space.lg}}>
        {mode === 'request'
          ? `${name} is asked to pay. Balances change only after the payment is marked sent and you confirm you received it.`
          : `Recording a payment doesn't change balances yet. ${name} has to confirm they received it. SplitMate never confirms payments on its own.`}
      </Text>
    </Screen>
  );
}
