/**
 * `PauseSheet` — PRD §12.2 / §16.1 (the name is verbatim from §16.1's
 * canonical table; §16.1 also fixes the folder as
 * `apps/mobile/src/screens/PauseSheet/`).
 *
 * §12.2 in full: "resume / restart (consumes life in S2; free in S1) /
 * settings shortcut / quit-to-map (confirm if goals >50% done)."
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, panel "3.9
 * Pause menu" — dimmed board behind a brass-framed cream sheet: "Paused",
 * a tabular status line, a gold Resume CTA, a restart ROW (icon tile + title
 * + sublabel + trailing status), a stack of settings rows, and "Exit to map"
 * as underlined text inside the card ("Exit is text, never a button", per
 * that panel's own footnote).
 *
 * EIGHT DIVERGENCES from panel 3.9, all deliberate — the PRD wins (§15) and
 * every mismatch is listed here, including the obvious ones (keep the count
 * in this sentence in step with the list):
 *
 * 1. NO life cost and NO life counter on the restart row. The panel shows
 *    "Costs 1 life" plus a heart chip reading 5, and its footnote argues for
 *    it. §12.2 says restart is "free in S1"; lives are §9.2, Stage 2. The
 *    life chip is not even reserved as a slot: §0 rule 2a admits only slots a
 *    CURRENT-stage section explicitly specs, and §12.2 specs no life counter.
 *    The sublabel says what restart actually does in Stage 1 instead.
 * 2. The settings shortcut is ONE row that routes to §12.1's `SettingsScreen`
 *    (now that it exists — §12.1 landed on its own PR, per CLAUDE.md rule 4),
 *    not the panel's three inline live SFX / Music / Haptics toggles. §12.2's
 *    own word is "shortcut," not "controls" — a route to §12.1 is what it
 *    specs, and duplicating three live toggles here would fork the mute
 *    state's one source of truth (`useMetaStore`) across two screens for no
 *    reason. Previously (before §12.1 existed) this row rendered disabled
 *    with "coming soon" copy; that placeholder is gone now that the
 *    destination is real.
 * 3. The status line reads "Moves 18", not the panel's "18 moves left".
 *    §6.7's game over is board death; there is no move limit anywhere in the
 *    engine or in §7.7's level schema, so "moves left" is a number that does
 *    not exist. This is placements made (`GameState.placements`) — the same
 *    number §14's `level_quit.moves` carries.
 * 4. No blur behind the sheet. The panel blurs the board (`filter:blur(1.5px)`)
 *    under an 82% scrim; RN has no free blur primitive (that is `expo-blur`,
 *    an un-installed dependency) and §15's component list has no blur token.
 *    The 82% scrim alone is kept — it is the part that carries the meaning.
 * 5. EVERY secondary text on the cream is `colors.night` @ 70% (`INK_70`),
 *    not the panel's ink — not just "Exit to map". The panel writes
 *    `rgba(42,33,21,.4)` on "Exit to map" (2.55:1 on cream) and
 *    `rgba(42,33,21,.45)` on the status line and the restart row's sublabel
 *    (2.83:1); all three are under the 4.5:1 normal-text floor. Same
 *    substitution `GhostButton`'s `onLight` variant already made for the same
 *    reason (§7.5 re-audit item 1). The settings sublabel and the confirm
 *    body take `INK_70` too, for consistency rather than as a substitution:
 *    they are PRD-only compositions (divergences 2 and 6) with no panel ink
 *    of their own to diverge from.
 * 6. The panel has NO confirm step; §12.2 requires one past 50% goal
 *    progress, so the confirm composition below is PRD-only and has no
 *    mockup to match. It is built from this sheet's own parts (title +
 *    body + gold CTA + text link) so it reads as the same surface.
 * 7. The panel's serif "Paused" is Playfair Display; `fontFamily.display` is
 *    still the platform `serif` fallback repo-wide (§15's font loading is not
 *    wired). Pre-existing, not introduced here, listed for completeness.
 * 8. The status line's goal segment reads "Crates 7/12"; the panel writes
 *    "crates 7/12", lower case. The label is `GOAL_LABEL_KEY` — the single
 *    §7.8 goal-type -> i18n-key mapping, shared with §7.5's `FailScreen`
 *    (which renders it title-cased at the start of its own line). Reusing
 *    that map is the right call; sentence-casing it only here would fork it
 *    per screen or add a casing prop for one caller. The case mismatch is
 *    the price, declared rather than hidden.
 *
 * `SheetRow` is local to this file on purpose. §15's component list
 * (`GoldButton · GhostButton · Card · ModalSheet · HUDBar · TimerChip ·
 * Badge · ProgressBar · Toast · Confetti`) has no list-row primitive, and
 * `GoldButton`/`GhostButton` are single-centred-label CTA shapes that cannot
 * express icon + title + sublabel + trailing status. Promoting a row into
 * `src/components` would be a design-system ADDITION smuggled into a feature
 * PR — the same call §7.10 made when it declined to build `Confetti`.
 * `ModalSheet(brass frame)` IS in §15's list and this sheet was its second
 * inline copy (`ChestSheet` the first) — now extracted to
 * `src/components/ModalSheet.tsx` and shared by both. `EndlessResultSheet`
 * (§7.6) is NOT a third copy: it has a flat cream card with no brass frame
 * layer at all, a different composition (see `ModalSheet`'s own header).
 *
 * §7.6 convergence (done): `EndlessScreen` now passes `GameplayScreen` a
 * `pause={{ onRestart: playAgain, onQuit: () => onExit(), onOpenSettings }}`
 * and this sheet is what it opens — no bespoke close button, no second
 * `BackHandler`. Endless has no goals, so this sheet's >50% confirm can never
 * fire there (a mid-run Endless exit forfeits a live score with no
 * confirmation) — flagged as its own open question in `EndlessScreen`, not
 * resolved by this sheet. `PauseControls.onQuit` still fires nothing itself
 * and hands `moves` upward, because Endless's terminal event is
 * `endless_end`, not `level_quit`, and the two callers' analytics differ.
 *
 * No loading / error / offline states (CLAUDE.md screen checklist): this is a
 * pure synchronous function of the `GameState` the caller already holds. It
 * touches no network — campaign play is fully offline (§12.4) — and reads no
 * store. Its EMPTY state (§12.9) is a goal-less config: the status line drops
 * the goal segments rather than rendering "0/0", and `Resume` remains the one
 * action, so there is still no dead end. Every state here is escapable:
 * Resume, the confirm's "Keep playing", and Android back (handled by
 * `GameplayScreen`, which owns the `BackHandler` subscription and pops one
 * layer per press — see `confirming` below).
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GoldButton } from '../../components/GoldButton';
import { ModalSheet } from '../../components/ModalSheet';
import { colors, fontFamily, fontSize, radius, spacing, withAlpha } from '../../components/tokens';
import { GOAL_LABEL_KEY, goalsPastHalf, type GoalBarEntry } from '../../game/goalBar';
import { t } from '../../i18n';

/** ≥44dp on every interactive element (CLAUDE.md a11y rule). */
const MIN_TOUCH_TARGET = 44;

