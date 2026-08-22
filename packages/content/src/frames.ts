/**
 * Cosmetic avatar frames — the PRD §7.10 chest reward.
 *
 * §7.10: "Chest at L10/20/30… (Stage 1 reward: cosmetic avatar frames; coins
 * retrofit in Stage 2)." Coins, wallet and every other economy surface are
 * Stage 2 (§9.1) and are deliberately absent here: a chest grants exactly one
 * frame id, which the client persists. CLAUDE.md rule 6 ("content is data")
 * is why the frame set is this JSON file rather than a literal in a screen —
 * adding or renaming a frame is a content edit, not a logic edit.
 *
 * Frame ids are permanent (they are persisted in the player's save and,
 * from Stage 2 on, will be server-visible). Display names are NOT here:
 * they are i18n keys in the app (`frames.<id>.name`), so this package stays
 * locale-free.
 */
import { z } from 'zod';
import framesJson from '../frames/avatarFrames.json';
import { MAX_LEVEL_ID } from './levels';

export const avatarFrameSchema = z.object({
  /** Permanent, persisted id. */
  id: z.string().min(1),
  /** The §7.10 chest that grants it. */
  chestLevel: z.number().int().positive(),
});

export type AvatarFrame = z.infer<typeof avatarFrameSchema>;

export const AVATAR_FRAMES: readonly AvatarFrame[] = z.array(avatarFrameSchema).parse(framesJson);

/** §7.10 "Chest at L10/20/30…" — the rhythm, as a number rather than six literals. */
export const CHEST_INTERVAL = 10;

/** Every chest level in the shipped range: L10, L20, … up to `MAX_LEVEL_ID`. */
export const CHEST_LEVELS: readonly number[] = Array.from(
  { length: Math.floor(MAX_LEVEL_ID / CHEST_INTERVAL) },
  (_, i) => (i + 1) * CHEST_INTERVAL,
);

/** The frame a chest pays out, or `undefined` if `level` carries no chest. */
export function frameForChest(level: number): AvatarFrame | undefined {
  return AVATAR_FRAMES.find((f) => f.chestLevel === level);
}
