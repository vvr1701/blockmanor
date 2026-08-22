/**
 * `LevelMapScreen` — PRD §7.10 / §16.1.
 *
 * §7.10 in full: "Chapter 1 (L1-30) garden path, Chapter 2 (L31-60) fountain
 * court. Medallion states: locked/current(pulse)/1-3 stars. Chest at
 * L10/20/30… (Stage 1 reward: cosmetic avatar frames; coins retrofit in
 * Stage 2). Map scrolls to current level on open."
 *
 * Mockups: `docs/design/spec/Block Manor Production Spec.dc.html` panel "5.1
 * Level map" and `Block Manor UI.dc.html` panel "A1 Level Map" — chapter card
 * (eyebrow / serif title / progress bar / "N of M levels · next chest at K"),
 * a winding dotted path down a vertical scroll with medallions on it, star
 * pips above completed medallions, a "You are here" tag on the current one,
 * chest nodes sitting between levels, and a footer bar with a star-total chip
 * and the gold "Play N" CTA.
 *
 * DIVERGENCES from those panels, all deliberate — §15: where a mockup and the
 * PRD disagree the PRD wins, and the mismatch gets reported rather than
 * silently dropped:
 * 1. **The chapter card scrolls with its chapter instead of being pinned.**
 *    Both panels draw ONE chapter and can therefore pin its card above the
 *    scroll box. §7.10 specs TWO chapters on this map, so a pinned card would
 *    be stale the moment the player scrolls into the other one. It is a row in
 *    the list, at the head of its chapter's levels.
 * 2. **"23 of 40 levels".** The mockup's chapter 1 is 40 levels; §7.10's is 30
 *    (L1-30). The PRD wins — the totals come from `packages/content`.
 * 3. **The footer coin chip is not built.** Coins are Stage 2 (§9.1);
 *    CLAUDE.md rule 1 forbids the data model early. The star chip beside it IS
 *    built — stars are Stage-1 data this screen already owns. No reserved slot
 *    is drawn: §7.10 specs none (§0 rule 2a reserves slots only where a
 *    current-stage section explicitly asks for one, as §7.5 and §7.11 do).
 * 4. **Landmark art** (the panels' "gate art"/"fountain art"/"greenhouse art"
 *    hatched placeholders) is not built. Those are the manor-exterior art
 *    §11's renovation meta gives meaning to, and no art pipeline output exists
 *    (§15 "SVG masters → PNG"). The garden/fountain identity of the two
 *    chapters carries in the chapter titles and path tint instead.
 * 5. **Medallions are not tappable.** The panels imply a level map you touch;
 *    §7.10 specs medallion STATES and a scroll position, and says nothing
 *    about replaying a level. Replay would need star/attempt semantics no PRD
 *    section defines today (§7.5's `attempt` counter is per level and
 *    `currentLevel` is single-valued), so the one play affordance is the
 *    panels' own footer CTA. Medallions stay fully announced to screen
 *    readers. Flagged for a §7.10 amendment rather than invented here.
 *
 * State coverage (CLAUDE.md screen checklist):
 * - **loading / error / offline: not applicable, and deliberately so.** Every
 *   input is synchronous local state — `packages/content` levels compiled into
 *   the bundle plus the MMKV-backed §4.4 meta store. There is no network call
 *   to be pending, to fail, or to be offline for (§12.4: campaign play is
 *   fully offline-capable), so a spinner or a retry button here would be
 *   theatre. The one degenerate INPUT — a truncated MMKV blob leaving `stars`
 *   or `chestsClaimed` null — is guarded in `buildMapNodes`, not surfaced as
 *   an error screen.
 * - **empty (§12.9): the content ceiling.** A save at `currentLevel >
 *   MAX_LEVEL_ID` has no current medallion and nothing left to play. Rather
 *   than a dead footer, the CTA becomes the single action §12.9 requires.
 */
