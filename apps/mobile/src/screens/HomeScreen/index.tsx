import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { isFirebaseConfigured } from '../../services/firebase';
import { useConfigStore } from '../../state/useConfigStore';
import { useMetaStore } from '../../state/useMetaStore';
import { DailyBoardTile } from './DailyBoardTile';
import { EndlessCard, ENDLESS_UNLOCK_LEVEL } from './EndlessCard';

/**
 * HomeScreen — PRD §7.11 / §16.1.
 *
 * Stage 0 placeholder: proves the boot path, the §15 tokens, MMKV-persisted meta
 * state, and the RC snapshot. The real hub (manor exterior, Daily Board tile,
 * gold PLAY CTA, bottom nav) is built in Stage 1 against docs/design/spec.
 *
 * §7.6 v1 (this PR): adds ONLY the small "Endless" entry card §7.11(e) calls
 * for, wired minimally into this placeholder layout. §7.11 owns the real
 * hub composition (manor background, HUD bar, event carousel, bottom nav)
 * and will re-place this card inside that layout in its own pass — nothing
 * here should be read as that build.
 */
export interface HomeScreenProps {
  /** Wired only when `flag_endless` is on AND the player has passed
   * `ENDLESS_UNLOCK_LEVEL` (`EndlessCard` renders no press target
   * otherwise) — see `App.tsx` for the no-router seam this calls into. */
  onPlayEndless?: () => void;
}

export function HomeScreen({ onPlayEndless }: HomeScreenProps = {}): React.JSX.Element {
  const currentLevel = useMetaStore((s) => s.currentLevel);
  const endlessBest = useMetaStore((s) => s.endlessBest);
  const dailyBoardFlag = useConfigStore((s) => s.value('flag_daily_board'));
  // §7.6: "Unlocked after Level 10." `currentLevel` is the NEXT level to
  // play (see `home.play` CTA / the FTUE returning-user check above), so
  // "after Level 10" is complete-and-moved-on, i.e. strictly greater than
  // 10 — still locked while `currentLevel === 10` (mid-attempt on it).
  const endlessFlag = useConfigStore((s) => s.value('flag_endless'));
  const endlessUnlocked = currentLevel > ENDLESS_UNLOCK_LEVEL;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <Text style={styles.title}>{t('home.title')}</Text>
        <Text style={styles.subtitle}>{t('home.subtitle')}</Text>

        <View style={styles.cta}>
          <Text style={styles.ctaText}>{t('home.play', { level: currentLevel })}</Text>
        </View>

        {/* §7.1.3 / §7.11(c): the tile's pulsing presence only — daily-board
            behavior (countdown, LIVE state, percentile) is §7.11/§8 scope. */}
        {dailyBoardFlag ? <DailyBoardTile /> : null}

        {/* §7.6 / §7.11(e): small Endless entry card, flag-gated. Hidden
            entirely (not a locked variant) when `flag_endless` is off. */}
        {endlessFlag ? (
          <EndlessCard
            unlocked={endlessUnlocked}
            currentLevel={currentLevel}
            best={endlessBest}
            onPress={() => onPlayEndless?.()}
          />
        ) : null}

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
