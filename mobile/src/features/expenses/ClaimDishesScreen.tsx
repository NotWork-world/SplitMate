import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, StyleSheet, useWindowDimensions, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {Check, LayoutList, Layers, Pencil, RotateCcw, SlidersHorizontal, Users, X} from 'lucide-react-native';
import {useGroupQuery} from '../../api/endpoints';
import type {ExpensePayload, ItemPayload, Member} from '../../api/types';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Chip,
  DishVisual,
  Footer,
  Header,
  IconButton,
  Money,
  MoneyField,
  ProgressBar,
  Screen,
  Segmented,
  Sheet,
  Text,
  TextField,
  haptics,
  radius,
  space,
  useTheme,
} from '../../design';
import {formatBp, formatMoney, formatQty, parseBp} from '../../money/currency';
import type {AppScreen} from '../../navigation/types';
import {useAppDispatch, useAppSelector} from '../../store';
import {draftActions, preview} from './draft';
import {ItemSheet, taxLabel} from './ItemSheet';

type Consumers = ItemPayload['consumers'];
type Mode = ItemPayload['split_mode'];
interface UndoEntry {
  clientId: string;
  consumers: Consumers;
  split_mode: Mode;
  review_state: ItemPayload['review_state'];
}

const SWIPE = 0.28; // fraction of screen width that commits a swipe

