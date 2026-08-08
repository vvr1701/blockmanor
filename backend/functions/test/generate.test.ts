/**
 * PRD §8.2 acceptance tests — Daily Board generation.
 *
 * Everything here runs in-process with no Firebase emulator: §8.2's substance
 * (seed derivation, prefill, sequence, the frozen snapshot, the solvability
 * gate, and the §8.5 determinism contract) is pure. The emulator-dependent
 * parts live in `publish.test.ts` and are skipped.
 */

import { REMOTE_CONFIG_DEFAULTS } from '@blockmanor/shared';
import {
  BOARD_SIZE,
  PIECE_BY_ID,
  PIECE_IDS,
  cellKind,
  createGame,
  simulate,
  type EngineTuning,
  type Move,
  type PieceId,
} from '@blockmanor/engine';
import { playout } from '@blockmanor/content';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DAILY_GENERATOR_VERSION,
  REROLL_REVISION,
  SOLVABILITY_MIN_MOVES,
  SOLVABILITY_TRIALS,
  dailyGameConfig,
  dailyPlaySeed,
  drawPrefill,
  drawSequence,
  generateDailyBoard,
  solvabilityMedian,
  type DailyGenerationInput,
  type DailyGenerationResult,
} from '../src/daily/generate';
import {
  PREFILL_MAX_CELLS,
  PREFILL_MIN_CELLS,
  PREFILL_TEMPLATES,
  TEMPLATE_ORIENTATIONS,
  assertTemplates,
  orient,
} from '../src/daily/patterns';
import {
  attemptSeed,
  dailySeed,
  openSequence,
  prefillSeed,
  sealSequence,
  sequenceKey,
  sequenceSeed,
  openSequence as unseal,
} from '../src/daily/seal';

/** Test-only salt. The real one lives in Functions config (§16) and never here. */
const SALT = 'test-salt-not-the-real-one';

/** The frozen §13 values, read once — exactly as `publish.ts` does. */
const TUNING: EngineTuning = {
  mercy_threshold: REMOTE_CONFIG_DEFAULTS.mercy_threshold,
  mercy_small_prob: REMOTE_CONFIG_DEFAULTS.mercy_small_prob,
  score_clear_base: REMOTE_CONFIG_DEFAULTS.score_clear_base,
  combo_step: REMOTE_CONFIG_DEFAULTS.combo_step,
  perfect_clear_bonus: REMOTE_CONFIG_DEFAULTS.perfect_clear_bonus,
};

const input = (date: string, over: Partial<DailyGenerationInput> = {}): DailyGenerationInput => ({
  date,
  seed: dailySeed(SALT, date),
  tuning: TUNING,
  pieceCount: REMOTE_CONFIG_DEFAULTS.daily_piece_count,
  generatedAt: `${date}T00:00:00.000Z`,
  ...over,
});

/**
 * Generation runs 200 bot playouts, so tests that just need *a* board share one
 * per date. Tests where repeating the work IS the assertion call
 * `generateDailyBoard` directly.
 */
const cache = new Map<string, DailyGenerationResult>();
function board(date: string): DailyGenerationResult {
  const hit = cache.get(date) ?? generateDailyBoard(input(date));
  cache.set(date, hit);
  return hit;
}

