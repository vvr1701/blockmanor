/**
 * `buildMapNodes` / `initialNodeIndex` — the structural half of PRD §7.10,
 * asserted without rendering: chapters, medallion states, chest placement and
 * "map scrolls to current level on open".
 */
import {
  AVATAR_FRAMES,
  CHEST_INTERVAL,
  CHEST_LEVELS,
  LEVELS,
  MAX_LEVEL_ID,
  frameForChest,
} from '@blockmanor/content';
import { describe, expect, it } from 'vitest';
import {
  buildMapNodes,
  initialNodeIndex,
  pathOffset,
  type ChapterNode,
  type ChestNode,
  type LevelNode,
  type MapProgress,
} from '../src/screens/LevelMapScreen/mapNodes';

function progress(over: Partial<MapProgress> = {}): MapProgress {
  return { currentLevel: 1, stars: {}, chestsClaimed: {}, ...over };
}

const levels = (nodes: ReturnType<typeof buildMapNodes>): LevelNode[] =>
  nodes.filter((n): n is LevelNode => n.kind === 'level');
const chests = (nodes: ReturnType<typeof buildMapNodes>): ChestNode[] =>
  nodes.filter((n): n is ChestNode => n.kind === 'chest');
const chapters = (nodes: ReturnType<typeof buildMapNodes>): ChapterNode[] =>
  nodes.filter((n): n is ChapterNode => n.kind === 'chapter');

describe('§7.10 map structure — chapters', () => {
  it('renders exactly the two chapters §7.10 names: L1-30 and L31-60', () => {
    const ch = chapters(buildMapNodes(progress()));
    expect(ch.map((c) => [c.chapter, c.firstLevel, c.lastLevel, c.total])).toEqual([
      [1, 1, 30, 30],
      [2, 31, 60, 30],
    ]);
  });

  it('every shipped level appears exactly once, in id order', () => {
    const ids = levels(buildMapNodes(progress())).map((n) => n.id);
    expect(ids).toEqual(LEVELS.map((l) => l.id));
    expect(ids).toHaveLength(MAX_LEVEL_ID);
  });

  it('the chapter card counts completed levels within its own chapter', () => {
    const ch = chapters(buildMapNodes(progress({ currentLevel: 24 })));
    expect(ch[0]!.completed).toBe(23);
    // Chapter 2 has not been entered — 0, not a negative number.
    expect(ch[1]!.completed).toBe(0);
  });

  it('a player inside chapter 2 shows chapter 1 fully complete, capped at its total', () => {
    const ch = chapters(buildMapNodes(progress({ currentLevel: 44 })));
    expect(ch[0]!.completed).toBe(30);
    expect(ch[1]!.completed).toBe(13);
  });

  it('"next chest at N" is the first UNCLAIMED chest of the chapter, even one already behind the player', () => {
    const ch = chapters(buildMapNodes(progress({ currentLevel: 24 })));
    expect(ch[0]!.nextChestLevel).toBe(10);
    const claimed = chapters(
      buildMapNodes(progress({ currentLevel: 24, chestsClaimed: { '10': true } })),
    );
    expect(claimed[0]!.nextChestLevel).toBe(20);
  });

  it('drops the "next chest" clause once every chest in the chapter is claimed', () => {
    const ch = chapters(
      buildMapNodes(
        progress({ currentLevel: 31, chestsClaimed: { '10': true, '20': true, '30': true } }),
      ),
    );
    expect(ch[0]!.nextChestLevel).toBeNull();
  });
});

describe('§7.10 medallion states — locked / current / 1-3 stars', () => {
  it('splits the map at `currentLevel`: below = completed, at = current, above = locked', () => {
    const ls = levels(buildMapNodes(progress({ currentLevel: 24 })));
    expect(ls.find((n) => n.id === 23)!.state).toBe('completed');
    expect(ls.find((n) => n.id === 24)!.state).toBe('current');
    expect(ls.find((n) => n.id === 25)!.state).toBe('locked');
  });

  it('exactly one medallion is `current`', () => {
    const ls = levels(buildMapNodes(progress({ currentLevel: 24 })));
    expect(ls.filter((n) => n.state === 'current')).toHaveLength(1);
  });

  it('renders the persisted star count, 1 through 3', () => {
    const ls = levels(
      buildMapNodes(progress({ currentLevel: 5, stars: { '1': 1, '2': 2, '3': 3 } })),
    );
    expect(ls.find((n) => n.id === 1)!.stars).toBe(1);
    expect(ls.find((n) => n.id === 2)!.stars).toBe(2);
    expect(ls.find((n) => n.id === 3)!.stars).toBe(3);
  });

  it('a completed level with no star record still shows 1 star ("star 1 = win", §7.5) — the pre-§7.10 save case', () => {
    const ls = levels(buildMapNodes(progress({ currentLevel: 5, stars: {} })));
    expect(ls.find((n) => n.id === 4)!.stars).toBe(1);
  });

  it('locked and current medallions carry no stars', () => {
    const ls = levels(buildMapNodes(progress({ currentLevel: 5, stars: { '5': 3, '6': 3 } })));
    expect(ls.find((n) => n.id === 5)!.stars).toBe(0);
    expect(ls.find((n) => n.id === 6)!.stars).toBe(0);
  });

  it('clamps a corrupt star value into 1-3 rather than rendering 7 pips', () => {
    const ls = levels(
      buildMapNodes(progress({ currentLevel: 5, stars: { '1': 7, '2': -3, '3': 2.4 } })),
    );
    expect(ls.find((n) => n.id === 1)!.stars).toBe(3);
    expect(ls.find((n) => n.id === 2)!.stars).toBe(1);
    expect(ls.find((n) => n.id === 3)!.stars).toBe(2);
  });

  it('survives a truncated MMKV blob (`stars`/`chestsClaimed` null) instead of throwing on mount — §12.9', () => {
    const corrupt = {
      currentLevel: 12,
      stars: null,
      chestsClaimed: null,
    } as unknown as MapProgress;
    expect(() => buildMapNodes(corrupt)).not.toThrow();
    expect(levels(buildMapNodes(corrupt)).find((n) => n.id === 12)!.state).toBe('current');
  });
});