export function ClaimDishesScreen({route, navigation}: AppScreen<'ClaimDishes'>) {
  const {localId, startAt} = route.params;
  const dispatch = useAppDispatch();
  const {colors} = useTheme();
  const draft = useAppSelector(s => s.drafts.byId[localId]);
  const group = useGroupQuery(draft?.groupId ?? '', {skip: !draft});
  const members = useMemo(() => group.data?.members ?? [], [group.data]);
  const payload = draft?.payload;
  const items = useMemo(() => payload?.items ?? [], [payload]);

  const [listMode, setListMode] = useState(false);
  const [round, setRound] = useState<'pending' | 'skipped'>('pending');
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [editing, setEditing] = useState<ItemPayload | null>(null);
  const [customFor, setCustomFor] = useState<ItemPayload | null>(null);
  // Items passed over in the current round, so skipping one again moves on to the next.
  const [passed, setPassed] = useState<string[]>([]);

  // The queue: items still to review this round (pending first time, then the skipped ones).
  const queue = useMemo(
    () =>
      items.filter(
        i =>
          !passed.includes(i.client_id) &&
          (round === 'pending' ? i.review_state === 'pending' && !i.consumers.length : !i.consumers.length),
      ),
    [items, round, passed],
  );
  const startIndex = startAt ? queue.findIndex(i => i.client_id === startAt) : -1;
  const current = startIndex > 0 ? queue[startIndex] : queue[0];
  const nextUp = queue.find(i => i !== current);
  const reviewed = items.filter(i => i.review_state !== 'pending' || i.consumers.length).length;
  const unassigned = items.filter(i => !i.consumers.length);

  const [selection, setSelection] = useState<string[]>([]);
  useEffect(() => {
    setSelection(current ? current.consumers.map(c => c.member_id) : []);
  }, [current?.client_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(
    (clientId: string, changes: Partial<ItemPayload>) => dispatch(draftActions.updateItem({localId, clientId, changes})),
    [dispatch, localId],
  );

  const pushUndo = (it: ItemPayload) =>
    setUndo(u => [...u.slice(-29), {clientId: it.client_id, consumers: it.consumers, split_mode: it.split_mode, review_state: it.review_state}]);

  const claim = useCallback(
    (it: ItemPayload, ids: string[]) => {
      pushUndo(it);
      const keepCustom = it.split_mode !== 'equal' && ids.every(id => it.consumers.some(c => c.member_id === id)) && ids.length === it.consumers.length;
      update(it.client_id, {
        consumers: keepCustom ? it.consumers : ids.map(member_id => ({member_id, value: 1})),
        split_mode: keepCustom ? it.split_mode : 'equal',
        review_state: 'claimed',
      });
      haptics.success();
    },
    [update],
  );

  const skip = useCallback(
    (it: ItemPayload) => {
      pushUndo(it);
      setPassed(p => [...p, it.client_id]);
      update(it.client_id, {review_state: 'skipped'});
      haptics.tap();
    },
    [update],
  );

  const doUndo = () => {
    const last = undo[undo.length - 1];
    if (!last) {
      return;
    }
    setUndo(undo.slice(0, -1));
    setPassed(p => p.filter(id => id !== last.clientId));
    update(last.clientId, {consumers: last.consumers, split_mode: last.split_mode, review_state: last.review_state});
    if (last.review_state === 'pending' && round === 'skipped') {
      setRound('pending');
    }
  };

  if (!draft || !payload) {
    return (
      <Screen header={<Header title="Assign dishes" />}>
        <Banner tone="warning" title="This draft isn't on this phone any more." />
      </Screen>
    );
  }

  const header = (
    <Header
      title="Who had what?"
      subtitle={`${reviewed} of ${items.length} items reviewed`}
      right={
        <IconButton
          icon={listMode ? Layers : LayoutList}
          label={listMode ? 'Switch to cards' : 'Switch to list'}
          onPress={() => setListMode(!listMode)}
        />
      }
    />
  );

  return (
    <Screen
      header={header}
      scroll={listMode || !current}
      glow={false}
      footer={
        <Footer>
          {listMode || !current ? (
            <Button
              label={unassigned.length ? (unassigned.length === 1 ? '1 item still needs someone' : `${unassigned.length} items still need someone`) : 'Review the bill'}
              variant={unassigned.length ? 'secondary' : 'food'}
              disabled={!!unassigned.length}
              onPress={() => navigation.replace('BillReview', {localId})}
              testID="claim-review"
            />
          ) : (
            <View style={styles.controls}>
              <RoundButton icon={X} label="Skip for now" color={colors.negative} onPress={() => skip(current)} testID="claim-skip" />
              <RoundButton icon={RotateCcw} label="Undo" small disabled={!undo.length} color={colors.textMuted} onPress={doUndo} testID="claim-undo" />
              <RoundButton
                icon={Check}
                label="Claim"
                color={colors.positive}
                disabled={!selection.length}
                onPress={() => claim(current, selection)}
                testID="claim-claim"
              />
            </View>
          )}
        </Footer>
      }>
      <View style={{paddingTop: space.xs}}>
        <ProgressBar value={items.length ? reviewed / items.length : 0} color={colors.food} />
      </View>

      {listMode ? (
        <ListAlternative payload={payload} members={members} onSet={(it, ids) => (ids.length ? claim(it, ids) : update(it.client_id, {consumers: [], review_state: 'skipped'}))} onCustom={setCustomFor} onEdit={setEditing} />
      ) : current ? (
        <View style={{flex: 1, marginTop: space.lg}}>
          {nextUp ? <BackCard item={nextUp} currency={payload.currency} /> : null}
          <SwipeCard
            key={current.client_id}
            item={current}
            payload={payload}
            members={members}
            selection={selection}
            onSelection={setSelection}
            onClaim={() => claim(current, selection)}
            onSkip={() => skip(current)}
            onEdit={() => setEditing(current)}
            onCustom={() => setCustomFor(current)}
          />
          <Text variant="caption" tone="faint" align="center" style={{marginTop: space.md}}>
            Pick who had it, then swipe right or tap ✓ · swipe left to skip
          </Text>
        </View>
      ) : (
        <View style={{marginTop: space.xl, gap: space.md}}>
          {unassigned.length ? (
            <>
              <Banner
                tone="warning"
                title={`${unassigned.length} item${unassigned.length > 1 ? 's were' : ' was'} skipped`}
                body="Every item needs at least one person before the bill can be finalised. Nobody is picked for you."
              />
              {unassigned.map(it => (
                <Card key={it.client_id} style={{flexDirection: 'row', alignItems: 'center', gap: space.md}}>
                  <DishVisual name={it.name} size={40} />
                  <Text variant="bodyStrong" style={{flex: 1}} numberOfLines={1}>
                    {it.name}
                  </Text>
                  <Money minor={preview(payload).result.items.find(x => x.id === it.client_id)?.total ?? 0} currency={payload.currency} variant="amountSmall" />
                </Card>
              ))}
              <Button
                label="Assign skipped items"
                variant="food"
                onPress={() => {
                  setPassed([]);
                  setRound('skipped');
                }}
              />
              <Button label="Use the list instead" variant="ghost" onPress={() => setListMode(true)} />
              <Button label="Undo last" variant="ghost" icon={RotateCcw} disabled={!undo.length} onPress={doUndo} />
            </>
          ) : (
            <Card style={{alignItems: 'center', paddingVertical: space.xxl}}>
              <Text style={{fontSize: 44}}>🎉</Text>
              <Text variant="title" style={{marginTop: space.sm}}>
                Every dish has an owner
              </Text>
              <Text variant="body" tone="muted" align="center" style={{marginTop: space.xs}}>
                Check GST, discounts and each person's share before you finalise.
              </Text>
              <Button label="Undo last" variant="ghost" icon={RotateCcw} disabled={!undo.length} onPress={doUndo} style={{marginTop: space.md}} />
            </Card>
          )}
        </View>
      )}

      <ItemSheet
        visible={!!editing}
        item={editing}
        currency={payload.currency}
        onClose={() => setEditing(null)}
        onSave={it => {
          update(it.client_id, it);
          setEditing(null);
        }}
      />
      <CustomSplitSheet
        item={customFor}
        payload={payload}
        members={members}
        initialSelection={customFor && customFor.client_id === current?.client_id ? selection : customFor?.consumers.map(c => c.member_id) ?? []}
        onClose={() => setCustomFor(null)}
        onSave={(it, consumers, mode) => {
          pushUndo(it);
          update(it.client_id, {consumers, split_mode: mode, review_state: 'claimed'});
          setCustomFor(null);
          haptics.success();
        }}
      />
    </Screen>
  );
}

// ------------------------------------------------------------------ the card

function SwipeCard({
  item,
  payload,
  members,
  selection,
  onSelection,
  onClaim,
  onSkip,
  onEdit,
  onCustom,
}: {
  item: ItemPayload;
  payload: ExpensePayload;
  members: Member[];
  selection: string[];
  onSelection: (ids: string[]) => void;
  onClaim: () => void;
  onSkip: () => void;
  onEdit: () => void;
  onCustom: () => void;
}) {
  const {colors} = useTheme();
  const {width} = useWindowDimensions();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const shake = useSharedValue(0);
  const [hint, setHint] = useState<string | null>(null);
  const hasSelection = selection.length > 0;

  // Exact per-person shares for the current selection, from the real engine (tax and discounts included).
  const shares = useMemo(() => {
    const trial: ExpensePayload = {
      ...payload,
      items: payload.items.map(i =>
        i.client_id === item.client_id
          ? {
              ...i,
              consumers: selection.map(member_id => ({member_id, value: i.consumers.find(c => c.member_id === member_id)?.value ?? 1})),
              split_mode: i.split_mode !== 'equal' && selection.length === i.consumers.length && selection.every(s => i.consumers.some(c => c.member_id === s)) ? i.split_mode : 'equal',
            }
          : i,
      ),
    };
    const r = preview(trial).result.items.find(i => i.id === item.client_id);
    return {result: r, byMember: Object.fromEntries((r?.shares ?? []).map(s => [s.member_id, s.total]))};
  }, [payload, item.client_id, selection]);
  const res = shares.result;

  const blocked = () => {
    haptics.warning();
    setHint('Pick who had this first. Nothing is assigned on its own.');
    shake.value = withSequence(withTiming(-10, {duration: 50}), withTiming(10, {duration: 60}), withTiming(0, {duration: 50}));
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-20, 20])
    .onUpdate(e => {
      x.value = e.translationX;
      y.value = e.translationY * 0.15;
    })
    .onEnd(e => {
      const goRight = e.translationX > width * SWIPE || e.velocityX > 900;
      const goLeft = e.translationX < -width * SWIPE || e.velocityX < -900;
      if (goRight && hasSelection) {
        x.value = withTiming(width * 1.4, {duration: 220}, () => runOnJS(onClaim)());
      } else if (goLeft) {
        x.value = withTiming(-width * 1.4, {duration: 220}, () => runOnJS(onSkip)());
      } else {
        if (goRight) {
          runOnJS(blocked)();
        }
        x.value = withSpring(0, {damping: 16, stiffness: 180});
        y.value = withSpring(0);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      {translateX: x.value + shake.value},
      {translateY: y.value},
      {rotate: `${interpolate(x.value, [-width, width], [-12, 12])}deg`},
    ],
  }));
  const claimStamp = useAnimatedStyle(() => ({opacity: interpolate(x.value, [0, width * SWIPE], [0, 1], 'clamp')}));
  const skipStamp = useAnimatedStyle(() => ({opacity: interpolate(x.value, [-width * SWIPE, 0], [1, 0], 'clamp')}));

  const toggle = (id: string) => {
    setHint(null);
    haptics.tap();
    onSelection(selection.includes(id) ? selection.filter(s => s !== id) : [...selection, id]);
  };
  const everyone = members.length > 0 && members.every(m => selection.includes(m.id));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.card, {backgroundColor: colors.bgElevated, borderColor: colors.borderStrong}, cardStyle]}
        accessible={false}
        testID="claim-card">
        <Animated.View style={[styles.stamp, styles.stampRight, {borderColor: colors.positive}, claimStamp]} pointerEvents="none">
          <Text variant="heading" tone="positive">
            CLAIM
          </Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampLeft, {borderColor: colors.negative}, skipStamp]} pointerEvents="none">
          <Text variant="heading" tone="negative">
            SKIP
          </Text>
        </Animated.View>

        <View style={{flexDirection: 'row', gap: space.lg, alignItems: 'center'}}>
          <DishVisual name={item.name} size={88} rounded={24} />
          <View style={{flex: 1}}>
            <Text variant="title" numberOfLines={2} accessibilityRole="header">
              {item.name}
            </Text>
            <Text variant="small" tone="muted">
              {formatQty(item.quantity_milli)} × {formatMoney(item.unit_price_minor, payload.currency)}
            </Text>
          </View>
          <IconButton icon={Pencil} label={`Edit ${item.name}`} filled onPress={onEdit} />
        </View>

        <View style={[styles.figures, {borderColor: colors.border}]}>
          <Figure label="Line" value={formatMoney(res?.gross ?? 0, payload.currency)} />
          {res && res.item_discount + res.bill_discount > 0 ? (
            <Figure label="Discounts" value={`−${formatMoney(res.item_discount + res.bill_discount, payload.currency)}`} tone="positive" />
          ) : null}
          <Figure label={taxLabel(item)} value={item.tax_rate_bp ? `${item.tax_inclusive ? 'incl. ' : '+'}${formatMoney(res?.tax ?? 0, payload.currency)}` : '—'} />
          <Figure label="Item total" value={formatMoney(res?.total ?? 0, payload.currency)} strong />
        </View>

        <View style={{flexDirection: 'row', alignItems: 'center', marginTop: space.lg, marginBottom: space.sm}}>
          <Text variant="smallStrong" tone="muted" style={{flex: 1}}>
            Who had it?
          </Text>
          <Chip
            label="Everyone"
            icon={Users}
            selected={everyone}
            onPress={() => {
              setHint(null);
              onSelection(everyone ? [] : members.map(m => m.id));
            }}
          />
        </View>
        <View style={styles.people}>
          {members.map(m => {
            const on = selection.includes(m.id);
            return (
              <Pressable
                key={m.id}
                accessibilityRole="checkbox"
                accessibilityState={{checked: on}}
                accessibilityLabel={`${m.display_name}${on && shares.byMember[m.id] !== undefined ? `, ${formatMoney(shares.byMember[m.id], payload.currency)}` : ''}`}
                onPress={() => toggle(m.id)}
                style={[styles.person, {backgroundColor: on ? colors.accentSoft : colors.surface, borderColor: on ? colors.accent : colors.border}]}>
                <Avatar name={m.display_name} hue={m.avatar_hue} size={32} />
                <View style={{flexShrink: 1}}>
                  <Text variant="smallStrong" numberOfLines={1}>
                    {m.is_me ? 'You' : m.display_name}
                  </Text>
                  <Text variant="caption" tone={on ? 'accent' : 'faint'} tabular>
                    {on && shares.byMember[m.id] !== undefined ? formatMoney(shares.byMember[m.id], payload.currency) : '—'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        {hint ? (
          <Text variant="smallStrong" tone="warning" style={{marginTop: space.sm}} accessibilityLiveRegion="assertive">
            {hint}
          </Text>
        ) : null}
        <Button label="Custom split (shares, % or amounts)" icon={SlidersHorizontal} variant="ghost" size="sm" onPress={onCustom} style={{marginTop: space.sm}} />
      </Animated.View>
    </GestureDetector>
  );
}

function BackCard({item, currency}: {item: ItemPayload; currency: string}) {
  const {colors} = useTheme();
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={[styles.card, styles.backCard, {backgroundColor: colors.bgElevated, borderColor: colors.border}]}>
      <View style={{flexDirection: 'row', gap: space.md, alignItems: 'center', opacity: 0.6}}>
        <DishVisual name={item.name} size={48} />
        <Text variant="bodyStrong" style={{flex: 1}} numberOfLines={1}>
          Next: {item.name}
        </Text>
        <Text variant="amountSmall">{formatMoney(item.unit_price_minor, currency)}</Text>
      </View>
    </View>
  );
}

function Figure({label, value, tone, strong}: {label: string; value: string; tone?: 'positive'; strong?: boolean}) {
  return (
    <View style={{flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3}}>
      <Text variant="small" tone="muted">
        {label}
      </Text>
      <Text variant={strong ? 'amount' : 'amountSmall'} tone={tone}>
        {value}
      </Text>
    </View>
  );
}

function RoundButton({
  icon: Icon,
  label,
  color,
  onPress,
  disabled,
  small,
  testID,
}: {
  icon: any;
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  small?: boolean;
  testID?: string;
}) {
  const {colors} = useTheme();
  const size = small ? 52 : 68;
  return (
    <View style={{alignItems: 'center', gap: 4}}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{disabled: !!disabled}}
        disabled={disabled}
        onPress={onPress}
        style={({pressed}) => ({
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color,
          backgroundColor: pressed ? colors.surfacePressed : colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.35 : 1,
        })}>
        <Icon size={small ? 22 : 30} color={color} strokeWidth={2.6} />
      </Pressable>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

// ------------------------------------------------------------------ non-swipe alternative

function ListAlternative({
  payload,
  members,
  onSet,
  onCustom,
  onEdit,
}: {
  payload: ExpensePayload;
  members: Member[];
  onSet: (it: ItemPayload, ids: string[]) => void;
  onCustom: (it: ItemPayload) => void;
  onEdit: (it: ItemPayload) => void;
}) {
  const {colors} = useTheme();
  const pv = useMemo(() => preview(payload), [payload]);
  return (
    <View style={{gap: space.md, marginTop: space.lg}}>
      {payload.items.map(it => {
        const ids = it.consumers.map(c => c.member_id);
        const res = pv.result.items.find(r => r.id === it.client_id);
        return (
          <Card key={it.client_id} style={!ids.length ? {borderColor: colors.warning} : undefined}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: space.md}}>
              <DishVisual name={it.name} size={44} />
              <View style={{flex: 1}}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {it.name}
                </Text>
                <Text variant="small" tone={ids.length ? 'muted' : 'warning'}>
                  {ids.length ? (it.split_mode === 'equal' ? `Split equally by ${ids.length}` : `Custom split (${it.split_mode})`) : 'Nobody yet'}
                </Text>
              </View>
              <Money minor={res?.total ?? 0} currency={payload.currency} variant="amountSmall" />
              <IconButton icon={Pencil} label={`Edit ${it.name}`} onPress={() => onEdit(it)} />
            </View>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md}}>
              {members.map(m => {
                const on = ids.includes(m.id);
                return (
                  <Chip
                    key={m.id}
                    label={m.is_me ? 'You' : m.display_name}
                    selected={on}
                    onPress={() => onSet(it, on ? ids.filter(x => x !== m.id) : [...ids, m.id])}
                  />
                );
              })}
              <Chip label="Custom…" icon={SlidersHorizontal} onPress={() => onCustom(it)} />
            </View>
          </Card>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ custom split

function CustomSplitSheet({
  item,
  payload,
  members,
  initialSelection,
  onClose,
  onSave,
}: {
  item: ItemPayload | null;
  payload: ExpensePayload;
  members: Member[];
  initialSelection: string[];
  onClose: () => void;
  onSave: (it: ItemPayload, consumers: Consumers, mode: Mode) => void;
}) {
  const [mode, setMode] = useState<Exclude<Mode, 'equal'>>('shares');
  const [values, setValues] = useState<Record<string, number>>({});
  const [pctText, setPctText] = useState<Record<string, string>>({});
  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (item && opened.current !== item.client_id) {
      opened.current = item.client_id;
      const m = item.split_mode === 'equal' ? 'shares' : item.split_mode;
      setMode(m);
      const ids = initialSelection.length ? initialSelection : item.consumers.map(c => c.member_id);
      const v = Object.fromEntries(ids.map(id => [id, item.consumers.find(c => c.member_id === id)?.value ?? (m === 'shares' ? 1 : 0)]));
      setValues(v);
      setPctText(m === 'percent' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, formatBp(x).replace('%', '')])) : {});
    }
    if (!item) {
      opened.current = null;
    }
  }, [item, initialSelection]);

  if (!item) {
    return null;
  }
  const net = preview(payload).result.items.find(r => r.id === item.client_id)?.net ?? 0;
  const ids = Object.keys(values);
  const total = ids.reduce((a, k) => a + (values[k] ?? 0), 0);
  const valid =
    ids.length > 0 &&
    (mode === 'shares' ? ids.every(k => values[k] >= 1) : mode === 'percent' ? total === 10000 : total === net);

  return (
    <Sheet
      visible={!!item}
      onClose={onClose}
      title={`Split ${item.name}`}
      footer={
        <Button
          label="Save split"
          disabled={!valid}
          onPress={() =>
            onSave(
              item,
              ids.map(member_id => ({member_id, value: values[member_id]})),
              mode,
            )
          }
        />
      }>
      <Segmented<Exclude<Mode, 'equal'>>
        value={mode}
        onChange={m => {
          setMode(m);
          setValues(Object.fromEntries(ids.map(k => [k, m === 'shares' ? 1 : 0])));
          setPctText({});
        }}
        options={[
          {value: 'shares', label: 'Shares'},
          {value: 'percent', label: 'Percent'},
          {value: 'exact', label: 'Amounts'},
        ]}
      />
      <Text variant="small" tone="muted" style={{marginVertical: space.md}}>
        {mode === 'shares'
          ? 'E.g. 2 shares for someone who had twice as much.'
          : mode === 'percent'
          ? 'Percentages must add up to exactly 100%.'
          : `Amounts must add up to ${formatMoney(net, payload.currency)} (the item after its own discount). Bill discounts and tax are then shared in the same proportion.`}
      </Text>
      {members.map(m => {
        const on = m.id in values;
        return (
          <View key={m.id} style={{flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs, minHeight: 56}}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{checked: on}}
              onPress={() => {
                const next = {...values};
                if (on) {
                  delete next[m.id];
                } else {
                  next[m.id] = mode === 'shares' ? 1 : 0;
                }
                setValues(next);
              }}
              style={{flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1}}>
              <Avatar name={m.display_name} hue={m.avatar_hue} size={32} selected={on} />
              <Text variant="bodyStrong" tone={on ? 'default' : 'faint'} numberOfLines={1}>
                {m.is_me ? 'You' : m.display_name}
              </Text>
            </Pressable>
            {on && mode === 'shares' ? (
              <TextField
                containerStyle={{width: 80}}
                keyboardType="number-pad"
                value={String(values[m.id] || '')}
                onChangeText={t => setValues({...values, [m.id]: Math.min(999, Number(t.replace(/\D/g, '')) || 0)})}
              />
            ) : null}
            {on && mode === 'percent' ? (
              <TextField
                containerStyle={{width: 96}}
                keyboardType="decimal-pad"
                suffix="%"
                value={pctText[m.id] ?? ''}
                onChangeText={t => {
                  setPctText({...pctText, [m.id]: t});
                  setValues({...values, [m.id]: parseBp(t) ?? 0});
                }}
              />
            ) : null}
            {on && mode === 'exact' ? (
              <MoneyField containerStyle={{width: 140}} currency={payload.currency} value={values[m.id] || null} onChange={v => setValues({...values, [m.id]: v ?? 0})} />
            ) : null}
          </View>
        );
      })}
      {mode === 'percent' ? (
        <Text variant="smallStrong" tone={total === 10000 ? 'positive' : 'warning'}>
          {formatBp(total)} of 100%
        </Text>
      ) : mode === 'exact' ? (
        <Text variant="smallStrong" tone={total === net ? 'positive' : 'warning'}>
          {formatMoney(total, payload.currency)} of {formatMoney(net, payload.currency)}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.xl,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: {width: 0, height: 16},
    elevation: 8,
  },
  backCard: {position: 'absolute', left: 14, right: 14, top: -14, padding: space.lg, elevation: 2, transform: [{scale: 0.96}]},
  stamp: {position: 'absolute', top: 18, zIndex: 2, borderWidth: 3, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4},
  stampRight: {left: 18, transform: [{rotate: '-12deg'}]},
  stampLeft: {right: 18, transform: [{rotate: '12deg'}]},
  figures: {marginTop: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth},
  people: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm},
  person: {flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6, paddingLeft: 6, paddingRight: space.md, borderRadius: radius.pill, borderWidth: 1, minHeight: 48, maxWidth: '48%'},
  controls: {flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center'},
});
