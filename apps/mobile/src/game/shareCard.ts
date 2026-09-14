/**
 * §8.7 share card CONTENT — pure, so the spoiler-free rule is testable without
 * a GPU. The Skia drawing (`renderShareCard`) only paints what this returns.
 *
 * "spoiler-free mini-grid of final board (colors only, no numbers except
 * score), score, 'Top X% · 🔥N · Block Manor', store-badged footer + install
 * link". The grid carries a colour per cell and nothing else: no positions of
 * pieces, no tray, no sequence — the mockup's note "the board can't be
 * reverse-engineered from a share".
 */

import { BOARD_SIZE, type Board } from '@blockmanor/engine';
import { blockColors } from '../components/tokens';
import { t } from '../i18n';
import { formatScore } from '../i18n/format';

const PALETTE: readonly string[] = Object.values(blockColors);

export interface ShareCardModel {
  /** Row-major BOARD_SIZE × BOARD_SIZE; a hex colour for a filled cell, null if empty. */
  cells: (string | null)[];
  score: string;
  /** "Top X% · 🔥N · Block Manor" (percentile and flame dropped when absent). */
  tagline: string;
  footer: string;
  installUrl: string;
}

export function shareCardModel(input: {
  board: Pick<Board, 'kinds' | 'colors'>;
  score: number;
  percentile: number | null;
  streak: number;
  installUrl: string;
}): ShareCardModel {
  const cells = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => {
    const kind = input.board.kinds[i];
    if (!kind || kind === 'empty') return null;
    const n = PALETTE.length;
    const colorId = input.board.colors[i] ?? 0;
    return PALETTE[((colorId % n) + n) % n] ?? null;
  });
  const tagline = [
    ...(input.percentile === null ? [] : [t('share.top', { percent: input.percentile })]),
    ...(input.streak > 0 ? [t('share.streak', { n: input.streak })] : []),
    t('share.brand'),
  ].join(' · ');
  return {
    cells,
    score: formatScore(input.score),
    tagline,
    footer: t('share.footer', { url: input.installUrl }),
    installUrl: input.installUrl,
  };
}

/** The text that travels with the image (WhatsApp shows it as the caption). */
export function shareMessage(model: ShareCardModel): string {
  return `${model.score} · ${model.tagline}\n${model.installUrl}`;
}
