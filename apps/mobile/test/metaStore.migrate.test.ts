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
