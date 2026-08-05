/**
 * Dial sweep — the authoring aid for finding level dials that hit a §7.9 target.
 *
 *     SWEEP=1 pnpm --filter @blockmanor/content balance
 *
 * SKIPPED unless `SWEEP=1`, so the CI balance job stays a gate and never pays
 * for exploration. This is a tool, not an assertion: it prints candidates and
 * asserts nothing about them.
 *
 * ---------------------------------------------------------------------------
 * It enforces the four rules the level-authoring skill's "Dial behavior notes"
 * were written from — every one of them cost a wrong answer during Stage 0:
 *
 *  1. SCAN CHEAP, CONFIRM AT 500. At p≈0.7, 150 seeds carries ~±7.5pp at 95%
 *     confidence — wider than the ±10pp acceptance band, so a 150-seed number
 *     cannot tell "in band" from "out". Two Stage-0 fixtures passed at 150 and
 *     failed at 500 (70%→57.4%, 50%→35.4%). So: scan the grid at 150, then
 *     re-measure the shortlist at 500 and report ONLY the confirmed figure.
 *  2. USE THE SHIPPING seedSalt. The salt IS the layout — same density and
 *     pattern under a different salt is a different board with a different
 *     win-rate. Sweeping under `${pattern}-${density}` and shipping under
 *     `T04-edges-crate` silently voids the balance evidence. So the salt is a
 *     required input here, not derived from the grid key.
 *  3. REJECT medianMoves < 8. A level the bot finishes in one or two
 *     placements has a meaningless win-rate: the prefill solved it.
 *  4. DON'T ASSUME DENSITY IS MONOTONIC. It is not — on `edges` the win-rate
 *     falls, climbs, then collapses to 100% at median 1 move. Never bisect;
 *     sweep the whole range and read the shape. The full grid is printed for
 *     exactly this reason, not just the winners.
 * ---------------------------------------------------------------------------
 */

import { describe, it } from 'vitest';
import { generateLevel, type ObstacleType, type PatternClass } from '../src/generator';
import { measureLevel, WIN_RATE_TOLERANCE_PP } from '../src/harness';
import { parseLevel } from '../src/schema';

// ===== EDIT THIS BLOCK ======================================================
/**
 * The id AND salt the level will actually ship with — see rule 2 above. BOTH
 * matter: `measureLevel` derives its per-playout seeds from the level id
 * (`L<id>-s<n>` / `bot-<id>-<n>`), so sweeping under id 1 and shipping under id
 * 904 measures a different seed stream and lands a few pp off the real gate.
 */
const LEVEL_ID = 904;
const SEED_SALT = 'T04-edges-crate';
/** §7.9 slot target as a fraction: .9 tutorial · .7 breather · .5 sustained · .35 spike. */
const TARGET = 0.5;
const GRID = {
  pattern: ['edges', 'bands', 'scatter', 'mid-fragments'] as PatternClass[],
  density: [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4],
  goal: 'crate' as Extract<ObstacleType, 'crate' | 'ivy' | 'chain' | 'heirloom'>,
  goalCount: [2, 3],
};
// ============================================================================

const SCAN_SEEDS = 150;
const CONFIRM_SEEDS = 500;
const MIN_MEDIAN_MOVES = 8;
/** Widen the scan net past the band — 150-seed noise hides real candidates. */
const SHORTLIST_PP = WIN_RATE_TOLERANCE_PP + 8;

interface Row {
  label: string;
  pattern: PatternClass;
  density: number;
  goalCount: number;
  win: number;
  med: number;
}

const build = (pattern: PatternClass, density: number, goalCount: number) =>
  generateLevel({
    id: LEVEL_ID, // rule 2 — the id feeds the seed stream, so it must be the real one
    chapter: 1,
    seedSalt: SEED_SALT, // rule 2 — never the grid key
    density,
    pattern,
    obstacles: { [GRID.goal]: goalCount },
    goals: [{ type: GRID.goal, count: goalCount }],
  });

const measure = (pattern: PatternClass, density: number, goalCount: number, seeds: number) =>
  measureLevel({ level: parseLevel(build(pattern, density, goalCount)), target: TARGET }, seeds);

describe.skipIf(!process.env.SWEEP)('dial sweep (authoring aid)', () => {
  it('scans the grid, then confirms the shortlist at full seed count', () => {
    console.log(
      `\nsalt="${SEED_SALT}" target=${(TARGET * 100).toFixed(0)}% goal=${GRID.goal}\n` +
        `scan @${SCAN_SEEDS} seeds — the FULL grid is shown because density is not monotonic:\n`,
    );

    const rows: Row[] = [];
    for (const pattern of GRID.pattern) {
      for (const density of GRID.density) {
        for (const goalCount of GRID.goalCount) {
          const b = measure(pattern, density, goalCount, SCAN_SEEDS);
          const row: Row = {
            label: `${pattern}/d${density}/g${goalCount}`,
            pattern,
            density,
            goalCount,
            win: b.winRate,
            med: b.medianMoves,
          };
          rows.push(row);
          const flag = b.medianMoves < MIN_MEDIAN_MOVES ? '  <-- degenerate, rejected' : '';
          console.log(
            `  ${row.label.padEnd(26)} win=${(b.winRate * 100).toFixed(0).padStart(3)}% med=${String(b.medianMoves).padStart(2)}${flag}`,
          );
        }
      }
    }

    const shortlist = rows
      .filter((r) => r.med >= MIN_MEDIAN_MOVES)
      .filter((r) => Math.abs(r.win - TARGET) * 100 <= SHORTLIST_PP)
      .sort((a, b) => Math.abs(a.win - TARGET) - Math.abs(b.win - TARGET))
      .slice(0, 6);

    console.log(
      `\nconfirm @${CONFIRM_SEEDS} seeds — ONLY these numbers may be used to accept a level:\n`,
    );
    for (const row of shortlist) {
      const b = measure(row.pattern, row.density, row.goalCount, CONFIRM_SEEDS);
      const verdict = b.withinTolerance ? 'ACCEPT' : 'reject';
      const drift = ((b.winRate - row.win) * 100).toFixed(1);
      console.log(
        `  ${verdict}  ${row.label.padEnd(26)} win=${(b.winRate * 100).toFixed(1).padStart(5)}% ` +
          `Δtarget=${b.deltaPp > 0 ? '+' : ''}${b.deltaPp}pp med=${b.medianMoves} ` +
          `stars=${b.suggestedStars.s2}/${b.suggestedStars.s3}  (moved ${drift}pp from the scan)`,
      );
    }
    console.log(
      '\nCopy an ACCEPT row into balance/fixtures.ts (or the Stage-1 level set),' +
        ' keeping the same seedSalt, then run the gate without SWEEP.\n',
    );
  });
});
