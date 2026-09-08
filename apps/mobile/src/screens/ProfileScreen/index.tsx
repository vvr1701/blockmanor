/**
 * §12.3 Profile — avatar/name edit, stats, badge case.
 *
 * Every stat reads its SOURCE OF TRUTH rather than a re-derivation, which is
 * what §12.3's acceptance asks for: levels-done counts the `stars` map (a
 * level is done iff it has a star record), and lines/streak are accumulated
 * where they happen rather than reverse-engineered from score.
 *
 * `bestDailyPercentile` has no source yet — §8.4's client is a later branch —
 * so it renders §12.9's "Early bird" empty state rather than a fake 0%.
 */
import { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { GhostButton } from '../../components/GhostButton';
import { colors, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { formatScore } from '../../i18n/format';
import { useMetaStore } from '../../state/useMetaStore';

const MIN_TOUCH_TARGET = 44;

/** A level counts as done once it has a star record (§7.5 writes one on every
 * win). Counting the map is the source of truth; `currentLevel - 1` is the
 * re-derivation §12.3 explicitly rejects — it is wrong for any player who
 * replayed, skipped via FTUE, or is mid-attempt. */
export function levelsCompleted(stars: Record<string, number>): number {
  return Object.keys(stars ?? {}).length;
}

export interface ProfileScreenProps {
  onClose: () => void;
}

export function ProfileScreen({ onClose }: ProfileScreenProps): React.JSX.Element {
  const playerName = useMetaStore((s) => s.playerName);
  const avatarId = useMetaStore((s) => s.avatarId);
  const setProfile = useMetaStore((s) => s.setProfile);
  const stars = useMetaStore((s) => s.stars);
  const longestStreak = useMetaStore((s) => s.longestStreak);
  const totalLines = useMetaStore((s) => s.totalLines);
  const bestPercentile = useMetaStore((s) => s.bestDailyPercentile);
  const ownedFrames = useMetaStore((s) => s.ownedFrames);
  const [name, setName] = useState(playerName ?? '');
  const commitName = (): void => setProfile(name.trim().length > 0 ? name.trim() : null, avatarId);

  const stats: { label: string; value: string }[] = [
    { label: t('profile.stat.levels'), value: String(levelsCompleted(stars)) },
    {
      label: t('profile.stat.percentile'),
      value: bestPercentile > 0 ? t('profile.percentileValue', { n: bestPercentile }) : '—',
    },
    { label: t('profile.stat.streak'), value: String(longestStreak) },
    { label: t('profile.stat.lines'), value: formatScore(totalLines) },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{t('profile.title')}</Text>

        <View style={styles.avatarRow}>
          {[0, 1, 2, 3].map((id) => (
            <Pressable
              key={id}
              onPress={() => setProfile(name.length > 0 ? name : null, id)}
              accessibilityRole="button"
              accessibilityLabel={t('profile.avatarA11y', { n: id + 1 })}
              accessibilityState={{ selected: avatarId === id }}
              style={[styles.avatar, avatarId === id ? styles.avatarSelected : null]}
            >
              <Text style={styles.avatarText}>{id + 1}</Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={commitName}
          onSubmitEditing={commitName}
          placeholder={t('profile.guest')}
          placeholderTextColor={colors.muted}
          accessibilityLabel={t('profile.nameA11y')}
          style={styles.name}
        />

        <View style={styles.statGrid}>
          {stats.map((s) => (
            <View key={s.label} style={styles.stat}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t('profile.badgeCase')}</Text>
        {ownedFrames.length > 0 ? (
          <View style={styles.frames}>
            {ownedFrames.map((id) => (
              <View key={id} style={styles.frame}>
                <Text style={styles.frameText}>{t(`frames.${id}` as Parameters<typeof t>[0])}</Text>
              </View>
            ))}
          </View>
        ) : (
          // §12.9: an empty state ships with EXACTLY ONE action button.
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('profile.noFrames')}</Text>
            <GhostButton label={t('profile.noFramesCta')} onPress={onClose} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.night },
  container: { padding: spacing.lg, gap: spacing.md },
  title: { color: colors.cream, fontSize: fontSize.xl, fontWeight: '700' },
  avatarRow: { flexDirection: 'row', gap: spacing.sm },
  avatar: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.card,
    backgroundColor: colors.night2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSelected: { borderWidth: 2, borderColor: colors.gold },
  avatarText: { color: colors.cream, fontSize: fontSize.md, fontWeight: '700' },
  name: { color: colors.cream, fontSize: fontSize.lg, fontWeight: '700' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: { minWidth: 120, gap: spacing.xs },
  statValue: { color: colors.gold, fontSize: fontSize.lg, fontWeight: '700' },
  statLabel: { color: colors.muted, fontSize: fontSize.sm },
  sectionTitle: { color: colors.cream, fontSize: fontSize.md, fontWeight: '700' },
  frames: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  frame: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.card,
    backgroundColor: colors.night2,
  },
  frameText: { color: colors.cream, fontSize: fontSize.sm },
  empty: { gap: spacing.md, alignItems: 'flex-start' },
  emptyText: { color: colors.muted, fontSize: fontSize.md },
});