describe('§7.10 chests — L10/20/30…', () => {
  it('sits at every multiple of 10 in the shipped range and nowhere else', () => {
    const cs = chests(buildMapNodes(progress()));
    expect(cs.map((c) => c.id)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(cs.map((c) => c.id)).toEqual([...CHEST_LEVELS]);
  });

  it('the content package derives chest levels from the §7.10 rhythm, not six literals', () => {
    expect(CHEST_LEVELS).toEqual(
      Array.from({ length: MAX_LEVEL_ID / CHEST_INTERVAL }, (_, i) => (i + 1) * CHEST_INTERVAL),
    );
  });

  it('sits AFTER its gating level, so the 10-level rhythm reads without counting', () => {
    const nodes = buildMapNodes(progress());
    const chestAt10 = nodes.findIndex((n) => n.kind === 'chest' && n.id === 10);
    const level10 = nodes.findIndex((n) => n.kind === 'level' && n.id === 10);
    const level11 = nodes.findIndex((n) => n.kind === 'level' && n.id === 11);
    expect(chestAt10).toBe(level10 + 1);
    expect(chestAt10).toBe(level11 - 1);
  });

  it('locked until its level is cleared, claimable after, claimed once opened', () => {
    const at10 = (p: MapProgress): ChestNode => chests(buildMapNodes(p)).find((c) => c.id === 10)!;
    expect(at10(progress({ currentLevel: 10 })).state).toBe('locked');
    expect(at10(progress({ currentLevel: 11 })).state).toBe('claimable');
    expect(at10(progress({ currentLevel: 11, chestsClaimed: { '10': true } })).state).toBe(
      'claimed',
    );
  });

  it('every chest has a cosmetic avatar frame to pay out (§7.10 Stage-1 reward)', () => {
    for (const level of CHEST_LEVELS) {
      expect(frameForChest(level)).toBeDefined();
    }
    expect(AVATAR_FRAMES).toHaveLength(CHEST_LEVELS.length);
    expect(new Set(AVATAR_FRAMES.map((f) => f.id)).size).toBe(AVATAR_FRAMES.length);
  });

  it('grants nothing but a frame — no coins, no wallet field (Stage 2, §9.1)', () => {
    for (const frame of AVATAR_FRAMES) {
      expect(Object.keys(frame).sort()).toEqual(['chestLevel', 'id']);
    }
  });
});

describe('§7.10 "Map scrolls to current level on open"', () => {
  it('opens on the CURRENT level row, not the top of the map', () => {
    const nodes = buildMapNodes(progress({ currentLevel: 24 }));
    const i = initialNodeIndex(nodes);
    expect(i).toBeGreaterThan(0);
    expect(nodes[i]).toMatchObject({ kind: 'level', id: 24, state: 'current' });
  });

  it('opens on row 1 (just past chapter 1s header) for a brand-new player on L1', () => {
    const nodes = buildMapNodes(progress({ currentLevel: 1 }));
    expect(nodes[initialNodeIndex(nodes)]).toMatchObject({ kind: 'level', id: 1 });
  });

  it('opens on the deepest chapter-2 row for a player near the end', () => {
    const nodes = buildMapNodes(progress({ currentLevel: 58 }));
    const node = nodes[initialNodeIndex(nodes)];
    expect(node).toMatchObject({ kind: 'level', id: 58 });
    expect((node as LevelNode).chapter).toBe(2);
  });

  it('falls back to the last row past the content ceiling, where no current medallion exists', () => {
    const nodes = buildMapNodes(progress({ currentLevel: MAX_LEVEL_ID + 1 }));
    expect(nodes.some((n) => n.kind === 'level' && n.state === 'current')).toBe(false);
    expect(initialNodeIndex(nodes)).toBe(nodes.length - 1);
  });

  it('opens at the TOP for a degenerate `currentLevel <= 0` save, not at the bottom', () => {
    for (const currentLevel of [0, -1]) {
      const nodes = buildMapNodes(progress({ currentLevel }));
      expect(nodes.some((n) => n.kind === 'level' && n.state === 'current')).toBe(false);
      expect(nodes.some((n) => n.kind === 'level' && n.state === 'completed')).toBe(false);
      expect(initialNodeIndex(nodes), `currentLevel ${currentLevel} opened at the end`).toBe(0);
    }
  });
});

describe('the winding path (mockup panel 5.1 / A1)', () => {
  it('swings nodes to both sides of centre, and returns to centre', () => {
    const offsets = Array.from({ length: 13 }, (_, i) => pathOffset(i));
    expect(Math.max(...offsets)).toBeGreaterThan(0);
    expect(Math.min(...offsets)).toBeLessThan(0);
    expect(pathOffset(0)).toBe(0);
    expect(pathOffset(6)).toBe(0);
  });
});
