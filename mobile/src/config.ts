import AsyncStorage from '@react-native-async-storage/async-storage';

// The hosted API (render.yaml). Debug builds talk to a server on the computer
// (the Android emulator reaches the host at 10.0.2.2). Either can be changed in
// Settings → Advanced → Server, which is saved on the phone.
export const DEFAULT_API_URL = __DEV__ ? 'http://10.0.2.2:8000' : 'https://splitmate-api-ya67.onrender.com';
const KEY = 'splitmate.apiUrl';

let current = DEFAULT_API_URL;

export function apiUrl(): string {
  return current;
}

export async function loadApiUrl(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved) {
      current = saved;
    }
  } catch {
    // keep the default
  }
  return current;
}

export async function saveApiUrl(url: string | null): Promise<void> {
  current = url ? url.replace(/\/+$/, '') : DEFAULT_API_URL;
  if (url) {
    await AsyncStorage.setItem(KEY, current);
  } else {
    await AsyncStorage.removeItem(KEY);
  }
}

export const APP_VERSION = require('../package.json').version as string;