import { MAX_LEVEL_ID, frameForChest } from '@blockmanor/content';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { GoldButton } from '../../components/GoldButton';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { useMetaStore } from '../../state/useMetaStore';
import { ChestSheet } from './ChestSheet';
import {
  ROW_HEIGHT,
  buildMapNodes,
  initialNodeIndex,
  pathOffset,
  type ChapterNode,
  type ChestNode,
  type LevelNode,
  type MapNode,
} from './mapNodes';

const MIN_TOUCH_TARGET = 44;
/** The mockup's `bm-pulse 1.9s` on the current node. ONE element animates. */
const PULSE_MS = 1900;
const PULSE_SCALE = 1.08;
/** Dots drawn per row along the path between this node and the next. */
const PATH_DOTS_PER_ROW = 3;
const TOTAL_STARS = 3;
const FILLED_STAR = '★';
const EMPTY_STAR = '☆';

export interface LevelMapScreenProps {
  /** Play the campaign's current level (`useMetaStore.currentLevel`). */
  onPlay: () => void;
  /** Leave the map — the mount point routes this to Home. */
  onExit: () => void;
}

export function LevelMapScreen({ onPlay, onExit }: LevelMapScreenProps): React.JSX.Element {
  const currentLevel = useMetaStore((s) => s.currentLevel);
  const stars = useMetaStore((s) => s.stars);
  const chestsClaimed = useMetaStore((s) => s.chestsClaimed);
  const claimChest = useMetaStore((s) => s.claimChest);
  const [openChest, setOpenChest] = useState<number | null>(null);

  const nodes = useMemo(
    () => buildMapNodes({ currentLevel, stars, chestsClaimed }),
    [currentLevel, stars, chestsClaimed],
  );
  // §7.10 "Map scrolls to current level on open". `initialScrollIndex` (not a
  // post-mount `scrollToIndex`) so the FIRST paint is already at the right
  // offset — no visible jump, and no work on a frame the player can see
  // (§4.5). It is only honoured because `getItemLayout` below makes every row
  // measurable without laying it out, which is also what lets the list window
  // 66 rows instead of mounting them (§4.5: no per-cell React components).
  const initialIndex = useMemo(() => initialNodeIndex(nodes), [nodes]);

  const totalStars = useMemo(
    () => Object.values(stars ?? {}).reduce<number>((sum, n) => sum + (n || 0), 0),
    [stars],
  );

  const pastContentCeiling = currentLevel > MAX_LEVEL_ID;

  const handleChestPress = useCallback((chestLevel: number) => setOpenChest(chestLevel), []);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<MapNode>) => (
      <MapRow node={item} index={index} onChestPress={handleChestPress} />
    ),
    [handleChestPress],
  );

  const openChestFrame = openChest === null ? undefined : frameForChest(openChest);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable
          onPress={onExit}
          accessibilityRole="button"
          accessibilityLabel={t('map.closeLabel')}
          hitSlop={8}
          style={styles.close}
        >
          <Text style={styles.closeGlyph}>✕</Text>
        </Pressable>
        <Text style={styles.topTitle}>{t('map.title')}</Text>
        <View style={styles.close} />
      </View>

      <FlatList
        style={styles.list}
        data={nodes}
        renderItem={renderItem}
        keyExtractor={keyOf}
        getItemLayout={getItemLayout}
        initialScrollIndex={initialIndex}
        initialNumToRender={8}
        windowSize={5}
        removeClippedSubviews
        contentContainerStyle={styles.listContent}
      />

      {pastContentCeiling ? (
        <Text style={styles.ceilingLine}>{t('map.allShippedLine')}</Text>
      ) : null}

      <View style={styles.footer}>
        <View
          style={styles.starChip}
          accessible
          accessibilityLabel={t('map.starsLabel', { totalStars })}
        >
          <Text style={styles.starChipGlyph}>{FILLED_STAR}</Text>
          <Text style={styles.starChipValue}>{totalStars}</Text>
        </View>
        <View style={styles.footerSpacer} />
        {pastContentCeiling ? (
          <GoldButton label={t('map.backHome')} onPress={onExit} size="md" />
        ) : (
          <GoldButton label={t('map.play', { level: currentLevel })} onPress={onPlay} size="md" />
        )}
      </View>

      {openChest !== null && openChestFrame ? (
        <ChestSheet
          chestLevel={openChest}
          frameName={t(`frames.${openChestFrame.id}` as Parameters<typeof t>[0])}
          opened={Boolean((chestsClaimed ?? {})[String(openChest)])}
          onOpen={() => claimChest(openChest, openChestFrame.id)}
          onClose={() => setOpenChest(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function keyOf(node: MapNode): string {
  return `${node.kind}-${node.id}`;
}

/** Uniform rows are the whole point (see `initialScrollIndex` above): the
 * chapter card is sized to `ROW_HEIGHT` like every other row so this stays a
 * multiplication rather than a measured offset table. */
function getItemLayout(
  _data: ArrayLike<MapNode> | null | undefined,
  index: number,
): { length: number; offset: number; index: number } {
  return { length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index };
}

interface MapRowProps {
  node: MapNode;
  index: number;
  onChestPress: (chestLevel: number) => void;
}

/** Memoized: a chest claim changes ONE row's props, and without this every
 * mounted row re-renders on it (§4.5). */
const MapRow = React.memo(function MapRow({
  node,
  index,
  onChestPress,
}: MapRowProps): React.JSX.Element {
  if (node.kind === 'chapter') return <ChapterCard node={node} />;
  const offset = pathOffset(index);
  return (
    <View style={styles.row}>
      <PathDots from={offset} to={pathOffset(index + 1)} />
      <View style={[styles.node, { transform: [{ translateX: offset }] }]}>
        {node.kind === 'level' ? (
          <Medallion node={node} />
        ) : (
          <Chest node={node} onPress={onChestPress} />
        )}
      </View>
    </View>
  );
});

/** The mockup's dotted garden path, sampled per row so the dot count scales
 * with the WINDOW the list mounts, never with the 60-level map. */
function PathDots({ from, to }: { from: number; to: number }): React.JSX.Element {
  return (
    <>
      {Array.from({ length: PATH_DOTS_PER_ROW }, (_, i) => {
        const f = (i + 1) / (PATH_DOTS_PER_ROW + 1);
        return (
          <View
            key={i}
            style={[
              styles.pathDot,
              {
                transform: [{ translateX: Math.round(from + (to - from) * f) }],
                top: ROW_HEIGHT / 2 + f * (ROW_HEIGHT / 2),
              },
            ]}
          />
        );
      })}
    </>
  );
}

function ChapterCard({ node }: { node: ChapterNode }): React.JSX.Element {
  const pct = node.total === 0 ? 0 : Math.round((node.completed / node.total) * 100);
  return (
    <View style={styles.row}>
      <View style={styles.chapterCard}>
        <Text style={styles.chapterEyebrow}>{t('map.chapter.eyebrow', { n: node.chapter })}</Text>
        <Text style={styles.chapterTitle}>
          {t(`map.chapter.${node.chapter}.title` as Parameters<typeof t>[0])}
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.chapterMeta}>
          {node.nextChestLevel === null
            ? t('map.chapter.progress', { done: node.completed, total: node.total })
            : t('map.chapter.progressWithChest', {
                done: node.completed,
                total: node.total,
                chest: node.nextChestLevel,
              })}
        </Text>
      </View>
    </View>
  );
}

/**
 * §7.10 "Medallion states: locked/current(pulse)/1-3 stars".
 *
 * The pulse lives in `CurrentMedallion`, a SEPARATE component, precisely so
 * that only the current level's medallion mounts an `Animated.View`, a shared
 * value and an animated style. Hooks cannot be conditional, so a single
 * component with `if (isCurrent)` inside gives all 60 medallions the animation
 * machinery whether they animate or not — which is exactly the §4.5 budget
 * ("no per-cell React components on board") applied to this screen. One
 * animated element, not sixty.
 */
function Medallion({ node }: { node: LevelNode }): React.JSX.Element {
  // Every medallion announces its real payload — level number, state, and the
  // star count when it has one — never a generic "medallion" (a11y rule).
  const label =
    node.state === 'completed'
      ? t('map.a11y.completed', { level: node.id, stars: node.stars, total: TOTAL_STARS })
      : node.state === 'current'
        ? t('map.a11y.current', { level: node.id })
        : t('map.a11y.locked', { level: node.id });

  return (
    <View style={styles.nodeStack} accessible accessibilityLabel={label}>
      {node.state === 'completed' ? (
        <View style={styles.starRow}>
          {Array.from({ length: TOTAL_STARS }, (_, i) => (
            <Text key={i} style={i < node.stars ? styles.starOn : styles.starOff}>
              {i < node.stars ? FILLED_STAR : EMPTY_STAR}
            </Text>
          ))}
        </View>
      ) : null}

      {node.state === 'current' ? (
        <CurrentMedallion id={node.id} />
      ) : (
        <View style={[styles.medallion, node.state === 'locked' ? styles.medallionLocked : null]}>
          <Text style={node.state === 'locked' ? styles.medallionNumLocked : styles.medallionNum}>
            {node.id}
          </Text>
        </View>
      )}

      {node.state === 'current' ? (
        <View style={styles.hereTag}>
          <Text style={styles.hereTagText}>{t('map.youAreHere')}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The one pulsing element on the map (mockup panel 5.1's `bm-pulse 1.9s`). */
function CurrentMedallion({ id }: { id: number }): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withRepeat(withTiming(PULSE_SCALE, { duration: PULSE_MS / 2 }), -1, true);
  }, [reducedMotion, scale]);

  const pulse = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.medallion, styles.medallionCurrent, pulse]}>
      <Text style={styles.medallionNum}>{id}</Text>
    </Animated.View>
  );
}

function Chest({
  node,
  onPress,
}: {
  node: ChestNode;
  onPress: (chestLevel: number) => void;
}): React.JSX.Element {
  const label =
    node.state === 'claimable'
      ? t('map.a11y.chestReady', { level: node.id })
      : node.state === 'claimed'
        ? t('map.a11y.chestClaimed', { level: node.id })
        : t('map.a11y.chestLocked', { level: node.id });

  const body = (
    <View style={styles.nodeStack}>
      <View
        style={[
          styles.chest,
          node.state === 'locked' ? styles.chestLocked : null,
          node.state === 'claimable' ? styles.chestReady : null,
        ]}
      >
        <View style={styles.chestBand} />
      </View>
      {node.state === 'claimed' ? <Text style={styles.chestClaimedGlyph}>{'✓'}</Text> : null}
      <View style={styles.chestTag}>
        <Text style={styles.chestTagText}>{t('map.chestTag', { level: node.id })}</Text>
      </View>
    </View>
  );

  if (node.state !== 'claimable') {
    return (
      <View accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onPress(node.id)}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={styles.chestPressable}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.night },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { color: colors.cream, fontSize: fontSize.lg, fontWeight: '700' },
  topTitle: {
    color: colors.cream,
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.lg,
  },
  list: { flex: 1 },
  listContent: { paddingBottom: spacing.lg },

  row: { height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  node: { alignItems: 'center', justifyContent: 'center' },
  nodeStack: { alignItems: 'center', gap: spacing.xs / 2 },
  pathDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    // `colors.gold` @ 55% — the mockup's lit path, at the alpha that keeps
    // the dots at 3.60:1 on `night` rather than the mockup's 42% (2.57:1).
    backgroundColor: 'rgba(233,196,106,0.55)',
  },

  chapterCard: {
    alignSelf: 'stretch',
    marginHorizontal: spacing.md,
    borderRadius: radius.sheet,
    borderWidth: 1,
    // `colors.gold` @ 55%: the card's own `night2` fill is 1.06:1 against the
    // `night` screen, so this border is what delineates the card — 3.66:1.
    borderColor: 'rgba(233,196,106,0.55)',
    backgroundColor: colors.night2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  chapterEyebrow: {
    // `colors.gold` @ 85% on `night2` — 7.5:1, well past the 4.5:1 floor.
    color: 'rgba(233,196,106,0.85)',
    fontSize: fontSize.xs,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  chapterTitle: {
    color: colors.cream,
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.lg,
    textAlign: 'center',
  },
  progressTrack: {
    alignSelf: 'stretch',
    height: 9,
    borderRadius: radius.block,
    // Darker than the card so the gold fill reads as fill (non-text, 3:1).
    backgroundColor: colors.night,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: radius.block, backgroundColor: colors.gold },
  chapterMeta: {
    color: colors.cream,
    fontSize: fontSize.xs,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },

  starRow: { flexDirection: 'row', gap: 2 },
  starOn: { color: colors.gold, fontSize: fontSize.xs },
  starOff: { color: colors.muted, fontSize: fontSize.xs },
  medallion: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    borderBottomWidth: 4,
    borderBottomColor: colors.goldDeep,
  },
  medallionCurrent: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: colors.cream,
    borderBottomWidth: 4,
  },
  // A locked medallion's `night2` fill is 1.06:1 against the `night` screen —
  // invisible as a UI component. The `muted` outline (6.0:1 on `night`) is
  // what actually identifies it, so it is a contrast requirement, not trim.
  medallionLocked: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.night2,
    borderWidth: 2,
    borderColor: colors.muted,
    borderBottomColor: colors.muted,
  },
  medallionNum: {
    color: colors.night,
    fontSize: fontSize.md,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  medallionNumLocked: {
    color: colors.muted,
    fontSize: fontSize.sm,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  hereTag: {
    borderRadius: radius.block,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.night,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  hereTagText: { color: colors.gold, fontSize: fontSize.xs, fontWeight: '900' },

  chestPressable: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET },
  chest: {
    width: 58,
    height: 46,
    borderRadius: radius.card - 2,
    borderWidth: 2,
    borderColor: colors.goldDeep,
    backgroundColor: colors.night2,
  },
  chestReady: { borderColor: colors.gold },
  // Claimed and locked both read as "not an action now"; locked additionally
  // drops to the muted outline the mockup gives an un-earned chest.
  chestLocked: { borderColor: colors.muted, opacity: 0.6 },
  chestBand: {
    position: 'absolute',
    left: -2,
    right: -2,
    top: 11,
    height: 7,
    backgroundColor: colors.gold,
  },
  chestTag: {
    borderRadius: radius.block,
    backgroundColor: colors.night,
    paddingHorizontal: spacing.xs + 2,
  },
  chestTagText: { color: colors.gold, fontSize: fontSize.xs, fontWeight: '900' },
  // WCAG 1.4.1: "claimed" must not be signalled by border colour alone.
  chestClaimedGlyph: {
    position: 'absolute',
    top: 12,
    color: colors.ok,
    fontSize: fontSize.md,
    fontWeight: '900',
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  footerSpacer: { flex: 1 },
  starChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.card,
    borderWidth: 1,
    // `colors.gold` @ 70% — 5.13:1 on `night`; the chip has no fill, so the
    // border is the only thing that draws it.
    borderColor: 'rgba(233,196,106,0.7)',
    paddingHorizontal: spacing.md,
  },
  starChipGlyph: { color: colors.gold, fontSize: fontSize.md },
  starChipValue: {
    color: colors.cream,
    fontSize: fontSize.md,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  ceilingLine: {
    color: colors.cream,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
});
