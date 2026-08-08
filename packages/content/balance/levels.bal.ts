/**
 * Shipped-content balance gate — PRD §7.9 (levels 1-60), §7.10 (chapters),
 * §5 Stage-1 scope note ("authoring shipped levels 1-60 ... is Stage 1").
 *
 * Mirrors `balance.bal.ts` (the Stage-0 tooling-validation gate over the
 * throwaway `levels/_test/` fixtures) but targets the REAL shipped content in
 * `levels/NNN.json`, and additionally folds the harness's own measurements
 * back into the shipped level JSON as §7.7 "harness-written metadata":
 * `stars` (from `suggestedStars`) and `estMoves` (from `medianMoves`). That
 * merge is deterministic — same dials + same bot policy + same seed count
 * always produce the same numbers — so the regenerate-and-byte-compare check
 * below still holds.
 *
 * Regenerate after a DELIBERATE change to SHIPPED_LEVELS below:
 *   UPDATE_BALANCE=1 pnpm --filter @blockmanor/content balance
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PieceId } from '@blockmanor/engine';
import {
  generateLevel,
  type GeneratorParams,
  type ObstacleType,
  type PatternClass,
} from '../src/generator';
import {
  buildReport,
  DEFAULT_SEEDS,
  measureLevel,
  WIN_RATE_TOLERANCE_PP,
  type BalanceReport,
} from '../src/harness';
import { levelSchema, parseLevel, type LevelJson } from '../src/schema';

const LEVELS_DIR = fileURLToPath(new URL('../levels/', import.meta.url));
const REPORT_PATH = `${LEVELS_DIR}_balance_report.json`;
const levelPath = (id: number): string => `${LEVELS_DIR}${String(id).padStart(3, '0')}.json`;

const UPDATING = process.env.UPDATE_BALANCE === '1';
const stringify = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

if (UPDATING) {
  expect(process.env.CI, 'UPDATE_BALANCE must never run in CI').toBeFalsy();
  mkdirSync(LEVELS_DIR, { recursive: true });
}

type ObsRecipe = Partial<Record<ObstacleType, number>>;

/** crate2 is deliberately excluded from `goals` (§7.8): its 2nd hit credits
 * the `crate` goal, but it never needs its own goal entry — it is a "flavor"
 * obstacle, adding board friction without a completion requirement of its
 * own. Every OTHER obstacle placed always gets a matching goal at its exact
 * placed count, so a goal is never unreachable. */
const goalsFor = (obs: ObsRecipe): { type: 'crate' | 'chain' | 'ivy'; count: number }[] =>
  (['crate', 'chain', 'ivy'] as const)
    .filter((t) => (obs[t] ?? 0) > 0)
    .map((t) => ({ type: t, count: obs[t] as number }));

const NO_BIG: Partial<Record<PieceId, number>> = { P08: 0, P09: 0, P11: 0 };

interface ShippedLevel {
  id: number;
  chapter: number;
  /** §7.9 slot target for this level, as a fraction. */
  target: number;
  difficultyTier: string;
  pattern: PatternClass;
  density: number;
  obstacles: ObsRecipe;
  /** Present only where the piece-weight-override dial was needed (§ skill,
   * "difficulty dials... weakest -> strongest"; here used to EASE, not harden,
   * the earliest tutorial levels where large pieces made survival too costly
   * for the greedy bot to reliably clear a lone crate goal). */
  noBig?: boolean;
  /**
   * Override for the default `L<id>-<pattern>-<density>` salt. Needed for L1
   * and L6: the level-authoring skill's rule 2 ("measure with the id AND
   * seedSalt you will actually ship") bit here during authoring — an earlier
   * sweep script used a differently-formatted salt for those two ids, and the
   * DEFAULT salt for the same (pattern, density) happens to land on a
   * near-trivial board (median 1-2 moves) under a different RNG stream. These
   * two therefore pin the salt that was actually confirmed at 500 seeds.
   */
  seedSalt?: string;
}

