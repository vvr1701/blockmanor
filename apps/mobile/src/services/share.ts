import Share, { Social } from 'react-native-share';
import { track } from './analytics';

/**
 * §8.7 "Native share sheet; WhatsApp prioritized on Android" (§0 v1.31(a)).
 *
 * WhatsApp first: a direct WhatsApp share when asked. If WhatsApp is missing or
 * refuses, the native sheet opens instead, so the button is never a dead end
 * (§12.9). A player dismissing either is not an error and fires no
 * `share_complete`.
 */

export type ShareChannel = 'whatsapp' | 'sheet';

export interface ShareCardPayload {
  /** PNG, base64 without the data-URL prefix; null when it could not be drawn. */
  base64: string | null;
  message: string;
}

function options(payload: ShareCardPayload) {
  return {
    message: payload.message,
    ...(payload.base64
      ? {
          url: `data:image/png;base64,${payload.base64}`,
          type: 'image/png',
          filename: 'block-manor',
        }
      : {}),
  };
}

async function openSheet(payload: ShareCardPayload): Promise<boolean> {
  try {
    await Share.open({ ...options(payload), failOnCancel: true });
    track('share_complete', { channel: 'sheet' });
    return true;
  } catch {
    return false;
  }
}

/** Returns whether the share left the app. */
export async function shareDailyCard(
  payload: ShareCardPayload,
  preferred: ShareChannel,
): Promise<boolean> {
  track('share_tap', { surface: 'daily_result' });
  if (preferred === 'sheet') return openSheet(payload);
  try {
    await Share.shareSingle({ ...options(payload), social: Social.Whatsapp });
    track('share_complete', { channel: 'whatsapp' });
    return true;
  } catch {
    return openSheet(payload);
  }
}
