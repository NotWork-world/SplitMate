import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {GoogleSignin, statusCodes} from '@react-native-google-signin/google-signin';
import {api, ApiError} from '../../api/client';
import {useHealthQuery} from '../../api/endpoints';
import type {TokenOut} from '../../api/types';
import {Banner, Button, Header, Screen, Text, TextField, Wordmark, space, useTheme} from '../../design';
import type {AuthScreen} from '../../navigation/types';
import {useAppDispatch} from '../../store';
import {completeSignIn} from './session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function GoogleButton({onError}: {onError: (m: string | null) => void}) {
  const dispatch = useAppDispatch();
  const health = useHealthQuery();
  const [busy, setBusy] = useState(false);
  const clientId = health.data?.features.google_web_client_id;
  const available = !!clientId;

  const go = async () => {
    if (!clientId) {
      return;
    }
    onError(null);
    setBusy(true);
    try {
      GoogleSignin.configure({webClientId: clientId});
      await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog: true});
      const res: any = await GoogleSignin.signIn();
      if (res?.type === 'cancelled') {
        return;
      }
      const idToken = res?.data?.idToken ?? res?.idToken;
      if (!idToken) {
        throw new Error('no token');
      }
      const tokens = await api.post<TokenOut>('/auth/google', {id_token: idToken});
      await completeSignIn(dispatch, tokens);
    } catch (e: any) {
      if (e?.code === statusCodes?.SIGN_IN_CANCELLED) {
        return;
      }
      onError(e instanceof ApiError ? e.message : "Google sign-in didn't work on this device. Use email instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{gap: space.xs}}>
      <Button label="Continue with Google" variant="secondary" onPress={go} loading={busy} disabled={!available} />
      {!available && !health.isLoading ? (
        <Text variant="small" tone="faint" align="center">
          {health.isError ? "Can't reach the server right now." : "Google sign-in isn't set up on this server yet."}
        </Text>
      ) : null}
    </View>
  );
}

export function SignInScreen({navigation}: AuthScreen<'SignIn'>) {
  const dispatch = useAppDispatch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const emailErr = touched && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null;

  const submit = async () => {
    setTouched(true);
    if (!EMAIL_RE.test(email.trim()) || !password) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tokens = await api.post<TokenOut>('/auth/login', {email: email.trim(), password});
      await completeSignIn(dispatch, tokens);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<Header />} keyboard>
      <Wordmark size={22} />
      <Text variant="title" style={{marginTop: space.xl}}>
        Welcome back
      </Text>
      <Text variant="body" tone="muted" style={{marginTop: space.xs, marginBottom: space.xl}}>
        Sign in to see your groups and balances.
      </Text>
      {error ? <Banner tone="negative" title={error} /> : null}
      <View style={{gap: space.lg, marginTop: space.md}}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          error={emailErr}
          testID="signin-email"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          error={touched && !password ? 'Enter your password.' : null}
          onSubmitEditing={submit}
          testID="signin-password"
        />
        <Button label="Sign in" size="lg" onPress={submit} loading={busy} testID="signin-submit" />
        <GoogleButton onError={setError} />
        <SwitchLink text="New to SplitMate?" action="Create an account" onPress={() => navigation.replace('SignUp')} />
      </View>
    </Screen>
  );
}

export function SignUpScreen({navigation}: AuthScreen<'SignUp'>) {
  const dispatch = useAppDispatch();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const errs = {
    name: touched && !name.trim() ? 'Tell your friends who you are.' : null,
    email: touched && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null,
    password: touched && password.length < 8 ? 'Use at least 8 characters.' : null,
  };

  const submit = async () => {
    setTouched(true);
    if (!name.trim() || !EMAIL_RE.test(email.trim()) || password.length < 8) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tokens = await api.post<TokenOut>('/auth/register', {
        email: email.trim(),
        password,
        display_name: name.trim(),
      });
      await completeSignIn(dispatch, tokens);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<Header />} keyboard>
      <Wordmark size={22} />
      <Text variant="title" style={{marginTop: space.xl}}>
        Create your account
      </Text>
      <Text variant="body" tone="muted" style={{marginTop: space.xs, marginBottom: space.xl}}>
        Free, no ads. Your friends don't need the app to be in a group.
      </Text>
      {error ? <Banner tone="negative" title={error} /> : null}
      <View style={{gap: space.lg, marginTop: space.md}}>
        <TextField label="Your name" value={name} onChangeText={setName} autoComplete="name" error={errs.name} testID="signup-name" />
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          error={errs.email}
          testID="signup-email"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password-new"
          hint="At least 8 characters."
          error={errs.password}
          testID="signup-password"
        />
        <Button label="Create account" size="lg" onPress={submit} loading={busy} testID="signup-submit" />
        <GoogleButton onError={setError} />
        <Text variant="small" tone="faint" align="center">
          By continuing you agree to SplitMate's privacy policy (Settings → Privacy).
        </Text>
        <SwitchLink text="Already have an account?" action="Sign in" onPress={() => navigation.replace('SignIn')} />
      </View>
    </Screen>
  );
}

function SwitchLink({text, action, onPress}: {text: string; action: string; onPress: () => void}) {
  const {colors} = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={{alignItems: 'center', paddingVertical: space.md}}>
      <Text variant="small" tone="muted">
        {text} <Text variant="smallStrong" color={colors.accentText}>{action}</Text>
      </Text>
    </Pressable>
  );
}
