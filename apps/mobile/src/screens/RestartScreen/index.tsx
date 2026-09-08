/**
 * §12.8's "friendly restart screen" — what a player sees instead of a white
 * screen. §12.9's rule applies: exactly ONE action button, never a dead end.
 *
 * The copy deliberately does not blame the player or explain the fault; §1's
 * P2 ("never punish without an exit") is the tone, and a stack trace on a
 * player's screen is neither friendly nor useful.
 */
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { GoldButton } from '../../components/GoldButton';
import { colors, fontSize, spacing } from '../../components/tokens';
import { t } from '../../i18n';

export interface RestartScreenProps {
  onRestart: () => void;
}

export function RestartScreen({ onRestart }: RestartScreenProps): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.emoji}>🫖</Text>
        <Text style={styles.title}>{t('restart.title')}</Text>
        <Text style={styles.body}>{t('restart.body')}</Text>
        <GoldButton label={t('restart.cta')} onPress={onRestart} size="lg" />
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
  emoji: { fontSize: 48 },
  title: { color: colors.cream, fontSize: fontSize.xl, fontWeight: '700', textAlign: 'center' },
  body: {
    color: colors.muted,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
});
