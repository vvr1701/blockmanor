/**
 * `migrateMetaState` — §7.5 audit B-1's persisted-save migration. Every
 * device on the pre-fix §7.1 build persisted `{ftueComplete: true,
 * currentLevel: 1}`; `LevelSession` didn't handle the engine's `'completed'`
 * status, so L1-L3 (goal-less scripted levels) were a permanent trap on
 * relaunch. This clamps any such save up to `FIRST_POST_FTUE_LEVEL` on the
 * `version 0 -> 1` migration step.
 */
import { FIRST_POST_FTUE_LEVEL } from '@blockmanor/content';
import { describe, expect, it } from 'vitest';
import { mmkvStorage } from '../src/state/persist';
import { migrateMetaState, useMetaStore } from '../src/state/useMetaStore';

const BASE = {
  currentLevel: 1,
  streak: 0,
  badges: { dailyUnplayed: false },
  ftueComplete: true,
  playerName: null,
  avatarId: null,
};

describe('migrateMetaState (PRD §7.5 audit B-1)', () => {
  it('clamps a through-FTUE v0 save stuck inside L1-L3 up to FIRST_POST_FTUE_LEVEL', () => {
    const migrated = migrateMetaState({ ...BASE, currentLevel: 1 }, 0) as typeof BASE;
    expect(migrated.currentLevel).toBe(FIRST_POST_FTUE_LEVEL);
  });

  it('leaves a v0 save already past FTUE untouched', () => {
    const migrated = migrateMetaState({ ...BASE, currentLevel: 12 }, 0) as typeof BASE;
    expect(migrated.currentLevel).toBe(12);
  });

  it('leaves a v0 save that never finished FTUE untouched (still routes through FtueScreen)', () => {
    const migrated = migrateMetaState(
      { ...BASE, ftueComplete: false, currentLevel: 1 },
      0,
    ) as typeof BASE;
    expect(migrated.currentLevel).toBe(1);
  });

  it('is a no-op once the save is already on the current version', () => {
    const migrated = migrateMetaState({ ...BASE, currentLevel: 1 }, 1) as typeof BASE;
    expect(migrated.currentLevel).toBe(1);
  });

  it('v1 -> v2 (§0 v1.17): a save predating the per-level `attempts` counter gets an empty one, not `undefined`', () => {
    const migrated = migrateMetaState({ ...BASE, currentLevel: 12 }, 1) as typeof BASE & {
      attempts: Record<string, number>;
    };
    expect(migrated.attempts).toEqual({});
  });

  it('v1 -> v2 leaves an existing `attempts` map alone', () => {
    const migrated = migrateMetaState({ ...BASE, currentLevel: 12, attempts: { '15': 4 } }, 2) as {
      attempts: Record<string, number>;
    };
    expect(migrated.attempts).toEqual({ '15': 4 });
  });

  /**
   * The two steps COMPOSE: a v0 save is older than both, so it must get the
   * FTUE clamp AND the `attempts` add in one pass. The steps were written as
   * an early `return` per step before §0 v1.17 — restore that and this reds
   * (`attempts` comes back `undefined`), because the v0 branch would exit
   * before the v1 -> v2 step ran. Not a live bug today only because zustand's
   * shallow merge backfills a missing key from initial state; it becomes one
   * the first time a later step TRANSFORMS an existing key instead of adding
   * a missing one.
   */
  it('a v0 save runs through BOTH steps — the FTUE clamp and the v1 -> v2 `attempts` add (§0 v1.17)', () => {
    const migrated = migrateMetaState({ ...BASE, currentLevel: 1 }, 0) as typeof BASE & {
      attempts: Record<string, number>;
    };
    expect(migrated.currentLevel).toBe(FIRST_POST_FTUE_LEVEL);
    expect(migrated.attempts).toEqual({});
  });

  it('v2 -> v3 (§7.10): a save predating per-level stars gets the three new maps, not `undefined`', () => {
    const migrated = migrateMetaState({ ...BASE, currentLevel: 24, attempts: {} }, 2) as {
      stars: Record<string, number>;
      chestsClaimed: Record<string, boolean>;
      ownedFrames: readonly string[];
    };
    expect(migrated.stars).toEqual({});
    expect(migrated.chestsClaimed).toEqual({});
    expect(migrated.ownedFrames).toEqual([]);
  });

  it('v2 -> v3 leaves already-earned stars, chests and frames alone', () => {
    const migrated = migrateMetaState(
      {
        ...BASE,
        currentLevel: 24,
        attempts: {},
        stars: { '12': 3 },
        chestsClaimed: { '10': true },
        ownedFrames: ['ivy_wreath'],
      },
      3,
    ) as { stars: Record<string, number>; ownedFrames: readonly string[] };
    expect(migrated.stars).toEqual({ '12': 3 });
    expect(migrated.ownedFrames).toEqual(['ivy_wreath']);
  });

  /**
   * The composition trap, one step further out than §0 v1.17's: a v0 save is
   * older than ALL THREE steps and must come out of a single pass with the
   * FTUE clamp, `attempts` AND §7.10's three maps. Turn any step into an
   * early `return` and this reds.
   */
  it('a v0 save runs through ALL THREE steps in one pass (§7.5 clamp + v1.17 attempts + §7.10 stars)', () => {
    const migrated = migrateMetaState({ ...BASE, currentLevel: 1 }, 0) as typeof BASE & {
      attempts: Record<string, number>;
      stars: Record<string, number>;
      chestsClaimed: Record<string, boolean>;
      ownedFrames: readonly string[];
    };
    expect(migrated.currentLevel).toBe(FIRST_POST_FTUE_LEVEL);
    expect(migrated.attempts).toEqual({});
    expect(migrated.stars).toEqual({});
    expect(migrated.chestsClaimed).toEqual({});
    expect(migrated.ownedFrames).toEqual([]);
  });

  it('the persisted `version` is 3 — a v2 blob must actually REACH the §7.10 step', async () => {
    mmkvStorage.setItem(
      'meta',
      JSON.stringify({ state: { ...BASE, currentLevel: 24, attempts: { '24': 2 } }, version: 2 }),
    );

    await useMetaStore.persist.rehydrate();

    const state = useMetaStore.getState();
    expect(state.stars).toEqual({});
    expect(state.chestsClaimed).toEqual({});
    expect(state.ownedFrames).toEqual([]);
    expect(state.attempts).toEqual({ '24': 2 });
  });

  it('tolerates a missing/undefined persisted state (fresh install, nothing to migrate)', () => {
    expect(migrateMetaState(undefined, 0)).toBeUndefined();
  });

  it('fires through the REAL zustand persist/rehydrate path, not `migrateMetaState` called directly (§7.5 re-audit item 7) — the `version: 0` assumption that makes the clamp fire at all is otherwise asserted nowhere', async () => {
    mmkvStorage.setItem(
      'meta',
      JSON.stringify({ state: { ...BASE, currentLevel: 1 }, version: 0 }),
    );

    await useMetaStore.persist.rehydrate();

    expect(useMetaStore.getState().currentLevel).toBe(FIRST_POST_FTUE_LEVEL);
  });
});
