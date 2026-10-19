import React, {useEffect, useState} from 'react';
import {Keyboard, Pressable, View} from 'react-native';
import {Check, Plus} from 'lucide-react-native';
import {errorMessage, useGroupWithPeopleMutation, useLazyUserByUsernameQuery, useMyPeopleQuery} from '../../api/endpoints';
import type {Group, PublicUser} from '../../api/types';
import {Avatar, Banner, Button, Sheet, Text, TextField, radius, space, useTheme} from '../../design';
import {usernameError} from '../../people/invite';

type Picked = {key: string; name: string; hue?: number; username?: string};

/**
 * Choose who's on this bill: people you already split with, anyone by SplitMate username,
 * or just a name. Gives back the group for exactly those people (reused if it exists).
 */
export function PeoplePickerSheet({
  visible,
  onClose,
  currency,
  onReady,
}: {
  visible: boolean;
  onClose: () => void;
  currency: string;
  onReady: (g: Group) => void;
}) {
  const {colors} = useTheme();
  const people = useMyPeopleQuery(undefined, {skip: !visible});
  const [lookup, lookupState] = useLazyUserByUsernameQuery();
  const [withPeople, state] = useGroupWithPeopleMutation();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [entry, setEntry] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setPicked([]);
      setEntry('');
      setError(null);
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

  const go = async () => {
    setError(null);
    try {
      const names = picked.map(p => p.name.split(' ')[0]);
      const g = await withPeople({
        name: names.length <= 3 ? names.join(' & ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`,
        currency,
        members: picked.map(p => (p.username ? {username: p.username} : {display_name: p.name})),
      }).unwrap();
      onReady(g);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const known = people.data ?? [];
  const extra = picked.filter(p => !known.some(k => `@${k.username}` === p.key));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Who's on this bill?"
      footer={
        <Button
          label={picked.length ? `Continue with ${picked.length} ${picked.length === 1 ? 'person' : 'people'}` : 'Choose people'}
          disabled={!picked.length}
          loading={state.isLoading}
          onPress={go}
          testID="people-continue"
        />
      }>
      {error ? (
        <View style={{marginBottom: space.sm}}>
          <Banner tone="negative" title={error} />
        </View>
      ) : null}
      <View style={{flexDirection: 'row', gap: space.sm, alignItems: 'flex-start'}}>
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
                  {p.username ? `@${p.username}` : 'Not on SplitMate · you can invite them later'}
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
    </Sheet>
  );
}
