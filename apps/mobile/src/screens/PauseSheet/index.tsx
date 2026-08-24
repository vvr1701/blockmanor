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
 * DIVERGENCES from panel 3.9, all deliberate — the PRD wins (§15) and every
 * mismatch is listed here, including the obvious ones:
 *
 * 1. NO life cost and NO life counter on the restart row. The panel shows
 *    "Costs 1 life" plus a heart chip reading 5, and its footnote argues for
 *    it. §12.2 says restart is "free in S1"; lives are §9.2, Stage 2. The
 *    life chip is not even reserved as a slot: §0 rule 2a admits only slots a
 *    CURRENT-stage section explicitly specs, and §12.2 specs no life counter.
 *    The sublabel says what restart actually does in Stage 1 instead.
 * 2. The settings shortcut is ONE disabled row, not the panel's three live
 *    SFX / Music / Haptics toggles. Those toggles are §12.1's spec
 *    ("SFX/music/haptics toggles"), and §12.1's `SettingsScreen` does not
 *    exist yet; building them here would implement §12.1 inside a §12.2 PR
 *    (CLAUDE.md rule 4, one subsection per PR) and would need a settings
 *    store §12.1 gets to design. §12.2's word is "shortcut" — a route to
 *    §12.1 — so a route is what this renders, honestly unavailable.
 * 3. That disabled row is NOT dimmed to a grey. Its title stays at the same
 *    `colors.night` on cream every enabled row uses, and "disabled" is
 *    carried by the "Not built yet" sublabel, the absent press handler and
 *    `accessibilityState.disabled`. WCAG 1.4.3 exempts inactive controls
 *    from the 4.5:1 floor, but that exemption is a licence to be
 *    low-contrast, not a reason to be — a row a player is supposed to READ
 *    and understand should stay readable.
 * 4. The status line reads "Moves 18", not the panel's "18 moves left".
 *    §6.7's game over is board death; there is no move limit anywhere in the
 *    engine or in §7.7's level schema, so "moves left" is a number that does
 *    not exist. This is placements made (`GameState.placements`) — the same
 *    number §14's `level_quit.moves` carries.
 * 5. No blur behind the sheet. The panel blurs the board (`filter:blur(1.5px)`)
 *    under an 82% scrim; RN has no free blur primitive (that is `expo-blur`,
 *    an un-installed dependency) and §15's component list has no blur token.
 *    The 82% scrim alone is kept — it is the part that carries the meaning.
 * 6. "Exit to map" is `colors.night` @ 70%, not the panel's `rgba(42,33,21,.4)`
 *    ink. That ink computes to 2.55:1 on cream and fails the 4.5:1 text
 *    floor. Same substitution `GhostButton`'s `onLight` variant already made
 *    for the same reason (§7.5 re-audit item 1).
 * 7. The panel has NO confirm step; §12.2 requires one past 50% goal
 *    progress, so the confirm composition below is PRD-only and has no
 *    mockup to match. It is built from this sheet's own parts (title +
 *    body + gold CTA + text link) so it reads as the same surface.
 * 8. The panel's serif "Paused" is Playfair Display; `fontFamily.display` is
 *    still the platform `serif` fallback repo-wide (§15's font loading is not
 *    wired). Pre-existing, not introduced here, listed for completeness.
 *
 * `SheetRow` is local to this file on purpose. §15's component list
 * (`GoldButton · GhostButton · Card · ModalSheet · HUDBar · TimerChip ·
 * Badge · ProgressBar · Toast · Confetti`) has no list-row primitive, and
 * `GoldButton`/`GhostButton` are single-centred-label CTA shapes that cannot
 * express icon + title + sublabel + trailing status. Promoting a row into
 * `src/components` would be a design-system ADDITION smuggled into a feature
 * PR — the same call §7.10 made when it declined to build `Confetti`.
 * `ModalSheet(brass frame)` is genuinely in §15's list and this sheet is a
 * third instance of it (`ChestSheet`, §7.6's `EndlessResultSheet`), but
 * extracting it would rewrite two already-audited screens on two other
 * unmerged branches; noted as the extraction point, not done here.
 *
 * CONVERGENCE POINT with §7.6 (noted, deliberately not done here — that
 * branch is unmerged and already audited). `EndlessScreen` needed a mid-run
 * exit before §12.2 existed, so it grew a bespoke `EndlessHud` close button
 * plus its own `BackHandler`. This sheet is the general version of both:
 * `GameplayScreen` now owns the `BackHandler` for every caller that passes
 * `pause`, so when §7.6 merges, `EndlessScreen` should pass
 * `pause={{ onRestart: playAgain, onQuit: onExit }}` and DELETE its own
 * `BackHandler` effect and `EndlessHud`'s close button. Two things must be
 * decided at that merge, not guessed now: Endless has no goals, so §12.2's
 * >50% confirm can never fire there (a mid-run Endless exit forfeits a live
 * score, which is arguably worth its own confirm — that would be a §7.6
 * amendment, not this code's call), and Endless fires `endless_end`, not
 * `level_quit`, so the quit callback's analytics differ by caller — which is
 * exactly why `PauseControls.onQuit` fires nothing itself and hands `moves`
 * upward instead.
 *
 * No loading / error / offline states (CLAUDE.md screen checklist): this is a
 * pure synchronous function of the `GameState` the caller already holds. It
 * touches no network — campaign play is fully offline (§12.4) — and reads no
 * store. Its EMPTY state (§12.9) is a goal-less config: the status line drops
 * the goal segments rather than rendering "0/0", and `Resume` remains the one
 * action, so there is still no dead end. Every state here is escapable:
 * Resume, the confirm's "Keep playing", and Android back (handled by
 * `GameplayScreen`, which owns the `BackHandler` subscription).
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GoldButton } from '../../components/GoldButton';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
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
   * modelled, reserved or referenced here. */
  onRestart: () => void;
  /** §12.2 quit-to-map. Called only AFTER the confirm when §12.2's threshold
   * says one is needed. */
  onQuit: () => void;
}

