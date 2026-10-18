import React, {createContext, useContext, useMemo} from 'react';
import {useColorScheme} from 'react-native';
import {darkColors, lightColors, ThemeColors} from './tokens';

export type ThemePreference = 'system' | 'dark' | 'light';

interface Theme {
  colors: ThemeColors;
  dark: boolean;
}

const ThemeContext = createContext<Theme>({colors: darkColors, dark: true});

export function ThemeProvider({preference, children}: {preference: ThemePreference; children: React.ReactNode}) {
  const system = useColorScheme();
  const dark = preference === 'system' ? system !== 'light' : preference === 'dark';
  const value = useMemo(() => ({colors: dark ? darkColors : lightColors, dark}), [dark]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
