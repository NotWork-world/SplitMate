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
  // Open instantly with the cached profile; validate against the server in the
  // background. Only an explicit "session expired" (401) signs the person out -
  // a sleeping server or no internet keeps the app usable offline.
  const cachedIn = await signInFromCache();
  if (!cachedIn) {
    try {
      if (await ensureAccessToken()) {
        const user = await api.get<User>('/me');
        await cacheUser(user);
        dispatch(signedIn(user));
        registerForPush();
        return;
      }
    } catch {
      // Offline, slow or a server error with nothing cached: the auth screens
      // let the person retry; only the 401 path above clears the stored token.
    }
    dispatch(signedOut());
    return;
  }
  // Signed in from cache: refresh the profile quietly (also wakes the token).
  (async () => {
    try {
      if (await ensureAccessToken()) {
        const user = await api.get<User>('/me');
        await cacheUser(user);
        dispatch(signedIn(user));
        registerForPush();
      }
    } catch {
      // Still offline or the free server waking: the cached session stands.
    }
  })();
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
