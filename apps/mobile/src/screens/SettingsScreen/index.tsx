/**
 * `SettingsScreen` — PRD §12.1 / §16.1.
 *
 * "SFX/music/haptics toggles · notification prefs by category · language
 * (S3) · link account · restore purchases (S2) · support (mailto) ·
 * privacy/terms links · delete account (S2) · version/build footer."
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, panel 9.1
 * "Settings" — a back chevron + serif title, a stacked row list (live
 * toggles for Sound effects/Music/Haptics, nav rows for the rest), a
 * language pill row, and a footer line with version/build + player id.
 *
 * DIVERGENCES from panel 9.1, all deliberate:
 * 1. **No Player ID line.** The footer shows only version/build (§12.1's own
 *    acceptance names exactly that: "the version/build footer matches the
 *    running build"). No section of §12.1 asks for a player-id display, and
 *    inventing one is a product decision this PR doesn't own.
 * 2. **Language, link account, restore purchases and delete account render
 *    as EMPTY reserved rows, not the mockup's live nav rows.** All four are
 *    later-stage: language is §11.4 (Stage 3 localization), the other three
 *    are §12.6/Stage 2 (auth upgrade, IAP restore, account deletion). Per
 *    §0 rule 2a a reserved slot "must render nothing, read no later-stage
 *    state, and import no later-stage module" — so each is a fixed-height
 *    `View`, same shape as `FailScreen`'s `CONTINUE_SLOT_RESERVED_HEIGHT`
 *    reservation, not a greyed-out preview row (which would need copy this
 *    PR has no source of truth for, e.g. the mockup's "English"/"Google
 *    Play" values are illustrative sample data, not real state).
 * 3. **Notifications are two live toggles, not the mockup's single "Manage"
 *    nav row.** §12.1's own text is "notification prefs BY CATEGORY," and
 *    §8.7 names exactly two Stage-1 push categories (daily-drop, 20:00
 *    streak-risk) — there is no third category and no separate management
 *    screen to navigate to.
 * 4. **Support/Privacy/Terms link out to placeholder URLs.** §17's launch
 *    checklist lists "support email" and "privacy policy + terms hosted" as
 *    unprovisioned business/ops tasks — no real address or hosted page
 *    exists anywhere in this repo or the PRD. `SUPPORT_EMAIL`/`PRIVACY_URL`/
 *    `TERMS_URL` below are genuinely working link-outs (a real `mailto:`,
 *    real `https:` URLs) built from the app's own domain-shaped slug, not
 *    invented unrelated addresses — swap the constants for the operator's
 *    real ones once §17 is done. Same class of decision as §12.5's iOS
 *    store-search fallback.
 *
 * States (CLAUDE.md screen checklist): no loading/error/offline — every
 * read here is synchronous local state (`useMetaStore`, MMKV-backed) or a
 * compiled build constant (`appInfo.ts`); nothing calls the network. No
 * empty state: the screen always has its full row list, and pressing the
 * close chevron is always the one escape (§12.9 "never a dead end").
 */
import React, { useCallback } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Toggle } from '../../components/Toggle';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
import { playCue } from '../../game/sfx';
import { t } from '../../i18n';
import { getBuildLabel, getInstalledVersion } from '../../services/appInfo';
import { useMetaStore } from '../../state/useMetaStore';
import { SETTINGS_RESERVED_ROW_HEIGHT } from './settingsTokens';

/** §12.1 divergence 4 — see file header. Placeholder targets pending §17. */
const SUPPORT_EMAIL = 'support@blockmanor.game';
const PRIVACY_URL = 'https://blockmanor.game/privacy';
const TERMS_URL = 'https://blockmanor.game/terms';

const MIN_TOUCH_TARGET = 44;

function SectionHeader({ label }: { label: string }): React.JSX.Element {
  return <Text style={styles.sectionHeader}>{label}</Text>;
}

function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Toggle label={label} value={value} onValueChange={onValueChange} />
    </View>
  );
}

function LinkRow({ label, url }: { label: string; url: string }): React.JSX.Element {
  const handlePress = useCallback(() => {
    playCue('btn_tap');
    void Linking.openURL(url);
  }, [url]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowChevron}>{'›'}</Text>
    </Pressable>
  );
}