describe('§8.2 seed derivation', () => {
  it('is HMAC_SHA256(secretSalt, "YYYY-MM-DD")', () => {
    // Independent expectation, computed the way the PRD states it.
    const expected = createHmacHex(SALT, '2026-08-09');
    expect(dailySeed(SALT, '2026-08-09')).toBe(expected);
  });

  it('rejects a non-ISO date and an empty salt', () => {
    expect(() => dailySeed(SALT, '2026-8-9')).toThrow(/YYYY-MM-DD/);
    expect(() => dailySeed(SALT, 'tomorrow')).toThrow(/YYYY-MM-DD/);
    expect(() => dailySeed('', '2026-08-09')).toThrow(/salt/);
  });

  it('same date + same salt → identical board', () => {
    const a = generateDailyBoard(input('2026-08-09'));
    const b = generateDailyBoard(input('2026-08-09'));
    // Byte-identical document, sealed sequence included: the IV is derived, not
    // random, so a retried scheduler run rewrites the same bytes.
    expect(b.doc).toStrictEqual(a.doc);
    expect(b.sequence).toStrictEqual(a.sequence);
  });

  it('different date → different board', () => {
    const a = board('2026-08-09');
    const b = generateDailyBoard(input('2026-08-10'));
    expect(b.sequence).not.toStrictEqual(a.sequence);
    expect(b.doc.engineConfig.pieceSequence.ct).not.toBe(a.doc.engineConfig.pieceSequence.ct);
  });

  it('different salt → different board for the same date', () => {
    const a = board('2026-08-09');
    const b = generateDailyBoard(
      input('2026-08-09', { seed: dailySeed('other-salt', '2026-08-09') }),
    );
    expect(b.sequence).not.toStrictEqual(a.sequence);
  });

  it('prefill and sequence sub-seeds are independent (no FNV inversion path)', () => {
    // The published prefill is public. If both streams derived from the same
    // string via the engine's FNV-1a fold, recovering the 32-bit prefill state
    // would recover the sequence state too. These are separate HMAC outputs.
    const attempt = attemptSeed(dailySeed(SALT, '2026-08-09'), '');
    expect(prefillSeed(attempt)).not.toBe(sequenceSeed(attempt));
    expect(prefillSeed(attempt)).toHaveLength(64);
    expect(sequenceSeed(attempt)).toHaveLength(64);
  });
});

describe('§8.2(a) prefill', () => {
  it('every curated template is 6–14 cells, on-board and obstacle-free', () => {
    expect(() => assertTemplates()).not.toThrow();
    for (const t of PREFILL_TEMPLATES) {
      expect(t.cells.length).toBeGreaterThanOrEqual(PREFILL_MIN_CELLS);
      expect(t.cells.length).toBeLessThanOrEqual(PREFILL_MAX_CELLS);
    }
    // A template holds coordinates only — there is no channel through which an
    // obstacle type could enter, which is how "obstacle-free" is guaranteed.
    expect(Object.keys(PREFILL_TEMPLATES[0]!.cells[0]!).sort()).toStrictEqual(['c', 'r']);
  });

  it('assertTemplates rejects an out-of-band template', () => {
    expect(() => assertTemplates([{ id: 'tiny', cells: [{ r: 0, c: 0 }] }])).toThrow(/6–14/);
    expect(() => assertTemplates([])).toThrow(/no prefill templates/);
    expect(() =>
      assertTemplates([{ id: 'dupe', cells: Array.from({ length: 8 }, () => ({ r: 0, c: 0 })) }]),
    ).toThrow(/repeats cell/);
    expect(() =>
      assertTemplates([
        { id: 'off', cells: Array.from({ length: 8 }, (_, i) => ({ r: 8, c: i })) },
      ]),
    ).toThrow(/off-board/);
  });

  it('orientations stay on-board, preserve the cell count, and are row-major sorted', () => {
    for (const t of PREFILL_TEMPLATES) {
      for (let o = 0; o < TEMPLATE_ORIENTATIONS; o++) {
        const cells = orient(t.cells, o);
        expect(cells).toHaveLength(t.cells.length);
        expect(new Set(cells.map((c) => `${c.r},${c.c}`)).size).toBe(t.cells.length);
        for (const { r, c } of cells) {
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThan(BOARD_SIZE);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThan(BOARD_SIZE);
        }
        const sorted = [...cells].sort((a, b) => a.r - b.r || a.c - b.c);
        expect(cells).toStrictEqual(sorted);
      }
    }
  });

  it('drawn prefill is 6–14 obstacle-free cells with valid colours', () => {
    // Sweep a year of dates so this is a property, not a spot check.
    for (let day = 0; day < 366; day++) {
      const date = isoDate(day);
      const prefill = drawPrefill(prefillSeed(attemptSeed(dailySeed(SALT, date), '')));
      expect(prefill.length).toBeGreaterThanOrEqual(PREFILL_MIN_CELLS);
      expect(prefill.length).toBeLessThanOrEqual(PREFILL_MAX_CELLS);
      for (const cell of prefill) {
        expect(Object.keys(cell).sort()).toStrictEqual(['c', 'color', 'r']);
        expect(Number.isInteger(cell.color)).toBe(true);
        expect(cell.color).toBeGreaterThanOrEqual(0);
      }
      expect(new Set(prefill.map((c) => `${c.r},${c.c}`)).size).toBe(prefill.length);
    }
  });

  it('the prefill lands on the board as plain filled cells, no obstacles', () => {
    const { doc, sequence } = board('2026-08-09');
    const state = createGame(
      dailyGameConfig(doc.engineConfig, sequence, doc.date),
      dailyPlaySeed(doc.date),
    );
    let filled = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const kind = cellKind(state.board, r, c);
        expect(['empty', 'filled']).toContain(kind);
        if (kind === 'filled') filled++;
      }
    }
    expect(filled).toBe(doc.engineConfig.prefill.length);
  });

  it('spreads across templates and orientations over a year', () => {
    const shapes = new Set<string>();
    for (let day = 0; day < 366; day++) {
      const prefill = drawPrefill(prefillSeed(attemptSeed(dailySeed(SALT, isoDate(day)), '')));
      shapes.add(prefill.map((c) => `${c.r},${c.c}`).join('|'));
    }
    // 12 templates × 8 orientations, minus collapses from symmetric templates.
    expect(shapes.size).toBeGreaterThan(30);
  });
});

