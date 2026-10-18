import React, {useEffect, useState} from 'react';
import {Pressable, Share, View} from 'react-native';
import {Bell, Download, FileText, KeyRound, LogOut, QrCode, Server, ShieldCheck, Trash2, Wallet} from 'lucide-react-native';
import {launchImageLibrary} from 'react-native-image-picker';
import BarcodeScanning from '@react-native-ml-kit/barcode-scanning';
import QRCode from 'react-native-qrcode-svg';
import {parseUpiQr, upiPayUrl} from '../../payments/upi';
import {usernameError} from '../../people/invite';
import {
  errorMessage,
  useChangePasswordMutation,
  useDeleteAccountMutation,
  useExportDataMutation,
  useHealthQuery,
  useMeQuery,
  useUpdateMeMutation,
} from '../../api/endpoints';
import {clearSession} from '../../api/client';
import {splitApi} from '../../api/endpoints';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Footer,
  Header,
  ListRow,
  Screen,
  SectionTitle,
  Segmented,
  Sheet,
  SwitchRow,
  Text,
  TextField,
  space,
  useToast,
} from '../../design';
import {APP_VERSION, apiUrl, DEFAULT_API_URL, saveApiUrl} from '../../config';
import {SUPPORTED_CURRENCIES} from '../../money/currency';
import type {AppScreen} from '../../navigation/types';
import {signedOut, useAppDispatch, useAppSelector, userUpdated} from '../../store';
import {signOut} from '../auth/session';
import {useThemePreference} from '../../themePreference';

export function ProfileScreen({navigation}: any) {
  const dispatch = useAppDispatch();
  const me = useMeQuery();
  const cached = useAppSelector(s => s.auth.user);
  const user = me.data ?? cached;
  const [confirmOut, setConfirmOut] = useState(false);
  useEffect(() => {
    if (me.data) {
      dispatch(userUpdated(me.data));
    }
  }, [me.data, dispatch]);
  return (
    <Screen refreshing={me.isFetching && !me.isLoading} onRefresh={me.refetch}>
      <Text variant="title" style={{marginVertical: space.sm}} accessibilityRole="header">
        Profile
      </Text>
      <Card strong style={{alignItems: 'center', paddingVertical: space.xl}}>
        <Avatar name={user?.display_name ?? '?'} hue={user?.avatar_hue} size={72} />
        <Text variant="title" style={{marginTop: space.md}}>
          {user?.display_name}
        </Text>
        {user?.username ? (
          <Text variant="bodyStrong" tone="accent" selectable testID="profile-handle">
            @{user.username}
          </Text>
        ) : null}
        <Text variant="small" tone="muted">
          {user?.email ?? 'Signed in with Google'}
        </Text>
        <Button label="Edit profile" variant="secondary" size="sm" style={{marginTop: space.md}} onPress={() => navigation.navigate('EditProfile')} />
      </Card>
      <SectionTitle title="Money" />
      <Card padded={false} style={{paddingHorizontal: space.sm}}>
        <ListRow icon={Wallet} title="Balances" subtitle="Everyone you owe or who owes you" onPress={() => navigation.navigate('Balances')} />
        <ListRow icon={FileText} title="Repayments" subtitle="Requests, payments and confirmations" onPress={() => navigation.navigate('Repayments', {})} />
      </Card>
      <SectionTitle title="App" />
      <Card padded={false} style={{paddingHorizontal: space.sm}}>
        <ListRow icon={Bell} title="Settings" subtitle="Notifications, appearance, data" onPress={() => navigation.navigate('Settings')} />
        <ListRow icon={ShieldCheck} title="Privacy" subtitle="What SplitMate stores and why" onPress={() => navigation.navigate('Privacy')} />
        <ListRow icon={LogOut} title="Sign out" destructive onPress={() => setConfirmOut(true)} />
      </Card>
      <Text variant="caption" tone="faint" align="center" style={{marginTop: space.xl}}>
        SplitMate {APP_VERSION}
      </Text>
      <ConfirmDialog
        visible={confirmOut}
        title="Sign out?"
        body="Drafts that are only on this phone stay here for next time."
        confirmLabel="Sign out"
        onCancel={() => setConfirmOut(false)}
        onConfirm={() => {
          setConfirmOut(false);
          signOut(dispatch);
        }}
      />
    </Screen>
  );
}

