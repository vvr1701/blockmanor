/**
 * The haptics seam — PRD §12.1 ("haptics toggle... actually silences its
 * channel") and §7.4 (every juice moment's haptic column). One gate, not six:
 * before this file, `JuiceLayer.tsx` and `DragLayer.tsx` each called
 * `expo-haptics` directly (six call sites total) — a per-call-site mute
 * check would be five more places to keep in sync than one shared function.
 * Same shape as `game/sfx.ts`'s `playCue`: callers keep calling
 * `Haptics.impactAsync(...)` etc, unchanged, just against this module
 * instead of `expo-haptics` directly.
 *
 * Unlike `playCue`, this is NOT a no-op — haptics ship today (no missing
 * asset blocks them the way §15.1 blocks audio), so muting here has to
 * actually prevent the real `expo-haptics` call, not just exist as a future
 * seam.
 */
import * as ExpoHaptics from 'expo-haptics';
import { useMetaStore } from '../state/useMetaStore';

export { ImpactFeedbackStyle, NotificationFeedbackType } from 'expo-haptics';

function hapticsEnabled(): boolean {
  return useMetaStore.getState().hapticsEnabled;
}

export async function impactAsync(style: ExpoHaptics.ImpactFeedbackStyle): Promise<void> {
  if (!hapticsEnabled()) return;
  await ExpoHaptics.impactAsync(style);
}

export async function notificationAsync(type: ExpoHaptics.NotificationFeedbackType): Promise<void> {
  if (!hapticsEnabled()) return;
  await ExpoHaptics.notificationAsync(type);
}

export async function selectionAsync(): Promise<void> {
  if (!hapticsEnabled()) return;
  await ExpoHaptics.selectionAsync();
}
