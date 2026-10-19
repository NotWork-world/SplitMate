import {PermissionsAndroid, Platform} from 'react-native';
import {getApps} from '@react-native-firebase/app';
import {
  deleteToken,
  getInitialNotification,
  getMessaging,
  getToken,
  onNotificationOpenedApp,
  onTokenRefresh,
} from '@react-native-firebase/messaging';
import {api} from '../api/client';

/**
 * Phone notifications (Firebase Cloud Messaging). Everything here is best effort: without
 * google-services.json in the build there's no Firebase app, and notifications simply stay
 * in the app's own list.
 */
let registered: string | null = null;
let stopRefresh: (() => void) | null = null;

function available() {
  try {
    return getApps().length > 0;
  } catch {
    return false;
  }
}

async function send(token: string) {
  await api.post('/me/push-token', {token, platform: Platform.OS === 'ios' ? 'ios' : 'android'});
  registered = token;
}

/** Ask once for permission (Android 13+), then tell the server where to reach this phone. */
export async function registerForPush(): Promise<void> {
  if (!available()) {
    return;
  }
  try {
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      if (r !== PermissionsAndroid.RESULTS.GRANTED) {
        return;
      }
    }
    const messaging = getMessaging();
    await send(await getToken(messaging));
    stopRefresh?.();
    stopRefresh = onTokenRefresh(messaging, t => {
      send(t).catch(() => undefined);
    });
  } catch {
    // No Play Services, offline, or Firebase not set up: in-app notifications still work.
  }
}

/** On sign-out: this phone stops getting the previous person's notifications. */
export async function unregisterPush(): Promise<void> {
  stopRefresh?.();
  stopRefresh = null;
  const token = registered;
  registered = null;
  if (!token || !available()) {
    return;
  }
  try {
    await api.post('/me/push-token/remove', {token});
    await deleteToken(getMessaging());
  } catch {
    // best effort
  }
}

/** The screen a tapped notification should open, as an app link. */
export function linkFor(m: {data?: Record<string, unknown>} | null): string | null {
  const d = m?.data ?? {};
  if (d.entity_type === 'repayment' && d.entity_id) {
    return `splitmate://repayment/${d.entity_id}`;
  }
  if (d.entity_type === 'expense' && d.entity_id) {
    return `splitmate://expense/${d.entity_id}`;
  }
  return null;
}

export async function initialNotificationLink(): Promise<string | null> {
  if (!available()) {
    return null;
  }
  try {
    return linkFor(await getInitialNotification(getMessaging()));
  } catch {
    return null;
  }
}

export function onNotificationTap(open: (url: string) => void): () => void {
  if (!available()) {
    return () => undefined;
  }
  try {
    return onNotificationOpenedApp(getMessaging(), m => {
      const url = linkFor(m);
      if (url) {
        open(url);
      }
    });
  } catch {
    return () => undefined;
  }
}
