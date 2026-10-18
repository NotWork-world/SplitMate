import React, {useMemo, useState} from 'react';
import {View} from 'react-native';
import {Ban, History, Pencil, Trash2} from 'lucide-react-native';
import {errorMessage, useCancelExpenseMutation, useExpenseQuery, useGroupQuery} from '../../api/endpoints';
import {
  AvatarStack,
  Banner,
  Button,
  CATEGORY_META,
  Card,
  ConfirmDialog,
  DishVisual,
  Header,
  Money,
  Screen,
  SectionTitle,
  Text,
  space,
  useTheme,
  useToast,
} from '../../design';
import {formatMoney, formatQty} from '../../money/currency';
import type {AppScreen} from '../../navigation/types';
import {useAppDispatch, useAppSelector} from '../../store';
import {QueryView} from '../common/QueryView';
import {formatDate, timeAgo} from '../common/rows';
import {BillBreakdown, PeopleShares} from './Breakdown';
import {createDraft, draftActions, payloadFromExpense} from './draft';
import {taxLabel} from './ItemSheet';
import {ReceiptThumb} from '../receipts/ReceiptThumb';

export function ExpenseDetailScreen({route, navigation}: AppScreen<'ExpenseDetail'>) {
  const {expenseId} = route.params;
  const dispatch = useAppDispatch();
  const toast = useToast();
  const {colors} = useTheme();
  const q = useExpenseQuery(expenseId, {refetchOnMountOrArgChange: true});
  const group = useGroupQuery(q.data?.group_id ?? '', {skip: !q.data});
  const [cancel, cancelState] = useCancelExpenseMutation();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftsById = useAppSelector(s => s.drafts.byId);
  const existingDraft = useMemo(() => Object.values(draftsById).find(d => d.serverId === expenseId), [draftsById, expenseId]);

  return (
    <Screen header={<Header title="Expense" />} refreshing={q.isFetching && !q.isLoading} onRefresh={q.refetch}>
      <QueryView query={q}>
        {e => {
          const meta = CATEGORY_META[e.category] ?? CATEGORY_META.other;
          const members = group.data?.members ?? [];
          const nameOf = (id: string) => {
            const m = members.find(x => x.id === id);
            return m ? (m.is_me ? 'You' : m.display_name) : 'Former member';
          };
          const edit = () => {
            if (existingDraft) {
              navigation.navigate('ExpenseEditor', {localId: existingDraft.localId});
              return;
            }
            const d = createDraft(e.group_id, payloadFromExpense(e), e);
            dispatch(draftActions.upsert(d));
            navigation.navigate('ExpenseEditor', {localId: d.localId});
          };
          return (
            <>
              <Card strong style={{alignItems: 'center', paddingVertical: space.xl}}>
                <Text style={{fontSize: 40, lineHeight: 50}}>{meta.emoji}</Text>
                <Text variant="title" align="center" style={{marginTop: space.sm}} testID="expense-title-text">
                  {e.title}
                </Text>
                <Text variant="small" tone="muted">
                  {e.group_type === 'personal' ? 'Personal' : e.group_name} · {formatDate(e.expense_date)} · {meta.label}
                </Text>
                {e.status === 'finalized' ? (
                  <Money minor={e.calculation.total} currency={e.currency} variant="amountHero" style={{marginTop: space.md}} />
                ) : null}
                {e.status === 'draft' ? (
                  <View style={{marginTop: space.md, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.warningSoft}}>
                    <Text variant="smallStrong" tone="warning">
                      Draft · not counted in balances
                    </Text>
                  </View>
                ) : null}
                {e.status === 'cancelled' ? (
                  <View style={{marginTop: space.md, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.negativeSoft}}>
                    <Text variant="smallStrong" tone="negative">
                      Cancelled · removed from balances
                    </Text>
                  </View>
                ) : null}
                {e.status === 'finalized' && e.group_type !== 'personal' ? (
                  <Text variant="bodyStrong" style={{marginTop: space.sm}} tone={e.my_paid_minor - e.my_share_minor > 0 ? 'positive' : e.my_paid_minor - e.my_share_minor < 0 ? 'negative' : 'muted'}>
                    {e.my_paid_minor - e.my_share_minor > 0
                      ? `You get back ${formatMoney(e.my_paid_minor - e.my_share_minor, e.currency)}`
                      : e.my_paid_minor - e.my_share_minor < 0
                      ? `Your share: ${formatMoney(e.my_share_minor, e.currency)}`
                      : e.my_share_minor
                      ? 'You paid your share'
                      : "You weren't part of this"}
                  </Text>
                ) : null}
              </Card>
              {error ? (
                <View style={{marginTop: space.md}}>
                  <Banner tone="negative" title={error} />
                </View>
              ) : null}
              {existingDraft ? (
                <View style={{marginTop: space.md}}>
                  <Banner tone="info" title="You have unsaved edits to this expense on this phone." />
                </View>
              ) : null}

              <View style={{flexDirection: 'row', gap: space.sm, marginTop: space.lg}}>
                {e.can_edit ? (
                  <Button label={e.status === 'draft' ? 'Continue' : 'Edit'} icon={Pencil} variant={e.status === 'draft' ? 'food' : 'secondary'} style={{flex: 1}} onPress={edit} />
                ) : null}
                {e.can_cancel ? (
                  <Button
                    label={e.status === 'draft' ? 'Delete draft' : 'Cancel expense'}
                    icon={e.status === 'draft' ? Trash2 : Ban}
                    variant="secondary"
                    style={{flex: 1}}
                    onPress={() => setConfirm(true)}
                  />
                ) : null}
              </View>

              {e.receipt_id ? (
                <>
                  <SectionTitle title="Receipt" />
                  <ReceiptThumb receiptId={e.receipt_id} />
                </>
              ) : null}

              <SectionTitle title="Paid by" />
              <Card>
                {Object.keys(e.resolved_payers).length ? (
                  Object.entries(e.resolved_payers).map(([id, amt]) => (
                    <View key={id} style={{flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2}}>
                      <Text variant="bodyStrong">{nameOf(id)}</Text>
                      <Money minor={amt} currency={e.currency} variant="amountSmall" />
                    </View>
                  ))
                ) : (
                  <Text variant="small" tone="muted">
                    {e.payers.length ? e.payers.map(p => nameOf(p.member_id)).join(', ') : 'Not chosen yet'}
                  </Text>
                )}
              </Card>

              <SectionTitle title="Items" />
              <Card padded={false} style={{paddingHorizontal: space.md}}>
                {e.items.map(it => {
                  const res = e.calculation.items?.find(x => x.id === it.client_id);
                  return (
                    <View key={it.client_id} style={{flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: space.md}}>
                      <DishVisual name={it.name} size={40} rounded={12} />
                      <View style={{flex: 1}}>
                        <Text variant="bodyStrong" numberOfLines={1}>
                          {it.name}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {formatQty(it.quantity_milli)} × {formatMoney(it.unit_price_minor, e.currency)} · {taxLabel(it)}
                          {it.split_mode !== 'equal' ? ` · ${it.split_mode} split` : ''}
                        </Text>
                        {it.consumers.length ? (
                          <View style={{flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4}}>
                            <AvatarStack people={it.consumers.map(c => ({name: nameOf(c.member_id), hue: members.find(m => m.id === c.member_id)?.avatar_hue}))} size={18} />
                            <Text variant="caption" tone="faint" numberOfLines={1} style={{flex: 1}}>
                              {it.consumers.map(c => nameOf(c.member_id)).join(', ')}
                            </Text>
                          </View>
                        ) : (
                          <Text variant="caption" tone="warning">
                            Not assigned
                          </Text>
                        )}
                      </View>
                      {res ? <Money minor={res.total} currency={e.currency} variant="amountSmall" /> : null}
                    </View>
                  );
                })}
              </Card>

              {e.calculation.items ? (
                <>
                  <SectionTitle title="How the total was worked out" />
                  <BillBreakdown result={e.calculation} />
                  <SectionTitle title="Each person's share" />
                  <PeopleShares result={e.calculation} members={members} paid={e.resolved_payers} />
                </>
              ) : null}

              {e.notes ? (
                <>
                  <SectionTitle title="Notes" />
                  <Card>
                    <Text variant="body">{e.notes}</Text>
                  </Card>
                </>
              ) : null}

              {e.versions.length ? (
                <>
                  <SectionTitle title="History" />
                  <Card>
                    {e.versions.map(v => (
                      <View key={v.version} style={{flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4}}>
                        <History size={14} color={colors.textFaint} />
                        <Text variant="small" style={{flex: 1}}>
                          v{v.version} {v.version === e.versions[0].version ? 'finalised' : 'edited'} by {v.actor} · {timeAgo(v.created_at)}
                        </Text>
                        <Text variant="small" tabular>
                          {formatMoney(v.total_minor, e.currency)}
                        </Text>
                      </View>
                    ))}
                    {e.cancelled_at ? (
                      <Text variant="small" tone="negative" style={{marginTop: 4}}>
                        Cancelled {timeAgo(e.cancelled_at)}
                      </Text>
                    ) : null}
                  </Card>
                </>
              ) : null}

              <ConfirmDialog
                visible={confirm}
                title={e.status === 'draft' ? 'Delete this draft?' : 'Cancel this expense?'}
                body={
                  e.status === 'draft'
                    ? "It hasn't affected anyone's balance, so nothing else changes."
                    : 'Balances go back to how they were without it. The expense stays in the history as cancelled. Repayments already confirmed are not undone.'
                }
                confirmLabel={e.status === 'draft' ? 'Delete' : 'Cancel expense'}
                destructive
                loading={cancelState.isLoading}
                onCancel={() => setConfirm(false)}
                onConfirm={async () => {
                  try {
                    await cancel({id: e.id, expected_version: e.version, }).unwrap();
                    setConfirm(false);
                    if (existingDraft) {
                      dispatch(draftActions.remove(existingDraft.localId));
                    }
                    toast(e.status === 'draft' ? 'Draft deleted' : 'Expense cancelled', 'positive');
                    if (e.status === 'draft') {
                      navigation.goBack();
                    }
                  } catch (err) {
                    setConfirm(false);
                    setError(errorMessage(err));
                  }
                }}
              />
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}