/**
 * The §7.9 curve, levels 1-60. Every (pattern, density, obstacles) combination
 * below was found by sweeping at 150 seeds and CONFIRMED at 500 — see the
 * level-authoring skill's "500 seeds is the MINIMUM" rule. Obstacle mixes
 * never repeat on consecutive levels (checked below). `crate` intro L1,
 * `crate2` L8, `chain` L12, `ivy` L18 — each a gentle level before the next
 * ramp/spike uses it. Chapter 2 (L31-60) restages the same four obstacles
 * into new COMBINATIONS every ~5 levels (crate2+ivy at L36, chain+ivy
 * compounded at L41) since heirloom — the only other §7.8 obstacle type — is
 * out of scope for Stage 1 (§7.8 content-stage note).
 */
const SHIPPED_LEVELS: ShippedLevel[] = [
  // ---- L1-10: tutorial, target 90% (PRD §7.9 "win rate target >=90%") ----
  {
    id: 1,
    chapter: 1,
    target: 0.9,
    difficultyTier: 'tutorial',
    pattern: 'bands',
    density: 0.35,
    obstacles: { crate: 1 },
    seedSalt: 'L1-p5-reg-bands-0.35',
  },
  {
    id: 2,
    chapter: 1,
    target: 0.9,
    difficultyTier: 'tutorial',
    pattern: 'edges',
    density: 0.3,
    obstacles: { crate: 2 },
  },
  {
    id: 3,
    chapter: 1,
    target: 0.9,
    difficultyTier: 'tutorial',
    pattern: 'bands',
    density: 0.45,
    obstacles: { crate: 1 },
  },
  {
    id: 4,
    chapter: 1,
    target: 0.9,
    difficultyTier: 'tutorial',
    pattern: 'bands',
    density: 0.35,
    obstacles: { crate: 2 },
  },
  {
    id: 5,
    chapter: 1,
    target: 0.9,
    difficultyTier: 'tutorial',
    pattern: 'bands',
    density: 0.45,
    obstacles: { crate: 1 },
    noBig: true,
  },
  // L6-L10 retuned (operator ruling, feat/7.9-levels follow-up): biased every
  // dial toward forgiveness — lowest workable goal count given the adjacency
  // constraint (consecutive obstacle mixes must differ; L5=crate:1 and
  // L11=crate:2+crate2:1 are fixed anchors outside this retune's scope), the
  // gentlest two placement patterns only (`edges` hugs the border, `bands`
  // fills border-ward rows first — never `scatter`/`mid-fragments`, the
  // generator's own harshest shapes), and `noBig` (P08/P09/P11 removed from
  // the draw, the L5/L6 precedent). Within that space, density AND seedSalt
  // both move the number (the generator's own sweep-tool docstring: "density
  // is not monotonic... never bisect, sweep the whole range") — same dials,
  // different salt, is a different realized board. Confirmed at the full 500
  // seeds; see the task's before/after table for the reject pile.
  {
    id: 6,
    chapter: 1,
    target: 0.9,
    difficultyTier: 'tutorial',
    pattern: 'edges',
    density: 0.36,
    obstacles: { crate: 2 },
    noBig: true,
    seedSalt: 'SALTSCAN5-id6-c2-edges-0.360-s5',
  },
  {
    id: 7,
    chapter: 1,
    target: 0.9,
    difficultyTier: 'tutorial',
    pattern: 'bands',
    density: 0.46,
    obstacles: { crate: 1 },
    noBig: true,
    seedSalt: 'SALTSCAN-id7-c1-bands-0.460-s6',
  },
  // first crate2 (double-crate) — gentle, still tutorial band. Kept at the
  // minimum that still teaches it: one crate2 alongside one plain crate.
  {
    id: 8,
    chapter: 1,
    target: 0.9,
    difficultyTier: 'tutorial',
    pattern: 'edges',
    density: 0.4,
    obstacles: { crate: 1, crate2: 1 },
    noBig: true,
    seedSalt: 'SALTSCAN3-id8-c1cr2-edges-0.400-s11',
  },
  {
    id: 9,
    chapter: 1,
    target: 0.9,
    difficultyTier: 'tutorial',
    pattern: 'bands',
    density: 0.46,
    obstacles: { crate: 1 },
    noBig: true,
    seedSalt: 'SALTSCAN4-id9-c1-bands-0.460-s157',
  },
  {
    id: 10,
    chapter: 1,
    target: 0.9,
    difficultyTier: 'tutorial',
    pattern: 'edges',
    density: 0.34,
    obstacles: { crate: 2 },
    noBig: true,
    seedSalt: 'SALTSCAN4-id10-c2-edges-0.340-s62',
  },

  // ---- L11-14: ramp down to the L15 spike ----
  {
    id: 11,
    chapter: 1,
    target: 0.82,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.22,
    obstacles: { crate: 2, crate2: 1 },
  },
  // first `chain` — gentle, inside a ramp level rather than cold into the spike.
  {
    id: 12,
    chapter: 1,
    target: 0.75,
    difficultyTier: 'ramp',
    pattern: 'bands',
    density: 0.22,
    obstacles: { crate: 2, chain: 2 },
  },
  {
    id: 13,
    chapter: 1,
    target: 0.65,
    difficultyTier: 'ramp',
    pattern: 'bands',
    density: 0.28,
    obstacles: { crate: 1, chain: 2 },
  },
  {
    id: 14,
    chapter: 1,
    target: 0.52,
    difficultyTier: 'ramp',
    pattern: 'scatter',
    density: 0.22,
    obstacles: { crate: 3, chain: 2 },
  },

  // ---- L15: first spike (§7.9, 35-45%) ----
  {
    id: 15,
    chapter: 1,
    target: 0.4,
    difficultyTier: 'spike',
    pattern: 'mid-fragments',
    density: 0.18,
    obstacles: { crate: 3, chain: 3 },
  },

  // ---- L16-22: breather (~70%) ----
  {
    id: 16,
    chapter: 1,
    target: 0.72,
    difficultyTier: 'breather',
    pattern: 'bands',
    density: 0.15,
    obstacles: { crate: 3, chain: 1 },
  },
  {
    id: 17,
    chapter: 1,
    target: 0.7,
    difficultyTier: 'breather',
    pattern: 'bands',
    density: 0.18,
    obstacles: { crate: 3 },
  },
  // first `ivy` — gentle, mid-breather where the player can learn the spread rule without pressure.
  {
    id: 18,
    chapter: 1,
    target: 0.7,
    difficultyTier: 'breather',
    pattern: 'mid-fragments',
    density: 0.15,
    obstacles: { crate: 2, ivy: 2 },
  },
  {
    id: 19,
    chapter: 1,
    target: 0.7,
    difficultyTier: 'breather',
    pattern: 'mid-fragments',
    density: 0.25,
    obstacles: { crate: 1, ivy: 2 },
  },
  {
    id: 20,
    chapter: 1,
    target: 0.7,
    difficultyTier: 'breather',
    pattern: 'mid-fragments',
    density: 0.18,
    obstacles: { crate: 2, ivy: 3 },
  },
  {
    id: 21,
    chapter: 1,
    target: 0.68,
    difficultyTier: 'breather',
    pattern: 'mid-fragments',
    density: 0.15,
    obstacles: { crate: 2, ivy: 2, chain: 1 },
  },
  {
    id: 22,
    chapter: 1,
    target: 0.68,
    difficultyTier: 'breather',
    pattern: 'mid-fragments',
    density: 0.18,
    obstacles: { crate: 1, ivy: 2, chain: 2 },
  },

  // ---- L23-29: ramp to the L30 spike (ivy+chain compounding, per skill notes) ----
  {
    id: 23,
    chapter: 1,
    target: 0.62,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.18,
    obstacles: { crate: 2, ivy: 3, chain: 1 },
  },
  {
    id: 24,
    chapter: 1,
    target: 0.58,
    difficultyTier: 'ramp',
    pattern: 'bands',
    density: 0.28,
    obstacles: { crate: 2, ivy: 3, chain: 2 },
  },
  {
    id: 25,
    chapter: 1,
    target: 0.55,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.18,
    obstacles: { crate: 2, ivy: 2, chain: 2, crate2: 1 },
  },
  {
    id: 26,
    chapter: 1,
    target: 0.5,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.25,
    obstacles: { crate: 2, ivy: 3, chain: 2 },
  },
  {
    id: 27,
    chapter: 1,
    target: 0.47,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.22,
    obstacles: { crate: 2, ivy: 3, chain: 3 },
  },
  {
    id: 28,
    chapter: 1,
    target: 0.44,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.28,
    obstacles: { crate: 2, ivy: 4, chain: 3 },
  },
  {
    id: 29,
    chapter: 1,
    target: 0.4,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.28,
    obstacles: { crate: 1, ivy: 4, chain: 3 },
  },

  // ---- L30: chapter-1 closing spike (~35%) ----
  {
    id: 30,
    chapter: 1,
    target: 0.35,
    difficultyTier: 'spike',
    pattern: 'mid-fragments',
    density: 0.28,
    obstacles: { crate: 2, ivy: 4, chain: 4 },
  },

  // ==== Chapter 2 (§7.10 fountain court) ====
  // ---- L31-35: gentle chapter opener, ramp down ----
  {
    id: 31,
    chapter: 2,
    target: 0.7,
    difficultyTier: 'breather',
    pattern: 'mid-fragments',
    density: 0.15,
    obstacles: { crate: 3 },
  },
  {
    id: 32,
    chapter: 2,
    target: 0.65,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.25,
    obstacles: { crate: 3, chain: 2 },
  },
  {
    id: 33,
    chapter: 2,
    target: 0.6,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.25,
    obstacles: { crate: 2, chain: 3 },
  },
  {
    id: 34,
    chapter: 2,
    target: 0.55,
    difficultyTier: 'ramp',
    pattern: 'bands',
    density: 0.28,
    obstacles: { crate: 2, chain: 3, ivy: 1 },
  },
  {
    id: 35,
    chapter: 2,
    target: 0.5,
    difficultyTier: 'ramp',
    pattern: 'scatter',
    density: 0.15,
    obstacles: { crate: 2, chain: 2, ivy: 2 },
  },

  // ---- L36-40: new combo (crate2 + ivy), ramp ----
  {
    id: 36,
    chapter: 2,
    target: 0.65,
    difficultyTier: 'breather',
    pattern: 'mid-fragments',
    density: 0.25,
    obstacles: { crate: 2, crate2: 2, ivy: 2 },
  },
  {
    id: 37,
    chapter: 2,
    target: 0.6,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.22,
    obstacles: { crate: 1, crate2: 2, ivy: 2 },
  },
  {
    id: 38,
    chapter: 2,
    target: 0.55,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.28,
    obstacles: { crate: 2, crate2: 2, ivy: 3 },
  },
  {
    id: 39,
    chapter: 2,
    target: 0.5,
    difficultyTier: 'ramp',
    pattern: 'scatter',
    density: 0.28,
    obstacles: { crate: 2, crate2: 1, ivy: 3, chain: 2 },
  },
  {
    id: 40,
    chapter: 2,
    target: 0.45,
    difficultyTier: 'ramp',
    pattern: 'edges',
    density: 0.25,
    obstacles: { crate: 2, crate2: 1, ivy: 3, chain: 3 },
  },

  // ---- L41-44: new combo (chain+ivy compounded), ramp to L45 spike ----
  {
    id: 41,
    chapter: 2,
    target: 0.6,
    difficultyTier: 'breather',
    pattern: 'bands',
    density: 0.32,
    obstacles: { crate: 2, chain: 3, ivy: 3 },
  },
  {
    id: 42,
    chapter: 2,
    target: 0.55,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.22,
    obstacles: { crate: 2, chain: 3, ivy: 4 },
  },
  {
    id: 43,
    chapter: 2,
    target: 0.5,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.18,
    obstacles: { crate: 2, chain: 4, ivy: 4 },
  },
  {
    id: 44,
    chapter: 2,
    target: 0.45,
    difficultyTier: 'ramp',
    pattern: 'bands',
    density: 0.32,
    obstacles: { crate: 2, crate2: 1, chain: 4, ivy: 4 },
  },

  // ---- L45: chapter-2 spike, full compound (crate2+chain+ivy), ~40% ----
  {
    id: 45,
    chapter: 2,
    target: 0.4,
    difficultyTier: 'spike',
    pattern: 'scatter',
    density: 0.32,
    obstacles: { crate: 2, crate2: 1, chain: 4, ivy: 5 },
  },

  // ---- L46-60: ramp to a sustained ~50% ----
  {
    id: 46,
    chapter: 2,
    target: 0.65,
    difficultyTier: 'breather',
    pattern: 'bands',
    density: 0.18,
    obstacles: { crate: 3, ivy: 2 },
  },
  {
    id: 47,
    chapter: 2,
    target: 0.62,
    difficultyTier: 'ramp',
    pattern: 'bands',
    density: 0.18,
    obstacles: { crate: 3, chain: 2 },
  },
  {
    id: 48,
    chapter: 2,
    target: 0.6,
    difficultyTier: 'ramp',
    pattern: 'bands',
    density: 0.28,
    obstacles: { crate: 2, chain: 2, ivy: 2 },
  },
  {
    id: 49,
    chapter: 2,
    target: 0.58,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.28,
    obstacles: { crate: 2, crate2: 1, ivy: 2 },
  },
  {
    id: 50,
    chapter: 2,
    target: 0.56,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.18,
    obstacles: { crate: 2, chain: 3, ivy: 1 },
  },
  {
    id: 51,
    chapter: 2,
    target: 0.55,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.18,
    obstacles: { crate: 2, chain: 2, ivy: 2 },
  },
  {
    id: 52,
    chapter: 2,
    target: 0.54,
    difficultyTier: 'ramp',
    pattern: 'mid-fragments',
    density: 0.22,
    obstacles: { crate: 2, crate2: 1, chain: 2 },
  },
  {
    id: 53,
    chapter: 2,
    target: 0.53,
    difficultyTier: 'ramp',
    pattern: 'scatter',
    density: 0.15,
    obstacles: { crate: 2, ivy: 3 },
  },
  {
    id: 54,
    chapter: 2,
    target: 0.52,
    difficultyTier: 'sustained',
    pattern: 'bands',
    density: 0.28,
    obstacles: { crate: 2, chain: 3 },
  },
  {
    id: 55,
    chapter: 2,
    target: 0.51,
    difficultyTier: 'sustained',
    pattern: 'scatter',
    density: 0.25,
    obstacles: { crate: 2, crate2: 1, ivy: 2 },
  },
  {
    id: 56,
    chapter: 2,
    target: 0.5,
    difficultyTier: 'sustained',
    pattern: 'mid-fragments',
    density: 0.18,
    obstacles: { crate: 2, chain: 2, ivy: 1 },
  },
  {
    id: 57,
    chapter: 2,
    target: 0.5,
    difficultyTier: 'sustained',
    pattern: 'mid-fragments',
    density: 0.15,
    obstacles: { crate: 2, ivy: 2, chain: 1 },
  },
  {
    id: 58,
    chapter: 2,
    target: 0.5,
    difficultyTier: 'sustained',
    pattern: 'mid-fragments',
    density: 0.28,
    obstacles: { crate: 2, crate2: 1, chain: 2 },
  },
  {
    id: 59,
    chapter: 2,
    target: 0.5,
    difficultyTier: 'sustained',
    pattern: 'mid-fragments',
    density: 0.18,
    obstacles: { crate: 2, ivy: 2, crate2: 1 },
  },
  {
    id: 60,
    chapter: 2,
    target: 0.5,
    difficultyTier: 'sustained',
    pattern: 'mid-fragments',
    density: 0.15,
    obstacles: { crate: 3, chain: 2, ivy: 1 },
  },
];

