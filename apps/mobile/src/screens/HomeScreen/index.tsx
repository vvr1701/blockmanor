import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { GoldButton } from '../../components/GoldButton';
import { colors, fontSize, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { isFirebaseConfigured } from '../../services/firebase';
import { useConfigStore } from '../../state/useConfigStore';
import { useMetaStore } from '../../state/useMetaStore';
import { DailyBoardTile } from './DailyBoardTile';

/**
 * HomeScreen — PRD §7.11 / §16.1.
 *
 * Stage 0 placeholder: proves the boot path, the §15 tokens, MMKV-persisted meta
 * state, and the RC snapshot. The real hub (manor exterior, Daily Board tile,
 * gold PLAY CTA, bottom nav) is built in Stage 1 against docs/design/spec.
 *
 * §7.5/§7.11: `onPlay` is the "PLAY — Level N" primary CTA wiring the
 * §7.5 progression loop needs to be reachable at all — `App.tsx` maps it to
 * mounting `LevelSession` for `currentLevel`.
 */
export interface HomeScreenProps {
  onPlay: () => void;
}

export function HomeScreen({ onPlay }: HomeScreenProps): React.JSX.Element {
  const currentLevel = useMetaStore((s) => s.currentLevel);
  const dailyBoardFlag = useConfigStore((s) => s.value('flag_daily_board'));

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <Text style={styles.title}>{t('home.title')}</Text>
        <Text style={styles.subtitle}>{t('home.subtitle')}</Text>

        <GoldButton
          label={t('home.play', { level: currentLevel })}
          onPress={onPlay}
          size="lg"
          style={styles.cta}
        />

        {/* §7.1.3 / §7.11(c): the tile's pulsing presence only — daily-board
            behavior (countdown, LIVE state, percentile) is §7.11/§8 scope. */}
        {dailyBoardFlag ? <DailyBoardTile /> : null}

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
  cta: { marginTop: spacing.lg },
  status: { marginTop: spacing.xl, alignItems: 'center', gap: spacing.xs },
  statusText: { color: colors.muted, fontSize: fontSize.xs },
});
