/**
 * PRD §7.1 FTUE — the scripted L1–L5 configs (§0 v1.11).
 *
 * Hand-authored teaching boards, not generator output: each carries a designed
 * `prefill` plus a fixed `pieceSequence` (§4.3) built so the level's specific
 * teaching beat fires and the level is winnable by that exact sequence. Exempt
 * from the §7.9 bot-measured targets and ±10pp band — see `balance/ftue.bal.ts`
 * for the replay gate that replaces it.
 */

import l1 from '../levels/001.json';
import l2 from '../levels/002.json';
import l3 from '../levels/003.json';
import l4 from '../levels/004.json';
import l5 from '../levels/005.json';
import { levelSchema, type LevelJson } from './schema';

/** L1..L5, in FTUE step order. Each has already run the §7.7 zod gate. */
export const FTUE_LEVELS: readonly LevelJson[] = [l1, l2, l3, l4, l5].map(
  (json) => levelSchema.parse(json) as LevelJson,
);
