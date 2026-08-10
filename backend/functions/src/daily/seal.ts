/**
 * Daily-Board seed derivation and sequence sealing — PRD §8.2, §16.
 *
 * §8.2: `seed = HMAC_SHA256(secretSalt, "YYYY-MM-DD")`, and the board doc is
 * published "with the sequence ENCRYPTED; client receives decryption via the
 * play-start callable → prevents pre-computing".
 *
 * §16: "Secrets in EAS/Firebase env config, never in repo. Daily-board salt only
 * in Functions config." Nothing in this file reads the salt — it is passed in by
 * `publish.ts`, which binds the `DAILY_BOARD_SALT` secret to the function. That
 * keeps every function here pure and unit-testable with a throwaway salt.
 *
 * Threat model, stated plainly: this protects PRE-computation only. Once any
 * client starts today's board it holds today's sequence, and §8.1 makes the
 * board globally identical anyway. What sealing buys is that nobody can solve
 * the board before the play-start callable hands them the key — which is exactly
 * what §8.2 asks for, and no more.
 */

import { PIECE_BY_ID, type PieceId } from '@blockmanor/engine';
import { type SealedSequence } from '@blockmanor/shared';
import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto';

const CIPHER = 'aes-256-gcm';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Each `PieceId` is exactly 3 chars, so the plaintext needs no separators. */
const PIECE_ID_LENGTH = 3;

function hmac(key: string | Buffer, message: string): Buffer {
  return createHmac('sha256', key).update(message, 'utf8').digest();
}

/**
 * §8.2's literal seed. Hex rather than raw bytes because the re-roll is specified
 * as string concatenation (`seed + "-r1"`) and the engine's RNG is seeded from a
 * string (§4.3).
 */
export function dailySeed(secretSalt: string, date: string): string {
  if (secretSalt.length === 0) throw new Error('PRD §16: daily-board salt is empty');
  if (!DATE_RE.test(date)) throw new Error(`PRD §8.2: date must be YYYY-MM-DD, got "${date}"`);
  return hmac(secretSalt, date).toString('hex');
}

/** §8.2 re-roll: `seed + "-r1"`. `revision` is `''` for the first attempt. */
export const attemptSeed = (seed: string, revision: string): string => `${seed}${revision}`;

/**
 * Two INDEPENDENT sub-seeds per attempt, both PRF outputs of the attempt seed.
 *
 * This is load-bearing, not decoration. The engine's `createRng` folds a string
 * into 32 bits of mulberry32 state via FNV-1a, and FNV-1a with a fixed suffix is
 * invertible on that state. Deriving both streams as `attemptSeed + "|prefill"`
 * and `attemptSeed + "|sequence"` would therefore let anyone brute-force the
 * 2^32 prefill seeds against the PUBLISHED prefill, invert to the shared state,
 * and recompute the sealed sequence — defeating §8.2's encryption entirely.
 * Independent HMACs break that link.
 */
export const prefillSeed = (attempt: string): string => hmac(attempt, 'prefill').toString('hex');
export const sequenceSeed = (attempt: string): string => hmac(attempt, 'sequence').toString('hex');

/**
 * The key handed to a client by the §8.3 play-start callable. Derived, never
 * stored: recomputing it needs the salt, so possession of the published document
 * reveals nothing.
 */
export const sequenceKey = (attempt: string): Buffer => hmac(attempt, 'sequence-key');

/**
 * The IV is derived, not random, so the whole published document is a pure
 * function of (salt, date, revision, RC snapshot). That makes a retried
 * scheduler run byte-identical to the first, and makes "same date → same board"
 * testable on the document itself. Safe because the key is unique per
 * (date, revision) and encrypts exactly one message — the IV-reuse hazard of
 * GCM needs key reuse, which cannot happen here.
 */
const sequenceIv = (attempt: string): Buffer => hmac(attempt, 'sequence-iv').subarray(0, 12);

export function sealSequence(attempt: string, sequence: readonly PieceId[]): SealedSequence {
  const cipher = createCipheriv(CIPHER, sequenceKey(attempt), sequenceIv(attempt));
  const ct = Buffer.concat([cipher.update(sequence.join(''), 'utf8'), cipher.final()]);
  return {
    alg: 'AES-256-GCM',
    iv: sequenceIv(attempt).toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/**
 * The other half of the seam: §8.3 (play start) and §8.5 (re-simulation) both
 * recover the plaintext sequence through this. Throws on a tampered document —
 * GCM authenticates, so a doctored `ct` fails here rather than silently
 * producing a different board.
 */
export function openSequence(attempt: string, sealed: SealedSequence): PieceId[] {
  if (sealed.alg !== 'AES-256-GCM') throw new Error(`Unknown seal alg "${sealed.alg}"`);
  const decipher = createDecipheriv(CIPHER, sequenceKey(attempt), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(sealed.ct, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  const ids: PieceId[] = [];
  for (let i = 0; i < plain.length; i += PIECE_ID_LENGTH) {
    const id = plain.slice(i, i + PIECE_ID_LENGTH);
    if (!(id in PIECE_BY_ID)) throw new Error(`Sealed sequence holds unknown piece id "${id}"`);
    ids.push(id as PieceId);
  }
  return ids;
}