/** The panel's status-line separator. Punctuation, not copy — it carries no
 * language, so it is not an i18n key. */
const SEGMENT_SEPARATOR = ' · ';

/**
 * The panel's list row: a square icon tile, a title and a sublabel.
 * Interactive when `onPress` is given; otherwise a non-pressable row that
 * still announces itself as a DISABLED button, which is what a screen reader
 * needs in order to explain why nothing happens.
 *
 * The mockup's rows also carry a trailing element (the restart row's life
 * chip, the settings rows' toggles). Both are divergences 1 and 2 above, so
 * no row here has one and the prop does not exist — an unused "trailing"
 * slot would be speculative scaffolding, not a §0 rule 2a reservation.
 */
function SheetRow({
  glyph,
  title,
  subtitle,
  onPress,
}: {
  glyph: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
}): React.JSX.Element {
  // The visible row is two separate strings; a screen reader should hear one
  // sentence, not two fragments in whatever order the tree yields.
  const label = `${title}${SEGMENT_SEPARATOR}${subtitle}`;
  const body = (
    <>
      <View style={styles.rowIcon}>
        {/* Decorative: the row's meaning is entirely in the text beside it. */}
        <Text style={styles.rowGlyph} accessibilityElementsHidden importantForAccessibility="no">
          {glyph}
        </Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
    </>
  );
  if (!onPress) {
    return (
      <View
        style={styles.row}
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        accessibilityLabel={label}
      >
        {body}
      </View>
    );
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
    >
      {body}
    </Pressable>
  );
}

export interface PauseSheetProps {
  /** Omitted for a config with no level (endless/dev-board shaped) — the
   * status line drops the segment rather than printing "Level 0". Written as
   * an explicit `| undefined` because `exactOptionalPropertyTypes` is on
   * (§16), and the caller passes `state.config.level?.id` straight through
   * rather than conditionally spreading a prop. */
  levelId?: number | undefined;
  /** Live goal state (§7.2's goal bar entries). Empty for a goal-less config
   * — the status line simply omits the goal segments. Also the input to
   * §12.2's ">50% done" confirm gate. */
  goals: readonly GoalBarEntry[];
  /** `GameState.placements` — the same number §14's `level_quit.moves` takes. */
  moves: number;
  onResume: () => void;
  /** §12.2 restart. FREE in Stage 1; §9.2's life cost is Stage 2 and is not
   * modelled, reserved or referenced here. `undefined` hides the row (§8.3). */
  onRestart?: (() => void) | undefined;
  /** §12.2's "settings shortcut" — routes to §12.1's `SettingsScreen`
   * (divergence 2). */
  onOpenSettings: () => void;
  /** §12.2 quit-to-map. Called only AFTER the confirm when §12.2's threshold
   * says one is needed. */
  onQuit: () => void;
  /** §0 v1.30: `'daily'` always confirms, with the one-attempt copy. */
  confirmQuit?: 'daily' | undefined;
  /** Which LAYER of the sheet is showing: the pause menu (`false`) or the
   * quit confirm (`true`). Controlled by `GameplayScreen` because that screen
   * owns the single Android `BackHandler` subscription and back must pop one
   * layer at a time (confirm -> menu -> board); a handler that could not see
   * this flag dismissed the whole sheet from the confirm. */
  confirming: boolean;
  onConfirmingChange: (confirming: boolean) => void;
}

