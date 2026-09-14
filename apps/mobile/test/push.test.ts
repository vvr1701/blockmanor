import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answerPushSoftAsk,
  syncPushRegistration,
  utcOffsetMinutes,
  watchPush,
} from '../src/services/push';
import { useMetaStore } from '../src/state/useMetaStore';
import { Platform, PermissionsAndroid } from './mocks/react-native';
import { firebaseMock, resetFirebaseMock } from './mocks/react-native-firebase';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetFirebaseMock();
  firebaseMock.configured = true;
  firebaseMock.callables['registerPush'] = () => ({ ok: true });
  PermissionsAndroid.__result = 'granted';
  PermissionsAndroid.__requests = [];
  Platform.OS = 'android';
  Platform.Version = 34;
  act(() => {
    useMetaStore.setState({
      pushOptIn: 'unasked',
      notificationPrefs: { dailyDrop: true, streakRisk: false },
    });
  });
});

afterEach(() => {
  Platform.OS = 'android';
  Platform.Version = 34;
});

describe('§8.7 push soft-ask answer (§0 v1.32(a,d))', () => {
  it('"Maybe later" records the answer and never shows the OS dialog', async () => {
    await answerPushSoftAsk(false);
    expect(useMetaStore.getState().pushOptIn).toBe('declined');
    expect(PermissionsAndroid.__requests).toHaveLength(0);
    expect(firebaseMock.calls).toHaveLength(0);
  });

  it('"Notify me" on Android 13+ asks POST_NOTIFICATIONS, then registers token, offset and prefs', async () => {
    await answerPushSoftAsk(true);
    expect(PermissionsAndroid.__requests).toStrictEqual(['android.permission.POST_NOTIFICATIONS']);
    expect(useMetaStore.getState().pushOptIn).toBe('granted');
    expect(firebaseMock.calls).toStrictEqual([
      {
        name: 'registerPush',
        data: {
          token: 'fcm-token-1',
          utcOffsetMinutes: utcOffsetMinutes(),
          dailyDrop: true,
          streakRisk: false,
        },
      },
    ]);
  });

  it('an OS refusal is recorded as declined and registers nothing', async () => {
    PermissionsAndroid.__result = 'denied';
    await answerPushSoftAsk(true);
    expect(useMetaStore.getState().pushOptIn).toBe('declined');
    expect(firebaseMock.calls).toHaveLength(0);
  });

  it('below Android 13 there is no runtime permission to ask', async () => {
    Platform.Version = 30;
    await answerPushSoftAsk(true);
    expect(PermissionsAndroid.__requests).toHaveLength(0);
    expect(useMetaStore.getState().pushOptIn).toBe('granted');
  });

  it('iOS uses the messaging permission and accepts provisional', async () => {
    Platform.OS = 'ios';
    firebaseMock.messagingAuth = 2;
    await answerPushSoftAsk(true);
    expect(useMetaStore.getState().pushOptIn).toBe('granted');
    firebaseMock.messagingAuth = 0;
    act(() => {
      useMetaStore.setState({ pushOptIn: 'unasked' });
    });
    await answerPushSoftAsk(true);
    expect(useMetaStore.getState().pushOptIn).toBe('declined');
  });
});

describe('§0 v1.32 registration and deep link', () => {
  it('never registers a player who has not opted in', async () => {
    await expect(syncPushRegistration()).resolves.toBe(false);
    expect(firebaseMock.calls).toHaveLength(0);
  });

  it('snaps the device offset onto the quarter-hour grid', () => {
    const at = (minutesBehindUtc: number) =>
      ({ getTimezoneOffset: () => minutesBehindUtc }) as unknown as Date;
    expect(utcOffsetMinutes(at(-330))).toBe(330); // India
    expect(utcOffsetMinutes(at(480))).toBe(-480); // US Pacific
    expect(utcOffsetMinutes(at(0))).toBe(0);
  });

  it('opens the Daily gate from a cold-start or background notification, and re-registers on token refresh', async () => {
    act(() => {
      useMetaStore.setState({ pushOptIn: 'granted' });
    });
    firebaseMock.initialNotification = { data: { route: 'daily' } };
    const onDaily = vi.fn();
    watchPush(onDaily);
    await flush();
    expect(onDaily).toHaveBeenCalledTimes(1);

    firebaseMock.openedHandlers[0]?.({ data: { route: 'somewhere-else' } });
    expect(onDaily).toHaveBeenCalledTimes(1);
    firebaseMock.openedHandlers[0]?.({ data: { route: 'daily' } });
    expect(onDaily).toHaveBeenCalledTimes(2);

    firebaseMock.tokenRefreshHandlers[0]?.('fcm-token-2');
    await flush();
    expect(firebaseMock.calls.at(-1)?.data).toMatchObject({ token: 'fcm-token-2' });
  });
});