export function EditProfileScreen({navigation}: AppScreen<'EditProfile'>) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const me = useMeQuery();
  const [update, {isLoading}] = useUpdateMeMutation();
  const [changePassword, pw] = useChangePasswordMutation();
  const [name, setName] = useState('');
  const [upi, setUpi] = useState('');
  const [uname, setUname] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [hue, setHue] = useState(260);
  const [error, setError] = useState<string | null>(null);
  const [pwSheet, setPwSheet] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');

  useEffect(() => {
    if (me.data) {
      setName(me.data.display_name);
      setUpi(me.data.upi_id ?? '');
      setUname(me.data.username ?? '');
      setCurrency(me.data.default_currency);
      setHue(me.data.avatar_hue);
    }
  }, [me.data]);

  const unameErr = usernameError(uname);
  const upiErr = upi &&!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,64}$/.test(upi.trim()) ? 'That doesn\'t look like a UPI ID (name@bank).' : null;

  return (
    <Screen
      header={<Header title="Edit profile" />}
      keyboard
      footer={
        <Footer>
          <Button
            label="Save"
            size="lg"
            loading={isLoading}
            disabled={!name.trim() || !!upiErr || !!unameErr || !uname.trim()}
            onPress={async () => {
              setError(null);
              try {
                const u = await update({display_name: name.trim(), username: uname.trim().replace(/^@/, '').toLowerCase(), upi_id: upi.trim(), default_currency: currency, avatar_hue: hue}).unwrap();
                dispatch(userUpdated(u));
                toast('Profile saved', 'positive');
                navigation.goBack();
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          />
        </Footer>
      }>
      {error ? <Banner tone="negative" title={error} /> : null}
      <View style={{alignItems: 'center', marginVertical: space.lg}}>
        <Avatar name={name || '?'} hue={hue} size={80} />
      </View>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center'}}>
        {[0, 30, 160, 200, 260, 300, 330].map(h => (
          <Pressable
            key={h}
            accessibilityRole="radio"
            accessibilityLabel={`Colour ${h}`}
            accessibilityState={{selected: hue === h}}
            onPress={() => setHue(h)}
            style={{width: 40, height: 40, borderRadius: 20, backgroundColor: `hsl(${h}, 70%, 55%)`, borderWidth: 3, borderColor: hue === h ? '#FFFFFF' : 'transparent'}}
          />
        ))}
      </View>
      <TextField containerStyle={{marginTop: space.lg}} label="Name" value={name} onChangeText={setName} />
      <TextField
        containerStyle={{marginTop: space.lg}}
        label="Username"
        prefix="@"
        autoCapitalize="none"
        autoCorrect={false}
        value={uname}
        onChangeText={setUname}
        error={unameErr}
        hint="Friends add you to groups with this."
        testID="profile-username"
      />
      <TextField
        containerStyle={{marginTop: space.lg}}
        label="UPI ID (optional)"
        placeholder="yourname@okbank"
        autoCapitalize="none"
        value={upi}
        onChangeText={setUpi}
        error={upiErr}
        hint="Shown to people in your groups so they can pay you from their UPI app."
      />
      <Button
        label="Fill from my UPI QR code"
        icon={QrCode}
        variant="secondary"
        size="sm"
        style={{marginTop: space.sm, alignSelf: 'flex-start'}}
        onPress={async () => {
          setError(null);
          const res = await launchImageLibrary({mediaType: 'photo', selectionLimit: 1});
          const uri = res.assets?.[0]?.uri;
          if (!uri) {
            return;
          }
          try {
            const codes = await BarcodeScanning.scan(uri);
            const found = codes.map(c => parseUpiQr(c.value)).find(Boolean);
            if (found) {
              setUpi(found.upiId);
              toast('UPI ID read from your QR', 'positive');
            } else {
              setError("No UPI QR found in that picture. Try a screenshot of the QR from your UPI app's \"Receive money\" page.");
            }
          } catch {
            setError("That picture couldn't be read.");
          }
        }}
        testID="profile-upi-qr"
      />
      {upi && !upiErr ? (
        <Card style={{alignItems: 'center', marginTop: space.md}}>
          <Text variant="smallStrong">Your payment QR</Text>
          <View style={{padding: space.md, backgroundColor: '#FFFFFF', borderRadius: 12, marginTop: space.sm}}>
            <QRCode value={upiPayUrl('upi://pay', {upiId: upi.trim(), name: name.trim() || 'SplitMate'})} size={168} color="#1F3B2D" />
          </View>
          <Text variant="caption" tone="faint" align="center" style={{marginTop: space.sm}}>
            Friends can scan this with any UPI app to pay you.
          </Text>
        </Card>
      ) : null}
      <SectionTitle title="Default currency for new groups" />
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
        {SUPPORTED_CURRENCIES.slice(0, 10).map(c => (
          <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
        ))}
      </View>
      <SectionTitle title="Security" />
      <Card padded={false} style={{paddingHorizontal: space.sm}}>
        <ListRow icon={KeyRound} title={me.data?.has_password ? 'Change password' : 'Set a password'} subtitle="Signs you out on other devices" onPress={() => setPwSheet(true)} />
      </Card>
      <Sheet
        visible={pwSheet}
        onClose={() => setPwSheet(false)}
        title="Password"
        footer={
          <Button
            label="Save password"
            loading={pw.isLoading}
            disabled={newPw.length < 8}
            onPress={async () => {
              try {
                await changePassword({current_password: curPw || undefined, new_password: newPw}).unwrap();
                setPwSheet(false);
                setCurPw('');
                setNewPw('');
                toast('Password changed', 'positive');
              } catch (e) {
                setPwSheet(false);
                setError(errorMessage(e));
              }
            }}
          />
        }>
        {me.data?.has_password ? <TextField label="Current password" secureTextEntry value={curPw} onChangeText={setCurPw} /> : null}
        <TextField containerStyle={{marginTop: space.md}} label="New password" secureTextEntry value={newPw} onChangeText={setNewPw} hint="At least 8 characters." />
      </Sheet>
    </Screen>
  );
}

export function SettingsScreen() {
  const dispatch = useAppDispatch();
  const me = useMeQuery();
  const health = useHealthQuery();
  const [update] = useUpdateMeMutation();
  const [exportData, exportState] = useExportDataMutation();
  const [deleteAccount, deleteState] = useDeleteAccountMutation();
  const {preference, setPreference} = useThemePreference();
  const [server, setServer] = useState(apiUrl());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const prefs = me.data?.preferences ?? {};
  const pref = (k: string) => prefs[k] !== false;
  const setPref = async (k: string, v: boolean) => {
    try {
      const u = await update({preferences: {[k]: v}}).unwrap();
      dispatch(userUpdated(u));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen header={<Header title="Settings" />} keyboard>
      {error ? <Banner tone="negative" title={error} /> : null}
      <SectionTitle title="Notifications in the app" />
      <Card padded={false} style={{paddingHorizontal: space.md}}>
        <SwitchRow title="Expenses" subtitle="New, edited or cancelled expenses in your groups" value={pref('notify_expenses')} onChange={v => setPref('notify_expenses', v)} />
        <SwitchRow title="Repayments" subtitle="Requests, payments and confirmations involving you" value={pref('notify_repayments')} onChange={v => setPref('notify_repayments', v)} />
        <SwitchRow title="Groups" subtitle="People joining or leaving" value={pref('notify_groups')} onChange={v => setPref('notify_groups', v)} />
      </Card>
      <Text variant="caption" tone="faint" style={{marginTop: space.xs}}>
        Push notifications aren't set up in this version; you'll see these in the bell on the home screen.
      </Text>

      <SectionTitle title="Appearance" />
      <Segmented
        value={preference}
        onChange={setPreference}
        options={[
          {value: 'system', label: 'System'},
          {value: 'dark', label: 'Dark'},
          {value: 'light', label: 'Light'},
        ]}
      />

      <SectionTitle title="Your data" />
      <Card padded={false} style={{paddingHorizontal: space.sm}}>
        <ListRow
          icon={Download}
          title="Export my data"
          subtitle="Everything SplitMate holds about you, as JSON"
          right={exportState.isLoading ? <Text variant="small" tone="muted">Preparing…</Text> : undefined}
          onPress={async () => {
            try {
              const data = await exportData().unwrap();
              await Share.share({title: 'SplitMate data export', message: JSON.stringify(data, null, 2)});
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        />
        <ListRow icon={Trash2} title="Delete my account" subtitle="Removes your profile; shared group history stays for others as “Deleted user”" destructive onPress={() => setConfirmDelete(true)} />
      </Card>

      <SectionTitle title="Advanced" />
      <Card>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm}}>
          <Server size={16} color="#8C90AE" />
          <Text variant="smallStrong" tone="muted">
            Server {health.data ? `· v${health.data.version} ✓` : health.isError ? '· unreachable' : ''}
          </Text>
        </View>
        <TextField value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" />
        <View style={{flexDirection: 'row', gap: space.sm, marginTop: space.sm}}>
          <Button
            label="Save & sign out"
            variant="secondary"
            size="sm"
            disabled={!/^https?:\/\/\S+$/.test(server.trim()) || server.trim() === apiUrl()}
            onPress={async () => {
              await saveApiUrl(server.trim() === DEFAULT_API_URL ? null : server.trim());
              await signOut(dispatch);
            }}
          />
          <Button label="Reset" variant="ghost" size="sm" onPress={() => setServer(DEFAULT_API_URL)} />
        </View>
        <Text variant="caption" tone="faint" style={{marginTop: space.xs}}>
          Changing the server signs you out, because accounts live on the server.
        </Text>
      </Card>

      <Sheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete your account?"
        footer={
          <>
            <Button
              label="Delete forever"
              variant="danger"
              loading={deleteState.isLoading}
              disabled={!!me.data?.has_password && !password}
              onPress={async () => {
                try {
                  await deleteAccount({confirm: 'DELETE', password: password || undefined}).unwrap();
                  setConfirmDelete(false);
                  await clearSession();
                  dispatch(splitApi.util.resetApiState());
                  dispatch(signedOut());
                } catch (e) {
                  setConfirmDelete(false);
                  setError(errorMessage(e));
                }
              }}
            />
            <Button label="Keep my account" variant="secondary" onPress={() => setConfirmDelete(false)} />
          </>
        }>
        <Text variant="body" tone="muted">
          This can't be undone. Your profile, sign-in and personal expenses are deleted. Expenses shared with others stay in their groups under "Deleted user" so their balances remain correct.
        </Text>
        {me.data?.has_password ? (
          <TextField containerStyle={{marginTop: space.lg}} label="Your password" secureTextEntry value={password} onChangeText={setPassword} />
        ) : null}
      </Sheet>
    </Screen>
  );
}

export function PrivacyScreen() {
  return (
    <Screen header={<Header title="Privacy" />}>
      <Card style={{gap: space.md}}>
        <Text variant="heading">What SplitMate stores</Text>
        <Text variant="body" tone="muted">
          Your name, email (or Google account id), and the groups, expenses, items, shares and repayments you or your group members add. Optional: a UPI ID you choose to show to your groups.
        </Text>
        <Text variant="heading">Why</Text>
        <Text variant="body" tone="muted">
          Only to work out who owes whom and to show you the history behind every balance. No ads, no selling data, no tracking SDKs.
        </Text>
        <Text variant="heading">Receipts</Text>
        <Text variant="body" tone="muted">
          Receipt text is read on your phone. If you attach the photo to an expense, it's stored privately and shown only to members of that group through short-lived links.
        </Text>
        <Text variant="heading">Your controls</Text>
        <Text variant="body" tone="muted">
          Export everything as JSON, or delete your account, from Settings → Your data. Deleting keeps shared expenses intact for others, with your name replaced by "Deleted user".
        </Text>
        <Text variant="heading">Security</Text>
        <Text variant="body" tone="muted">
          Passwords are hashed with Argon2. Your session token is kept in Android's secure keystore. All traffic to the hosted server uses HTTPS.
        </Text>
      </Card>
    </Screen>
  );
}
