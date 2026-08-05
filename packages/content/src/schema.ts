/**
 * Level JSON schema — PRD §7.7, the authoring-time gate.
 *
 * PRD §16 rule 6: "levels/story/economy in `packages/content` JSON with zod
 * schemas". This is that schema. It is deliberately NOT the engine's
 * `validateLevel` (§4.2 keeps the engine zero-dep): the two check the same
 * shape at different boundaries, so `levelSchema` parses what an author or the
 * generator wrote, and the engine re-validates whatever reaches it at runtime.
 * `parseLevel` below runs both, so a level that satisfies zod but trips the
 * engine's checks cannot be committed.
 */

import { PIECE_IDS, validateLevel, type LevelConfig, type PieceId } from '@blockmanor/engine';
import { z } from 'zod';

/** The §6.2 piece table is the authority on which IDs exist — never a regex. */
const pieceIdSchema = z.enum(PIECE_IDS as unknown as [PieceId, ...PieceId[]]);

/** §7.8 obstacle types plus a plain block, as they appear in `prefill`. */
export const prefillTypeSchema = z.enum(['filled', 'crate', 'crate2', 'chain', 'ivy', 'heirloom']);

/** §7.8: `crate2` is NOT a goal type — its 2nd hit credits `crate` (PRD v1.6). */
export const goalTypeSchema = z.enum(['crate', 'chain', 'ivy', 'heirloom']);

const cell = z.number().int().min(0).max(7);

export const levelSchema = z
  .object({
    // --- required (§7.7) ---
    id: z.number().int().positive(),
    chapter: z.number().int().positive(),
    seedSalt: z.string().min(1),
    stars: z.object({ s2: z.number().int().nonnegative(), s3: z.number().int().nonnegative() }),

    // --- optional with defaults (§7.7) ---
    prefill: z
      .array(
        z.object({
          r: cell,
          c: cell,
          type: prefillTypeSchema,
          color: z.number().int().min(0).optional(),
        }),
      )
      .default([]),
    goals: z
      .array(z.object({ type: goalTypeSchema, count: z.number().int().positive() }))
      .default([]),
    pieceWeightOverrides: z.record(pieceIdSchema, z.number().nonnegative()).default({}),
    mercy: z.boolean().default(true),
    ivySpreadInterval: z.number().int().positive().default(3),
    ivyMaxTiles: z.number().int().positive().default(16),

    // --- optional harness-written metadata (§7.7); the engine never reads these ---
    estMoves: z.number().int().nonnegative().optional(),
    difficultyTier: z.string().optional(),
  })
  .strict()
  .refine((l) => l.stars.s3 >= l.stars.s2, {
    message: 'stars.s3 must be >= stars.s2 (§7.5: s3 is the harder threshold)',
    path: ['stars'],
  })
  .refine((l) => new Set(l.prefill.map((p) => `${p.r},${p.c}`)).size === l.prefill.length, {
    message: 'prefill contains duplicate cells',
    path: ['prefill'],
  })
  .refine(
    (l) => l.goals.every((g) => g.type !== 'ivy' || l.prefill.some((p) => p.type === 'ivy')),
    {
      message: 'an ivy goal needs at least one ivy tile in prefill — it would be unreachable',
      path: ['goals'],
    },
  );

export type LevelJson = z.input<typeof levelSchema>;

/**
 * Parse level JSON through BOTH gates and return what the engine will actually
 * run. Use this everywhere a level is loaded — never `levelSchema.parse` alone.
 */
export function parseLevel(input: unknown): LevelConfig {
  return validateLevel(levelSchema.parse(input));
}
