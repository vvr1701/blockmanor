/**
 * `OutOfCoinsSheet` — PRD §9.4 step 3 / §16.1. Opens when `ContinueSheet`'s
 * paid Continue is tapped but the shown coin balance can't cover the price:
 * "compact 2-bundle store slides over (smallest bundle highlighted 'covers
 * your continue'), full store link. Cancel → back to fail screen."
 *
 * §0 v1.45(e): §10.3 (the IAP catalog, `ShopScreen`, RevenueCat) is not built
 * in this codebase yet, so the two bundles below are READ-ONLY info cards —
 * not buttons — sourced from §10.3's own table (`coins_s`/`coins_m`; store
 * price points stay store-managed, §0 v1.5, hence plain constants here, never
 * an `[RC]` key). There is no "full store" link for the same reason: a
 * tappable affordance with nowhere to go is the §12.9 dead end CLAUDE.md
 * rejects, and `HomeScreen`'s own nav already omits links to screens that
 * don't exist yet rather than wiring a no-op. "Cancel" is the only real
 * control, exactly as the PRD line names it.
 *
 * §0 v1.47(c): `OutOfLivesSheet`'s "Refill" button is the exact same shape of
 * problem (not enough coins for a priced thing) and reuses this component
 * rather than forking it — `body`/`coversLabel` are overridable so that
 * caller can say "to refill a life" instead of "to continue" without a
 * second, near-identical sheet.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GhostButton } from '../../components/GhostButton';
import { ModalSheet } from '../../components/ModalSheet';
import { colors, fontSize, radius, spacing, withAlpha } from '../../components/tokens';
import { t } from '../../i18n';
import { formatScore } from '../../i18n/format';

/** §10.3's two smallest coin bundles — the ones a continue's price range
 * (`continue_price_1..3`, §13 defaults 900/1200/1600) can plausibly need. */
const BUNDLE_SMALL = { sku: 'coins_s', coins: 1_100, priceInr: 89 } as const;
const BUNDLE_MID = { sku: 'coins_m', coins: 3_600, priceInr: 269 } as const;
const BUNDLES = [BUNDLE_SMALL, BUNDLE_MID] as const;

export interface OutOfCoinsSheetProps {
  /** The price that couldn't be covered — decides which bundle gets the
   * "covers" badge. */
  price: number;
  onCancel: () => void;
  /** Pre-rendered body text; defaults to §9.4's own continue copy. */
  body?: string;
  /** Pre-rendered "covers" badge label; defaults to §9.4's own continue copy. */
  coversLabel?: string;
}

export function OutOfCoinsSheet({
  price,
  onCancel,
  body,
  coversLabel,
}: OutOfCoinsSheetProps): React.JSX.Element {
  // The SMALLEST bundle that covers the price, per the PRD's own wording —
  // not always the first/cheapest bundle shown (§13 defaults: `coins_s`
  // covers only `continue_price_1`; `continue_price_2`/`_3` need `coins_m`).
  const coveringSku = (BUNDLES.find((b) => b.coins >= price) ?? BUNDLE_MID).sku;

  return (
    <ModalSheet sheetAlign="center">
      <Text style={styles.title}>{t('oob.title')}</Text>
      <Text style={styles.body}>{body ?? t('oob.body', { price: formatScore(price) })}</Text>

      <View style={styles.bundles}>
        {BUNDLES.map((b) => (
          <View
            key={b.sku}
            style={[styles.bundle, b.sku === coveringSku ? styles.bundleCovers : null]}
          >
            {b.sku === coveringSku ? (
              <Text style={styles.coversTag}>{coversLabel ?? t('oob.covers')}</Text>
            ) : null}
            <Text style={styles.bundleCoins}>{`${formatScore(b.coins)} 🪙`}</Text>
            <Text style={styles.bundlePrice}>{`₹${b.priceInr}`}</Text>
          </View>
        ))}
      </View>

      <GhostButton label={t('oob.cancel')} onPress={onCancel} variant="onLight" />
    </ModalSheet>
  );
}

const INK_70 = withAlpha(colors.night, 0.7);

const styles = StyleSheet.create({
  title: {
    color: colors.night,
    fontSize: fontSize.lg,
    fontWeight: '800',
    textAlign: 'center',
  },
  body: {
    color: INK_70,
    fontSize: fontSize.sm,
    fontWeight: '700',
    textAlign: 'center',
  },
  bundles: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignSelf: 'stretch',
  },
  bundle: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.card - 2,
    borderWidth: 2,
    borderColor: withAlpha(colors.night, 0.12),
  },
  bundleCovers: {
    borderColor: colors.goldDeep,
    backgroundColor: withAlpha(colors.gold, 0.18),
  },
  coversTag: {
    color: colors.goldDeep,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  bundleCoins: { color: colors.night, fontSize: fontSize.md, fontWeight: '800' },
  bundlePrice: { color: INK_70, fontSize: fontSize.sm, fontWeight: '700' },
});
