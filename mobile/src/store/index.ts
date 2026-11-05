import {configureStore, combineReducers, createSlice, type PayloadAction} from '@reduxjs/toolkit';
import {TypedUseSelectorHook, useDispatch, useSelector} from 'react-redux';
import {persistStore, persistReducer, createTransform, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER} from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {setupListeners} from '@reduxjs/toolkit/query';
import NetInfo from '@react-native-community/netinfo';
import {AppState} from 'react-native';
import {splitApi} from '../api/endpoints';
import type {User} from '../api/types';
import {draftsReducer, persistDrafts} from '../features/expenses/draft';

type AuthStatus = 'restoring' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  user: User | null;
}

const authSlice = createSlice({
  name: 'auth',
  initialState: {status: 'restoring', user: null} as AuthState,
  reducers: {
    signedIn(state, action: PayloadAction<User>) {
      state.status = 'signedIn';
      state.user = action.payload;
    },
    signedOut(state) {
      state.status = 'signedOut';
      state.user = null;
    },
    userUpdated(state, action: PayloadAction<User>) {
      state.user = action.payload;
    },
  },
});

export const {signedIn, signedOut, userUpdated} = authSlice.actions;

// The API cache and the signed-in profile persist: the app opens instantly with
// the last data, online or not, and refreshes in the background. Drafts persist
// on their own (an unfinalised bill is data, not a cache), so they stay out.
const rootReducer = combineReducers({
  auth: authSlice.reducer,
  drafts: draftsReducer,
  [splitApi.reducerPath]: splitApi.reducer,
});

/**
 * redux-persist saves the request bookkeeping too: close the app while a
 * request is in flight and the next launch rehydrates a query stuck in
 * "pending" that nothing will ever finish - the home screen then sits on
 * "Loading your balances" forever. Drop half-finished requests on the way
 * in from disk; RTK Query refetches anything without a result on its own.
 */
const dropHalfFinishedRequests = createTransform<any, any>(
  state => state,
  state => {
    if (!state || typeof state !== 'object') {
      return state;
    }
    const s = state as {
      queries?: Record<string, {status?: string} | undefined>;
      mutations?: Record<string, Record<string, {status?: string} | undefined>>;
    };
    const queries = s.queries ? {...s.queries} : s.queries;
    if (queries) {
      for (const k of Object.keys(queries)) {
        if (queries[k]?.status === 'pending') {
          delete queries[k];
        }
      }
    }
    const mutations = s.mutations ? {...s.mutations} : s.mutations;
    if (mutations) {
      for (const k of Object.keys(mutations)) {
        const entries = mutations[k];
        if (entries && typeof entries === 'object') {
          for (const rk of Object.keys(entries)) {
            if (entries[rk]?.status === 'pending') {
              delete entries[rk];
            }
          }
        }
      }
    }
    return {...s, queries, mutations};
  },
  {whitelist: ['splitApi']},
);

// The transform's typing fights persistReducer's generics (redux-persist and
// @reduxjs/toolkit carry unrelated copies of redux's types), so the config is
// left untyped and the store's shape comes from the reducer itself, as before.
const persistedReducer = persistReducer(
  {key: 'splitmate', storage: AsyncStorage, version: 1, blacklist: ['drafts'], transforms: [dropHalfFinishedRequests]} as any,
  rootReducer,
);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: gdm =>
    gdm({
      serializableCheck: {ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER]},
    }).concat(splitApi.middleware),
});

// setupListeners' default handler needs a browser window (focus + online
// events), which React Native doesn't have: bridge NetInfo and AppState to
// the same actions instead. Result: the moment internet returns - or the app
// comes back to the front (a tapped notification) - every subscribed query
// refetches on its own, on top of the persisted cache it's already showing.
let syncNowFn: () => void = () => {};
setupListeners(store.dispatch, (dispatch, actions) => {
  syncNowFn = () => dispatch(actions.onOnline());
  const net = NetInfo.addEventListener(s => {
    const off = !(s.isConnected ?? false) || s.isInternetReachable === false;
    if (off) {
      dispatch(actions.onOffline());
    } else {
      dispatch(actions.onOnline());
    }
  });
  const appState = AppState.addEventListener('change', st => {
    if (st === 'active') {
      dispatch(actions.onFocus());
    }
  });
  return () => {
    net();
    appState.remove();
  };
});

/** Refetch everything now (the offline banner's Reload button). Keeps the cache. */
export function syncNow(): void {
  syncNowFn();
}

export const persistor = persistStore(store);

let lastDrafts = store.getState().drafts.byId;
store.subscribe(() => {
  const s = store.getState().drafts;
  if (s.loaded && s.byId !== lastDrafts) {
    lastDrafts = s.byId;
    persistDrafts(s.byId);
  }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
