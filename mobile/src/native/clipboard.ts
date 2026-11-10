import {NativeModules, Platform} from 'react-native';

/**
 * Copies text to the Android clipboard. Returns false instead of throwing when the
 * native module isn't there (iOS, tests), so callers can fall back to the selectable
 * text on screen.
 */
export async function copyText(text: string): Promise<boolean> {
  const mod = Platform.OS === 'android' ? NativeModules.SplitMateClipboard : null;
  if (!mod) {
    return false;
  }
  try {
    await mod.copy(text);
    return true;
  } catch {
    return false;
  }
}
