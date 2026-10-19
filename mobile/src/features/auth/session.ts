import AsyncStorage from '@react-native-async-storage/async-storage';
import {GoogleSignin} from '@react-native-google-signin/google-signin';
import {api, clearSession, currentRefreshToken, ensureAccessToken, loadRefreshToken, saveSession, setSignedOutHandler} from '../../api/client';
import {splitApi} from '../../api/endpoints';
import type {TokenOut, User} from '../../api/types';
import {registerForPush, unregisterPush} from '../../push/push';
import {AppDispatch, signedIn, signedOut} from '../../store';

// Profile only (name, avatar colour): no balances or tokens are cached in plain storage.
const USER_KEY = 'splitmate.user';

async function cacheUser(user: User | null) {
  try {
    if (user) {
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      await AsyncStorage.removeItem(USER_KEY);
    }
  } catch {
    // best effort
  }
}

export async function restoreSession(dispatch: AppDispatch) {
  setSignedOutHandler(() => {
    cacheUser(null);
    dispatch(splitApi.util.resetApiState());
    dispatch(signedOut());
  });
  const token = await loadRefreshToken();
  if (!token) {
    dispatch(signedOut());
    return;
  }
  const signInFromCache = async () => {
    const cached = await AsyncStorage.getItem(USER_KEY).catch(() => null);
    if (cached) {
      dispatch(signedIn(JSON.parse(cached) as User));
      return true;
    }
    return false;
  };
  try {
    if (await ensureAccessToken()) {
      const user = await api.get<User>('/me');
      await cacheUser(user);
      dispatch(signedIn(user));
      registerForPush();
      return;
    }
    // The refresh didn't succeed but the session wasn't rejected (the token is still stored):
    // a server hiccup or the free server waking up. Stay signed in; screens retry.
    if (currentRefreshToken() && (await signInFromCache())) {
      return;
    }
  } catch {
    // Offline, slow or a server error at launch: only "session expired" (401) signs you out,
    // and that path clears the stored token, which is what we check here.
    if (currentRefreshToken() && (await signInFromCache())) {
      return;
    }
  }
  dispatch(signedOut());
}

export async function completeSignIn(dispatch: AppDispatch, tokens: TokenOut) {
  await saveSession(tokens);
  await cacheUser(tokens.user);
  dispatch(splitApi.util.resetApiState());
  dispatch(signedIn(tokens.user));
  registerForPush();
}

export async function signOut(dispatch: AppDispatch) {
  await unregisterPush();
  const token = currentRefreshToken();
  if (token) {
    try {
      await api.post('/auth/logout', {refresh_token: token});
    } catch {
      // Still sign out locally.
    }
  }
  try {
    await GoogleSignin.signOut();
  } catch {
    // Not signed in with Google.
  }
  await clearSession();
  await cacheUser(null);
  dispatch(splitApi.util.resetApiState());
  dispatch(signedOut());
}
