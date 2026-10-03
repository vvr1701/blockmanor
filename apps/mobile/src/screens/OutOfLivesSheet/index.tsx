/**
 * `OutOfLivesSheet` — PRD §9.2 / §16.1 (named §0 v1.47(a)). Shown by
 * `LevelSession` in place of `GameplayScreen` when `canStartLevel` refuses a
 * run: "timer, 'Refill 🪙' at `life_refill_price`" (rewarded-ad +1 is §10.1's
 * own scope, §0 v1.42(d) — not built here).
 *
 * Pure function of `now`/`nextLifeAt`, same discipline `DailyGateScreen`'s
 * `resetsIn` already keeps: the ticking `setInterval` lives in the caller
 * (`LevelSession`), not in here, so this component stays trivially testable
 * and has exactly one job — render what it's told.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { GhostButton } from '../../components/GhostButton';
import { GoldButton } from '../../components/GoldButton';
import { ModalSheet } from '../../components/ModalSheet';
import { colors, fontSize, withAlpha } from '../../components/tokens';
import { t } from '../../i18n';
import { formatScore } from '../../i18n/format';

/** "4:59" — countdown display only; the real unblock decision is the
 * caller's `canStartLevel`/`selectLives` read, never this formatting. */
function countdown(msLeft: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export interface OutOfLivesSheetProps {
  now: number;
  /** Epoch ms the next life arrives; null only transiently (store already
   * full) — this sheet should not be showing by the time that happens. */
  nextLifeAt: number | null;
  /** `life_refill_price` — never a literal. */
  price: number;
  /** True while a refill spend is in flight. */
  busy: boolean;
  onRefill: () => void;
  onCancel: () => void;
}

export function OutOfLivesSheet({
  now,
  nextLifeAt,
  price,
  busy,
  onRefill,
  onCancel,
}: OutOfLivesSheetProps): React.JSX.Element {
  return (
    <ModalSheet sheetAlign="center">
      <Text style={styles.title}>{t('lives.title')}</Text>
      {nextLifeAt !== null ? (
        <Text style={styles.body}>{t('lives.body', { time: countdown(nextLifeAt - now) })}</Text>
      ) : null}

      <GoldButton
        label={t('lives.cta', { price: formatScore(price) })}
        onPress={onRefill}
        size="md"
        disabled={busy}
        style={styles.full}
      />
      <GhostButton label={t('oob.cancel')} onPress={onCancel} variant="onLight" disabled={busy} />
    </ModalSheet>
  );
}

const INK_70 = withAlpha(colors.night, 0.7);

const styles = StyleSheet.create({
  full: { alignSelf: 'stretch' },
  title: {
    color: colors.night,
    fontSize: fontSize.lg,
    fontWeight: '800',
    textAlign: 'center',
  },
  body: {
    color: INK_70,
    fontSize: fontSize.md,
    fontWeight: '700',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
