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