export function PauseSheet({
  levelId,
  goals,
  moves,
  onResume,
  onRestart,
  onQuit,
}: PauseSheetProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);

  const handleQuitPress = useCallback(() => {
    // §12.2: "quit-to-map (confirm if goals >50% done)". At or below half the
    // player has invested little enough that a second tap is friction, not
    // protection (§1 P6) — leave immediately.
    if (goalsPastHalf(goals)) setConfirming(true);
    else onQuit();
  }, [goals, onQuit]);

  const status = [
    ...(levelId === undefined ? [] : [t('gameplay.level', { id: levelId })]),
    ...goals.map((g) =>
      t('fail.goalLine', {
        label: t(GOAL_LABEL_KEY[g.type]),
        done: g.total - g.remaining,
        total: g.total,
      }),
    ),
    t('pause.movesSegment', { moves }),
  ].join(SEGMENT_SEPARATOR);

  return (
    // `accessibilityViewIsModal` WITHOUT `accessible` on the same node — that
    // pairing collapses the sheet into a single screen-reader node and makes
    // every button below unreachable (§7.6 fix pass), which is the §12.9 dead
    // end this section exists to avoid.
    <View style={styles.backdrop} accessibilityViewIsModal>
      <View style={styles.frame}>
        <View style={styles.sheet}>
          {confirming ? (
            <>
              <Text style={styles.title}>{t('pause.confirm.title')}</Text>
              <Text style={styles.confirmBody}>{t('pause.confirm.body')}</Text>
              <GoldButton
                label={t('pause.confirm.stay')}
                onPress={() => setConfirming(false)}
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

              <GoldButton
                label={t('pause.resume')}
                onPress={onResume}
                size="lg"
                style={styles.cta}
              />

              <SheetRow
                glyph="↻"
                title={t('pause.restart')}
                subtitle={t('pause.restartHint')}
                onPress={onRestart}
              />

              {/* §12.2's "settings shortcut". §12.1 `SettingsScreen` does not
                  exist yet (it is Stage 1, so this is a not-yet, not an
                  out-of-stage), so the row states that rather than pretending
                  to route somewhere. See divergences 2 and 3. */}
              <SheetRow
                glyph="⚙"
                title={t('pause.settings')}
                subtitle={t('pause.settingsUnavailable')}
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
        </View>
      </View>
    </View>
  );
}

/** `colors.night` @ 70% on cream — 5.98:1, the repo's established on-light
 * ink (`GhostButton.onLight`, `ChestSheet`). */
const INK_70 = 'rgba(19,24,48,0.7)';

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    // `colors.night` @ 82% — the panel's dark scrim, no new hex. Opaque
    // enough to also swallow board touches while paused, which is what stops
    // a placement landing behind the sheet.
    backgroundColor: 'rgba(19,24,48,0.82)',
  },
  /** The panel's brass frame around the cream sheet. */
  frame: {
    alignSelf: 'stretch',
    borderRadius: radius.sheet + spacing.sm,
    borderWidth: 2,
    borderColor: colors.goldDeep,
    backgroundColor: colors.goldDeep,
    padding: spacing.sm,
  },
  sheet: {
    borderRadius: radius.sheet,
    backgroundColor: colors.cream,
    padding: spacing.lg,
    gap: spacing.sm,
  },
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
    backgroundColor: 'rgba(19,24,48,0.07)',
  },
  rowPressed: { backgroundColor: 'rgba(19,24,48,0.14)' },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(19,24,48,0.1)',
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