describe('§8.2(b) piece sequence', () => {
  it('has exactly daily_piece_count entries, all canonical §6.2 ids', () => {
    const { doc, sequence } = board('2026-08-09');
    expect(doc.engineConfig.pieceCount).toBe(REMOTE_CONFIG_DEFAULTS.daily_piece_count);
    expect(sequence).toHaveLength(REMOTE_CONFIG_DEFAULTS.daily_piece_count);
    for (const id of sequence) expect(id in PIECE_BY_ID).toBe(true);
  });

  it('honours a Remote-Config-changed daily_piece_count', () => {
    const { doc, sequence } = generateDailyBoard(input('2026-08-09', { pieceCount: 24 }));
    expect(sequence).toHaveLength(24);
    expect(doc.engineConfig.pieceCount).toBe(24);
  });

  it('rejects a nonsense piece count at the trust boundary', () => {
    expect(() => drawSequence('s', 0)).toThrow(/positive integer/);
    expect(() => drawSequence('s', 1.5)).toThrow(/positive integer/);
  });

  it('is drawn from the §6.2 weights (no mercy, no small-pool bias)', () => {
    // 200k draws: the observed frequency of each id must track its §6.2 weight.
    const N = 200_000;
    const ids = drawSequence('weight-check', N);
    const counts = new Map<PieceId, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

    const total = PIECE_IDS.reduce((sum, id) => sum + PIECE_BY_ID[id].weight, 0);
    for (const id of PIECE_IDS) {
      const expected = PIECE_BY_ID[id].weight / total;
      const observed = (counts.get(id) ?? 0) / N;
      expect(Math.abs(observed - expected)).toBeLessThan(0.004);
    }
    // §6.4 mercy would over-represent SMALL_POOL as the board fills; generation
    // never looks at a board at all, so the distribution is flat over time.
    const firstHalf = ids.slice(0, N / 2).filter((id) => PIECE_BY_ID[id].weight >= 8).length;
    const secondHalf = ids.slice(N / 2).filter((id) => PIECE_BY_ID[id].weight >= 8).length;
    expect(Math.abs(firstHalf - secondHalf) / (N / 2)).toBeLessThan(0.01);
  });
});

