/**
 * `react-native-share` stand-in (native module) — see vitest.config.ts. Records
 * every call; set `shareMock.singleRejects` / `openRejects` to model WhatsApp
 * missing and a player dismissing the sheet.
 */
export enum Social {
  Whatsapp = 'whatsapp',
}

export const shareMock = {
  calls: [] as { method: 'open' | 'shareSingle'; options: Record<string, unknown> }[],
  singleRejects: false,
  openRejects: false,
};

export function resetShareMock(): void {
  shareMock.calls = [];
  shareMock.singleRejects = false;
  shareMock.openRejects = false;
}

const Share = {
  Social: { WHATSAPP: 'whatsapp' },
  async open(options: Record<string, unknown>): Promise<{ success: boolean }> {
    shareMock.calls.push({ method: 'open', options });
    if (shareMock.openRejects) throw new Error('User did not share');
    return { success: true };
  },
  async shareSingle(options: Record<string, unknown>): Promise<{ success: boolean }> {
    shareMock.calls.push({ method: 'shareSingle', options });
    if (shareMock.singleRejects) throw new Error('Not installed');
    return { success: true };
  },
};

export default Share;
