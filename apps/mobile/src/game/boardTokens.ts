/**
 * Board renderer tokens — PRD §7.2 / §15. Every tunable visual constant the
 * `src/game` renderer uses lives here, never inline at a call site (matches
 * the juice-timing convention of `src/game/juice.ts` — this file is its
 * layout/color counterpart for §7.2, since juice.ts itself is §7.4 scope).
 *
 * Layout numbers are lifted from the approved mockup's own measurements
 * (`docs/design/spec/Block Manor UI.dc.html`, "03 Level Gameplay" panel);
 * obstacle motif geometry is traced from the Production Spec's labelled
 * "Obstacle tiles" panel (see `obstacleSprites.ts` header) — both cited per
 * constant below. PRD-exact values (§7.2 tray scale, v1.8) are called out.
 */

/** Gap between board cells, px — mockup's 8×8 grids use a 2–3px gap; 3px at the
 * board's ~38px reference cell size (mockup line: `gap:3px` @ `repeat(8,38px)`). */
export const BOARD_CELL_GAP = 3;

/** Cell corner radius as a fraction of cell size — mockup `mcell`: `size * .26`. */
export const CELL_RADIUS_RATIO = 0.26;
/** Radius floor so tiny cells (very narrow devices) don't render as circles. */
export const CELL_RADIUS_MIN = 3;

/** Padding between the board panel's frame and the first/last cell (mockup `padding:11px`). */
export const BOARD_PANEL_PADDING = 11;
/** Outer rounded-card radius of the board panel (mockup outer frame `border-radius:24px`). */
export const BOARD_PANEL_RADIUS = 24;
/** Inner (grid backing) panel radius (mockup inner `border-radius:16px`). */
export const BOARD_INNER_RADIUS = 16;

/** §7.2 v1.8 exact: tray pieces render at 50% of the board's cell scale (matches
 * the approved mockup's 19px-on-38px tray cells). Fixed on every device — no
 * clamp; `test/boardLayout.test.ts` checks 3×widest-piece fits realistic widths. */
export const TRAY_SCALE = 0.5;
/** Gap between cells within one tray piece (mockup `piece()`: `gap:2px`). */
export const TRAY_PIECE_CELL_GAP = 2;
/** Gap between the 3 tray piece slots. */
export const TRAY_SLOT_GAP = 18;
/** Tray row vertical padding (mockup tray row `padding:12px 8px`). */
export const TRAY_ROW_PADDING_V = 12;
export const TRAY_ROW_RADIUS = 20;

/**
 * Stage-2 booster row reservation height (CLAUDE.md rule 1 / PRD §7.2: "Stage-2
 * adds booster row between board and tray" — the slot is reserved now, filled
 * later). Sized off the mockup's booster tile (54px) + label + breathing room;
 * renders nothing and reads no Stage-2 state.
 */
export const BOOSTER_ROW_RESERVED_HEIGHT = 88;

/** Top HUD sizing (mockup "03 Level Gameplay" header row). */
export const HUD_ICON_SIZE = 38;
export const HUD_ROW_GAP = 10;
export const GOAL_BAR_ICON_SIZE = 40;
export const GOAL_PROGRESS_BAR_HEIGHT = 9;
export const GOAL_PROGRESS_BAR_RADIUS = 6;

/**
 * Dev-only render-TIME overlay (not GPU frame time — see `DevFrameStats.tsx`
 * header). §4.5's "60fps board interaction" budget covers drag/juice frame
 * pacing, which doesn't exist until §7.3/§7.4 land; it cannot be signed off
 * from this component at all yet, on-device or not.
 */
export const DEV_FRAME_STATS_SAMPLE_WINDOW = 30;

/**
 * Obstacle motif geometry — traced from the Production Spec "Obstacle tiles"
 * panel's `cell()` (`docs/design/spec/Block Manor Production Spec.dc.html`,
 * :3908–3916; `k = size / 38` there is this file's *_RATIO ×38, i.e. these
 * ratios ARE that k-scaling, just pre-divided). Motifs are dark/light
 * translucent overlays on the base gradient, never a second hue: shape +
 * luminance contrast reads under deuteranopia even where hue doesn't (§15).
 */
/** crate `a`/`b`, crate2 `a`: plank rotation, ±38° (:3908–3909). */
export const MOTIF_PLANK_ANGLE_RAD = 0.6632; // 38° in radians
/** plank width, 88% of cell (:3908). */
export const MOTIF_PLANK_WIDTH_RATIO = 0.88;
/** plank thickness, `13 * k` px → 13/38 of cell (:3908). */
export const MOTIF_PLANK_THICKNESS_RATIO = 13 / 38;
export const MOTIF_PLANK_OPACITY = 0.3; // rgba(0,0,0,.3), :3908

/** crate2's "2" badge (:3910–3911): pill size `15 * k` px, inset `2 * k` px. */
export const MOTIF_BADGE_SIZE_RATIO = 15 / 38;
export const MOTIF_BADGE_INSET_RATIO = 2 / 38;
export const MOTIF_BADGE_BG = '#2A1D13';
export const MOTIF_BADGE_TEXT_COLOR = '#F3D98F';
/** badge font size, `10 * k` px (:3911). */
export const MOTIF_BADGE_FONT_SIZE_RATIO = 10 / 38;

/** chain bar (:3913): width 104%, height `12 * k` px; ring: diameter `14 * k` px,
 * stroke `max(2, 3 * k)` px. Bar stripe pattern (repeating-linear-gradient of two
 * steel tones) simplified to one solid steel fill — see BoardCanvas.tsx note. */
export const MOTIF_CHAIN_BAR_WIDTH_RATIO = 1.04;
export const MOTIF_CHAIN_BAR_HEIGHT_RATIO = 12 / 38;
export const MOTIF_CHAIN_BAR_COLOR = '#7C87A8'; // midpoint of the spec's 2-tone stripe
export const MOTIF_CHAIN_RING_SIZE_RATIO = 14 / 38;
export const MOTIF_CHAIN_RING_STROKE_RATIO = 3 / 38;
export const MOTIF_CHAIN_RING_STROKE_MIN = 2;
export const MOTIF_CHAIN_RING_COLOR = '#DCE2EE';

/** ivy (:3914): big leaf 54%×42%, small leaf 28%×22% offset (left 12%, top 14%). */
export const MOTIF_LEAF_BIG_WIDTH_RATIO = 0.54;
export const MOTIF_LEAF_BIG_HEIGHT_RATIO = 0.42;
export const MOTIF_LEAF_BIG_OPACITY = 0.45;
export const MOTIF_LEAF_SMALL_WIDTH_RATIO = 0.28;
export const MOTIF_LEAF_SMALL_HEIGHT_RATIO = 0.22;
export const MOTIF_LEAF_SMALL_OFFSET_X_RATIO = 0.12;
export const MOTIF_LEAF_SMALL_OFFSET_Y_RATIO = 0.14;
export const MOTIF_LEAF_SMALL_OPACITY = 0.28;

/** heirloom (:3916): item 46%×46% rounded 10%; diagonal band width 104%,
 * height `11 * k` px, rotated −24°. */
export const MOTIF_ITEM_SIZE_RATIO = 0.46;
export const MOTIF_ITEM_RADIUS_RATIO = 0.1;
export const MOTIF_ITEM_OPACITY = 0.45;
export const MOTIF_ITEM_BAND_HEIGHT_RATIO = 11 / 38;
export const MOTIF_ITEM_BAND_ANGLE_RAD = -0.4189; // -24° in radians
