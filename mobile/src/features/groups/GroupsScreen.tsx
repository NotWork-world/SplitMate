import React from 'react';
import {View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {Plus, UserPlus} from 'lucide-react-native';
import {useGroupsQuery} from '../../api/endpoints';
import {Button, EmptyState, IconButton, Screen, SectionTitle, Text, space} from '../../design';
import {QueryView} from '../common/QueryView';
import {GroupCard} from '../common/rows';

export function GroupsScreen() {
  const nav = useNavigation();
  const q = useGroupsQuery(undefined, {refetchOnFocus: true});
  return (
    <Screen refreshing={q.isFetching && !q.isLoading} onRefresh={q.refetch}>
      <View style={{flexDirection: 'row', alignItems: 'center', marginVertical: space.sm}}>
        <Text variant="title" style={{flex: 1}} accessibilityRole="header">
          Groups
        </Text>
        <IconButton icon={UserPlus} label="Join with a code" filled onPress={() => nav.navigate('JoinGroup', {})} />
        <View style={{width: space.sm}} />
        <IconButton icon={Plus} label="Create a group" filled onPress={() => nav.navigate('CreateGroup')} />
      </View>
      <QueryView query={q}>
        {groups => {
          const active = groups.filter(g => !g.archived);
          const archived = groups.filter(g => g.archived);
          if (!groups.length) {
            return (
              <EmptyState
                emoji="👥"
                title="No groups yet"
                body="Flatmates, a Goa trip, the Friday dinner gang: make a group and add people by name."
                action={{label: 'Create a group', onPress: () => nav.navigate('CreateGroup')}}
              />
            );
          }
          return (
            <>
              {active.map(g => (
                <GroupCard key={g.id} g={g} onPress={() => nav.navigate('GroupDetail', {groupId: g.id})} />
              ))}
              {archived.length ? (
                <>
                  <SectionTitle title="Archived" />
                  {archived.map(g => (
                    <GroupCard key={g.id} g={g} onPress={() => nav.navigate('GroupDetail', {groupId: g.id})} />
                  ))}
                </>
              ) : null}
              <Button label="Create another group" variant="ghost" icon={Plus} onPress={() => nav.navigate('CreateGroup')} style={{marginTop: space.md}} />
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}
