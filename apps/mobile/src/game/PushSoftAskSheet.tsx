/**
 * §7.1 step 5 "Notification soft-ask ONLY after first Daily Board completion",
 * mockup panel "1.6 Notification soft-ask" ("Want tomorrow's board the second
 * it drops?" · one line · Notify me · Maybe later). "The OS dialog appears one
 * tap later — never first": this sheet asks; only "Notify me" reaches the OS.
 *
 * NOT built: the butler-with-letter-tray illustration (no art pipeline output
 * yet). The mockup's "9am" is not copied — the hour is `daily_push_hour`
 * (§0 v1.32(d)).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GoldButton } from '../components/GoldButton';
import { colors, fontFamily, fontSize, radius, spacing, withAlpha } from '../components/tokens';
import { t } from '../i18n';

export interface PushSoftAskSheetProps {
  onAnswer: (accepted: boolean) => void;
}

export function PushSoftAskSheet({ onAnswer }: PushSoftAskSheetProps): React.JSX.Element {
  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <View style={styles.sheet}>
        <Text style={styles.title}>{t('push.softAsk.title')}</Text>
        <Text style={styles.body}>{t('push.softAsk.body')}</Text>
        <GoldButton
          label={t('push.softAsk.accept')}
          onPress={() => onAnswer(true)}
          size="lg"
          style={styles.cta}
        />
        <Pressable
          style={styles.later}
          onPress={() => onAnswer(false)}
          accessibilityRole="button"
          accessibilityLabel={t('push.softAsk.decline')}
        >
          <Text style={styles.laterText}>{t('push.softAsk.decline')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,11,24,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radius.sheet,
    padding: spacing.lg,
    backgroundColor: colors.cream,
  },
  title: {
    textAlign: 'center',
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.lg,
    color: colors.night,
  },
  body: {
    marginTop: spacing.sm,
    textAlign: 'center',
    color: colors.night,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  cta: { marginTop: spacing.lg },
  later: { marginTop: spacing.sm, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  laterText: {
    color: withAlpha(colors.night, 0.7),
    fontSize: fontSize.sm,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
