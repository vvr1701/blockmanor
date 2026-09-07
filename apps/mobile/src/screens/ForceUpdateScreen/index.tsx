/**
 * `ForceUpdateScreen` — PRD §12.5 / §16.1: "Remote Config `min_supported_version`;
 * below → blocking screen with store button." The remote kill switch's harder
 * half — §12.5's acceptance line is explicit that a below-minimum build
 * "cannot be dismissed into the game."
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, panel "9.4
 * Maintenance / update", the "Forced-update variant" block (dashed gold-bordered
 * card: eyebrow, title, body naming what the update adds, gold CTA "Update on
 * Google Play"). This screen borrows the panel's card chrome but not its exact
 * copy — the panel's body names a specific version's specific feature
 * ("Version 1.1 adds the Conservatory"), which this build has no source of
 * truth for (no RC key names a feature list); the body here instead states the
 * one fact this screen actually knows, `min_supported_version` itself.
 *
 * NOT DISMISSIBLE BY CONSTRUCTION, not by a guard: this component takes no
 * `onDismiss`/`onClose` prop and `App.tsx` mounts it with nothing else in the
 * tree, so there is no sibling screen for a back-press or a stray callback to
 * reveal. Android hardware back therefore falls through to the OS default
 * (exits the app) rather than "back into the game" — which is not the game.
 *
 * The store button is a LINK-OUT (`Linking.openURL`, §12.5's own scope note:
 * "a link-out, not a purchase flow"), not in-app navigation — pressing it
 * cannot itself reveal the game either.
 *
 * States (CLAUDE.md screen checklist): no loading — the gate that mounts this
 * screen already resolved a boolean synchronously (`useConfigStore` always
 * has a value, live-fetched or the compiled default). No empty state — the
 * screen is never contentless, it always names `minSupportedVersion`. No
 * server-side error state to show — `Linking.openURL`'s promise is not
 * awaited for UI purposes (the store app opening, or not, is entirely
 * outside this app's control once the intent fires). No offline state
 * distinct from the screen's own purpose: this gate does not require
 * connectivity to RENDER (§12.5 "must not depend on anything that could
 * itself be the thing that is broken" — that is why `useConfigStore` always
 * holds at least the compiled default rather than blocking on a fetch);
 * connectivity only affects whether the store button's target loads, which
 * is the store app's concern, not this screen's.
 */
import React, { useCallback } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { GoldButton } from '../../components/GoldButton';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
import { getStoreUrl } from '../../services/appInfo';
import { t } from '../../i18n';

export interface ForceUpdateScreenProps {
  /** `[RC] min_supported_version` — read by the caller once, so this
   * component stays a pure render of the fact rather than a second reader
   * of `useConfigStore` (CLAUDE.md rule 3 is about call sites, not about how
   * many times a screen may re-derive the same store read). */
  minSupportedVersion: string;
}

export function ForceUpdateScreen({
  minSupportedVersion,
}: ForceUpdateScreenProps): React.JSX.Element {
  const handleStorePress = useCallback(() => {
    void Linking.openURL(getStoreUrl());
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>{t('forceUpdate.eyebrow')}</Text>
        <Text style={styles.title}>{t('forceUpdate.title')}</Text>
        <Text style={styles.body}>{t('forceUpdate.body', { version: minSupportedVersion })}</Text>
        <GoldButton
          label={t('forceUpdate.cta')}
          onPress={handleStorePress}
          size="lg"
          style={styles.cta}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    backgroundColor: colors.cream,
    borderRadius: radius.sheet,
    borderWidth: 1.5,
    borderColor: colors.goldDeep,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  eyebrow: {
    color: colors.goldDeep,
    fontSize: fontSize.xs,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.night,
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.xl,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  body: {
    color: 'rgba(19,24,48,0.7)', // colors.night @ 70% — 5.98:1 on cream, the repo's on-light ink
    fontSize: fontSize.sm,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  cta: { width: '100%', marginTop: spacing.md },
});
