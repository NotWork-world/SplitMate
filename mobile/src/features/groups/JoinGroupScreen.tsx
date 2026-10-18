import React, {useState} from 'react';
import {View} from 'react-native';
import {errorMessage, useAcceptInviteMutation, useInvitePreviewQuery} from '../../api/endpoints';
import {Avatar, Banner, Button, Card, Chip, Header, Screen, SectionTitle, Text, TextField, space} from '../../design';
import type {AppScreen} from '../../navigation/types';

export function JoinGroupScreen({route, navigation}: AppScreen<'JoinGroup'>) {
  const [code, setCode] = useState(route.params?.code ?? '');
  const [submitted, setSubmitted] = useState(route.params?.code ?? '');
  const [claim, setClaim] = useState<string | null>(null);
  const preview = useInvitePreviewQuery(submitted, {skip: !submitted});
  const [accept, acceptState] = useAcceptInviteMutation();
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen header={<Header title="Join a group" />} keyboard>
      <Text variant="body" tone="muted" style={{marginBottom: space.lg}}>
        Enter the invite code a friend shared with you.
      </Text>
      <View style={{flexDirection: 'row', gap: space.sm, alignItems: 'flex-end'}}>
        <TextField
          containerStyle={{flex: 1}}
          label="Invite code"
          value={code}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setCode}
          onSubmitEditing={() => setSubmitted(code.trim())}
        />
        <Button label="Look up" variant="secondary" onPress={() => setSubmitted(code.trim())} disabled={!code.trim()} />
      </View>
      {preview.isError ? (
        <View style={{marginTop: space.lg}}>
          <Banner tone="negative" title={errorMessage(preview.error)} />
        </View>
      ) : null}
      {error ? (
        <View style={{marginTop: space.lg}}>
          <Banner tone="negative" title={error} />
        </View>
      ) : null}
      {preview.data ? (
        <Card style={{marginTop: space.xl}}>
          <Text style={{fontSize: 36}}>{preview.data.group_emoji ?? '👥'}</Text>
          <Text variant="title">{preview.data.group_name}</Text>
          <Text variant="small" tone="muted">
            {preview.data.member_count} people
          </Text>
          {preview.data.claimable_members.length ? (
            <>
              <SectionTitle title="Are you one of these?" />
              <Text variant="small" tone="muted" style={{marginBottom: space.sm}}>
                Pick your name to take over expenses already added for you.
              </Text>
              <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
                {preview.data.claimable_members.map(m => (
                  <Chip key={m.id} label={m.display_name} selected={claim === m.id} onPress={() => setClaim(claim === m.id ? null : m.id)} />
                ))}
                <Chip label="I'm new here" selected={claim === null} onPress={() => setClaim(null)} />
              </View>
            </>
          ) : null}
          <Button
            label="Join group"
            size="lg"
            style={{marginTop: space.xl}}
            loading={acceptState.isLoading}
            onPress={async () => {
              setError(null);
              try {
                const g = await accept({code: submitted, memberId: claim ?? undefined}).unwrap();
                navigation.replace('GroupDetail', {groupId: g.id});
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          />
          {claim ? (
            <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md}}>
              <Avatar name={preview.data.claimable_members.find(m => m.id === claim)?.display_name ?? ''} size={24} />
              <Text variant="small" tone="muted">
                You'll join as this person.
              </Text>
            </View>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
