import React, {useState} from 'react';
import {Share} from 'react-native';
import {Archive, LogOut, Pencil, Share2, Shield, UserMinus, UserPlus} from 'lucide-react-native';
import {
  errorMessage,
  useCreateInviteMutation,
  useGroupQuery,
  useRemoveMemberMutation,
  useUpdateGroupMutation,
  useUpdateMemberMutation,
} from '../../api/endpoints';
import type {Member} from '../../api/types';
import {
  Avatar,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Header,
  ListRow,
  Screen,
  SectionTitle,
  Sheet,
  Text,
  TextField,
  space,
  useToast,
} from '../../design';
import type {AppScreen} from '../../navigation/types';
import {QueryView} from '../common/QueryView';
import {AddPeopleSheet} from './AddPeopleSheet';

export function GroupSettingsScreen({route, navigation}: AppScreen<'GroupSettings'>) {
  const {groupId} = route.params;
  const toast = useToast();
  const q = useGroupQuery(groupId);
  const [addOpen, setAddOpen] = useState(false);
  const [removeMember, removeState] = useRemoveMemberMutation();
  const [updateMember] = useUpdateMemberMutation();
  const [updateGroup, updateState] = useUpdateGroupMutation();
  const [createInvite, inviteState] = useCreateInviteMutation();
  const [rename, setRename] = useState<string | null>(null);
  const [selected, setSelected] = useState<Member | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);
  const [error, setError] = useState<string | null>(null);

  const share = async (memberId?: string) => {
    try {
      const inv = await createInvite({groupId, memberId}).unwrap();
      await Share.share({message: inv.share_text});
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen header={<Header title="Group settings" />} keyboard>
      <QueryView query={q}>
        {g => {
          const admin = g.my_role === 'owner' || g.my_role === 'admin';
          const me = g.members.find(m => m.is_me);
          return (
            <>
              {error ? <Banner tone="negative" title={error} /> : null}
              <SectionTitle title="People" />
              <Card padded={false} style={{paddingHorizontal: space.sm}}>
                {g.members.map(m => (
                  <ListRow
                    key={m.id}
                    left={<Avatar name={m.display_name} hue={m.avatar_hue} size={36} />}
                    title={`${m.display_name}${m.is_me ? ' (you)' : ''}`}
                    subtitle={m.role !== 'member' ? (m.role === 'owner' ? 'Owner' : 'Admin') : m.is_registered ? (m.username ? `@${m.username} · On SplitMate` : 'On SplitMate') :'Not on SplitMate yet · tap to invite'}
                    onPress={m.is_me ? undefined : () => setSelected(m)}
                  />
                ))}
              </Card>
              <Button label="Add people" icon={UserPlus} variant="food" onPress={() => setAddOpen(true)} style={{marginTop: space.md}} testID="group-add-people" />
              <Button label="Share an invite link" icon={Share2} variant="ghost" loading={inviteState.isLoading} onPress={() => share()} style={{marginTop: space.xs}} />
              <AddPeopleSheet visible={addOpen} onClose={() => setAddOpen(false)} groupId={groupId} groupName={g.name} />

              <SectionTitle title="Group" />
              <Card padded={false} style={{paddingHorizontal: space.sm}}>
                {admin ? <ListRow icon={Pencil} title="Rename group" subtitle={g.name} onPress={() => setRename(g.name)} /> : null}
                {admin ? (
                  <ListRow
                    icon={Archive}
                    title={g.archived ? 'Unarchive group' : 'Archive group'}
                    subtitle="Archived groups keep their history and balances."
                    onPress={async () => {
                      try {
                        await updateGroup({id: groupId, body: {archived: !g.archived}}).unwrap();
                        toast(g.archived ? 'Group restored' : 'Group archived', 'positive');
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                    }}
                  />
                ) : null}
                {me && me.role !== 'owner' ? (
                  <ListRow icon={LogOut} title="Leave group" subtitle="Only possible once you're settled up." destructive onPress={() => setConfirmRemove(me)} />
                ) : null}
              </Card>

              <Sheet
                visible={!!selected}
                onClose={() => setSelected(null)}
                title={selected?.display_name}
                footer={<Button label="Close" variant="secondary" onPress={() => setSelected(null)} />}>
                {selected && !selected.is_registered ? (
                  <ListRow
                    icon={Share2}
                    title={`Invite ${selected.display_name}`}
                    subtitle="Their code links to this spot, so their history comes with them."
                    onPress={() => {
                      const id = selected.id;
                      setSelected(null);
                      share(id);
                    }}
                  />
                ) : null}
                {admin && selected?.is_registered && selected.role !== 'owner' ? (
                  <ListRow
                    icon={Shield}
                    title={selected.role === 'admin' ? 'Remove admin rights' : 'Make admin'}
                    onPress={async () => {
                      try {
                        await updateMember({groupId, memberId: selected.id, body: {role: selected.role === 'admin' ? 'member' : 'admin'}}).unwrap();
                        setSelected(null);
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                    }}
                  />
                ) : null}
                {admin && selected && selected.role !== 'owner' ? (
                  <ListRow
                    icon={UserMinus}
                    destructive
                    title={`Remove ${selected.display_name}`}
                    subtitle="Only when they're settled up and have no repayments in progress."
                    onPress={() => {
                      setConfirmRemove(selected);
                      setSelected(null);
                    }}
                  />
                ) : null}
                {!admin && selected?.is_registered ? (
                  <Text variant="small" tone="muted">
                    Only the group's owner or admins can change people.
                  </Text>
                ) : null}
              </Sheet>

              <Sheet
                visible={rename !== null}
                onClose={() => setRename(null)}
                title="Rename group"
                footer={
                  <Button
                    label="Save"
                    loading={updateState.isLoading}
                    disabled={!rename?.trim()}
                    onPress={async () => {
                      try {
                        await updateGroup({id: groupId, body: {name: rename?.trim()}}).unwrap();
                        setRename(null);
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                    }}
                  />
                }>
                <TextField value={rename ?? ''} onChangeText={setRename} autoFocus />
              </Sheet>

              <ConfirmDialog
                visible={!!confirmRemove}
                title={confirmRemove?.is_me ? 'Leave this group?' : `Remove ${confirmRemove?.display_name}?`}
                body="Their past expenses stay in the history. This only works when they're settled up."
                confirmLabel={confirmRemove?.is_me ? 'Leave' : 'Remove'}
                destructive
                loading={removeState.isLoading}
                onCancel={() => setConfirmRemove(null)}
                onConfirm={async () => {
                  const m = confirmRemove!;
                  try {
                    await removeMember({groupId, memberId: m.id}).unwrap();
                    setConfirmRemove(null);
                    if (m.is_me) {
                      navigation.popToTop();
                    }
                  } catch (e) {
                    setConfirmRemove(null);
                    setError(errorMessage(e));
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
