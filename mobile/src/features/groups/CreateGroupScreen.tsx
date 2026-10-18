import React, {useState} from 'react';
import {View} from 'react-native';
import {Plus, X} from 'lucide-react-native';
import {errorMessage, useCreateGroupMutation} from '../../api/endpoints';
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
} from '../../design';
import {SUPPORTED_CURRENCIES} from '../../money/currency';
import type {AppScreen} from '../../navigation/types';
import {useAppSelector} from '../../store';

const TYPES = ['friends', 'trip', 'home', 'couple', 'other'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function CreateGroupScreen({navigation}: AppScreen<'CreateGroup'>) {
  const user = useAppSelector(s => s.auth.user);
  const [create, {isLoading}] = useCreateGroupMutation();
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('friends');
  const [currency, setCurrency] = useState(user?.default_currency ?? 'INR');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [newName, setNewName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMember = () => {
    const n = newName.trim();
    if (n && !members.includes(n)) {
      setMembers([...members, n]);
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
      const pending = newName.trim() && !members.includes(newName.trim()) ? [...members, newName.trim()] : members;
      const g = await create({
        name: name.trim(),
        type,
        emoji: GROUP_TYPE_META[type].emoji,
        currency,
        start_date: type === 'trip' && start ? start : null,
        end_date: type === 'trip' && end ? end : null,
        members: pending.map(display_name => ({display_name})),
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
          <View key={m} style={{flexDirection: 'row', alignItems: 'center'}}>
            <Text variant="bodyStrong" style={{flex: 1}}>
              {m}
            </Text>
            <IconButton icon={X} label={`Remove ${m}`} onPress={() => setMembers(members.filter(x => x !== m))} />
          </View>
        ))}
      </View>
    </Screen>
  );
}
