import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import {
  getInitialNotification,
  getMessaging,
  getToken,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';
import { useMetaStore } from '../state/useMetaStore';
import { isFirebaseConfigured, recordError } from './firebase';

/**
 * §8.7 push, client half (PRD §0 v1.32). The soft-ask decides; this asks the OS
 * and keeps the server's copy of token, UTC offset and §12.1 prefs current.
 */

/** RNFB `AuthorizationStatus`: AUTHORIZED = 1, PROVISIONAL = 2. */
const AUTHORIZED = 1;
const PROVISIONAL = 2;
const QUARTER_HOUR = 15;
const ANDROID_RUNTIME_PERMISSION_API = 33;

/** The OS permission dialog — shown only after the soft-ask's "Notify me". */
export async function requestPushPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      if (Number(Platform.Version) < ANDROID_RUNTIME_PERMISSION_API) return true;
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
    const status = await requestPermission(getMessaging());
    return status === AUTHORIZED || status === PROVISIONAL;
  } catch (error) {
    recordError(error, 'push_permission');
    return false;
  }
}

/**
 * The device's UTC offset, on the server's quarter-hour grid (§0 v1.32(b)).
 * `getTimezoneOffset` is minutes BEHIND UTC, hence the sign flip.
 */
export function utcOffsetMinutes(date: Date = new Date()): number {
  return Math.round(-date.getTimezoneOffset() / QUARTER_HOUR) * QUARTER_HOUR || 0;
}

/**
 * §0 v1.32(a): (re-)register token + offset + prefs. Called after opt-in, on
 * every app open, on token refresh and on a preference change. A no-op unless
 * the player said yes. Never throws — a failed registration retries next open.
 */
export async function syncPushRegistration(token?: string): Promise<boolean> {
  const { pushOptIn, notificationPrefs } = useMetaStore.getState();
  if (pushOptIn !== 'granted' || !isFirebaseConfigured()) return false;
  try {
    const call = httpsCallable(getFunctions(), 'registerPush');
    await call({
      token: token ?? (await getToken(getMessaging())),
      utcOffsetMinutes: utcOffsetMinutes(),
      dailyDrop: notificationPrefs.dailyDrop,
      streakRisk: notificationPrefs.streakRisk,
    });
    return true;
  } catch (error) {
    recordError(error, 'push_register');
    return false;
  }
}

/** The soft-ask's answer: record it, and on yes ask the OS then register. */
export async function answerPushSoftAsk(accepted: boolean): Promise<void> {
  const meta = useMetaStore.getState();
  if (!accepted) {
    meta.setPushOptIn('declined');
    return;
  }
  const granted = await requestPushPermission();
  meta.setPushOptIn(granted ? 'granted' : 'declined');
  if (granted) await syncPushRegistration();
}

const isDailyRoute = (
  message: { data?: { [key: string]: string | object } | undefined } | null,
): boolean => message?.data?.['route'] === 'daily';

/**
 * §8.7 "All notifications deep-link to the Daily gate", from a cold start or
 * from the background; also re-registers when FCM rotates the token. Returns
 * an unsubscribe.
 */
export function watchPush(onOpenDaily: () => void): () => void {
  if (!isFirebaseConfigured()) return () => undefined;
  const messaging = getMessaging();
  void getInitialNotification(messaging).then((m) => {
    if (isDailyRoute(m)) onOpenDaily();
  });
  const offOpened = onNotificationOpenedApp(messaging, (m) => {
    if (isDailyRoute(m)) onOpenDaily();
  });
  const offToken = onTokenRefresh(messaging, (token) => void syncPushRegistration(token));
  return () => {
    offOpened();
    offToken();
  };
}
