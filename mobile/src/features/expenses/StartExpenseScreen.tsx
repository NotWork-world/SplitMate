import React, {useEffect, useMemo, useState} from 'react';
import {UserPlus} from 'lucide-react-native';
import {useGroupsQuery} from '../../api/endpoints';
import type {Group} from '../../api/types';
import {Button, Card, EmptyState, GROUP_TYPE_META, Header, ListRow, Screen, SectionTitle, Text, space} from '../../design';
import type {AppScreen} from '../../navigation/types';
import {useAppDispatch, useAppSelector} from '../../store';
import {QueryView} from '../common/QueryView';
import {formatMoney} from '../../money/currency';
import {createDraft, draftActions, emptyPayload} from './draft';
import {PeoplePickerSheet} from './PeoplePickerSheet';

export function StartExpenseScreen({route, navigation}: AppScreen<'StartExpense'>) {
  const {groupId, mode = 'itemized'} = route.params ?? {};
  const dispatch = useAppDispatch();
  const groups = useGroupsQuery({includePersonal: true});
  const draftsById = useAppSelector(s => s.drafts.byId);
  const currency = useAppSelector(s => s.auth.user?.default_currency ?? 'INR');
  const [picking, setPicking] = useState(false);
  const localDrafts = useMemo(
    () => Object.values(draftsById).filter(d => !d.serverId).sort((a, b) => b.updatedAt - a.updatedAt),
    [draftsById],
  );

  const start = (g: Group) => {
    const d = createDraft(g.id, emptyPayload(g.currency, g.my_member_id, mode === 'itemized'));
    dispatch(draftActions.upsert(d));
    navigation.replace('ExpenseEditor', {localId: d.localId});
  };

  useEffect(() => {
    const g = groupId ? groups.data?.find(x => x.id === groupId) : undefined;
    if (g) {
      start(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, groups.data]);

  return (
    <Screen header={<Header title={mode === 'itemized' ? 'Split a bill' : 'Add an expense'} subtitle="Who is it with?" />}>
      <Button label="Choose people" icon={UserPlus} variant="food" size="lg" onPress={() => setPicking(true)} style={{marginTop: space.sm}} testID="start-choose-people" />
      <Text variant="caption" tone="faint" style={{marginTop: space.xs}}>
        No group needed: pick friends and split. Or use one of your groups below.
      </Text>
      <PeoplePickerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        currency={currency}
        onReady={g => {
          setPicking(false);
          start(g);
        }}
      />
      {localDrafts.length ? (
        <>
          <SectionTitle title="Continue where you left off" />
          <Card padded={false} style={{paddingHorizontal: space.sm}}>
            {localDrafts.slice(0, 3).map(d => (
              <ListRow
                key={d.localId}
                title={d.payload.title || 'Untitled bill'}
                subtitle={`On this phone only · ${d.payload.items.length} item(s)`}
                onPress={() => navigation.replace('ExpenseEditor', {localId: d.localId})}
              />
            ))}
          </Card>
        </>
      ) : null}
      <SectionTitle title="Or pick a group" />
      <QueryView query={groups}>
        {list => {
          const usable = list.filter(g => !g.archived);
          if (!usable.length) {
            return <EmptyState emoji="👥" title="Create a group first" action={{label: 'Create a group', onPress: () => navigation.replace('CreateGroup')}} />;
          }
          return (
            <Card padded={false} style={{paddingHorizontal: space.sm}}>
              {usable
                .sort((a, b) => (a.type === 'personal' ? 1 : b.type === 'personal' ? -1 : 0))
                .map(g => (
                  <ListRow
                    key={g.id}
                    left={<Text style={{fontSize: 24, width: 32, textAlign: 'center'}}>{g.emoji || GROUP_TYPE_META[g.type]?.emoji}</Text>}
                    title={g.type === 'personal' ? 'Just me (personal)' : g.name}
                    subtitle={
                      g.type === 'personal'
                        ? 'Track your own spending; not shared'
                        : `${g.members.length} people${g.my_balances.length ? ` · ${g.my_balances.map(b => formatMoney(b.amount_minor, b.currency)).join(', ')}` : ''}`
                    }
                    onPress={() => start(g)}
                  />
                ))}
            </Card>
          );
        }}
      </QueryView>
    </Screen>
  );
}
