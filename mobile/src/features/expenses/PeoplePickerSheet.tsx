import React, {useEffect, useState} from 'react';
import {Keyboard, Pressable, View} from 'react-native';
import {BookUser, Check, Plus, Users} from 'lucide-react-native';
import {
  errorMessage,
  useCreateInviteMutation,
  useGroupWithPeopleMutation,
  useGroupsQuery,
  useLazyUserByUsernameQuery,
  useMyPeopleQuery,
} from '../../api/endpoints';
import type {Group, PublicUser} from '../../api/types';
import {Avatar, Banner, Button, Card, Segmented, Sheet, Text, TextField, radius, space, useTheme, useToast} from '../../design';
import {normalizePhone, pickContact, sendOnWhatsApp, usernameError} from '../../people/invite';

type Picked = {key: string; name: string; hue?: number; username?: string; phone?: string};

/**
 * Choose who's on this bill: an existing group, people you already split with, anyone by
 * SplitMate username, a phone contact (who gets a WhatsApp invite to join), or just a name.
 * Gives back the group for exactly those people (reused if it exists).
 */
export function PeoplePickerSheet({
  visible,
  onClose,
  currency,
  onReady,
  title = "Who's on this bill?",
}: {
  visible: boolean;
  onClose: () => void;
  currency: string;
  onReady: (g: Group) => void;
  title?: string;
}) {
  const {colors} = useTheme();
  const toast = useToast();
  const [tab, setTab] = useState<'people' | 'groups'>('people');
  const people = useMyPeopleQuery(undefined, {skip: !visible});
  const groups = useGroupsQuery({includePersonal: false}, {skip: !visible});
  const [lookup, lookupState] = useLazyUserByUsernameQuery();
  const [withPeople, state] = useGroupWithPeopleMutation();
  const [createInvite] = useCreateInviteMutation();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [entry, setEntry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setPicked([]);
      setEntry('');
      setError(null);
      setTab('people');
    }
  }, [visible]);

  const has = (key: string) => picked.some(p => p.key === key);
  const toggle = (p: Picked) => setPicked(list => (has(p.key) ? list.filter(x => x.key !== p.key) : [...list, p]));
  const fromUser = (u: PublicUser): Picked => ({key: `@${u.username}`, name: u.display_name, hue: u.avatar_hue, username: u.username});

  // "@handle" looks the person up; anything else is added as a name (someone not on SplitMate).
  const addEntry = async () => {
    const text = entry.trim();
    if (!text) {
      return;
    }
    setError(null);
    if (text.startsWith('@')) {
      if (usernameError(text)) {
        setError(usernameError(text));
        return;
      }
      try {
        Keyboard.dismiss();
        const u = await lookup(text).unwrap();
        if (!has(`@${u.username}`)) {
          setPicked(list => [...list, fromUser(u)]);
        }
        setEntry('');
      } catch (e) {
        setError(errorMessage(e));
      }
    } else {
      setPicked(list => [...list, {key: `name:${text.toLowerCase()}:${Date.now()}`, name: text}]);
      setEntry('');
    }
  };

  const addContact = async () => {
    setError(null);
    try {
      const c = await pickContact();
      if (c) {
        const name = c.name.trim() || c.phone;
        setPicked(list => (list.some(p => p.name.toLowerCase() === name.toLowerCase()) ? list : [...list, {key: `contact:${name.toLowerCase()}:${Date.now()}`, name, phone: c.phone}]));
      }
    } catch (e) {
      setError(errorMessage(e)); // includes the "contact permission" case
    }
  };

  const go = async () => {
    setError(null);
    setBusy(true);
    try {
      const names = picked.map(p => p.name.split(' ')[0]);
      const g = await withPeople({
        name: names.length <= 3 ? names.join(' & ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`,
        currency,
        members: picked.map(p => (p.username ? {username: p.username} : {display_name: p.name})),
      }).unwrap();
      // Friends picked from the phone contacts aren't on SplitMate yet: send each one a
      // WhatsApp message with an invite tied to their spot, so their share is waiting when they join.
      const contacts = picked.filter(p => p.phone && !p.username);
      let invited = 0;
      for (const c of contacts) {
        const m = g.members.find(x => x.display_name.toLowerCase() === c.name.toLowerCase());
        if (!m) {
          continue;
        }
        try {
          const inv = await createInvite({groupId: g.id, memberId: m.id}).unwrap();
          const via = await sendOnWhatsApp(normalizePhone(c.phone!), `Hi ${c.name.split(' ')[0]}! ${inv.share_text}`);
          if (via === 'whatsapp') {
            invited++;
          }
        } catch {
          // The invite can also be shared later from the group screen; don't block the flow.
        }
      }
      if (invited) {
        toast(`WhatsApp invite${invited === 1 ? '' : 's'} sent to ${invited} friend${invited === 1 ? '' : 's'}`, 'positive');
      }
      onReady(g);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const known = people.data ?? [];
  const extra = picked.filter(p => !known.some(k => `@${k.username}` === p.key));
  const groupList = (groups.data ?? []).filter(g => !g.archived && g.type !== 'personal');

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        tab === 'groups' ? undefined : (
          <Button
            label={picked.length ? `Continue with ${picked.length} ${picked.length === 1 ? 'person' : 'people'}` : 'Choose people'}
            disabled={!picked.length}
            loading={state.isLoading || busy}
            onPress={go}
            testID="people-continue"
          />
        )
      }>
      <Segmented<'people' | 'groups'>
        value={tab}
        onChange={setTab}
        options={[
          {value: 'people', label: 'People'},
          {value: 'groups', label: 'A group I have'},
        ]}
      />
      {tab === 'people' ? (
        <>
          {error ? (
            <View style={{marginBottom: space.sm, marginTop: space.sm}}>
              <Banner tone="negative" title={error} />
            </View>
          ) : null}
          <View style={{flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', marginTop: space.md}}>
            <TextField
              containerStyle={{flex: 1}}
              placeholder="@username or a name"
              autoCapitalize="none"
              autoCorrect={false}
              value={entry}
              onChangeText={setEntry}
              onSubmitEditing={addEntry}
              returnKeyType="done"
              testID="people-entry"
            />
            <Button label="Add" icon={Plus} variant="secondary" loading={lookupState.isFetching} disabled={!entry.trim()} onPress={addEntry} testID="people-add" />
          </View>
          <Text variant="caption" tone="faint" style={{marginTop: space.xs}}>
            Type @ and their username to find someone on SplitMate, or just a name for a friend without the app.
          </Text>
          <Button label="Add from phone contacts" icon={BookUser} variant="secondary" loading={busy} onPress={addContact} style={{marginTop: space.md}} testID="people-contact" />
          <View style={{marginTop: space.md, gap: space.xs}}>
            {[...known.map(fromUser), ...extra].map(p => {
              const on = has(p.key);
              return (
                <Pressable
                  key={p.key}
                  accessibilityRole="checkbox"
                  accessibilityState={{checked: on}}
                  accessibilityLabel={p.name}
                  onPress={() => toggle(p)}
                  testID={`people-${p.username ?? p.name}`}
                  style={({pressed}) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    padding: space.sm,
                    borderRadius: radius.md,
                    backgroundColor: on ? colors.highlight : pressed ? colors.surfacePressed : 'transparent',
                  })}>
                  <Avatar name={p.name} hue={p.hue} size={36} />
                  <View style={{flex: 1}}>
                    <Text variant="bodyStrong">{p.name}</Text>
                    <Text variant="caption" tone="muted">
                      {p.username
                        ? `@${p.username}`
                        : p.phone
                        ? `${p.phone} · WhatsApp invite sent when you continue`
                        : 'Not on SplitMate · you can invite them later'}
                    </Text>
                  </View>
                  {on ? <Check size={20} color={colors.highlightText} /> : null}
                </Pressable>
              );
            })}
            {!known.length && !extra.length && !people.isLoading ? (
              <Text variant="small" tone="muted">
                People you split with show up here next time.
              </Text>
            ) : null}
          </View>
        </>
      ) : (
        <View style={{marginTop: space.md, gap: space.xs}}>
          {groups.isLoading ? (
            <Text variant="small" tone="muted">
              Loading your groups…
            </Text>
          ) : groupList.length ? (
            groupList.map(g => (
              <Pressable
                key={g.id}
                accessibilityRole="button"
                onPress={() => onReady(g)}
                style={({pressed}) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  padding: space.sm,
                  borderRadius: radius.md,
                  backgroundColor: pressed ? colors.surfacePressed : 'transparent',
                })}>
                <Users size={20} color={colors.textMuted} />
                <View style={{flex: 1}}>
                  <Text variant="bodyStrong">{g.name}</Text>
                  <Text variant="caption" tone="muted">
                    {g.members.length} people · {g.my_balances.length ? g.my_balances.map(b => formatMoneySoft(b.amount_minor, b.currency)).join(', ') : 'settled up'}
                  </Text>
                </View>
              </Pressable>
            ))
          ) : (
            <Card>
              <Text variant="small" tone="muted">
                No groups yet. Pick people on the first tab instead — SplitMate makes a group for exactly them.
              </Text>
            </Card>
          )}
        </View>
      )}
    </Sheet>
  );
}

function formatMoneySoft(minor: number, currency: string): string {
  const abs = Math.abs(minor) / 100;
  return `${minor >= 0 ? '+' : '−'}${currency === 'INR' ? '₹' : currency + ' '}${abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(2)}`;
}
