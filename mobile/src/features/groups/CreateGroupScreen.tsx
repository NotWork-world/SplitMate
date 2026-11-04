import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {Check, Plus, X} from 'lucide-react-native';
import {errorMessage, useCreateGroupMutation, useMyPeopleQuery} from '../../api/endpoints';
import {
  Banner,
  Button,
  Chip,
  Footer,
  GROUP_TYPE_META,
  Header,
  IconButton,
  Screen,
  SectionTitle,
  Text,
  TextField,
  space,
  useTheme,
} from '../../design';
import {SUPPORTED_CURRENCIES} from '../../money/currency';
import type {AppScreen} from '../../navigation/types';
import {useAppSelector} from '../../store';

const TYPES = ['friends', 'trip', 'home', 'couple', 'other'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function CreateGroupScreen({navigation}: AppScreen<'CreateGroup'>) {
  const user = useAppSelector(s => s.auth.user);
  const [create, {isLoading}] = useCreateGroupMutation();
  const people = useMyPeopleQuery();
  const {colors} = useTheme();
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('friends');
  const [currency, setCurrency] = useState(user?.default_currency ?? 'INR');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [newName, setNewName] = useState('');
  const [members, setMembers] = useState<Array<{name: string; username?: string}>>([]);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // People you already split with: typed text matches their name or @handle.
  const known = people.data ?? [];
  const q = newName.trim().toLowerCase();
  const suggestions = q
    ? known.filter(k => k.display_name.toLowerCase().includes(q) || k.username.toLowerCase().includes(q)).slice(0, 6)
    : [];
  const has = (name: string, username?: string) =>
    members.some(m => (username ? m.username === username : m.username === undefined && m.name === name));

  const addLinked = (name: string, username: string) => {
    if (!has(name, username)) {
      setMembers(list => [...list, {name, username}]);
    }
    setNewName('');
  };

  const addMember = () => {
    const n = newName.trim();
    if (!n) {
      return;
    }
    // Typing a friend you already split with links their account (no stranger
    // guessing: only exact matches to your own people, and only if unique).
    const matches = known.filter(k => k.display_name.toLowerCase() === n.toLowerCase());
    if (matches.length === 1) {
      addLinked(matches[0].display_name, matches[0].username);
      return;
    }
    if (!has(n)) {
      setMembers(list => [...list, {name: n}]);
    }
    setNewName('');
  };
  const dateErr = (v: string) => (v && !DATE_RE.test(v) ? 'Use YYYY-MM-DD' : null);

  const submit = async () => {
    setTouched(true);
    if (!name.trim() || dateErr(start) || dateErr(end)) {
      return;
    }
    setError(null);
    try {
      const pending = newName.trim() ? [...members, {name: newName.trim()}] : members;
      const g = await create({
        name: name.trim(),
        type,
        emoji: GROUP_TYPE_META[type].emoji,
        currency,
        start_date: type === 'trip' && start ? start : null,
        end_date: type === 'trip' && end ? end : null,
        members: pending.map(m => (m.username ? {username: m.username} : {display_name: m.name})),
      }).unwrap();
      navigation.replace('GroupDetail', {groupId: g.id});
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen
      header={<Header title="New group" />}
      keyboard
      footer={
        <Footer>
          <Button label="Create group" size="lg" onPress={submit} loading={isLoading} testID="create-group-submit" />
        </Footer>
      }>
      {error ? <Banner tone="negative" title={error} /> : null}
      <TextField
        label="Group name"
        placeholder="Flat 4B, Goa 2026, Friday dinners…"
        value={name}
        onChangeText={setName}
        error={touched && !name.trim() ? 'Give the group a name.' : null}
        testID="group-name"
      />
      <SectionTitle title="What's it for?" />
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
        {TYPES.map(t => (
          <Chip key={t} label={GROUP_TYPE_META[t].label} emoji={GROUP_TYPE_META[t].emoji} selected={type === t} onPress={() => setType(t)} />
        ))}
      </View>
      {type === 'trip' ? (
        <View style={{flexDirection: 'row', gap: space.sm, marginTop: space.lg}}>
          <TextField containerStyle={{flex: 1}} label="Starts" placeholder="2026-12-20" value={start} onChangeText={setStart} error={dateErr(start)} />
          <TextField containerStyle={{flex: 1}} label="Ends" placeholder="2026-12-27" value={end} onChangeText={setEnd} error={dateErr(end)} />
        </View>
      ) : null}
      {type === 'home' ? (
        <Text variant="small" tone="muted" style={{marginTop: space.md}}>
          Tip: add rent and utilities each month with an equal or exact split. Groceries can be itemised.
        </Text>
      ) : null}
      <SectionTitle title="Default currency" />
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
        {['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'THB', 'JPY'].filter(c => SUPPORTED_CURRENCIES.includes(c)).map(c => (
          <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
        ))}
      </View>
      <SectionTitle title="People" />
      <Text variant="small" tone="muted" style={{marginBottom: space.md}}>
        You're in automatically. Add friends by name; they can join later with an invite code and take over their spot.
      </Text>
      <View style={{flexDirection: 'row', gap: space.sm, alignItems: 'flex-end'}}>
        <TextField
          containerStyle={{flex: 1}}
          placeholder="Friend's name"
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={addMember}
          returnKeyType="done"
          testID="member-name"
        />
        <Button label="Add" icon={Plus} variant="secondary" onPress={addMember} disabled={!newName.trim()} testID="member-add" />
      </View>
      <View style={{marginTop: space.md, gap: space.xs}}>
        {members.map(m => (
          <View key={m.username ?? m.name} style={{flexDirection: 'row', alignItems: 'center'}}>
            <Text variant="bodyStrong" style={{flex: 1}}>
              {m.name}
              {m.username ? <Text variant="caption" tone="muted"> · on SplitMate (@{m.username})</Text> : null}
            </Text>
            <IconButton icon={X} label={`Remove ${m.name}`} onPress={() => setMembers(members.filter(x => x !== m))} />
          </View>
        ))}
      </View>
      {suggestions.length ? (
        <View style={{marginTop: space.sm, gap: space.xs}}>
          {suggestions.map(k => {
            const on = has(k.display_name, k.username);
            return (
              <Pressable
                key={k.username}
                accessibilityRole="button"
                accessibilityLabel={`Add ${k.display_name}`}
                onPress={() => addLinked(k.display_name, k.username)}
                style={({pressed}) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  padding: space.sm,
                  borderRadius: 12,
                  backgroundColor: pressed ? colors.surfacePressed : colors.surface,
                })}>
                <Check size={18} color={on ? colors.accentText : colors.textFaint} />
                <Text variant="body" style={{flex: 1}}>
                  {k.display_name} <Text variant="caption" tone="muted">@{k.username}</Text>
                </Text>
                <Text variant="caption" tone="muted">on SplitMate</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}
