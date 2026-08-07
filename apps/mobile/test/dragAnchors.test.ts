import { describe, expect, it } from 'vitest';
import { clampToGrid, isNearBoard, nearestAnchor } from '../src/game/dragAnchors';

const CELL = 40; // px, arbitrary for these unit tests

describe('nearestAnchor (PRD §7.3 0.6-cell snap radius)', () => {
  const anchors = [
    { r: 0, c: 0 },
    { r: 2, c: 3 },
    { r: 5, c: 5 },
  ];

  it('picks the anchor exactly under the piece', () => {
    expect(nearestAnchor(anchors, 3 * CELL, 2 * CELL, CELL, 0.6)).toEqual({ r: 2, c: 3 });
  });

  it('snaps within the 0.6-cell radius', () => {
    const within = nearestAnchor(anchors, 3 * CELL + 0.5 * CELL, 2 * CELL, CELL, 0.6);
    expect(within).toEqual({ r: 2, c: 3 });
  });

  it('does not snap just outside the 0.6-cell radius', () => {
    const outside = nearestAnchor(anchors, 3 * CELL + 0.7 * CELL, 2 * CELL, CELL, 0.6);
    expect(outside).toBeNull();
  });

  it('returns null with no candidate anchors', () => {
    expect(nearestAnchor([], 0, 0, CELL, 0.6)).toBeNull();
  });

  it('picks the CLOSER of two anchors both within radius', () => {
    const close = [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
    ];
    // 0.3 cells from (0,0), 0.7 cells from (0,1) — only (0,0) is in range,
    // and it is also the nearer one.
    expect(nearestAnchor(close, 0.3 * CELL, 0, CELL, 0.6)).toEqual({ r: 0, c: 0 });
  });
});

describe('clampToGrid (illegal-hover ghost fallback position)', () => {
  it('rounds to the nearest cell', () => {
    expect(clampToGrid(2.6 * CELL, 1.4 * CELL, CELL, 1, 1, 8)).toEqual({ r: 1, c: 3 });
  });

  it('clamps negative positions to row/col 0', () => {
    expect(clampToGrid(-5 * CELL, -5 * CELL, CELL, 1, 1, 8)).toEqual({ r: 0, c: 0 });
  });

  it('clamps so a wide piece never rounds off the board', () => {
    // 8-wide board, a 3-wide piece: max legal col anchor is 5.
    expect(clampToGrid(50 * CELL, 0, CELL, 1, 3, 8)).toEqual({ r: 0, c: 5 });
  });
});

describe('isNearBoard (ghost visibility)', () => {
  const gridSize = 8 * CELL;

  it('is true over the board interior', () => {
    expect(isNearBoard(3 * CELL, 3 * CELL, gridSize, CELL, 1)).toBe(true);
  });

  it('is true just outside the edge, within the margin', () => {
    expect(isNearBoard(-0.5 * CELL, 3 * CELL, gridSize, CELL, 1)).toBe(true);
  });

  it('is false well outside the board (still over the tray)', () => {
    expect(isNearBoard(3 * CELL, gridSize + 5 * CELL, gridSize, CELL, 1)).toBe(false);
  });
});
