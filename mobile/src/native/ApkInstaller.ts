import {NativeModules, Platform} from 'react-native';

/**
 * Hands a downloaded update APK (in app cache) to Android's package installer.
 * Returns false when the platform isn't Android or the module is missing, so
 * callers can fall back to opening the release page in a browser.
 */
export async function installApk(path: string): Promise<void> {
  const mod = (NativeModules as {ApkInstaller?: {install: (path: string) => Promise<void>}}).ApkInstaller;
  if (Platform.OS !== 'android' || !mod) {
    throw new Error('Updates install through the store on this platform.');
  }
  await mod.install(path);
}
