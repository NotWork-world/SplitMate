import React, {useMemo, useState} from 'react';
import {View} from 'react-native';
import {newId} from '../../api/client';
import {errorMessage, useRepaymentActionMutation, useRepaymentQuery, useRepaymentsQuery} from '../../api/endpoints';
import type {RepaymentActionName} from '../../api/types';
import {Avatar, Banner, Button, Card, EmptyState, Header, Money, Screen, SectionTitle, Sheet, Text, TextField, space, useTheme, useToast} from '../../design';
import {formatMoney, toInputText} from '../../money/currency';
import type {AppScreen} from '../../navigation/types';
import {UpiPaySheet} from '../../payments/UpiPaySheet';
import {QueryView} from '../common/QueryView';
import {RepaymentRow, STATUS_LABEL, timeAgo} from '../common/rows';

const ACTION_COPY: Record<RepaymentActionName, {label: string; variant: 'primary' | 'secondary' | 'danger' | 'food'; needsNote?: boolean; confirm: string}> = {
  mark_sent: {label: "I've sent it", variant: 'primary', confirm: 'Mark as sent? The other person still needs to confirm they received it.'},
  confirm: {label: 'I received it', variant: 'food', confirm: 'Confirm you received this money? This updates the balance and cannot be undone.'},
  dispute: {label: "I didn't get the full amount", variant: 'secondary', needsNote: true, confirm: 'Dispute this payment? Balances stay unchanged.'},
  reject: {label: 'Not received', variant: 'danger', confirm: 'Reject this payment? Balances stay unchanged.'},
  cancel: {label: 'Cancel', variant: 'secondary', confirm: 'Cancel this repayment? Balances stay unchanged.'},
  resubmit: {label: 'Send again with details', variant: 'primary', needsNote: true, confirm: 'Ask them to check again?'},
};

