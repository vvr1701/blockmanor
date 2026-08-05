/**
 * The balance gate — PRD §7.9, §5 (Stage-0 tooling), BUILD_GUIDE S0.3.
 *
 * Three assertions, in order:
 *   1. the generator is deterministic — regenerating each fixture from its dials
 *      reproduces the committed `levels/_test/*.json` byte for byte
 *   2. every level's bot win-rate sits within ±10pp of its §7.9 target
 *   3. the committed `_balance_report.json` still matches a fresh measurement
 *
 * (3) is what makes the report evidence rather than a rumour: a balance number
 * nobody can re-derive is worthless, and this job re-derives all of them.
 *
 * Regenerate after a DELIBERATE dial or bot-policy change:
 *   UPDATE_BALANCE=1 pnpm --filter @blockmanor/content balance
 * Bump HARNESS_VERSION whenever the bot policy changes — old rows are then void.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateLevel } from '../src/generator';
import {
  buildReport,
  DEFAULT_SEEDS,
  WIN_RATE_TOLERANCE_PP,
  type BalanceReport,
} from '../src/harness';
import { parseLevel } from '../src/schema';
import { FIXTURES } from './fixtures';

const LEVELS_DIR = fileURLToPath(new URL('../levels/_test/', import.meta.url));
const REPORT_PATH = `${LEVELS_DIR}_balance_report.json`;
const levelPath = (id: number): string => `${LEVELS_DIR}${id}.json`;

const UPDATING = process.env.UPDATE_BALANCE === '1';
const stringify = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

if (UPDATING) {
  // Regeneration is a local, deliberate act. If this ran in CI the job would
  // rewrite the very evidence it exists to check, and still report green.
  expect(process.env.CI, 'UPDATE_BALANCE must never run in CI').toBeFalsy();
  mkdirSync(LEVELS_DIR, { recursive: true });
}

describe('balance harness (PRD §7.9)', () => {
  const generated = FIXTURES.map((fixture) => ({
    fixture,
    json: generateLevel(fixture.params),
  }));

  it('regenerates each fixture byte-identically from its dials', () => {
    for (const { fixture, json } of generated) {
      const path = levelPath(fixture.params.id);
      if (UPDATING) writeFileSync(path, stringify(json));
      // Byte-stable, not merely deep-equal: the generator is seeded, so any
      // drift in it is a silent rebalance of every level authored from it.
      expect(stringify(json), fixture.params.seedSalt).toBe(readFileSync(path, 'utf8'));
    }
  });

  it(`measures every level within ±${WIN_RATE_TOLERANCE_PP}pp of its §7.9 target`, () => {
    const specs = generated.map(({ fixture, json }) => ({
      level: parseLevel(json),
      target: fixture.target,
    }));
    const report = buildReport(specs, DEFAULT_SEEDS);

    for (const [i, level] of report.levels.entries()) {
      const fixture = FIXTURES[i];
      console.log(
        `  ${String(level.id)} ${(fixture?.covers ?? '').padEnd(52)} target=${(level.target * 100).toFixed(0)}% win=${(level.winRate * 100).toFixed(1)}% Δ=${level.deltaPp > 0 ? '+' : ''}${level.deltaPp}pp med=${level.medianMoves} stars=${level.suggestedStars.s2}/${level.suggestedStars.s3}`,
      );
    }
    // The §7.9 acceptance rule itself. A level outside the band is not content.
    for (const level of report.levels) {
      expect(level.withinTolerance, `level ${level.id} is ${level.deltaPp}pp from target`).toBe(
        true,
      );
    }

    if (UPDATING) writeFileSync(REPORT_PATH, stringify(report));
    const committed = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as BalanceReport;
    expect(report).toEqual(committed);
  });
});
