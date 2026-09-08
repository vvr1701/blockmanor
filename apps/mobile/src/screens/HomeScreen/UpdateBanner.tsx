/**
 * §12.11 soft update nudge — "dismissible Home banner, max 1/week".
 *
 * Deliberately NOT a modal and NOT a second gold button (§7.11's composed-
 * screen rule, §0 v1.21): a soft nudge that blocks the primary action is not
 * soft. It is a dismissible strip with a link-out, and the dismiss control is
 * the one §12.9 action that must always be reachable.
 *
 * The "max 1/week" window is enforced by the CALLER (`HomeScreen`) via
 * `isNudgeSuppressed`, not in here, so the decision and its clock live in one
 * testable place rather than inside a render.
 */
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { getStoreUrl } from '../../services/appInfo';

/** §12.11 "max 1/week". */
export const NUDGE_SUPPRESSION_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_TOUCH_TARGET = 44;

/** True while a dismissal is still inside its week. `0` (never dismissed) is
 * never suppressed — `now - 0` is enormous, but stating it explicitly beats
 * relying on that arithmetic holding forever. */
export function isNudgeSuppressed(dismissedAt: number, now: number): boolean {
  if (dismissedAt <= 0) return false;
  return now - dismissedAt < NUDGE_SUPPRESSION_MS;
}

export interface UpdateBannerProps {
  onDismiss: () => void;
}

export function UpdateBanner({ onDismiss }: UpdateBannerProps): React.JSX.Element {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{t('update.nudge')}</Text>
      <Pressable
        onPress={() => void Linking.openURL(getStoreUrl())}
        accessibilityRole="button"
        accessibilityLabel={t('update.cta')}
        hitSlop={spacing.sm}
        style={styles.action}
      >
        <Text style={styles.actionText}>{t('update.cta')}</Text>
      </Pressable>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t('update.dismiss')}
        hitSlop={spacing.sm}
        style={styles.action}
      >
        <Text style={styles.dismissText}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.card,
    backgroundColor: colors.night2,
  },
  text: { color: colors.cream, fontSize: fontSize.sm, flexShrink: 1 },
  action: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  actionText: { color: colors.gold, fontSize: fontSize.sm, fontWeight: '700' },
  dismissText: { color: colors.muted, fontSize: fontSize.md },
});
