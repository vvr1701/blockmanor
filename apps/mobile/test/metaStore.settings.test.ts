/**
 * `useMetaStore`'s §12.1 SFX/music/haptics toggles + notification prefs.
 * Persistence goes through zustand's own MMKV-backed `persist` (§4.4), so
 * the round-trip test exercises the REAL rehydrate path, same idiom as
 * `metaStore.stars.test.ts` — "every toggle persists across relaunch" is a
 * clause of its own (§0 rule 6a) and gets its own assertion here, not
 * borrowed from the in-memory setter tests above it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { mmkvStorage } from '../src/state/persist';
import { migrateMetaState, useMetaStore } from '../src/state/useMetaStore';

const DEFAULTS = {
  sfxEnabled: true,
  musicEnabled: true,
  hapticsEnabled: true,
  notificationPrefs: { dailyDrop: true, streakRisk: true },
};

beforeEach(() => {
  useMetaStore.setState({ ...DEFAULTS });
});

describe('§12.1 toggles — defaults', () => {
  it('SFX, music and haptics all default ON (§7.4: "off by default is NOT allowed" for music, extended for consistency)', () => {
    const s = useMetaStore.getState();
    expect(s.sfxEnabled).toBe(true);
    expect(s.musicEnabled).toBe(true);
    expect(s.hapticsEnabled).toBe(true);
  });

  it('both notification categories default ON', () => {
    expect(useMetaStore.getState().notificationPrefs).toEqual({
      dailyDrop: true,
      streakRisk: true,
    });
  });
});

describe('§12.1 toggles — setters, each independent', () => {
  it('setSfxEnabled flips SFX only', () => {
    useMetaStore.getState().setSfxEnabled(false);
    const s = useMetaStore.getState();
    expect(s.sfxEnabled).toBe(false);
    expect(s.musicEnabled).toBe(true);
    expect(s.hapticsEnabled).toBe(true);
  });

  it('setMusicEnabled flips music only', () => {
    useMetaStore.getState().setMusicEnabled(false);
    const s = useMetaStore.getState();
    expect(s.musicEnabled).toBe(false);
    expect(s.sfxEnabled).toBe(true);
  });

  it('setHapticsEnabled flips haptics only', () => {
    useMetaStore.getState().setHapticsEnabled(false);
    const s = useMetaStore.getState();
    expect(s.hapticsEnabled).toBe(false);
    expect(s.sfxEnabled).toBe(true);
  });

  it('setNotificationPref updates one category, leaves the other alone', () => {
    useMetaStore.getState().setNotificationPref('dailyDrop', false);
    expect(useMetaStore.getState().notificationPrefs).toEqual({
      dailyDrop: false,
      streakRisk: true,
    });
    useMetaStore.getState().setNotificationPref('streakRisk', false);
    expect(useMetaStore.getState().notificationPrefs).toEqual({
      dailyDrop: false,
      streakRisk: false,
    });
  });
});

describe('§12.1 toggles — persist across a simulated relaunch (§12.1 acceptance: "persists across relaunch")', () => {
  it('SFX/music/haptics and notification prefs all round-trip through the REAL persist/rehydrate path', async () => {
    useMetaStore.getState().setSfxEnabled(false);
    useMetaStore.getState().setMusicEnabled(false);
    useMetaStore.getState().setHapticsEnabled(false);
    useMetaStore.getState().setNotificationPref('dailyDrop', false);
    const image = mmkvStorage.getItem('meta');
    expect(typeof image).toBe('string');

    // Simulate the fresh JS process a relaunch gives: in-memory state back to
    // whatever a NEW store construction would start from, then rehydrate off
    // the same (still-persisted) MMKV image — not an in-memory assertion.
    useMetaStore.setState({ ...DEFAULTS });
    mmkvStorage.setItem('meta', String(image));
    await useMetaStore.persist.rehydrate();

    const s = useMetaStore.getState();
    expect(s.sfxEnabled).toBe(false);
    expect(s.musicEnabled).toBe(false);
    expect(s.hapticsEnabled).toBe(false);
    expect(s.notificationPrefs).toEqual({ dailyDrop: false, streakRisk: true });
  });
});

describe('migrateMetaState v4 -> v5 (§12.1)', () => {
  const V4_SAVE = {
    currentLevel: 12,
    streak: 3,
    badges: { dailyUnplayed: false },
    ftueComplete: true,
    playerName: null,
    avatarId: null,
    attempts: {},
    stars: {},
    chestsClaimed: {},
    ownedFrames: [],
    endlessBest: 0,
  };

  it('a save predating the toggles gets all four fields, all ON', () => {
    const migrated = migrateMetaState(V4_SAVE, 4) as typeof V4_SAVE & typeof DEFAULTS;
    expect(migrated.sfxEnabled).toBe(true);
    expect(migrated.musicEnabled).toBe(true);
    expect(migrated.hapticsEnabled).toBe(true);
    expect(migrated.notificationPrefs).toEqual({ dailyDrop: true, streakRisk: true });
  });

  it('is a no-op once the save already carries the fields, even a muted one', () => {
    const alreadyMuted = {
      ...V4_SAVE,
      sfxEnabled: false,
      musicEnabled: false,
      hapticsEnabled: false,
      notificationPrefs: { dailyDrop: false, streakRisk: false },
    };
    const migrated = migrateMetaState(alreadyMuted, 5) as typeof alreadyMuted;
    expect(migrated.sfxEnabled).toBe(false);
    expect(migrated.musicEnabled).toBe(false);
    expect(migrated.hapticsEnabled).toBe(false);
    expect(migrated.notificationPrefs).toEqual({ dailyDrop: false, streakRisk: false });
  });

  it('composes with every earlier migration step in one pass from a v0 save', () => {
    const v0 = {
      currentLevel: 1,
      streak: 0,
      badges: { dailyUnplayed: false },
      ftueComplete: false,
      playerName: null,
      avatarId: null,
    };
    const migrated = migrateMetaState(v0, 0) as typeof v0 & typeof DEFAULTS & { attempts: unknown };
    expect(migrated.sfxEnabled).toBe(true);
    expect(migrated.notificationPrefs).toEqual({ dailyDrop: true, streakRisk: true });
    expect(migrated.attempts).toEqual({});
  });
});
