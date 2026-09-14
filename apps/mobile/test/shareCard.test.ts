import { BOARD_SIZE, type CellKind } from '@blockmanor/engine';
import { describe, expect, it } from 'vitest';
import { blockColors } from '../src/components/tokens';
import { shareCardModel, shareMessage } from '../src/game/shareCard';

const N = BOARD_SIZE * BOARD_SIZE;
const emptyBoard = () => ({
  kinds: Array.from({ length: N }, (): CellKind => 'empty'),
  colors: Array.from({ length: N }, () => 0),
});

describe('§8.7 share card content', () => {
  it('is spoiler-free: a colour per filled cell and nothing else', () => {
    const board = emptyBoard();
    board.kinds[0] = 'filled';
    board.colors[0] = 1;
    board.kinds[63] = 'filled';
    board.colors[63] = 8; // wraps onto the 7-colour palette, like the renderer
    const model = shareCardModel({
      board,
      score: 8420,
      percentile: 11,
      streak: 12,
      installUrl: 'https://blockmanor.game',
    });
    expect(model.cells).toHaveLength(N);
    expect(model.cells[0]).toBe(blockColors.teal);
    expect(model.cells[63]).toBe(blockColors.teal);
    expect(model.cells.filter((c) => c !== null)).toHaveLength(2);
    expect(model.cells.every((c) => c === null || /^#[0-9A-F]{6}$/i.test(c))).toBe(true);
  });

  it('carries "Top X% · 🔥N · Block Manor", the score, and the install link', () => {
    const model = shareCardModel({
      board: emptyBoard(),
      score: 8420,
      percentile: 11,
      streak: 12,
      installUrl: 'https://blockmanor.game',
    });
    expect(model.score).toBe('8,420');
    expect(model.tagline).toBe('Top 11% · 🔥12 · Block Manor');
    expect(model.footer).toContain('https://blockmanor.game');
    expect(shareMessage(model)).toBe(
      '8,420 · Top 11% · 🔥12 · Block Manor\nhttps://blockmanor.game',
    );
  });

  it('drops the percentile for Early bird and the flame at streak 0 rather than printing blanks', () => {
    const model = shareCardModel({
      board: emptyBoard(),
      score: 40,
      percentile: null,
      streak: 0,
      installUrl: 'https://x.test',
    });
    expect(model.tagline).toBe('Block Manor');
  });
});
