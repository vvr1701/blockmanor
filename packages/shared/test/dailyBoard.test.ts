/**
 * The §8.2 client/server seam. These tests are here, not in `backend/functions`,
 * for the same reason the code is: `apps/mobile` imports this package and cannot
 * import the backend, so this is the layer both halves actually share.
 */

import { BOARD_SIZE, createGame, type PieceId } from '@blockmanor/engine';
import { describe, expect, it } from 'vitest';
import {
  DAILY_BOARDS_COLLECTION,
  FROZEN_CONFIG_KEYS,
  dailyActivatesAt,
  dailyGameConfig,
  dailyPlaySeed,
  engineVersion,
  parseDailyBoardDoc,
  probeRuns,
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
  engineVersion: engineVersion(),
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

describe('§8.2 engineVersion (PRD v1.14)', () => {
  it('is a pinned fingerprint of the re-simulation surface', () => {
    // PINNED, exactly like the §5 determinism corpus hash, and for the opposite
    // half of the same job: the corpus hash pins engine behaviour on GENERATED
    // piece streams, this pins it on the FIXED `pieceSequence` the Daily Board
    // plays from — plus `dailyGameConfig()` and every literal it hardcodes.
    //
    // If this fails, the re-simulation surface moved. That is not automatically
    // a bug: re-pin it, and note that every board published from here on
    // carries the new value, which is precisely what §8.5 needs to tell "this
    // player cheated" from "we deployed a different engine under them". What
    // must never happen is the value staying put while behaviour changes — the
    // hazard that retired the old `<pkg version>+<corpus hash>` literal, whose
    // corpus half never exercised `pieceSequence` at all.
    //
    // It is also the cross-runtime check: CI's Node is not the author's, and a
    // pure engine + literal probe inputs must agree on both.
    expect(engineVersion()).toBe('daily-sim-v2+b5a6053e');
  });

  it('is stable and cheap to ask for twice', () => {
    expect(engineVersion()).toBe(engineVersion());
    expect(engineVersion()).toMatch(/^daily-sim-v2\+[0-9a-f]{8}$/);
  });

  it('probes what it claims to: both terminal statuses, a combo, a perfect clear', () => {
    // The digest above pins the probes' OUTPUT; this pins their COVERAGE. Without
    // it, shortening a probe (so it no longer dies, no longer clears, no longer
    // empties the board) narrows what the fingerprint can ever detect, and the
    // suite stays green after the re-pin the test above asks for. A scoring path
    // no probe reaches is a path `engineVersion` cannot report a change on —
    // which is the false negative §8.5 uses this field to avoid.
    const runs = probeRuns();
    const events = runs.flatMap((r) => r.events);

    // §8.2's two terminal statuses; `'won'` is unreachable (no goals).
    expect(new Set(runs.map((r) => r.status))).toEqual(new Set(['completed', 'lost']));
    // §6.6 combo: needs two CONSECUTIVE clearing placements, not one multi-line
    // clear — `combo_step` is frozen into `engineConfig`, so it must be probed.
    expect(events.some((e) => e.type === 'LINES_CLEARED' && e.comboDisplay >= 2)).toBe(true);
    // §6.6 perfect clear: reachable only from `fillCount === 0`, i.e. only from
    // the empty-prefill probe. `perfect_clear_bonus` is frozen too.
    expect(events.some((e) => e.type === 'PERFECT_CLEAR')).toBe(true);
  });
});
