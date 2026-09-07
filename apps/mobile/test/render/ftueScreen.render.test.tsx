/**
 * `FtueScreen` render-tree tests — PRD §7.1 (v1.11). Drives the exact same
 * scripted move log as `packages/content/balance/ftue.bal.ts` through
 * `DragLayer.onPlace` (the same technique `gameplayScreen.render.test.tsx`
 * already uses for §7.3 wiring), so this test proves the FTUE STEP MACHINE
 * (advance on win/completed, HUD visibility, callout dismissal, the
 * name/avatar hand-off, the returning-user-flipping `ftueComplete` flag, and
 * the `ftue_step`/`ftue_complete` analytics sequence) — never re-proving the
 * engine's own winnability/teaching-beat rules, which the content-side
 * replay gate already owns.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_POST_FTUE_LEVEL } from '@blockmanor/content';
import { DragLayer } from '../../src/game/DragLayer';
import { FtueCallout, FtueHandCursor } from '../../src/screens/FtueScreen/FtueOverlay';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { useMetaStore } from '../../src/state/useMetaStore';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

import { track } from '../../src/services/analytics';
import { FtueScreen } from '../../src/screens/FtueScreen';

const trackMock = vi.mocked(track);

/** Mirrors `packages/content/balance/ftue.bal.ts`'s designed move scripts —
 * same levels, same intended playthrough, so a level authoring change that
 * breaks one breaks both (by construction, not by luck). */
const MOVES: Record<number, { pieceIndex: number; r: number; c: number }[]> = {
  1: [
    { pieceIndex: 0, r: 7, c: 7 },
    { pieceIndex: 1, r: 0, c: 0 },
    { pieceIndex: 2, r: 0, c: 3 },
  ],
  2: [
    { pieceIndex: 0, r: 7, c: 0 },
    { pieceIndex: 1, r: 0, c: 2 },
    { pieceIndex: 2, r: 0, c: 5 },
  ],
  3: [
    { pieceIndex: 0, r: 5, c: 0 },
    { pieceIndex: 1, r: 6, c: 0 },
    { pieceIndex: 2, r: 0, c: 0 },
  ],
  4: [{ pieceIndex: 0, r: 7, c: 7 }],
  5: [
    { pieceIndex: 0, r: 0, c: 0 },
    { pieceIndex: 1, r: 6, c: 7 },
  ],
};

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

/** Drives every scripted move for the level currently mounted, one at a
 * time — a real placement re-renders (§4.5 budget), so `DragLayer` must be
 * re-found after each `act`. */
function playLevelId(renderer: ReactTestRenderer, id: number): void {
  for (const move of MOVES[id] as { pieceIndex: number; r: number; c: number }[]) {
    const dragLayer = renderer.root.findByType(DragLayer);
    act(() => {
      (dragLayer.props as { onPlace: (i: number, r: number, c: number) => void }).onPlace(
        move.pieceIndex,
        move.r,
        move.c,
      );
    });
  }
}

beforeEach(() => {
  trackMock.mockClear();
  useMetaStore.setState({
    currentLevel: 1,
    ftueComplete: false,
    playerName: null,
    avatarId: null,
  });
});

describe('FtueScreen (PRD §7.1 v1.11)', () => {
  it('mounts on L1 with a callout + hand cursor, HUD hidden, and fires ftue_step l1', () => {
    const renderer = render(<FtueScreen />);
    expect(renderer.root.findAllByType(FtueCallout).length).toBe(1);
    expect(renderer.root.findAllByType(FtueHandCursor).length).toBe(1);
    expect(renderer.root.findByType(GameplayScreen).props.hudVisible).toBe(false);
    expect(trackMock).toHaveBeenCalledWith('ftue_step', { step: 'l1' });
  });

  it('the L1 callout/hand-cursor disappear after the first placement ("dismissed by playing")', () => {
    const renderer = render(<FtueScreen />);
    const dragLayer = renderer.root.findByType(DragLayer);
    act(() => {
      (dragLayer.props as { onPlace: (i: number, r: number, c: number) => void }).onPlace(1, 0, 0);
    });
    expect(renderer.root.findAllByType(FtueCallout).length).toBe(0);
    expect(renderer.root.findAllByType(FtueHandCursor).length).toBe(0);
  });

  it('walks L1 -> L2 -> L3 -> L4 -> L5 -> name/avatar -> ftueComplete, firing every ftue_step + ftue_complete', () => {
    const renderer = render(<FtueScreen />);

    for (const id of [1, 2, 3, 4, 5]) {
      playLevelId(renderer, id);
    }

    const guestButton = renderer.root.findAll(
      (node) => node.props.accessibilityLabel === 'or continue as Guest',
    )[0];
    expect(guestButton).toBeDefined();
    act(() => {
      (guestButton!.props as { onPress: () => void }).onPress();
    });

    expect(useMetaStore.getState().ftueComplete).toBe(true);
    expect(useMetaStore.getState().playerName).toBeNull();
    // §7.5 re-audit item 7 — the L5->post-FTUE handoff this migration exists
    // to patch: `currentLevel` must land on `FIRST_POST_FTUE_LEVEL`, not
    // stay wherever L5's own play left it.
    expect(useMetaStore.getState().currentLevel).toBe(FIRST_POST_FTUE_LEVEL);

    const steps = trackMock.mock.calls
      .filter(([name]) => name === 'ftue_step')
      .map(([, p]) => (p as { step: string }).step);
    expect(steps).toEqual(['l1', 'l2', 'l3', 'l4', 'l5', 'name_avatar']);
    expect(trackMock).toHaveBeenCalledWith('ftue_complete', { guest: true });
  });

  it('naming a player at the name/avatar step fires ftue_complete with guest:false and persists the name', () => {
    const renderer = render(<FtueScreen />);
    for (const id of [1, 2, 3, 4, 5]) playLevelId(renderer, id);

    const input = renderer.root.findByType('RNTextInput' as never);
    act(() => {
      (input.props as { onChangeText: (v: string) => void }).onChangeText('Eleanor');
    });
    const claimButton = renderer.root.findAll(
      (node) => node.props.accessibilityLabel === 'Claim the manor',
    )[0];
    act(() => {
      (claimButton!.props as { onPress: () => void }).onPress();
    });

    expect(useMetaStore.getState().ftueComplete).toBe(true);
    expect(useMetaStore.getState().playerName).toBe('Eleanor');
    expect(trackMock).toHaveBeenCalledWith('ftue_complete', { guest: false });
  });

  it('L5 mounts GameplayScreen with the HUD visible (fades in), unlike L1-L4', () => {
    const renderer = render(<FtueScreen />);
    for (const id of [1, 2, 3, 4]) playLevelId(renderer, id);

    const gameplay = renderer.root.findByType(GameplayScreen);
    expect(gameplay.props.hudVisible).toBe(true);
    expect(gameplay.props.hudFadeIn).toBe(true);
  });
});
