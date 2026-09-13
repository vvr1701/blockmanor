/**
 * `ModalSheet` — PRD §15's "brass frame" component
 * (`GoldButton · GhostButton · Card · ModalSheet · HUDBar · TimerChip ·
 * Badge · ProgressBar · Toast · Confetti`). Extracted from three inline
 * copies that had grown byte-identical `backdrop`/`frame`/`sheet` style
 * trios (`PauseSheet` §12.2, `ChestSheet` §7.10) — the dark scrim, the
 * 2dp `colors.goldDeep` frame, the cream sheet inside it.
 *
 * `EndlessResultSheet` (§7.6) was grepped as a candidate too and is
 * deliberately NOT converged here: it renders a scrim + a flat cream card
 * with no brass frame layer at all (verified — `grep -rn "backgroundColor:
 * colors.goldDeep" src/` returns exactly the two files above), so it is a
 * different composition, not a third copy of this one.
 *
 * No visual change intended: every pixel value below is copied verbatim
 * from `PauseSheet`'s pre-extraction styles.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing, withAlpha } from './tokens';

export interface ModalSheetProps {
  /** Rendered inside the cream sheet, inside the brass frame. */
  children: React.ReactNode;
  /** Rendered inside the backdrop but OUTSIDE the frame — `ChestSheet`'s
   * "Not now" dismiss link sits on the dark scrim below the frame, not
   * inside the cream card. */
  footer?: React.ReactNode;
  /** `PauseSheet`'s rows want the sheet's children to stretch full width
   * (the default, `'stretch'`); `ChestSheet`'s badge/text/CTA stack wants
   * them centred. */
  sheetAlign?: 'stretch' | 'center';
}

export function ModalSheet({
  children,
  footer,
  sheetAlign = 'stretch',
}: ModalSheetProps): React.JSX.Element {
  return (
    // `accessibilityViewIsModal` WITHOUT `accessible` on the same node — that
    // pairing collapses the sheet into a single screen-reader node and makes
    // every control inside unreachable (§7.6 fix pass), the §12.9 dead end
    // this component's callers all exist to avoid.
    <View style={styles.backdrop} accessibilityViewIsModal>
      <View style={styles.frame}>
        <View style={[styles.sheet, sheetAlign === 'center' ? styles.sheetCenter : null]}>
          {children}
        </View>
      </View>
      {footer}
    </View>
  );
}

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
    // `colors.night` @ 82% — the mockup's dark scrim, no new hex.
    backgroundColor: withAlpha(colors.night, 0.82),
  },
  /** The mockup's brass frame around the cream sheet. */
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
  sheetCenter: { alignItems: 'center' },
});
