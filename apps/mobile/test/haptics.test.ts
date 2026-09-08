/**
 * `game/haptics.ts`'s §12.1 mute gate. Unlike `playCue`, haptics ship for
 * real today (no missing-asset block) — muting has to actually prevent the
 * real `expo-haptics` call, and this is directly observable: spy on the
 * REAL (mocked) `expo-haptics` module and assert it is never reached while
 * `hapticsEnabled: false`, same idiom `dragLayer.render.test.tsx` /
 * `juiceLayer.render.test.tsx` already use for the haptic calls themselves.
 */
import * as ExpoHaptics from 'expo-haptics';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { impactAsync, notificationAsync, selectionAsync } from '../src/game/haptics';
import { useMetaStore } from '../src/state/useMetaStore';

beforeEach(() => {
  useMetaStore.setState({ hapticsEnabled: true });
  vi.restoreAllMocks();
});

describe('game/haptics.ts (PRD §12.1 — "actually silences its channel")', () => {
  it('enabled (the default): impactAsync reaches the real expo-haptics call', async () => {
    const spy = vi.spyOn(ExpoHaptics, 'impactAsync');
    await impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light);
    expect(spy).toHaveBeenCalledWith(ExpoHaptics.ImpactFeedbackStyle.Light);
  });

  it('muted: impactAsync is NOT reached', async () => {
    useMetaStore.getState().setHapticsEnabled(false);
    const spy = vi.spyOn(ExpoHaptics, 'impactAsync');
    await impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light);
    expect(spy).not.toHaveBeenCalled();
  });

  it('muted: notificationAsync is NOT reached', async () => {
    useMetaStore.getState().setHapticsEnabled(false);
    const spy = vi.spyOn(ExpoHaptics, 'notificationAsync');
    await notificationAsync(ExpoHaptics.NotificationFeedbackType.Success);
    expect(spy).not.toHaveBeenCalled();
  });

  it('muted: selectionAsync is NOT reached', async () => {
    useMetaStore.getState().setHapticsEnabled(false);
    const spy = vi.spyOn(ExpoHaptics, 'selectionAsync');
    await selectionAsync();
    expect(spy).not.toHaveBeenCalled();
  });

  it('re-enabling haptics makes the channel reachable again — a live read, not a cached snapshot', async () => {
    useMetaStore.getState().setHapticsEnabled(false);
    const spy = vi.spyOn(ExpoHaptics, 'selectionAsync');
    await selectionAsync();
    expect(spy).not.toHaveBeenCalled();

    useMetaStore.getState().setHapticsEnabled(true);
    await selectionAsync();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
