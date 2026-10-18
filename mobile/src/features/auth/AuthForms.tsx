import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {GoogleSignin, statusCodes} from '@react-native-google-signin/google-signin';
import {api, ApiError} from '../../api/client';
import {useHealthQuery} from '../../api/endpoints';
import type {TokenOut} from '../../api/types';
import {Accent, Banner, Button, Card, Header, LogoMark, Screen, Text, TextField, space, useTheme} from '../../design';
import type {AuthScreen} from '../../navigation/types';
import {useAppDispatch} from '../../store';
import {completeSignIn} from './session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Shared sign-in / sign-up frame: logo, headline, then the form on a glass card. */
function AuthLayout({title, subtitle, children}: {title: React.ReactNode; subtitle: string; children: React.ReactNode}) {
  return (
    <Screen header={<Header />} keyboard>
      <View style={{alignItems: 'center', marginTop: space.sm}}>
        <View style={{backgroundColor: '#DCE3D1', padding: 12, borderRadius: 24}}>
          <LogoMark size={60} framed />
        </View>
        <Text variant="hero" align="center" style={{marginTop: space.lg, alignSelf: 'stretch'}}>
          {title}
        </Text>
        <Text variant="body" tone="muted" align="center" style={{marginTop: space.xs, maxWidth: 320}}>
          {subtitle}
        </Text>
      </View>
      <Card strong style={{marginTop: space.xl, gap: space.lg, padding: space.xl}}>
        {children}
      </Card>
    </Screen>
  );
}

function OrDivider() {
  const {colors} = useTheme();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: space.md}}>
      <View style={{flex: 1, height: 1, backgroundColor: colors.border}} />
      <Text variant="caption" tone="faint">
        OR
      </Text>
      <View style={{flex: 1, height: 1, backgroundColor: colors.border}} />
    </View>
  );
}

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
    <AuthLayout title={<>Welcome <Accent>back</Accent></>} subtitle="Sign in to see your groups, balances and anything waiting for you.">
      {error ? <Banner tone="negative" title={error} /> : null}
      <View style={{gap: space.lg}}>
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
        <OrDivider />
        <GoogleButton onError={setError} />
      </View>
      <SwitchLink text="New to SplitMate?" action="Create an account" onPress={() => navigation.replace('SignUp')} />
    </AuthLayout>
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
    <AuthLayout title={<>Create your <Accent>account</Accent></>} subtitle="Free, no ads. Your friends don't need the app to be in your group.">
      {error ? <Banner tone="negative" title={error} /> : null}
      <View style={{gap: space.lg}}>
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
        <OrDivider />
        <GoogleButton onError={setError} />
        <Text variant="small" tone="faint" align="center">
          By continuing you agree to SplitMate's privacy policy (Settings → Privacy).
        </Text>
      </View>
      <SwitchLink text="Already have an account?" action="Sign in" onPress={() => navigation.replace('SignIn')} />
    </AuthLayout>
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
