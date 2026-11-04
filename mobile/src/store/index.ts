import {configureStore, combineReducers, createSlice, type PayloadAction} from '@reduxjs/toolkit';
import {TypedUseSelectorHook, useDispatch, useSelector} from 'react-redux';
import {persistStore, persistReducer, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER} from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {setupListeners} from '@reduxjs/toolkit/query';
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

const persistedReducer = persistReducer(
  {key: 'splitmate', storage: AsyncStorage, version: 1, blacklist: ['drafts']},
  rootReducer,
);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: gdm =>
    gdm({
      serializableCheck: {ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER]},
    }).concat(splitApi.middleware),
});

// When the internet comes back (NetInfo), every subscribed query refetches.
setupListeners(store.dispatch);

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
