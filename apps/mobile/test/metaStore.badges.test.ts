/**
 * `selectBadges` — PRD §7.11's centralized badge computation
 * (`useMetaStore.badges`), specifically `mapChestReady` (§0 v1.18's map
 * affordance dot). qa-prd-auditor M-5/M-6: the render-tree tests only ever
 * exercised L10/L11, so two real mutations survived — `currentLevel > level`
 * loosened to `>= level`, and `CHEST_LEVELS.some` narrowed to `[10].some`
 * (silently dropping L20-L60). Both are covered here directly against the
 * pure function, at the actual boundaries.
 */
import { CHEST_LEVELS, MAX_LEVEL_ID } from '@blockmanor/content';
import { beforeEach, describe, expect, it } from 'vitest';
import { selectBadges, useMetaStore } from '../src/state/useMetaStore';

const FIRST_CHEST = CHEST_LEVELS[0]!; // 10
const LAST_CHEST = CHEST_LEVELS[CHEST_LEVELS.length - 1]!; // 60, === MAX_LEVEL_ID

beforeEach(() => {
  useMetaStore.setState({ chestsClaimed: {} });
});

function chestReady(currentLevel: number, chestsClaimed: Record<string, boolean> = {}): boolean {
  useMetaStore.setState({ currentLevel, chestsClaimed });
  return selectBadges(useMetaStore.getState()).mapChestReady;
}

describe('selectBadges.mapChestReady boundaries (qa-prd-auditor M-5/M-6)', () => {
  it(`L${FIRST_CHEST - 1} (below the first chest): not ready`, () => {
    expect(chestReady(FIRST_CHEST - 1)).toBe(false);
  });

  it(`L${FIRST_CHEST} exactly (still playing it — "> level", not ">="): not ready`, () => {
    expect(chestReady(FIRST_CHEST)).toBe(false);
  });

  it(`L${FIRST_CHEST + 1} (cleared it, currentLevel just past it): ready`, () => {
    expect(chestReady(FIRST_CHEST + 1)).toBe(true);
  });

  it('a claimed chest is not ready even though currentLevel is past it', () => {
    expect(chestReady(FIRST_CHEST + 1, { [String(FIRST_CHEST)]: true })).toBe(false);
  });

  it('a LATER level with an EARLIER chest unclaimed is still ready — every chest counts, not just the nearest', () => {
    // Past L20 (claimed) but L10 was never opened: `[10].some` alone would
    // still catch this one (10 is index 0), so this case alone would NOT
    // catch that mutation — paired with the L60 case below, which it would.
    expect(chestReady(25, { [String(FIRST_CHEST + 10)]: true })).toBe(true);
  });

  it(`currentLevel L${LAST_CHEST + 1} (cleared the final chest level L${LAST_CHEST}, MAX_LEVEL_ID=${MAX_LEVEL_ID}), L${LAST_CHEST} unclaimed: ready — proves the FULL CHEST_LEVELS list is walked, not a truncated one`, () => {
    // Every earlier chest claimed; only the last one isn't. `[10].some`
    // would report `false` here — this is what actually catches that mutation.
    const allButLast: Record<string, boolean> = {};
    for (const level of CHEST_LEVELS) if (level !== LAST_CHEST) allButLast[String(level)] = true;
    expect(chestReady(LAST_CHEST + 1, allButLast)).toBe(true);
  });

  it(`L${LAST_CHEST} claimed too: nothing left, not ready`, () => {
    const allClaimed: Record<string, boolean> = {};
    for (const level of CHEST_LEVELS) allClaimed[String(level)] = true;
    expect(chestReady(LAST_CHEST + 1, allClaimed)).toBe(false);
  });
});
