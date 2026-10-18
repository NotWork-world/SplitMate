import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {createContext, useContext, useEffect, useState} from 'react';
import {ThemePreference} from './design/theme';

const KEY = 'splitmate.theme';
const Ctx = createContext<{preference: ThemePreference; setPreference: (p: ThemePreference) => void}>({
  preference: 'light',
  setPreference: () => {},
});

export function ThemePreferenceProvider({children}: {children: (p: ThemePreference) => React.ReactNode}) {
  // Light (cream & forest) is the signature look; dark and system are options in Settings.
  const [preference, setPref] = useState<ThemePreference>('light');
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then(v => {
        if (v === 'dark' || v === 'light' || v === 'system') {
          setPref(v);
        }
      })
      .catch(() => {});
  }, []);
  const setPreference = (p: ThemePreference) => {
    setPref(p);
    AsyncStorage.setItem(KEY, p).catch(() => {});
  };
  return <Ctx.Provider value={{preference, setPreference}}>{children(preference)}</Ctx.Provider>;
}

export const useThemePreference = () => useContext(Ctx);
