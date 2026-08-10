/**
 * The §8.2 client/server seam. These tests are here, not in `backend/functions`,
 * for the same reason the code is: `apps/mobile` imports this package and cannot
 * import the backend, so this is the layer both halves actually share.
 */

import { BOARD_SIZE, createGame, type PieceId } from '@blockmanor/engine';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DAILY_BOARDS_COLLECTION,
  ENGINE_VERSION,
  FROZEN_CONFIG_KEYS,
  dailyActivatesAt,
  dailyGameConfig,
  dailyPlaySeed,
  parseDailyBoardDoc,
  type DailyBoardDoc,
} from '../src/dailyBoard';
import { REMOTE_CONFIG_DEFAULTS } from '../src/remoteConfig';

const TUNING = {
  mercy_threshold: REMOTE_CONFIG_DEFAULTS.mercy_threshold,
  mercy_small_prob: REMOTE_CONFIG_DEFAULTS.mercy_small_prob,
  score_clear_base: REMOTE_CONFIG_DEFAULTS.score_clear_base,
  combo_step: REMOTE_CONFIG_DEFAULTS.combo_step,
  perfect_clear_bonus: REMOTE_CONFIG_DEFAULTS.perfect_clear_bonus,
};

/** A minimal but complete §8.2 document, shaped exactly as generation writes it. */
const doc = (): DailyBoardDoc => ({
  date: '2026-08-09',
  generatorVersion: 1,
  revision: '',
  engineVersion: '0.1.0+392ad7a4',
  engineConfig: {
    tuning: { ...TUNING },
    prefill: [
      { r: 0, c: 0, color: 1 },
      { r: 0, c: 1, color: 2 },
    ],
    pieceCount: 60,
    pieceSequence: { alg: 'AES-256-GCM', iv: 'aXY=', ct: 'Y3Q=', tag: 'dGFn' },
  },
  configSource: {
    mercy_threshold: 'live',
    mercy_small_prob: 'live',
    score_clear_base: 'live',
    combo_step: 'live',
    perfect_clear_bonus: 'default',
    daily_piece_count: 'live',
  },
  solvability: { trials: 200, medianMoves: 31, minMoves: 15, passed: true },
  generatedAt: '2026-08-08T23:45:00.000Z',
  activatesAt: Date.UTC(2026, 7, 9),
});

describe('§8.2 daily GameConfig builder', () => {
  it('is one builder for both sides of §8.5 — prefill lands as plain filled cells', () => {
    const sequence: PieceId[] = ['P01', 'P02', 'P03'];
    const config = dailyGameConfig(doc().engineConfig, sequence, '2026-08-09');

    expect(config.mode).toBe('daily');
    expect(config.pieceSequence).toStrictEqual(sequence);
    // §8.1/§6.4: no mercy, no goals — the Daily Board has no win state.
    expect(config.level?.mercy).toBe(false);
    expect(config.level?.goals).toStrictEqual([]);
    expect(config.level?.prefill).toStrictEqual([
      { r: 0, c: 0, type: 'filled', color: 1 },
      { r: 0, c: 1, type: 'filled', color: 2 },
    ]);
    // And the engine accepts it — the builder cannot emit a config the engine rejects.
    const state = createGame(config, dailyPlaySeed('2026-08-09'));
    expect(state.board.occ).toHaveLength(BOARD_SIZE);
  });

  it('binds the play seed to the date, and nothing else', () => {
    expect(dailyPlaySeed('2026-08-09')).toBe('daily:2026-08-09');
    expect(dailyPlaySeed('2026-08-10')).not.toBe(dailyPlaySeed('2026-08-09'));
    // Never the secret §8.2 seed: the salt cannot reach this package at all.
    expect(dailyPlaySeed('2026-08-09')).not.toContain('hmac');
  });

  it('names the collection once, for both the client fetch and the server write', () => {
    expect(DAILY_BOARDS_COLLECTION).toBe('dailyBoards');
  });
});