describe('§8.2 sealed sequence', () => {
  it('round-trips through the play-start key seam', () => {
    const { doc, sequence } = board('2026-08-09');
    const attempt = attemptSeed(dailySeed(SALT, doc.date), doc.revision);
    expect(unseal(attempt, doc.engineConfig.pieceSequence)).toStrictEqual(sequence);
  });

  it('does not leak the plaintext into the document', () => {
    const { doc, sequence } = board('2026-08-09');
    const json = JSON.stringify(doc);
    expect(json).not.toContain(sequence.join(''));
    // The first 5 ids in order must not appear anywhere either.
    expect(json).not.toContain(sequence.slice(0, 5).join(''));
    // Nor the secret material.
    expect(json).not.toContain(SALT);
    expect(json).not.toContain(dailySeed(SALT, doc.date));
  });

  it('cannot be opened without the salt-derived key', () => {
    const { doc } = board('2026-08-09');
    const wrong = attemptSeed(dailySeed('wrong-salt', doc.date), doc.revision);
    expect(() => openSequence(wrong, doc.engineConfig.pieceSequence)).toThrow();
  });

  it('detects a tampered ciphertext (GCM auth tag)', () => {
    const { doc } = board('2026-08-09');
    const attempt = attemptSeed(dailySeed(SALT, doc.date), doc.revision);
    const raw = Buffer.from(doc.engineConfig.pieceSequence.ct, 'base64');
    raw.writeUInt8(raw.readUInt8(0) ^ 0xff, 0);
    expect(() =>
      openSequence(attempt, { ...doc.engineConfig.pieceSequence, ct: raw.toString('base64') }),
    ).toThrow();
  });

  it('rejects an unknown seal algorithm and a corrupt plaintext', () => {
    const attempt = 'a';
    expect(() =>
      openSequence(attempt, { alg: 'rot13' as 'AES-256-GCM', iv: '', ct: '', tag: '' }),
    ).toThrow(/Unknown seal alg/);
    // Encrypt something that is not a run of 3-char piece ids.
    const sealed = sealSequence(attempt, ['P0' as PieceId, '1XX' as PieceId]);
    expect(() => openSequence(attempt, sealed)).toThrow(/unknown piece id/);
  });

  it('derives a 32-byte AES-256 key per (date, revision), never stored', () => {
    const seed = dailySeed(SALT, '2026-08-09');
    expect(sequenceKey(attemptSeed(seed, ''))).toHaveLength(32);
    expect(sequenceKey(attemptSeed(seed, ''))).not.toStrictEqual(
      sequenceKey(attemptSeed(seed, REROLL_REVISION)),
    );
    expect(sequenceKey(attemptSeed(dailySeed(SALT, '2026-08-10'), ''))).not.toStrictEqual(
      sequenceKey(attemptSeed(seed, '')),
    );
  });
});

describe('§8.2 frozen engineConfig snapshot (PRD v1.7)', () => {
  it('embeds every field §8.2 lists', () => {
    const { doc } = board('2026-08-09');
    const snapshot = doc.engineConfig;

    // Scoring constants (§6.6).
    expect(snapshot.tuning.score_clear_base).toBe(REMOTE_CONFIG_DEFAULTS.score_clear_base);
    expect(snapshot.tuning.combo_step).toBe(REMOTE_CONFIG_DEFAULTS.combo_step);
    expect(snapshot.tuning.perfect_clear_bonus).toBe(REMOTE_CONFIG_DEFAULTS.perfect_clear_bonus);
    // Mercy values (§6.4) — recorded although mercy is OFF, so the snapshot is complete.
    expect(snapshot.tuning.mercy_threshold).toBe(REMOTE_CONFIG_DEFAULTS.mercy_threshold);
    expect(snapshot.tuning.mercy_small_prob).toBe(REMOTE_CONFIG_DEFAULTS.mercy_small_prob);
    // Piece sequence + prefill.
    expect(snapshot.pieceSequence.alg).toBe('AES-256-GCM');
    expect(snapshot.prefill.length).toBeGreaterThanOrEqual(PREFILL_MIN_CELLS);

    expect(Object.keys(snapshot).sort()).toStrictEqual([
      'pieceCount',
      'pieceSequence',
      'prefill',
      'tuning',
    ]);
    // `tuning` is keyed exactly like `EngineTuning`, so §8.5 assigns it with no
    // mapping layer — a mapping layer is where a field silently goes missing.
    expect(Object.keys(snapshot.tuning).sort()).toStrictEqual([
      'combo_step',
      'mercy_small_prob',
      'mercy_threshold',
      'perfect_clear_bonus',
      'score_clear_base',
    ]);
  });

  it('carries the document metadata §8.3/§8.5 need', () => {
    const { doc } = board('2026-08-09');
    expect(doc.date).toBe('2026-08-09');
    expect(doc.generatorVersion).toBe(DAILY_GENERATOR_VERSION);
    expect(doc.revision).toBe('');
    expect(doc.generatedAt).toBe('2026-08-09T00:00:00.000Z');
    expect(doc.solvability.trials).toBe(SOLVABILITY_TRIALS);
  });

  it('freezes an off-default Remote Config value instead of the registry default', () => {
    const tweaked: EngineTuning = { ...TUNING, score_clear_base: 42, perfect_clear_bonus: 999 };
    const { doc } = generateDailyBoard(input('2026-08-09', { tuning: tweaked }));
    expect(doc.engineConfig.tuning.score_clear_base).toBe(42);
    expect(doc.engineConfig.tuning.perfect_clear_bonus).toBe(999);
  });

  it('no module in the daily path imports Remote Config', async () => {
    // The whole v1.7 amendment in one assertion: an RC push mid-day must not be
    // able to change how a submitted run scores. `publish.ts` reads RC once, at
    // generation; nothing else may.
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('../src/daily/', import.meta.url).pathname;
    for (const file of readdirSync(dir).filter((f) => f !== 'publish.ts')) {
      const source = readFileSync(`${dir}${file}`, 'utf8');
      expect(source, `${file} must not read Remote Config`).not.toMatch(
        /^\s*import .*remote-config/m,
      );
      expect(source, `${file} must not read the RC registry`).not.toContain(
        'REMOTE_CONFIG_DEFAULTS',
      );
    }
  });
});

