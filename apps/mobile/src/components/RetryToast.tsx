/**
 * §12.8: "every callable failure -> toast with retry, never dead-end modals."
 *
 * A toast rather than a modal is the whole point of the clause: a modal that
 * can only be dismissed by succeeding is the dead end §12.9 forbids. This
 * dismisses itself, and `onRetry` is optional — a failure with no sensible
 * retry still gets told to the player rather than swallowed.
 *
 * FIRST PRODUCTION CALLER IS §8.3's daily client, which is where the first
 * callable in the app lands. It is built here because §12.8 specifies it, not
 * speculatively: the tests below drive it directly, and §8.3 wires it to
 * `dailyPlayStart` / `dailySubmit` when those reach the client.
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from './tokens';
import { t } from '../i18n';

/** Long enough to read and reach, short enough not to sit on the board. */
export const TOAST_VISIBLE_MS = 5000;
const MIN_TOUCH_TARGET = 44;

export interface RetryToastProps {
  message: string;
  onDismiss: () => void;
  /** Omit when the failure has no meaningful retry. */
  onRetry?: () => void;
}

export function RetryToast({ message, onDismiss, onRetry }: RetryToastProps): React.JSX.Element {
  useEffect(() => {
    const id = setTimeout(onDismiss, TOAST_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [onDismiss]);

  return (
    <View style={styles.toast} accessibilityRole="alert">
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t('toast.retry')}
          hitSlop={spacing.sm}
          style={styles.retry}
        >
          <Text style={styles.retryText}>{t('toast.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.card,
    backgroundColor: colors.night2,
  },
  message: { color: colors.cream, fontSize: fontSize.md, flexShrink: 1 },
  retry: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  retryText: { color: colors.gold, fontSize: fontSize.md, fontWeight: '700' },
});
