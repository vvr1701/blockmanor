/**
 * `FtueScreen` — PRD §7.1 / §16.1. Cold-opens straight into the L1-L5
 * scripted teaching boards (§0 v1.11, `packages/content` `FTUE_LEVELS`), then
 * the name/avatar step, then hands off to the Home reveal.
 *
 * Step machine only — every rule (winnability, teaching beats) is the
 * engine's; this screen just watches `GameEvent[]`/`GameState` off
 * `GameplayScreen.onEvent` to know when to advance, never re-deriving them
 * (same boundary `JuiceLayer` already keeps for §7.4).
 */

import { createGame, type EngineTuning, type GameEvent, type GameState } from '@blockmanor/engine';
import { FTUE_LEVELS, parseLevel, type LevelJson } from '@blockmanor/content';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { FtueStep } from '@blockmanor/shared';
import { GameplayScreen } from '../GameplayScreen';
import { track } from '../../services/analytics';
import { useConfigStore } from '../../state/useConfigStore';
import { useMetaStore } from '../../state/useMetaStore';
import { t } from '../../i18n';
import { FtueCallout, FtueHandCursor } from './FtueOverlay';
import { FtueNameAvatarStep } from './FtueNameAvatarStep';

/** §7.1.2 order: L1 row, L2 columns, L3 combo, L4 crate goal, L5 free play. */
const LEVEL_STEPS: readonly FtueStep[] = ['l1', 'l2', 'l3', 'l4', 'l5'];

const CALLOUT_COPY: Partial<Record<FtueStep, { title: string; subtitle: string }>> = {
  l1: { title: t('ftue.l1.title'), subtitle: t('ftue.l1.subtitle') },
  l2: { title: t('ftue.l2.title'), subtitle: t('ftue.l2.subtitle') },
  l3: { title: t('ftue.l3.title'), subtitle: t('ftue.l3.subtitle') },
  l4: { title: t('ftue.l4.title'), subtitle: t('ftue.l4.subtitle') },
};

function useEngineTuning(): EngineTuning {
  const mercy_threshold = useConfigStore((s) => s.value('mercy_threshold'));
  const mercy_small_prob = useConfigStore((s) => s.value('mercy_small_prob'));
  const score_clear_base = useConfigStore((s) => s.value('score_clear_base'));
  const combo_step = useConfigStore((s) => s.value('combo_step'));
  const perfect_clear_bonus = useConfigStore((s) => s.value('perfect_clear_bonus'));
  return useMemo(
    () => ({
      mercy_threshold,
      mercy_small_prob,
      score_clear_base,
      combo_step,
      perfect_clear_bonus,
    }),
    [mercy_threshold, mercy_small_prob, score_clear_base, combo_step, perfect_clear_bonus],
  );
}

function buildFtueGameState(json: LevelJson, tuning: EngineTuning): GameState {
  return createGame(
    {
      mode: 'level',
      tuning,
      level: parseLevel(json),
      ...(json.pieceSequence ? { pieceSequence: json.pieceSequence } : {}),
    },
    `ftue-${json.id}`,
  );
}

export function FtueScreen(): React.JSX.Element {
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<'level' | 'nameAvatar'>('level');
  const [hasPlaced, setHasPlaced] = useState(false);
  const tuning = useEngineTuning();
  const setFtueComplete = useMetaStore((s) => s.setFtueComplete);
  const setProfile = useMetaStore((s) => s.setProfile);

  const step = LEVEL_STEPS[stepIndex] as FtueStep;
  const json = FTUE_LEVELS[stepIndex] as LevelJson;
  const initialState = useMemo(() => buildFtueGameState(json, tuning), [json, tuning]);

  useEffect(() => {
    if (phase === 'level') track('ftue_step', { step });
  }, [phase, step]);

  const handleEvent = useCallback(
    (events: readonly GameEvent[], state: GameState) => {
      if (events.length > 0) setHasPlaced(true);
      if (state.status === 'won' || state.status === 'completed') {
        if (stepIndex + 1 < LEVEL_STEPS.length) {
          setStepIndex((i) => i + 1);
          setHasPlaced(false);
        } else {
          track('ftue_step', { step: 'name_avatar' });
          setPhase('nameAvatar');
        }
      }
    },
    [stepIndex],
  );

  const handleNameAvatarDone = useCallback(
    (name: string | null, avatarId: number | null, guest: boolean) => {
      setProfile(name, avatarId);
      setFtueComplete(true);
      track('ftue_complete', { guest });
    },
    [setProfile, setFtueComplete],
  );

  if (phase === 'nameAvatar') {
    return <FtueNameAvatarStep onDone={handleNameAvatarDone} />;
  }

  const callout = !hasPlaced ? CALLOUT_COPY[step] : undefined;

  return (
    <View style={styles.fill}>
      <GameplayScreen
        key={step}
        initialState={initialState}
        hudVisible={step === 'l5'}
        hudFadeIn={step === 'l5'}
        onEvent={handleEvent}
      />
      {callout ? (
        <FtueCallout title={callout.title} subtitle={callout.subtitle} dim={step !== 'l1'} />
      ) : null}
      {step === 'l1' && !hasPlaced ? <FtueHandCursor /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