export function PauseSheet({
  levelId,
  goals,
  moves,
  onResume,
  onRestart,
  onOpenSettings,
  onQuit,
  confirmQuit,
  confirming,
  onConfirmingChange,
}: PauseSheetProps): React.JSX.Element {
  const handleQuitPress = useCallback(() => {
    // §12.2: "quit-to-map (confirm if goals >50% done)". At or below half the
    // player has invested little enough that a second tap is friction, not
    // protection (§1 P6) — leave immediately.
    if (confirmQuit === 'daily' || goalsPastHalf(goals)) onConfirmingChange(true);
    else onQuit();
  }, [confirmQuit, goals, onQuit, onConfirmingChange]);

  const status = [
    ...(levelId === undefined ? [] : [t('gameplay.level', { id: levelId })]),
    ...goals.map((g) =>
      t('gameplay.goal.line', {
        label: t(GOAL_LABEL_KEY[g.type]),
        done: g.total - g.remaining,
        total: g.total,
      }),
    ),
    t('pause.movesSegment', { moves }),
  ].join(SEGMENT_SEPARATOR);

  return (
    <ModalSheet>
      {confirming ? (
        <>
          <Text style={styles.title}>
            {t(confirmQuit === 'daily' ? 'pause.confirmDaily.title' : 'pause.confirm.title')}
          </Text>
          <Text style={styles.confirmBody}>
            {t(confirmQuit === 'daily' ? 'pause.confirmDaily.body' : 'pause.confirm.body')}
          </Text>
          <GoldButton
            label={t('pause.confirm.stay')}
            onPress={() => onConfirmingChange(false)}
            size="lg"
            style={styles.cta}
          />
          <Pressable
            style={styles.quit}
            onPress={onQuit}
            accessibilityRole="button"
            accessibilityLabel={t('pause.confirm.leave')}
            hitSlop={8}
          >
            <Text style={styles.quitText}>{t('pause.confirm.leave')}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.title}>{t('pause.title')}</Text>
          <Text style={styles.status}>{status}</Text>

          <GoldButton label={t('pause.resume')} onPress={onResume} size="lg" style={styles.cta} />

          {onRestart ? (
            <SheetRow
              glyph="↻"
              title={t('pause.restart')}
              subtitle={t('pause.restartHint')}
              onPress={onRestart}
            />
          ) : null}

          {/* §12.2's "settings shortcut" -> §12.1's `SettingsScreen`.
              See divergence 2. */}
          <SheetRow
            glyph="⚙"
            title={t('pause.settings')}
            subtitle={t('pause.settingsHint')}
            onPress={onOpenSettings}
          />

          <Pressable
            style={styles.quit}
            onPress={handleQuitPress}
            accessibilityRole="button"
            accessibilityLabel={t('pause.quit')}
            hitSlop={8}
          >
            <Text style={styles.quitText}>{t('pause.quit')}</Text>
          </Pressable>
        </>
      )}
    </ModalSheet>
  );
}

/** `colors.night` @ 70% on cream — 5.98:1, the repo's established on-light
 * ink (`GhostButton.onLight`, `ChestSheet`). */
const INK_70 = withAlpha(colors.night, 0.7);

const styles = StyleSheet.create({
  title: {
    color: colors.night,
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.xl,
    textAlign: 'center',
  },
  status: {
    color: INK_70,
    fontSize: fontSize.xs,
    fontWeight: '800',
    textAlign: 'center',
    // §15 / CLAUDE.md a11y: tabular numerals for scores and counts.
    fontVariant: ['tabular-nums'],
  },
  confirmBody: {
    color: INK_70,
    fontSize: fontSize.sm,
    fontWeight: '700',
    textAlign: 'center',
  },
  cta: { alignSelf: 'stretch', marginTop: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.card + 2,
    padding: spacing.sm + 2,
    // `colors.night` @ 7% on cream — the panel's faint row wash.
    backgroundColor: withAlpha(colors.night, 0.07),
  },
  rowPressed: { backgroundColor: withAlpha(colors.night, 0.14) },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.night, 0.1),
  },
  rowGlyph: { color: colors.night, fontSize: fontSize.md },
  rowText: { flex: 1 },
  rowTitle: { color: colors.night, fontSize: fontSize.sm, fontWeight: '900' },
  rowSubtitle: { color: INK_70, fontSize: fontSize.xs, fontWeight: '700' },
  quit: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  quitText: {
    color: INK_70,
    fontSize: fontSize.sm,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
});
