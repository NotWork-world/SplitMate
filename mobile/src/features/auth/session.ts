import AsyncStorage from '@react-native-async-storage/async-storage';
import {GoogleSignin} from '@react-native-google-signin/google-signin';
import {api, clearSession, currentRefreshToken, ensureAccessToken, loadRefreshToken, saveSession, setSignedOutHandler} from '../../api/client';
import {splitApi} from '../../api/endpoints';
import type {TokenOut, User} from '../../api/types';
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
  try {
    if (await ensureAccessToken()) {
      const user = await api.get<User>('/me');
      await cacheUser(user);
      dispatch(signedIn(user));
      return;
    }
  } catch (e: any) {
    // Offline at launch with a stored session: stay signed in; screens show offline states and retry.
    if (e?.code === 'offline' || e?.code === 'timeout') {
      const cached = await AsyncStorage.getItem(USER_KEY).catch(() => null);
      if (cached) {
        dispatch(signedIn(JSON.parse(cached) as User));
        return;
      }
    }
  }
  dispatch(signedOut());
}

export async function completeSignIn(dispatch: AppDispatch, tokens: TokenOut) {
  await saveSession(tokens);
  await cacheUser(tokens.user);
  dispatch(splitApi.util.resetApiState());
  dispatch(signedIn(tokens.user));
}

export async function signOut(dispatch: AppDispatch) {
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
