/**
 * The §7.10 level-map node list — pure, so the map's structure (chapters,
 * medallion states, chest placement, which row the list opens on) is testable
 * without rendering anything.
 *
 * §7.10 in full: "Chapter 1 (L1-30) garden path, Chapter 2 (L31-60) fountain
 * court. Medallion states: locked/current(pulse)/1-3 stars. Chest at
 * L10/20/30... (Stage 1 reward: cosmetic avatar frames; coins retrofit in
 * Stage 2). Map scrolls to current level on open."
 *
 * `currentLevel` is the level the player will play NEXT — that reading is
 * consistent repo-wide (`HomeScreen`'s "PLAY - Level N", `LevelSession`) and
 * was upheld by the §7.6 audit. So a level is COMPLETED iff `id <
 * currentLevel`, CURRENT iff `id === currentLevel`, LOCKED otherwise.
 */
import { CHEST_LEVELS, LEVELS, MAX_LEVEL_ID, type LevelJson } from '@blockmanor/content';

/** §7.10: "locked/current(pulse)/1-3 stars". A completed level always has
 * ≥1 star ("star 1 = win", §7.5), so `stars` carries the count for the
 * completed case and is 0 for the other two. */
export type MedallionState = 'locked' | 'current' | 'completed';

export interface LevelNode {
  kind: 'level';
  id: number;
  chapter: number;
  state: MedallionState;
  /** 0 unless `state === 'completed'`; 1-3 otherwise. */
  stars: number;
}

export interface ChestNode {
  kind: 'chest';
  /** The level whose completion opens it (§7.10 L10/20/30…). */
  id: number;
  chapter: number;
  state: 'locked' | 'claimable' | 'claimed';
}

export interface ChapterNode {
  kind: 'chapter';
  chapter: number;
  id: number;
  firstLevel: number;
  lastLevel: number;
  /** Levels of this chapter the player has completed (0..total). */
  completed: number;
  total: number;
  /** The next chest in this chapter the player has not opened, if any. */
  nextChestLevel: number | null;
}

export type MapNode = LevelNode | ChestNode | ChapterNode;

export interface MapProgress {
  currentLevel: number;
  stars: Record<string, number>;
  chestsClaimed: Record<string, boolean>;
}

/** The star count persisted for `id`, clamped into 1-3. A completed level
 * with no record (a save made before §7.10 persisted stars, or a truncated
 * MMKV blob) still shows a medallion — "star 1 = win" (§7.5) is the floor,
 * so it renders as 1 star rather than as an unwon level. */
function persistedStars(id: number, stars: Record<string, number>): number {
  const raw = stars[String(id)];
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 1;
  return Math.min(3, Math.max(1, n));
}

/**
 * The whole map, top (L1) to bottom (`MAX_LEVEL_ID`), as one flat list: a
 * chapter header row, then that chapter's levels with a chest row after each
 * of L10/20/30… §7.10 names exactly two chapters and `MAX_LEVEL_ID` is 60, so
 * this walks the shipped levels rather than assuming a chapter count.
 */
export function buildMapNodes(progress: MapProgress): MapNode[] {
  // `?? {}` guards a truncated or hand-edited MMKV blob: zustand runs
  // `migrate` only for OLDER versions, so a corrupt `stars` on a v3 save
  // reaches this read exactly as written and would throw on index.
  const stars = progress.stars ?? {};
  const claimed = progress.chestsClaimed ?? {};
  const out: MapNode[] = [];
  let chapter = -1;

  for (const level of LEVELS) {
    if (level.chapter !== chapter) {
      chapter = level.chapter;
      out.push(chapterHeader(chapter, progress.currentLevel, claimed));
    }
    out.push({
      kind: 'level',
      id: level.id,
      chapter,
      state:
        level.id < progress.currentLevel
          ? 'completed'
          : level.id === progress.currentLevel
            ? 'current'
            : 'locked',
      stars: level.id < progress.currentLevel ? persistedStars(level.id, stars) : 0,
    });
    if (CHEST_LEVELS.includes(level.id)) {
      out.push({
        kind: 'chest',
        id: level.id,
        chapter,
        state: claimed[String(level.id)]
          ? 'claimed'
          : progress.currentLevel > level.id
            ? 'claimable'
            : 'locked',
      });
    }
  }
  return out;
}

function chapterLevels(chapter: number): readonly LevelJson[] {
  return LEVELS.filter((l) => l.chapter === chapter);
}

function chapterHeader(
  chapter: number,
  currentLevel: number,
  claimed: Record<string, boolean>,
): ChapterNode {
  const levels = chapterLevels(chapter);
  const first = levels[0]?.id ?? 1;
  const last = levels[levels.length - 1]?.id ?? MAX_LEVEL_ID;
  // Derived from `currentLevel`, not from the `stars` map: a save made before
  // §7.10 persisted stars has real progress and no star records, and a
  // progress bar reading 0/30 for a player on L24 would be a lie.
  const completed = Math.min(levels.length, Math.max(0, currentLevel - first));
  // The next chest the player will OPEN — the first unclaimed one in the
  // chapter, whether it is already claimable or still ahead of them. Not
  // gated on `currentLevel`: a chest sitting unopened behind you is exactly
  // the one the header should point at.
  const nextChest = CHEST_LEVELS.find((l) => l >= first && l <= last && !claimed[String(l)]);
  return {
    kind: 'chapter',
    chapter,
    id: first,
    firstLevel: first,
    lastLevel: last,
    completed,
    total: levels.length,
    nextChestLevel: nextChest ?? null,
  };
}

/**
 * §7.10 "Map scrolls to current level on open" — the row the list opens on.
 * Falls back to the last row for a save past `MAX_LEVEL_ID` (no current
 * medallion exists) and to 0 for an unexpectedly empty list.
 */
export function initialNodeIndex(nodes: readonly MapNode[]): number {
  const i = nodes.findIndex((n) => n.kind === 'level' && n.state === 'current');
  if (i >= 0) return i;
  return Math.max(0, nodes.length - 1);
}

/** Fixed row height — what makes `getItemLayout` (and therefore windowing and
 * a jank-free `initialScrollIndex`) possible at all (§4.5). */
export const ROW_HEIGHT = 104;

/**
 * Horizontal offset of the node in row `index`, in dp either side of centre —
 * the mockup's winding garden path (panel 5.1 / A1, whose nodes sit on a sine
 * curve). Purely presentational; lives here so it is covered by the same pure
 * tests as the rest of the layout.
 */
export const PATH_AMPLITUDE = 78;
const PATH_PERIOD = 6;

export function pathOffset(index: number): number {
  // `|| 0` normalizes `Math.round`'s negative zero — a `-0` translateX is
  // harmless to render but makes every equality check on it surprising.
  return Math.round(Math.sin((index / PATH_PERIOD) * Math.PI * 2) * PATH_AMPLITUDE) || 0;
}
