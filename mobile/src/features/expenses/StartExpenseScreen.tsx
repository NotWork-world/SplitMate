import React, {useEffect} from 'react';
import {useGroupsQuery} from '../../api/endpoints';
import type {Group} from '../../api/types';
import {Card, EmptyState, GROUP_TYPE_META, Header, ListRow, Screen, SectionTitle, Text, space} from '../../design';
import type {AppScreen} from '../../navigation/types';
import {useAppDispatch, useAppSelector} from '../../store';
import {QueryView} from '../common/QueryView';
import {formatMoney} from '../../money/currency';
import {createDraft, draftActions, emptyPayload} from './draft';

export function StartExpenseScreen({route, navigation}: AppScreen<'StartExpense'>) {
  const {groupId, mode = 'itemized'} = route.params ?? {};
  const dispatch = useAppDispatch();
  const groups = useGroupsQuery({includePersonal: true});
  const localDrafts = useAppSelector(s => Object.values(s.drafts.byId).filter(d => !d.serverId).sort((a, b) => b.updatedAt - a.updatedAt));

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
    <Screen header={<Header title={mode === 'itemized' ? 'Split a bill' : 'Add an expense'} subtitle="Which group is it for?" />}>
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
      <SectionTitle title="Groups" />
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