/** §0 rule 2a reserved slot — renders nothing, reads no later-stage state,
 * imports no later-stage module. See file header divergence 2. */
function ReservedRow(): React.JSX.Element {
  return <View style={styles.reservedRow} />;
}

export interface SettingsScreenProps {
  onExit: () => void;
}

export function SettingsScreen({ onExit }: SettingsScreenProps): React.JSX.Element {
  const sfxEnabled = useMetaStore((s) => s.sfxEnabled);
  const musicEnabled = useMetaStore((s) => s.musicEnabled);
  const hapticsEnabled = useMetaStore((s) => s.hapticsEnabled);
  const notificationPrefs = useMetaStore((s) => s.notificationPrefs);
  const setSfxEnabled = useMetaStore((s) => s.setSfxEnabled);
  const setMusicEnabled = useMetaStore((s) => s.setMusicEnabled);
  const setHapticsEnabled = useMetaStore((s) => s.setHapticsEnabled);
  const setNotificationPref = useMetaStore((s) => s.setNotificationPref);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable
          onPress={onExit}
          accessibilityRole="button"
          accessibilityLabel={t('settings.closeLabel')}
          hitSlop={8}
          style={styles.close}
        >
          <Text style={styles.closeGlyph}>{'‹'}</Text>
        </Pressable>
        <Text style={styles.topTitle}>{t('settings.title')}</Text>
        <View style={styles.close} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ToggleRow label={t('settings.sfx')} value={sfxEnabled} onValueChange={setSfxEnabled} />
        <ToggleRow
          label={t('settings.music')}
          value={musicEnabled}
          onValueChange={setMusicEnabled}
        />
        <ToggleRow
          label={t('settings.haptics')}
          value={hapticsEnabled}
          onValueChange={setHapticsEnabled}
        />

        <SectionHeader label={t('settings.notifications.header')} />
        <ToggleRow
          label={t('settings.notifications.dailyDrop')}
          value={notificationPrefs.dailyDrop}
          onValueChange={(v) => setNotificationPref('dailyDrop', v)}
        />
        <ToggleRow
          label={t('settings.notifications.streakRisk')}
          value={notificationPrefs.streakRisk}
          onValueChange={(v) => setNotificationPref('streakRisk', v)}
        />

        {/* S3 — language (§11.4 localization). Reserved, see file header. */}
        <ReservedRow />
        {/* S2 — link account (§12.6). Reserved, see file header. */}
        <ReservedRow />
        {/* S2 — restore purchases (§10.3). Reserved, see file header. */}
        <ReservedRow />

        <LinkRow label={t('settings.support')} url={`mailto:${SUPPORT_EMAIL}`} />
        <LinkRow label={t('settings.privacy')} url={PRIVACY_URL} />
        <LinkRow label={t('settings.terms')} url={TERMS_URL} />

        {/* S2 — delete account (§12.6). Reserved, see file header. */}
        <ReservedRow />

        <Text style={styles.footer}>
          {t('settings.footer', { version: getInstalledVersion(), build: getBuildLabel() })}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.night },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { color: colors.cream, fontSize: fontSize.lg, fontWeight: '700' },
  topTitle: {
    color: colors.cream,
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.lg,
  },
  content: { padding: spacing.md, gap: spacing.xs },
  sectionHeader: {
    // `colors.muted` — 6.87:1 on `colors.night`, clears the 4.5:1 normal-text
    // floor at full opacity (an alpha-dimmed cream measured under 4.5:1 here).
    color: colors.muted,
    fontSize: fontSize.xs,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.card,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.1)' },
  rowLabel: { color: colors.cream, fontSize: fontSize.sm, fontWeight: '800' },
  // `colors.muted` — same contrast rationale as `sectionHeader` above.
  rowChevron: { color: colors.muted, fontSize: fontSize.md, fontWeight: '700' },
  reservedRow: { height: SETTINGS_RESERVED_ROW_HEIGHT },
  footer: {
    color: colors.muted,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.lg,
    fontVariant: ['tabular-nums'],
  },
});
