/**
 * `EventBannerSlot` — PRD §7.11(f): "event banner carousel slot (empty in
 * S1–2, hidden via flag)". A named component (not an inline `<View>`)
 * purely so a test can find it by type (qa-prd-auditor M-9: deleting the
 * `flag_events` gate around a bare `<View>` left every test green — nothing
 * could tell "the slot is there" from "the slot is gone").
 *
 * Renders literally nothing: no event content model exists at any stage
 * until §11/§4's own build gives it one (out of this build's scope).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '../../components/tokens';
import { EVENT_BANNER_SLOT_HEIGHT } from './homeTokens';

export function EventBannerSlot(): React.JSX.Element {
  return <View style={styles.slot} />;
}

const styles = StyleSheet.create({
  slot: { height: EVENT_BANNER_SLOT_HEIGHT, marginHorizontal: spacing.md },
});
