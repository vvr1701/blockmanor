import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/analytics', () => ({ track: vi.fn() }));

import { track } from '../src/services/analytics';
import { shareDailyCard } from '../src/services/share';
import { resetShareMock, shareMock } from './mocks/react-native-share';

const trackMock = vi.mocked(track);
const payload = { base64: 'iVBORw0K', message: '8,420 · Top 11% · Block Manor' };

beforeEach(() => {
  trackMock.mockClear();
  resetShareMock();
});

describe('§8.7 shareDailyCard (§0 v1.31(a))', () => {
  it('shares the PNG straight to WhatsApp and reports the channel', async () => {
    await expect(shareDailyCard(payload, 'whatsapp')).resolves.toBe(true);
    expect(shareMock.calls).toHaveLength(1);
    expect(shareMock.calls[0]).toMatchObject({
      method: 'shareSingle',
      options: { social: 'whatsapp', url: 'data:image/png;base64,iVBORw0K', type: 'image/png' },
    });
    expect(trackMock.mock.calls).toStrictEqual([
      ['share_tap', { surface: 'daily_result' }],
      ['share_complete', { channel: 'whatsapp' }],
    ]);
  });

  it('falls back to the native sheet when WhatsApp is unavailable — never a dead end', async () => {
    shareMock.singleRejects = true;
    await expect(shareDailyCard(payload, 'whatsapp')).resolves.toBe(true);
    expect(shareMock.calls.map((c) => c.method)).toStrictEqual(['shareSingle', 'open']);
    expect(trackMock).toHaveBeenCalledWith('share_complete', { channel: 'sheet' });
  });

  it('a dismissed sheet is not a completed share', async () => {
    shareMock.openRejects = true;
    await expect(shareDailyCard(payload, 'sheet')).resolves.toBe(false);
    expect(trackMock.mock.calls.map(([name]) => name)).toStrictEqual(['share_tap']);
  });

  it('with no image it still shares the text and link', async () => {
    await shareDailyCard({ base64: null, message: 'hi' }, 'sheet');
    expect(shareMock.calls[0]?.options).toStrictEqual({ message: 'hi', failOnCancel: true });
  });
});
