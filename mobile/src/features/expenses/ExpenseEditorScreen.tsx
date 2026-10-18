import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {CloudOff, Plus, ScanLine, Trash2, UserPlus} from 'lucide-react-native';
import {useGroupQuery} from '../../api/endpoints';
import type {ExpensePayload, ItemPayload} from '../../api/types';
import {
  AvatarStack,
  Banner,
  Button,
  CATEGORY_META,
  Card,
  Chip,
  ConfirmDialog,
  DishVisual,
  Footer,
  Header,
  IconButton,
  Money,
  Screen,
  SectionTitle,
  Segmented,
  Text,
  TextField,
  radius,
  space,
  useTheme,
} from '../../design';
import {formatMoney, formatQty} from '../../money/currency';
import type {AppScreen} from '../../navigation/types';
import {useAppDispatch, useAppSelector} from '../../store';
import {QueryView} from '../common/QueryView';
import {AddPeopleSheet} from '../groups/AddPeopleSheet';
import {draftActions, newItem, preview, todayIso} from './draft';
import {BillExtras, PayersSection} from './Extras';
import {ItemSheet, taxLabel} from './ItemSheet';
import {SimpleSplit} from './SimpleSplit';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function yesterdayIso() {
  const d = new Date(Date.now() - 86400000);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

export function ExpenseEditorScreen({route, navigation}: AppScreen<'ExpenseEditor'>) {
  const {localId} = route.params;
  const dispatch = useAppDispatch();
  const {colors} = useTheme();
  const draft = useAppSelector(s => s.drafts.byId[localId]);
  const group = useGroupQuery(draft?.groupId ?? '', {skip: !draft});
  const [editing, setEditing] = useState<ItemPayload | null>(null);
  const [touched, setTouched] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [addPeople, setAddPeople] = useState(false);
  const payload = draft?.payload;
  const pv = useMemo(() => (payload ? preview(payload) : null), [payload]);

  const isPersonal = group.data?.type === 'personal';
  useEffect(() => {
    // Personal space: the only person is you, so "who had it" has exactly one answer.
    if (isPersonal && payload && group.data) {
      const me = group.data.my_member_id;
      const needs = payload.items.some(i => !i.consumers.length);
      if (needs) {
        dispatch(
          draftActions.patch({
            localId,
            payload: {items: payload.items.map(i => (i.consumers.length ? i : {...i, consumers: [{member_id: me, value: 1}], review_state: 'claimed'}))},
          }),
        );
      }
    }
  }, [isPersonal, payload, group.data, dispatch, localId]);

  if (!draft || !payload || !pv) {
    return (
      <Screen header={<Header title="Expense" />}>
        <Banner tone="warning" title="This draft isn't on this phone any more." />
      </Screen>
    );
  }

  const change = (p: Partial<ExpensePayload>) => dispatch(draftActions.patch({localId, payload: p}));
  const itemized = payload.split_kind === 'itemized';
  const members = group.data?.members ?? [];
  const nameOf = (id: string) => members.find(m => m.id === id)?.display_name ?? '?';
  const unassigned = payload.items.filter(i => !i.consumers.length).length;
  const titleErr = touched && !payload.title.trim() ? 'Give it a name, like "Dinner at Bikanervala".' : null;
  const dateErr = !DATE_RE.test(payload.expense_date) ? 'Use YYYY-MM-DD.' : null;
  const r = pv.result;

  const next = () => {
    setTouched(true);
    if (!payload.title.trim() || dateErr) {
      return;
    }
    if (itemized && payload.items.length && unassigned && !isPersonal) {
      navigation.navigate('ClaimDishes', {localId});
    } else {
      navigation.navigate('BillReview', {localId});
    }
  };

  return (
    <Screen
      header={
        <Header
          title={draft.serverStatus === 'finalized' ? 'Edit expense' : itemized ? 'Split a bill' : 'New expense'}
          subtitle={group.data?.type === 'personal' ? 'Personal' : group.data?.name}
          right={<IconButton icon={Trash2} label="Discard this draft" onPress={() => setDiscard(true)} />}
        />
      }
      keyboard
      footer={
        <Footer>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <View style={{flex: 1}}>
              <Text variant="caption" tone="faint" style={{textTransform: 'uppercase'}}>
                Total
              </Text>
              <Money minor={r.total} currency={payload.currency} variant="title" />
            </View>
            <Button
              label={itemized && unassigned && !isPersonal ? `Assign dishes (${unassigned})` : 'Review bill'}
              variant={itemized ? 'food' : 'primary'}
              onPress={next}
              disabled={!payload.items.length}
              testID="editor-next"
            />
          </View>
        </Footer>
      }>
      <QueryView query={group}>
        {() => (
          <>
            {!draft.serverId ? (
              <Banner icon={CloudOff} tone="info" title="Saved on this phone only" body="Nothing changes anyone's balance until you finalise it." />
            ) : null}
            <View style={{marginTop: space.md, gap: space.md}}>
              <TextField
                label="What was it?"
                placeholder={itemized ? 'Dinner at Paradise' : 'October rent'}
                value={payload.title}
                onChangeText={title => change({title})}
                error={titleErr}
                testID="expense-title"
              />
            </View>
            <SectionTitle title="Category" />
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
              {Object.entries(CATEGORY_META).map(([key, meta]) => (
                <Chip key={key} label={meta.label} emoji={meta.emoji} selected={payload.category === key} onPress={() => change({category: key})} />
              ))}
            </View>
            <SectionTitle title="Date" />
            <View style={{flexDirection: 'row', gap: space.sm, alignItems: 'flex-start'}}>
              <TextField containerStyle={{flex: 1}} value={payload.expense_date} onChangeText={expense_date => change({expense_date})} error={dateErr} />
              <Chip label="Today" selected={payload.expense_date === todayIso()} onPress={() => change({expense_date: todayIso()})} />
              <Chip label="Yesterday" selected={payload.expense_date === yesterdayIso()} onPress={() => change({expense_date: yesterdayIso()})} />
            </View>

            {!isPersonal && group.data ? (
              <>
                <SectionTitle
                  title={`People · ${members.length}`}
                  action={<Chip label="Add person" icon={UserPlus} onPress={() => setAddPeople(true)} />}
                />
                <AvatarStack people={members.map(m => ({name: m.display_name, hue: m.avatar_hue}))} size={30} />
                <AddPeopleSheet
                  visible={addPeople}
                  onClose={() => setAddPeople(false)}
                  groupId={group.data.id}
                  groupName={group.data.name}
                />
              </>
            ) : null}

            <SectionTitle title="How to split" />
            <Segmented
              value={itemized ? 'itemized' : 'simple'}
              onChange={v =>
                change(
                  v === 'itemized'
                    ? {split_kind: 'itemized', items: payload.items.filter(i => i.client_id !== 'main')}
                    : {split_kind: 'equal', items: [], discounts: [], charges: [], reported_taxes: []},
                )
              }
              options={[
                {value: 'itemized', label: 'Dish by dish'},
                {value: 'simple', label: 'One amount'},
              ]}
            />

            {itemized ? (
              <>
                <SectionTitle
                  title={`Items · ${payload.items.length}`}
                  action={
                    <Chip label="Scan receipt" icon={ScanLine} tone="food" onPress={() => navigation.navigate('ReceiptScan', {localId})} />
                  }
                />
                {payload.items.length === 0 ? (
                  <Card style={{alignItems: 'center', paddingVertical: space.xl}}>
                    <Text style={{fontSize: 32}}>🍽️</Text>
                    <Text variant="bodyStrong" style={{marginTop: space.sm}}>
                      Add what was on the bill
                    </Text>
                    <Text variant="small" tone="muted" align="center" style={{marginTop: 4}}>
                      Type each dish and price, or scan the receipt and check what it read.
                    </Text>
                  </Card>
                ) : (
                  <Card padded={false} style={{paddingHorizontal: space.sm}}>
                    {payload.items.map(it => {
                      const res = r.items.find(x => x.id === it.client_id);
                      return (
                        <Pressable
                          key={it.client_id}
                          accessibilityRole="button"
                          accessibilityLabel={`Edit ${it.name}`}
                          onPress={() => setEditing(it)}
                          style={({pressed}) => [styles.itemRow, pressed && {backgroundColor: colors.surfacePressed}]}>
                          <DishVisual name={it.name} size={44} rounded={14} />
                          <View style={{flex: 1}}>
                            <Text variant="bodyStrong" numberOfLines={1}>
                              {it.name}
                            </Text>
                            <Text variant="small" tone="muted" numberOfLines={1}>
                              {formatQty(it.quantity_milli)} × {formatMoney(it.unit_price_minor, payload.currency)} · {taxLabel(it)}
                              {it.discount ? ' · discount' : ''}
                            </Text>
                            {it.consumers.length ? (
                              <View style={{marginTop: 4}}>
                                <AvatarStack people={it.consumers.map(c => ({name: nameOf(c.member_id), hue: members.find(m => m.id === c.member_id)?.avatar_hue}))} size={20} />
                              </View>
                            ) : (
                              <View style={[styles.unassigned, {backgroundColor: colors.warningSoft}]}>
                                <Text variant="caption" tone="warning">
                                  {it.review_state === 'skipped' ? 'Skipped · not assigned' : 'Not assigned yet'}
                                </Text>
                              </View>
                            )}
                            {it.source === 'receipt' && it.ocr_confidence !== null && it.ocr_confidence < 70 ? (
                              <Text variant="caption" tone="warning">Check this line — the scan wasn't sure</Text>
                            ) : null}
                          </View>
                          {res ? <Money minor={res.total} currency={payload.currency} variant="amountSmall" /> : null}
                        </Pressable>
                      );
                    })}
                  </Card>
                )}
                <Button
                  label="Add item"
                  icon={Plus}
                  variant="secondary"
                  style={{marginTop: space.md}}
                  onPress={() => setEditing(newItem())}
                  testID="add-item"
                />
                {payload.items.length ? (
                  <>
                    <SectionTitle title="Discounts, charges & tax" />
                    <BillExtras payload={payload} result={r} onChange={change} />
                  </>
                ) : null}
              </>
            ) : (
              <>
                <SectionTitle title="Amount & people" />
                <SimpleSplit payload={payload} members={members} result={r} onChange={change} />
              </>
            )}

            <SectionTitle title="Paid by" />
            <PayersSection payload={payload} members={members} total={r.total} onChange={change} />

            <SectionTitle title="Notes" />
            <TextField
              placeholder="Optional"
              multiline
              value={payload.notes ?? ''}
              onChangeText={notes => change({notes: notes || null})}
              style={{minHeight: 64, textAlignVertical: 'top'}}
            />
            <View style={{height: space.xl, borderRadius: radius.sm}} />
          </>
        )}
      </QueryView>

      <ItemSheet
        visible={!!editing}
        item={editing}
        currency={payload.currency}
        onClose={() => setEditing(null)}
        onDelete={
          editing && payload.items.some(i => i.client_id === editing.client_id)
            ? () => {
                change({
                  items: payload.items.filter(i => i.client_id !== editing.client_id),
                  // A discount that applied only to this item goes with it (never widened to other items).
                  discounts: payload.discounts.flatMap(d => {
                    if (!d.item_client_ids) {
                      return [d];
                    }
                    const left = d.item_client_ids.filter(x => x !== editing.client_id);
                    return left.length ? [{...d, item_client_ids: left}] : [];
                  }),
                });
                setEditing(null);
              }
            : undefined
        }
        onSave={it => {
          const exists = payload.items.some(i => i.client_id === it.client_id);
          change({items: exists ? payload.items.map(i => (i.client_id === it.client_id ? it : i)) : [...payload.items, it]});
          setEditing(null);
        }}
      />
      <ConfirmDialog
        visible={discard}
        title="Discard this draft?"
        body={draft.serverId ? 'Your changes on this phone will be lost. The saved version stays as it is.' : 'The bill and all its items will be deleted from this phone.'}
        confirmLabel="Discard"
        destructive
        onCancel={() => setDiscard(false)}
        onConfirm={() => {
          setDiscard(false);
          navigation.goBack();
          dispatch(draftActions.remove(localId));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  itemRow: {flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.xs, borderRadius: radius.md},
  unassigned: {alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginTop: 4},
});