// Variety rule (level-authoring skill / level-designer agent): no two
// consecutive levels share an identical obstacle mix.
describe('shipped-level plan sanity', () => {
  it('never repeats an obstacle mix on consecutive levels', () => {
    for (let i = 1; i < SHIPPED_LEVELS.length; i++) {
      const prev = SHIPPED_LEVELS[i - 1] as ShippedLevel;
      const cur = SHIPPED_LEVELS[i] as ShippedLevel;
      expect(
        JSON.stringify(cur.obstacles),
        `L${prev.id} and L${cur.id} share an identical obstacle mix`,
      ).not.toBe(JSON.stringify(prev.obstacles));
    }
  });

  it('is exactly levels 1-60, chapter 1 = L1-30, chapter 2 = L31-60 (§7.10)', () => {
    expect(SHIPPED_LEVELS.map((l) => l.id)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    for (const l of SHIPPED_LEVELS) expect(l.chapter).toBe(l.id <= 30 ? 1 : 2);
  });

  it('never ships heirloom in Stage-1 content (§7.8 content-stage note)', () => {
    for (const l of SHIPPED_LEVELS) {
      expect(Object.keys(l.obstacles)).not.toContain('heirloom');
    }
  });
});

function toGeneratorParams(l: ShippedLevel): GeneratorParams {
  return {
    id: l.id,
    chapter: l.chapter,
    seedSalt: l.seedSalt ?? `L${l.id}-${l.pattern}-${l.density}`,
    density: l.density,
    pattern: l.pattern,
    obstacles: l.obstacles,
    goals: goalsFor(l.obstacles),
    difficultyTier: l.difficultyTier,
    ...(l.noBig ? { pieceWeightOverrides: NO_BIG } : {}),
  };
}

describe('shipped levels 1-60 (PRD §7.9)', () => {
  // Pass 1: generate the un-scored candidate, so it can be measured.
  const drafts = SHIPPED_LEVELS.map((l) => ({
    plan: l,
    draft: generateLevel(toGeneratorParams(l)),
  }));

  // Pass 2: measure each draft, then fold `stars`/`estMoves` back in — the
  // §7.7 "harness-written metadata" contract. This is what makes the merge
  // deterministic: same dials -> same draft -> same measurement -> same final.
  const finals: { plan: ShippedLevel; json: LevelJson }[] = drafts.map(({ plan, draft }) => {
    const measured = measureLevel({ level: parseLevel(draft), target: plan.target }, DEFAULT_SEEDS);
    const final = levelSchema.parse({
      ...draft,
      stars: measured.suggestedStars,
      estMoves: measured.medianMoves,
    }) as LevelJson;
    return { plan, json: final };
  });

  it('regenerates each shipped level byte-identically from its dials', () => {
    for (const { plan, json } of finals) {
      const path = levelPath(plan.id);
      if (UPDATING) writeFileSync(path, stringify(json));
      expect(stringify(json), `level ${plan.id}`).toBe(readFileSync(path, 'utf8'));
    }
  });

  it(`measures every level within +/-${WIN_RATE_TOLERANCE_PP}pp of its §7.9 target`, () => {
    const specs = finals.map(({ plan, json }) => ({
      level: parseLevel(json),
      target: plan.target,
    }));
    const report = buildReport(specs, DEFAULT_SEEDS);

    for (const [i, level] of report.levels.entries()) {
      const plan = SHIPPED_LEVELS[i];
      console.log(
        `  L${String(level.id).padStart(2)} tier=${(plan?.difficultyTier ?? '').padEnd(10)} ` +
          `target=${(level.target * 100).toFixed(0)}% win=${(level.winRate * 100).toFixed(1)}% ` +
          `Delta=${level.deltaPp > 0 ? '+' : ''}${level.deltaPp}pp med=${level.medianMoves} ` +
          `stars=${level.suggestedStars.s2}/${level.suggestedStars.s3}`,
      );
    }
    for (const level of report.levels) {
      expect(level.withinTolerance, `level ${level.id} is ${level.deltaPp}pp from target`).toBe(
        true,
      );
    }
    // Reject a level the bot solves in 1-2 placements (level-authoring skill:
    // "a level the bot finishes in one or two placements has a meaningless
    // win-rate: the prefill did the work, not the player").
    for (const level of report.levels) {
      expect(level.medianMoves, `level ${level.id} medianMoves`).toBeGreaterThanOrEqual(8);
    }

    if (UPDATING) writeFileSync(REPORT_PATH, stringify(report));
    const committed = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as BalanceReport;
    expect(report).toEqual(committed);
  });
});
