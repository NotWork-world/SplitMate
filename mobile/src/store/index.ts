import {configureStore, createSlice, PayloadAction} from '@reduxjs/toolkit';
import {TypedUseSelectorHook, useDispatch, useSelector} from 'react-redux';
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

export const store = configureStore({
  reducer: {
    auth: authSlice.reducer,
    drafts: draftsReducer,
    [splitApi.reducerPath]: splitApi.reducer,
  },
  middleware: gdm => gdm().concat(splitApi.middleware),
});

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
