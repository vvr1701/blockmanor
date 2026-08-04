import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { isFirebaseConfigured } from '../../services/firebase';
import { useConfigStore } from '../../state/useConfigStore';
import { useMetaStore } from '../../state/useMetaStore';

/**
 * HomeScreen — PRD §7.11 / §16.1.
 *
 * Stage 0 placeholder: proves the boot path, the §15 tokens, MMKV-persisted meta
 * state, and the RC snapshot. The real hub (manor exterior, Daily Board tile,
 * gold PLAY CTA, bottom nav) is built in Stage 1 against docs/design/spec.
 */
export function HomeScreen(): React.JSX.Element {
  const currentLevel = useMetaStore((s) => s.currentLevel);
  const dailyBoardFlag = useConfigStore((s) => s.value('flag_daily_board'));

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <Text style={styles.title}>{t('home.title')}</Text>
        <Text style={styles.subtitle}>{t('home.subtitle')}</Text>

        <View style={styles.cta}>
          <Text style={styles.ctaText}>{t('home.play', { level: currentLevel })}</Text>
        </View>

        <View style={styles.status}>
          <Text style={styles.statusText}>
            {isFirebaseConfigured()
              ? t('home.status.firebase.ready')
              : t('home.status.firebase.missing')}
          </Text>
          <Text style={styles.statusText}>
            {t('home.status.dailyBoard', { state: dailyBoardFlag ? 'on' : 'off' })}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.night },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { color: colors.cream, fontSize: fontSize.xxl, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: fontSize.sm },
  cta: {
    marginTop: spacing.lg,
    backgroundColor: colors.gold,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.card,
    borderBottomWidth: 3,
    borderBottomColor: colors.goldDeep,
  },
  ctaText: { color: colors.night, fontSize: fontSize.lg, fontWeight: '800' },
  status: { marginTop: spacing.xl, alignItems: 'center', gap: spacing.xs },
  statusText: { color: colors.muted, fontSize: fontSize.xs },
});