describe('§8.2 document schema (fetch trust boundary, §4.2)', () => {
  it('accepts a well-formed document and returns it typed', () => {
    expect(parseDailyBoardDoc(doc())).toStrictEqual(doc());
  });

  it('covers all six frozen keys in configSource', () => {
    expect([...FROZEN_CONFIG_KEYS].sort()).toStrictEqual(Object.keys(doc().configSource).sort());
  });

  const reject: [string, (d: DailyBoardDoc) => void][] = [
    ['a non-ISO date', (d) => (d.date = '9 Aug 2026')],
    ['an off-board prefill cell', (d) => (d.engineConfig.prefill[0]!.r = BOARD_SIZE)],
    ['a negative prefill colour', (d) => (d.engineConfig.prefill[0]!.color = -1)],
    // §8.5 rejects `moves.length > daily_piece_count`; a zero or fractional
    // count would make that comparison meaningless.
    ['a zero pieceCount', (d) => (d.engineConfig.pieceCount = 0)],
    ['a fractional pieceCount', (d) => (d.engineConfig.pieceCount = 12.5)],
    ['a NaN tuning value', (d) => (d.engineConfig.tuning.score_clear_base = NaN)],
    ['a foreign seal algorithm', (d) => (d.engineConfig.pieceSequence.alg = 'rot13' as never)],
    ['an empty ciphertext', (d) => (d.engineConfig.pieceSequence.ct = '')],
    [
      'a missing configSource key',
      (d) => delete (d.configSource as Partial<DailyBoardDoc['configSource']>).combo_step,
    ],
    ['an unknown configSource value', (d) => (d.configSource.combo_step = 'guess' as never)],
    ['a missing engineConfig', (d) => delete (d as Partial<DailyBoardDoc>).engineConfig],
    [
      'a missing engineVersion (§8.2 v1.12)',
      (d) => delete (d as Partial<DailyBoardDoc>).engineVersion,
    ],
    ['a missing activatesAt (§8.2 v1.12)', (d) => delete (d as Partial<DailyBoardDoc>).activatesAt],
    [
      'an ISO-string activatesAt — the rules compare it to request.time.toMillis()',
      (d) => (d.activatesAt = '2026-08-09T00:00:00.000Z' as never),
    ],
    ['a fractional activatesAt', (d) => (d.activatesAt = 1.5)],
  ];

  for (const [what, corrupt] of reject) {
    it(`rejects ${what}`, () => {
      const bad = doc();
      corrupt(bad);
      expect(() => parseDailyBoardDoc(bad)).toThrow();
    });
  }

  it('rejects things that are not documents at all', () => {
    for (const junk of [null, undefined, 42, 'board', [], {}]) {
      expect(() => parseDailyBoardDoc(junk)).toThrow();
    }
  });
});

describe('§8.2 publication boundary (PRD v1.12)', () => {
  it('activates day D at D 00:00:00.000 UTC, in epoch milliseconds', () => {
    // Epoch ms, not ISO and not a Firestore Timestamp: `firestore.rules`
    // compares this against `request.time.toMillis()`, int to int.
    expect(dailyActivatesAt('2026-08-09')).toBe(Date.UTC(2026, 7, 9));
    expect(new Date(dailyActivatesAt('2026-08-09')).toISOString()).toBe('2026-08-09T00:00:00.000Z');
    // Exactly 24h apart on consecutive days, DST-free because it is all UTC.
    expect(dailyActivatesAt('2026-08-10') - dailyActivatesAt('2026-08-09')).toBe(86_400_000);
    // Generation happens 15 minutes BEFORE activation, on the previous day.
    expect(dailyActivatesAt('2026-08-09') - Date.parse('2026-08-08T23:45:00.000Z')).toBe(900_000);
  });
});

describe('§8.2 engineVersion (PRD v1.12)', () => {
  // ENGINE_VERSION is a literal because `packages/engine` is PURE and untouched
  // and does not export its own version or its corpus hash. These two tests are
  // what stops the literal from drifting away from what it claims to describe.
  const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('matches the real packages/engine version on disk', () => {
    const pkg = JSON.parse(read('../../engine/package.json')) as { version: string };
    expect(ENGINE_VERSION.split('+')[0]).toBe(pkg.version);
  });

  it('matches the pinned determinism corpus hash on disk', () => {
    // The hash lives only in the engine's determinism test (§5 Stage-0 DoD),
    // pinned there so a cross-runtime regression fails CI. Re-deriving it here
    // would take the 1,000-game fuzz run; reading the pin is the whole point.
    const pinned = /corpusHash:\s*'([0-9a-f]+)'/.exec(
      read('../../engine/test/determinism.test.ts'),
    );
    expect(pinned?.[1]).toBeDefined();
    expect(ENGINE_VERSION.split('+')[1]).toBe(pinned?.[1]);
  });
});
