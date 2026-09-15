/**
 * §7.1 step 4 "Daily Board soft-gate: after first Home visit, butler card
 * introduces 'Today's Board'." Shown on Home once FTUE is done, until the
 * player either opens the board from it or dismisses it; never again after.
 *
 * NOT built: the butler illustration (no art pipeline output yet — same note
 * as Home's manor and the push soft-ask).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, radius, spacing, withAlpha } from '../../components/tokens';
import { t } from '../../i18n';

const MIN_TOUCH = 44;

export interface DailyIntroCardProps {
  onOpen: () => void;
  onDismiss: () => void;
}

export function DailyIntroCard({ onOpen, onDismiss }: DailyIntroCardProps): React.JSX.Element {
  return (
    <View style={styles.card} accessibilityRole="summary">
      <Text style={styles.speaker}>{t('home.dailyIntro.speaker')}</Text>
      <Text style={styles.title}>{t('home.dailyIntro.title')}</Text>
      <Text style={styles.body}>{t('home.dailyIntro.body')}</Text>
      <View style={styles.actions}>
        <Pressable
          style={[styles.action, styles.primary]}
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={t('home.dailyIntro.open')}
        >
          <Text style={styles.primaryText}>{t('home.dailyIntro.open')}</Text>
        </Pressable>
        <Pressable
          style={styles.action}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t('home.dailyIntro.dismiss')}
        >
          <Text style={styles.dismissText}>{t('home.dailyIntro.dismiss')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    padding: spacing.md,
    backgroundColor: colors.cream,
    marginBottom: spacing.sm,
  },
  speaker: { color: withAlpha(colors.night, 0.7), fontSize: fontSize.xs, fontWeight: '900' },
  title: {
    marginTop: 2,
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.md,
    color: colors.night,
  },
  body: { marginTop: spacing.xs, color: colors.night, fontSize: fontSize.sm, fontWeight: '700' },
  actions: { marginTop: spacing.sm, flexDirection: 'row', gap: spacing.sm },
  action: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: spacing.md },
  // Night, not gold: Home keeps exactly one gold button (panel 2.1).
  primary: { backgroundColor: colors.night, borderRadius: radius.card },
  primaryText: { color: colors.cream, fontSize: fontSize.sm, fontWeight: '900' },
  dismissText: {
    color: withAlpha(colors.night, 0.7),
    fontSize: fontSize.sm,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
