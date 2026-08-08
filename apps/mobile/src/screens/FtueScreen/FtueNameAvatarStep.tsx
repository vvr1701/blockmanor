/**
 * Name/avatar step — PRD §7.1.3: "After L5 win → name/avatar screen (guest
 * allowed) → Home reveal...". Not a separate §16.1 canonical screen (the
 * table lists no distinct name for it — it's part of `FtueScreen`'s own
 * flow), so it lives here rather than under `src/screens/`.
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, panel
 * "1.5 Name & avatar" — avatar grid, name field, "Claim the manor" CTA,
 * "or continue as Guest" text link.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  blockColors,
  colors,
  fontFamily,
  fontSize,
  radius,
  spacing,
} from '../../components/tokens';
import { t } from '../../i18n';

const AVATAR_COLORS = Object.values(blockColors);
/** §15 a11y: every interactive element ≥44dp regardless of its visual size. */
const AVATAR_TOUCH_SIZE = 44;

export interface FtueNameAvatarStepProps {
  /** `guest: true` when the player skipped naming (§7.1.3 "guest allowed"). */
  onDone: (name: string | null, avatarId: number | null, guest: boolean) => void;
}

export function FtueNameAvatarStep({ onDone }: FtueNameAvatarStepProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [avatarIndex, setAvatarIndex] = useState(0);

  const claim = (): void => {
    const trimmed = name.trim();
    onDone(trimmed.length > 0 ? trimmed : null, avatarIndex, false);
  };
  const guest = (): void => onDone(null, null, true);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.title}>{t('ftue.nameAvatar.title')}</Text>
        <Text style={styles.subtitle}>{t('ftue.nameAvatar.subtitle')}</Text>

        <View style={styles.avatarRow}>
          {AVATAR_COLORS.map((color, i) => (
            <Pressable
              key={color}
              onPress={() => setAvatarIndex(i)}
              accessibilityRole="button"
              accessibilityLabel={t('ftue.nameAvatar.avatarLabel', { n: i + 1 })}
              style={[
                styles.avatar,
                { backgroundColor: color },
                avatarIndex === i ? styles.avatarSelected : null,
              ]}
            />
          ))}
        </View>

        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={t('ftue.nameAvatar.placeholder')}
          placeholderTextColor={colors.muted}
          maxLength={14}
          accessibilityLabel={t('ftue.nameAvatar.inputLabel')}
        />

        <View style={styles.spacer} />

        <Pressable
          style={styles.cta}
          onPress={claim}
          accessibilityRole="button"
          accessibilityLabel={t('ftue.nameAvatar.cta')}
        >
          <Text style={styles.ctaText}>{t('ftue.nameAvatar.cta')}</Text>
        </Pressable>
        <Pressable
          style={styles.guestButton}
          onPress={guest}
          accessibilityRole="button"
          accessibilityLabel={t('ftue.nameAvatar.guest')}
        >
          <Text style={styles.guestText}>{t('ftue.nameAvatar.guest')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.night },
  content: { flex: 1, padding: spacing.lg, alignItems: 'center' },
  title: {
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.xl,
    color: colors.cream,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  subtitle: {
    marginTop: spacing.xs,
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.muted,
    textAlign: 'center',
  },
  avatarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  avatar: {
    width: AVATAR_TOUCH_SIZE,
    height: AVATAR_TOUCH_SIZE,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarSelected: { borderColor: colors.gold },
  input: {
    marginTop: spacing.xl,
    width: '100%',
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: 'rgba(233,196,106,0.5)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.cream,
    fontSize: fontSize.md,
    fontWeight: '700',
    minHeight: AVATAR_TOUCH_SIZE,
  },
  spacer: { flex: 1 },
  cta: {
    width: '100%',
    backgroundColor: colors.gold,
    paddingVertical: spacing.md,
    borderRadius: radius.card,
    borderBottomWidth: 3,
    borderBottomColor: colors.goldDeep,
    alignItems: 'center',
    minHeight: AVATAR_TOUCH_SIZE,
    justifyContent: 'center',
  },
  ctaText: { color: colors.night, fontSize: fontSize.lg, fontWeight: '800' },
  guestButton: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    minHeight: AVATAR_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestText: {
    color: colors.muted,
    fontSize: fontSize.sm,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
