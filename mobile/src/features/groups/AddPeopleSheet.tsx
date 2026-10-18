import React, {useEffect, useState} from 'react';
import {Keyboard, View} from 'react-native';
import {BookUser, MessageCircle, Plus, Share2} from 'lucide-react-native';
import {errorMessage, useAddMemberMutation, useCreateInviteMutation, useLazyUserByUsernameQuery} from '../../api/endpoints';
import type {Member, PublicUser} from '../../api/types';
import {Avatar, Banner, Button, Card, Segmented, Sheet, Text, TextField, space, useToast} from '../../design';
import {normalizePhone, pickContact, sendOnWhatsApp, usernameError, type PickedContact} from '../../people/invite';

type Mode = 'username' | 'contact' | 'name';

/**
 * Three ways to bring someone into a group:
 *  - their SplitMate username: they're in straight away and the group shows up in their app;
 *  - a phone contact: a spot is made for them and a WhatsApp message carries an invite link
 *    tied to that spot, so when they join, everything already split with them comes along;
 *  - just a name, for people who'll never install the app.
 */
export function AddPeopleSheet({
  visible,
  onClose,
  groupId,
  groupName,
  onAdded,
}: {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  groupName?: string;
  onAdded?: (m: Member) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('username');
  const [username, setUsername] = useState('');
  const [found, setFound] = useState<PublicUser | null>(null);
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lookup, lookupState] = useLazyUserByUsernameQuery();
  const [addMember] = useAddMemberMutation();
  const [createInvite] = useCreateInviteMutation();

  useEffect(() => {
    if (visible) {
      setError(null);
      setFound(null);
      setContact(null);
      setUsername('');
      setName('');
    }
  }, [visible]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e)); // API errors and native picker errors both carry a message
    } finally {
      setBusy(false);
    }
  };

  const added = (m: Member, msg: string) => {
    toast(msg, 'positive');
    onAdded?.(m);
    onClose();
  };

  const uErr = usernameError(username);

  return (
    <Sheet visible={visible} onClose={onClose} title="Add people">
      <Segmented<Mode>
        options={[
          {value: 'username', label: 'Username'},
          {value: 'contact', label: 'Contacts'},
          {value: 'name', label: 'Just a name'},
        ]}
        value={mode}
        onChange={m => {
          setMode(m);
          setError(null);
        }}
      />
      {error ? (
        <View style={{marginTop: space.sm}}>
          <Banner tone="negative" title={error} />
        </View>
      ) : null}

      {mode === 'username' ? (
        <View style={{marginTop: space.md}}>
          <TextField
            label="Their SplitMate username"
            placeholder="asha_rao"
            prefix="@"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={t => {
              setUsername(t);
              setFound(null);
            }}
            error={uErr}
            hint="They can see theirs on their Profile tab."
            testID="add-username"
          />
          {found ? (
            <Card style={{marginTop: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md}}>
              <Avatar name={found.display_name} hue={found.avatar_hue} size={44} />
              <View style={{flex: 1}}>
                <Text variant="bodyStrong">{found.display_name}</Text>
                <Text variant="small" tone="muted">
                  @{found.username}
                </Text>
              </View>
            </Card>
          ) : null}
          {found ? (
            <Button
              key="add"
              label={`Add ${found.display_name}`}
              icon={Plus}
              style={{marginTop: space.md}}
              loading={busy}
              onPress={() =>
                run(async () => {
                  const m = await addMember({groupId, username: found.username}).unwrap();
                  added(m, `${m.display_name} added. The group now shows in their app.`);
                })
              }
              testID="add-username-confirm"
            />
          ) : (
            <Button
              key="find"
              label="Find"
              variant="secondary"
              style={{marginTop: space.md}}
              disabled={!username.trim() || !!uErr}
              loading={lookupState.isFetching}
              onPress={() =>
                run(async () => {
                  Keyboard.dismiss(); // so the result and its Add button aren't under the keyboard
                  setFound(await lookup(username).unwrap());
                })
              }
              testID="add-username-find"
            />
          )}
        </View>
      ) : null}

      {mode === 'contact' ? (
        <View style={{marginTop: space.md}}>
          {contact ? (
            <>
              <TextField label="Name in this group" value={contact.name} onChangeText={t => setContact({...contact, name: t})} />
              <Text variant="small" tone="muted" style={{marginTop: space.xs}}>
                {contact.phone}
              </Text>
              <Button
                key="invite" // a fresh button, not the picker button reused mid-press
                label="Add & invite on WhatsApp"
                icon={MessageCircle}
                variant="food"
                style={{marginTop: space.md}}
                disabled={!contact.name.trim()}
                loading={busy}
                onPress={() =>
                  run(async () => {
                    // A spot for them now, and an invite tied to it: when they join, it becomes theirs.
                    const m = await addMember({groupId, display_name: contact.name.trim()}).unwrap();
                    const inv = await createInvite({groupId, memberId: m.id}).unwrap();
                    const via = await sendOnWhatsApp(normalizePhone(contact.phone), `Hi ${contact.name.split(' ')[0]}! ${inv.share_text}`);
                    added(m, via === 'whatsapp' ? `${m.display_name} added · invite sent` : `${m.display_name} added`);
                  })
                }
                testID="add-contact-invite"
              />
              <Button label="Choose someone else" variant="ghost" onPress={() => setContact(null)} style={{marginTop: space.xs}} />
            </>
          ) : (
            <>
              <Text variant="small" tone="muted">
                Pick a friend from your phone. SplitMate only sees the one contact you choose.
              </Text>
              <Button
                key="pick"
                label="Choose from contacts"
                icon={BookUser}
                style={{marginTop: space.md}}
                loading={busy}
                onPress={() =>
                  run(async () => {
                    const c = await pickContact();
                    if (c) {
                      setContact(c);
                    }
                  })
                }
                testID="add-contact-pick"
              />
              <Button
                label={`Share ${groupName ? `“${groupName}”` : 'group'} link on WhatsApp`}
                icon={Share2}
                variant="secondary"
                style={{marginTop: space.sm}}
                onPress={() =>
                  run(async () => {
                    const inv = await createInvite({groupId}).unwrap();
                    await sendOnWhatsApp(null, inv.share_text);
                    onClose();
                  })
                }
              />
            </>
          )}
          <Text variant="caption" tone="faint" style={{marginTop: space.md}}>
            When they join with the link, they appear here as “On SplitMate” automatically.
          </Text>
        </View>
      ) : null}

      {mode === 'name' ? (
        <View style={{marginTop: space.md}}>
          <TextField label="Name" placeholder="Rahul" value={name} onChangeText={setName} testID="add-name" />
          <Button
            label="Add"
            icon={Plus}
            variant="secondary"
            style={{marginTop: space.md}}
            disabled={!name.trim()}
            loading={busy}
            onPress={() =>
              run(async () => {
                const m = await addMember({groupId, display_name: name.trim()}).unwrap();
                added(m, `${m.display_name} added`);
              })
            }
          />
          <Text variant="caption" tone="faint" style={{marginTop: space.sm}}>
            For friends without the app. You can invite them later and they keep their history.
          </Text>
        </View>
      ) : null}
    </Sheet>
  );
}
