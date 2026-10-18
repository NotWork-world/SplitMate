import React, {useMemo, useState} from 'react';
import {Pressable, View} from 'react-native';
import {CheckCircle2, CloudOff, Pencil} from 'lucide-react-native';
import {
  QueryError,
  useCreateExpenseMutation,
  useFinalizeExpenseMutation,
  useGroupQuery,
  useUpdateExpenseMutation,
} from '../../api/endpoints';
import type {Expense} from '../../api/types';
import {Banner, Button, CATEGORY_META, Footer, Header, IconButton, Screen, SectionTitle, Text, haptics, space, useTheme, useToast} from '../../design';
import type {AppScreen} from '../../navigation/types';
import {useAppDispatch, useAppSelector} from '../../store';
import {formatDate} from '../common/rows';
import {BillBreakdown, PeopleShares} from './Breakdown';
import {canFinalize, draftActions, preview} from './draft';

export function BillReviewScreen({route, navigation}: AppScreen<'BillReview'>) {
  const {localId} = route.params;
  const dispatch = useAppDispatch();
  const toast = useToast();
  const {colors} = useTheme();
  const draft = useAppSelector(s => s.drafts.byId[localId]);
  const group = useGroupQuery(draft?.groupId ?? '', {skip: !draft});
  const [createExpense] = useCreateExpenseMutation();
  const [updateExpense] = useUpdateExpenseMutation();
  const [finalizeExpense] = useFinalizeExpenseMutation();
  const [busy, setBusy] = useState<null | 'final' | 'draft'>(null);
  const [error, setError] = useState<{title: string; body?: string; offline?: boolean} | null>(null);
  const pv = useMemo(() => (draft ? preview(draft.payload) : null), [draft]);

  if (!draft || !pv) {
    return (
      <Screen header={<Header title="Review" />}>
        <Banner tone="warning" title="This draft isn't on this phone any more." />
      </Screen>
    );
  }
  const p = draft.payload;
  const r = pv.result;
  const members = group.data?.members ?? [];
  const blocking = [...r.issues.filter(i => i.blocking), ...(pv.payerIssue ? [{code: 'payers', message: pv.payerIssue, ref: null, blocking: true}] : [])];
  if (r.total <= 0 && !blocking.length) {
    blocking.push({code: 'zero', message: 'The bill total must be more than zero.', ref: null, blocking: true});
  }
  const warnings = r.issues.filter(i => !i.blocking);
  const ready = canFinalize(pv);
  const editingFinalized = draft.serverStatus === 'finalized';

  const done = (e: Expense, final: boolean) => {
    haptics.success();
    dispatch(draftActions.remove(localId));
    toast(final ? 'Expense added · balances updated' : 'Draft saved', 'positive');
    navigation.popToTop();
    navigation.navigate('ExpenseDetail', {expenseId: e.id});
  };

  const fail = (e: unknown) => {
    const err = e as QueryError;
    if (err?.code === 'offline' || err?.code === 'timeout') {
      setError({title: 'Not sent: no connection', body: "The bill is safe on this phone. Try again when you're online; it won't be added twice.", offline: true});
    } else if (err?.code === 'version_conflict') {
      setError({title: 'Someone else changed this expense', body: 'Open it again to see the latest version before editing.'});
    } else if (err?.code === 'total_changed') {
      setError({title: "The server's total is different", body: 'Something changed while you were reviewing. Check the bill again.'});
    } else {
      const details = Array.isArray(err?.details) ? err.details.map((d: any) => d.message).join(' ') : undefined;
      setError({title: err?.message ?? 'Something went wrong.', body: details});
    }
  };

  const submit = async (final: boolean) => {
    setBusy(final ? 'final' : 'draft');
    setError(null);
    try {
      if (!draft.serverId) {
        const e = await createExpense({groupId: draft.groupId, body: p, finalize: final, clientTotal: final ? r.total : undefined, idempotencyKey: draft.idempotencyKey}).unwrap();
        done(e, final);
        return;
      }
      const updated = await updateExpense({id: draft.serverId, body: {...p, expected_version: draft.serverVersion ?? 1}}).unwrap();
      if (updated.status === 'finalized' || !final) {
        done(updated, updated.status === 'finalized');
        return;
      }
      dispatch(draftActions.synced({localId, serverId: updated.id, version: updated.version, status: 'draft'}));
      const fin = await finalizeExpense({
        id: updated.id,
        expected_version: updated.version,
        client_total_minor: r.total,
        idempotencyKey: draft.idempotencyKey,
      }).unwrap();
      done(fin, true);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const meta = CATEGORY_META[p.category] ?? CATEGORY_META.other;
  return (
    <Screen
      header={
        <Header
          title="Review bill"
          subtitle={`${meta.emoji} ${p.title || 'Untitled'} · ${formatDate(p.expense_date)}`}
          right={<IconButton icon={Pencil} label="Edit details" onPress={() => navigation.navigate('ExpenseEditor', {localId})} />}
        />
      }
      footer={
        <Footer>
          <Button
            label={editingFinalized ? 'Save changes' : 'Finalise & update balances'}
            icon={CheckCircle2}
            size="lg"
            variant="food"
            disabled={!ready || !!busy}
            loading={busy === 'final'}
            onPress={() => submit(true)}
            testID="review-finalize"
          />
          {!editingFinalized ? (
            <Button label="Save as draft (no balance changes)" variant="ghost" loading={busy === 'draft'} disabled={!!busy || !p.title.trim()} onPress={() => submit(false)} />
          ) : null}
        </Footer>
      }>
      {error ? (
        <View style={{marginBottom: space.md}}>
          <Banner tone={error.offline ? 'warning' : 'negative'} icon={error.offline ? CloudOff : undefined} title={error.title} body={error.body} />
        </View>
      ) : null}

      {blocking.length ? (
        <View style={{gap: space.sm, marginBottom: space.md}}>
          <Text variant="smallStrong" tone="warning">
            Fix {blocking.length === 1 ? 'this' : 'these'} before finalising
          </Text>
          {blocking.map((i, n) => (
            <Pressable
              key={`${i.code}-${n}`}
              accessibilityRole="button"
              onPress={() =>
                i.code === 'item_unassigned' || i.code === 'percent_not_100' || i.code === 'exact_mismatch'
                  ? navigation.navigate('ClaimDishes', {localId, startAt: i.ref ?? undefined})
                  : navigation.navigate('ExpenseEditor', {localId})
              }
              style={{padding: space.md, borderRadius: 12, backgroundColor: colors.warningSoft}}>
              <Text variant="small">{i.message}</Text>
              <Text variant="caption" tone="warning" style={{marginTop: 2}}>
                Tap to fix →
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Banner tone="positive" title="Everything adds up" body="Each share below is exact to the paisa and sums to the total." />
      )}
      {warnings.map((w, i) => (
        <View key={i} style={{marginTop: space.sm}}>
          <Banner tone="warning" title={w.message} />
        </View>
      ))}

      <SectionTitle title="Bill" />
      <BillBreakdown result={r} />
      <SectionTitle title="Each person" />
      <PeopleShares result={r} members={members} paid={pv.paid} />
      <Text variant="caption" tone="faint" style={{marginTop: space.md}}>
        Leftover paise from rounding go to the largest remainders first (ties by a fixed order), so nobody is ever charged more than a paisa above their exact share.
      </Text>
    </Screen>
  );
}