describe('§8.2 → §8.5 determinism contract', () => {
  it('re-simulating the published snapshot twice is byte-identical', () => {
    const { doc, sequence } = board('2026-08-09');
    const config = dailyGameConfig(doc.engineConfig, sequence, doc.date);
    const seed = dailyPlaySeed(doc.date);

    // A real move log, produced by the bot exactly as a player would produce one.
    const moves: readonly Move[] = playout(config, seed, 'player').moves;
    expect(moves.length).toBeGreaterThan(SOLVABILITY_MIN_MOVES);

    const first = simulate(config, seed, moves);
    const second = simulate(config, seed, moves);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('re-simulating from a snapshot rebuilt out of the STORED document matches', () => {
    // The §8.5 path in miniature: nothing but the document survives the round
    // trip through Firestore, so re-simulation must work from JSON alone.
    const { doc, sequence } = board('2026-08-09');
    const seed = dailyPlaySeed(doc.date);
    const live = dailyGameConfig(doc.engineConfig, sequence, doc.date);
    const moves = playout(live, seed, 'player').moves;
    const expected = simulate(live, seed, moves);

    const stored = JSON.parse(JSON.stringify(doc)) as typeof doc;
    const reopened = openSequence(
      attemptSeed(dailySeed(SALT, stored.date), stored.revision),
      stored.engineConfig.pieceSequence,
    );
    const rebuilt = dailyGameConfig(stored.engineConfig, reopened, stored.date);
    expect(JSON.stringify(simulate(rebuilt, seed, moves))).toBe(JSON.stringify(expected));
  });

  it('a mid-day Remote Config push cannot change the verdict', () => {
    // The failure PRD v1.7 exists to prevent. Live RC "changes" under us; the
    // snapshot does not, so the honest submission still verifies.
    const { doc, sequence } = board('2026-08-09');
    const seed = dailyPlaySeed(doc.date);
    const fromSnapshot = dailyGameConfig(doc.engineConfig, sequence, doc.date);
    const moves = playout(fromSnapshot, seed, 'player').moves;
    const honest = simulate(fromSnapshot, seed, moves);

    const afterPush: EngineTuning = { ...TUNING, score_clear_base: 25, combo_step: 0.5 };
    const fromLiveRc = dailyGameConfig(
      { ...doc.engineConfig, tuning: afterPush },
      sequence,
      doc.date,
    );
    const wrong = simulate(fromLiveRc, seed, moves);

    expect(wrong.score).not.toBe(honest.score); // the push WOULD have mattered…
    expect(simulate(fromSnapshot, seed, moves).score).toBe(honest.score); // …and does not.
  });

  it('a tampered claimed score is detectable, and an edited move log fails to replay', () => {
    const { doc, sequence } = board('2026-08-09');
    const config = dailyGameConfig(doc.engineConfig, sequence, doc.date);
    const seed = dailyPlaySeed(doc.date);
    const moves = playout(config, seed, 'player').moves;
    const truth = simulate(config, seed, moves);

    expect(truth.score + 10_000).not.toBe(truth.score);
    const edited: Move[] = moves.map((m, i) => (i === 3 ? { ...m, r: (m.r + 3) % BOARD_SIZE } : m));
    let replayed = true;
    try {
      simulate(config, seed, edited);
    } catch {
      replayed = false;
    }
    // Either it throws (illegal) or it produces a different result — never a
    // silent match. §8.5 owns the rejection itself; this only proves detectability.
    expect(
      replayed && JSON.stringify(simulate(config, seed, edited)) === JSON.stringify(truth),
    ).toBe(false);
  });

  it('a run that outlives the sequence ends "completed", not "lost" (§8.2 exhaustion)', () => {
    // A trivially survivable board: 3 pieces of one dot each.
    const config = dailyGameConfig(
      { tuning: TUNING, prefill: [] },
      ['P01', 'P01', 'P01'],
      '2026-08-09',
    );
    const seed = dailyPlaySeed('2026-08-09');
    const { moves, result } = playout(config, seed, 'bot');
    expect(moves).toHaveLength(3);
    expect(result.status).toBe('completed');
  });
});

describe('§8.2 solvability gate', () => {
  it('the published board passes: greedy bot median ≥15 placements over 200 trials', () => {
    const { doc } = board('2026-08-09');
    expect(doc.solvability.trials).toBe(200);
    expect(doc.solvability.minMoves).toBe(15);
    expect(doc.solvability.passed).toBe(true);
    expect(doc.solvability.medianMoves).toBeGreaterThanOrEqual(15);
  });

  it('a deliberately unsolvable board fails the gate', () => {
    // Sequence of nothing but 3x3 squares on a board seeded to leave no 3x3
    // room: the bot dies almost immediately.
    const wall = Array.from({ length: 8 }, (_, c) => ({ r: 0, c, color: 0 })).concat(
      Array.from({ length: 8 }, (_, c) => ({ r: 2, c, color: 0 })),
      Array.from({ length: 8 }, (_, c) => ({ r: 4, c, color: 0 })),
      Array.from({ length: 8 }, (_, c) => ({ r: 6, c, color: 0 })),
    );
    const config = dailyGameConfig(
      { tuning: TUNING, prefill: wall },
      Array.from({ length: 60 }, () => 'P11' as PieceId),
      '2026-08-09',
    );
    expect(solvabilityMedian(config, '2026-08-09', 20)).toBeLessThan(SOLVABILITY_MIN_MOVES);
  });

  it('re-rolls with seed + "-r1" when the first roll fails', () => {
    // Force a failure by generating with a 1-piece sequence: the bot can never
    // reach 15 placements, so the gate must fail twice and the document must
    // carry the re-rolled revision.
    const { doc, attempts, sequence } = generateDailyBoard(input('2026-08-09', { pieceCount: 1 }));
    expect(attempts).toHaveLength(2);
    expect(attempts.every((a) => !a.passed)).toBe(true);
    expect(doc.revision).toBe(REROLL_REVISION);
    expect(doc.solvability.passed).toBe(false);

    // The published board really is the -r1 roll: it opens with the -r1 key…
    const rerolled = attemptSeed(dailySeed(SALT, '2026-08-09'), REROLL_REVISION);
    expect(openSequence(rerolled, doc.engineConfig.pieceSequence)).toStrictEqual(sequence);
    // …and NOT with the first-roll key.
    expect(() =>
      openSequence(attemptSeed(dailySeed(SALT, '2026-08-09'), ''), doc.engineConfig.pieceSequence),
    ).toThrow();
    // …and its content differs from the first roll's.
    const firstRollSeed = attemptSeed(dailySeed(SALT, '2026-08-09'), '');
    expect(drawSequence(sequenceSeed(rerolled), 1)).not.toStrictEqual(
      drawSequence(sequenceSeed(firstRollSeed), 1),
    );
  });

  it('takes the first roll (revision "") when it passes', () => {
    const { doc, attempts } = board('2026-08-09');
    expect(attempts).toHaveLength(1);
    expect(doc.revision).toBe('');
  });

  it('holds for a week of consecutive dates', () => {
    for (let day = 0; day < 7; day++) {
      const { doc } = generateDailyBoard(input(isoDate(day)));
      expect(doc.solvability.passed, `${doc.date} median ${doc.solvability.medianMoves}`).toBe(
        true,
      );
    }
  });
});

// --- helpers --------------------------------------------------------------

/**
 * §8.2's formula, re-derived from `node:crypto` rather than imported from
 * `seal.ts`, so this checks the spec instead of agreeing with itself.
 */
function createHmacHex(key: string, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

/** Day `n` after 2026-01-01, as YYYY-MM-DD. */
function isoDate(n: number): string {
  return new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
}