export function RepaymentDetailScreen({route}: AppScreen<'RepaymentDetail'>) {
  const {repaymentId} = route.params;
  const toast = useToast();
  const {colors} = useTheme();
  const q = useRepaymentQuery(repaymentId, {refetchOnMountOrArgChange: true});
  const [act, actState] = useRepaymentActionMutation();
  const [pending, setPending] = useState<RepaymentActionName | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [upiSheet, setUpiSheet] = useState(false);
  // One key per opened action sheet, so a retried tap can't apply the action twice.
  const idem = useMemo(() => newId('act_'), [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen header={<Header title="Repayment" />} refreshing={q.isFetching && !q.isLoading} onRefresh={q.refetch}>
      <QueryView query={q}>
        {r => {
          const tone = r.status === 'CONFIRMED' ? 'positive' : r.status === 'REJECTED' || r.status === 'DISPUTED' ? 'negative' : 'warning';
          return (
            <>
              <Card strong style={{alignItems: 'center', paddingVertical: space.xl}}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: space.md}}>
                  <Avatar name={r.debtor.display_name} hue={r.debtor.avatar_hue} size={48} />
                  <Text variant="title" tone="muted">
                    →
                  </Text>
                  <Avatar name={r.creditor.display_name} hue={r.creditor.avatar_hue} size={48} />
                </View>
                <Text variant="body" tone="muted" style={{marginTop: space.md}}>
                  {r.debtor.is_me ? 'You' : r.debtor.display_name} to {r.creditor.is_me ? 'you' : r.creditor.display_name} · {r.group_name}
                </Text>
                <Money minor={r.amount_minor} currency={r.currency} variant="amountHero" />
                <View style={{marginTop: space.sm, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: tone === 'positive' ? colors.positiveSoft : tone === 'negative' ? colors.negativeSoft : colors.warningSoft}}>
                  <Text variant="smallStrong" tone={tone}>
                    {STATUS_LABEL[r.status]}
                  </Text>
                </View>
                {r.reference ? (
                  <Text variant="small" tone="muted" style={{marginTop: space.sm}}>
                    Ref: {r.reference} · {r.method.toUpperCase()}
                  </Text>
                ) : null}
              </Card>

              {r.status === 'MARKED_SENT' || r.status === 'AWAITING_CONFIRMATION' ? (
                <View style={{marginTop: space.md}}>
                  <Banner
                    tone="info"
                    title={r.i_am === 'creditor' ? 'Did the money arrive?' : `Waiting for ${r.creditor.display_name} to confirm`}
                    body="A payment marked as sent is not proof it arrived. Balances change only after the person who received it confirms."
                  />
                </View>
              ) : null}
              {error ? (
                <View style={{marginTop: space.md}}>
                  <Banner tone="negative" title={error} />
                </View>
              ) : null}

              <View style={{gap: space.sm, marginTop: space.lg}}>
                {r.i_am === 'debtor' && r.allowed_actions.includes('mark_sent') && r.currency === 'INR' && r.creditor.upi_id ? (
                  <>
                    <Button label={`Pay ${r.creditor.display_name} with a UPI app`} variant="food" onPress={() => setUpiSheet(true)} testID="rep-upi" />
                    <UpiPaySheet
                      visible={upiSheet}
                      onClose={() => setUpiSheet(false)}
                      upiId={r.creditor.upi_id}
                      qr={r.creditor.upi_qr}
                      name={r.creditor.display_name}
                      note={`SplitMate ${r.group_name}`}
                      amount={toInputText(r.amount_minor, r.currency)}
                      amountLabel={formatMoney(r.amount_minor, r.currency)}
                      onLaunched={() => setPending('mark_sent')}
                    />
                  </>
                ) : null}
                {r.allowed_actions.map(a => (
                  <Button key={a} label={ACTION_COPY[a].label} variant={ACTION_COPY[a].variant} onPress={() => setPending(a)} testID={`rep-${a}`} />
                ))}
              </View>

              <SectionTitle title="Timeline" />
              <Card>
                {r.events.map((ev, i) => (
                  <View key={i} style={{flexDirection: 'row', gap: space.md, paddingVertical: space.xs}}>
                    <View style={{width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: colors.accent}} />
                    <View style={{flex: 1}}>
                      <Text variant="smallStrong">{STATUS_LABEL[ev.to_status] ?? ev.to_status}</Text>
                      {ev.note ? (
                        <Text variant="small" tone="muted">
                          "{ev.note}"
                        </Text>
                      ) : null}
                      <Text variant="caption" tone="faint">
                        {timeAgo(ev.created_at)}
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>

              <Sheet
                visible={!!pending}
                onClose={() => setPending(null)}
                title={pending ? ACTION_COPY[pending].label : ''}
                footer={
                  <Button
                    label="Confirm"
                    variant={pending ? ACTION_COPY[pending].variant : 'primary'}
                    loading={actState.isLoading}
                    disabled={!!pending && !!ACTION_COPY[pending].needsNote && !note.trim()}
                    onPress={async () => {
                      if (!pending) {
                        return;
                      }
                      setError(null);
                      try {
                        await act({id: r.id, action: pending, note: note.trim() || null, idempotencyKey: idem}).unwrap();
                        toast(pending === 'confirm' ? 'Confirmed · balance updated' : 'Done', 'positive');
                        setPending(null);
                        setNote('');
                      } catch (e) {
                        setPending(null);
                        setError(errorMessage(e));
                      }
                    }}
                  />
                }>
                <Text variant="body" tone="muted">
                  {pending ? ACTION_COPY[pending].confirm : ''}
                </Text>
                <TextField
                  containerStyle={{marginTop: space.md}}
                  label={pending && ACTION_COPY[pending].needsNote ? 'What happened?' : 'Note (optional)'}
                  value={note}
                  onChangeText={setNote}
                />
              </Sheet>
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}

export function RepaymentsScreen({route, navigation}: AppScreen<'Repayments'>) {
  const q = useRepaymentsQuery({groupId: route.params?.groupId}, {refetchOnMountOrArgChange: true});
  return (
    <Screen header={<Header title="Repayments" />} refreshing={q.isFetching && !q.isLoading} onRefresh={q.refetch}>
      <QueryView query={q}>
        {page =>
          page.items.length ? (
            <Card padded={false} style={{paddingHorizontal: space.sm}}>
              {page.items.map(r => (
                <RepaymentRow key={r.id} r={r} onPress={() => navigation.navigate('RepaymentDetail', {repaymentId: r.id})} />
              ))}
            </Card>
          ) : (
            <EmptyState emoji="💸" title="No repayments yet" body="Requests and payments between people show up here with their status." />
          )
        }
      </QueryView>
    </Screen>
  );
}
