/**
 * `EndlessScreen` — PRD §7.6. Covers the engine-config contract ("identical
 * engine config `mode:\"endless\"`", no goals, mercy RNG on, §13 tuning read
 * from Remote Config), the `endless_end{score,best}` analytics wiring (§14),
 * the personal-best update, the mid-run exit (§12.9 "no dead ends"), and the
 * mockup compositions (panel 10.2 in-run HUD, 10.3a/10.3b game-over sheet).
 *
 * Drives `GameplayScreen.onEvent` directly with a synthetic terminal
 * `GameState` — the same "call the prop function this screen itself passed
 * down" technique `ftueScreen.render.test.tsx` uses for `DragLayer.onPlace` —
 * rather than exhausting a real board (game-over timing under mercy RNG is
 * not something a unit test should depend on).
 */
import type { GameEvent, GameState } from '@blockmanor/engine';
import { REMOTE_CONFIG_DEFAULTS, type RemoteConfigSnapshot } from '@blockmanor/shared';
import React from 'react';
import { BackHandler } from 'react-native';
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

import { colors } from '../../src/components/tokens';
import { EndlessHud } from '../../src/screens/EndlessScreen/EndlessHud';
import { EndlessResultSheet } from '../../src/screens/EndlessScreen/EndlessResultSheet';
import { EndlessScreen } from '../../src/screens/EndlessScreen';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { track } from '../../src/services/analytics';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useMetaStore } from '../../src/state/useMetaStore';
import { collectTextContrast, flattenStyle } from '../contrast';

const trackMock = vi.mocked(track);

/** The mock's test-only hardware-back trigger (see test/mocks/react-native). */
const MockBackHandler = BackHandler as unknown as {
  __press(): boolean;
  __count(): number;
};

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function texts(node: ReactTestInstance): string[] {
  return node.findAllByType('RNText' as never).map((n) => n.children.join(''));
}

function byLabel(node: ReactTestInstance, label: string): ReactTestInstance | undefined {
  return node.findAll((n) => n.props.accessibilityLabel === label)[0];
}

function press(node: ReactTestInstance): void {
  act(() => {
    (node.props as { onPress: () => void }).onPress();
  });
}

/** Synthesizes a terminal (`status: 'lost'`) `GameState` off a real mounted
 * one, only touching the fields `EndlessScreen.handleEvent` reads. */
function endedState(base: GameState, score: number): GameState {
  return { ...base, status: 'lost', score };
}

type OnEvent = (e: readonly GameEvent[], s: GameState) => void;
type HeaderProp = (s: GameState) => React.ReactElement;

/** Mounts the screen and hands back the pieces every test needs. */
function mount(onExit = vi.fn()): {
  renderer: ReactTestRenderer;
  base: GameState;
  end: (score: number) => void;
  header: () => HeaderProp;
  onExit: ReturnType<typeof vi.fn>;
} {
  const renderer = render(<EndlessScreen onExit={onExit} />);
  const base = renderer.root.findByType(GameplayScreen).props.initialState as GameState;
  return {
    renderer,
    base,
    onExit,
    header: () => renderer.root.findByType(GameplayScreen).props.header as HeaderProp,
    end: (score: number) =>
      act(() => {
        (renderer.root.findByType(GameplayScreen).props as { onEvent: OnEvent }).onEvent(
          [],
          endedState(base, score),
        );
      }),
  };
}

beforeEach(() => {
  trackMock.mockClear();
  // In `act`: renderers from earlier tests are still mounted and subscribed
  // to these stores, so resetting them IS a React update.
  act(() => {
    useMetaStore.setState({ endlessBest: 0 });
    useConfigStore.setState({ snapshot: { ...REMOTE_CONFIG_DEFAULTS }, fetchedAt: null });
  });
});

describe('EndlessScreen (PRD §7.6)', () => {
  it('builds an engine config with mode "endless", no `level` (=> no goals), and mercy left on', () => {
    const { base } = mount();
    expect(base.config.mode).toBe('endless');
    expect(base.config.level).toBeUndefined();
    expect(base.config.pieceSequence).toBeUndefined();
    // §7.2: the goal bar is driven off `state.goals`, empty exactly when
    // `config.level` is absent (§6's `createGame`) — "no goals" end to end.
    expect(base.goals).toEqual([]);
  });

  it('§13: engine tuning tracks Remote Config, it is not five inlined defaults', () => {
    // Every value differs from `REMOTE_CONFIG_DEFAULTS`, so a call site that
    // hardcoded the defaults (instead of reading `useConfigStore` through
    // `useEngineTuning`) cannot pass. Closes the same gap on `FtueScreen`,
    // which builds its config through that very same hook.
    const remote = {
      mercy_threshold: 0.91,
      mercy_small_prob: 0.19,
      score_clear_base: 77,
      combo_step: 0.42,
      perfect_clear_bonus: 555,
    };
    act(() => {
      // Cast because `RemoteConfigSnapshot` is derived from an `as const`
      // defaults object, so every value's type is the DEFAULT LITERAL — a
      // fetched value can never be assigned to it. That is a §13/shared
      // typing bug, not a §7.6 one; flagged, deliberately not fixed here.
      useConfigStore
        .getState()
        .applySnapshot(remote as unknown as Partial<RemoteConfigSnapshot>, 1_700_000_000_000);
    });
    const { base } = mount();
    expect(base.config.tuning).toEqual(remote);
  });

  it('fires `endless_end{score,best}` exactly once when the run ends, and raises `endlessBest`', () => {
    const { end } = mount();
    end(1500);

    expect(trackMock).toHaveBeenCalledWith('endless_end', { score: 1500, best: 1500 });
    expect(useMetaStore.getState().endlessBest).toBe(1500);
    expect(trackMock.mock.calls.filter(([name]) => name === 'endless_end').length).toBe(1);
  });

  it('a SECOND terminal notification for the same run is ignored (the once-per-run guard)', () => {
    const { renderer, base } = mount();
    const onEvent = (renderer.root.findByType(GameplayScreen).props as { onEvent: OnEvent })
      .onEvent;
    // Two REAL invocations — asserting "exactly once" after a single call (as
    // this test used to) is satisfied with no guard at all. Deleting the
    // `endedRef` guard has to fail here.
    act(() => {
      onEvent([], endedState(base, 1500));
      onEvent([], endedState(base, 9999));
    });

    expect(trackMock.mock.calls.filter(([name]) => name === 'endless_end').length).toBe(1);
    expect(trackMock).toHaveBeenCalledWith('endless_end', { score: 1500, best: 1500 });
    expect(useMetaStore.getState().endlessBest).toBe(1500);
    // The sheet must still describe the run that actually ended.
    expect(texts(renderer.root.findByType(EndlessResultSheet))).toContain('1,500');
  });

  it('a run that scores below the existing best fires `endless_end` with the OLD best, and does not lower it', () => {
    useMetaStore.setState({ endlessBest: 5000 });
    const { end } = mount();
    end(900);

    expect(trackMock).toHaveBeenCalledWith('endless_end', { score: 900, best: 5000 });
    expect(useMetaStore.getState().endlessBest).toBe(5000);
  });

  it('"Play again" starts a fresh run (new GameplayScreen instance) and clears the result sheet', () => {
    const { renderer, end } = mount();
    end(300);

    const playAgain = byLabel(renderer.root, 'Play again');
    expect(playAgain).toBeDefined();
    press(playAgain!);

    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(renderer.root.findAllByType(EndlessResultSheet).length).toBe(0);
  });

  it('"Home" on the result sheet fires `onExit`', () => {
    const { renderer, end, onExit } = mount();
    end(300);
    press(byLabel(renderer.root, 'Home')!);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('EndlessScreen exits (PRD §12.9 "invitations, never dead ends")', () => {
  it('a close affordance is on screen DURING the run, not only after game over', () => {
    const { renderer, onExit } = mount();
    expect(renderer.root.findAllByType(EndlessResultSheet).length).toBe(0);
    const exit = byLabel(renderer.root, 'Exit to Home');
    expect(exit).toBeDefined();
    press(exit!);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('the in-run exit is a >=44dp touch target with a button role (§15 a11y)', () => {
    const { renderer } = mount();
    const exit = byLabel(renderer.root, 'Exit to Home')!;
    const style = flattenStyle(exit.props.style);
    expect(Number(style.minWidth)).toBeGreaterThanOrEqual(44);
    expect(Number(style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(exit.props.accessibilityRole).toBe('button');
  });

  it('Android hardware back returns to Home instead of killing the app', () => {
    const { onExit } = mount();
    let consumed = false;
    act(() => {
      consumed = MockBackHandler.__press();
    });
    // `false` here is real Android exiting the process mid-run.
    expect(consumed).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('the hardware-back subscription is released on unmount', () => {
    const before = MockBackHandler.__count();
    const { renderer } = mount();
    expect(MockBackHandler.__count()).toBe(before + 1);
    act(() => {
      renderer.unmount();
    });
    expect(MockBackHandler.__count()).toBe(before);
  });
});

describe('EndlessScreen in-run HUD (mockup panel 10.2)', () => {
  it('replaces the standard HUD row with the mode chip + centred score', () => {
    const { renderer } = mount();
    const hud = renderer.root.findByType(EndlessHud);
    expect(texts(hud)).toContain('ENDLESS');
    expect(texts(hud)).toContain('0');
    // §7.2's level title belongs to level play, not this mode.
    expect(texts(renderer.root).some((s) => s.startsWith('Level '))).toBe(false);
  });

  it('shows the best-line marker and the best chip once there is a best to chase, and marks it passed', () => {
    useMetaStore.setState({ endlessBest: 12480 });
    const { base, header } = mount();

    const behind = render(header()({ ...base, score: 9240 }));
    expect(texts(behind.root)).toContain('Best 12,480');
    expect(texts(behind.root)).toContain('Best line');

    const ahead = render(header()({ ...base, score: 13920 }));
    expect(texts(ahead.root)).toContain('Best 12,480 — passed!');
    expect(texts(ahead.root)).toContain('13,920');
  });

  it('§12.9: with no best yet there is nothing to chase, so no best line is drawn', () => {
    const { renderer } = mount();
    const hud = renderer.root.findByType(EndlessHud);
    expect(texts(hud)).not.toContain('Best line');
    expect(texts(hud).some((s) => s.startsWith('Best '))).toBe(false);
  });

  it('the HUD keeps showing the best the player was chasing, not the one their run just set', () => {
    useMetaStore.setState({ endlessBest: 12480 });
    const { base, end, header } = mount();
    end(13920);
    expect(texts(render(header()({ ...base, score: 13920 })).root)).toContain(
      'Best 12,480 — passed!',
    );
  });
});

describe('EndlessScreen result sheet (mockup panels 10.3a / 10.3b)', () => {
  it('10.3b regular: "Board full", the score, the standing best and how far short it fell', () => {
    useMetaStore.setState({ endlessBest: 12480 });
    const { renderer, end } = mount();
    end(9240);
    const sheet = texts(renderer.root.findByType(EndlessResultSheet));
    expect(sheet).toContain('Board full');
    expect(sheet).toContain('9,240');
    expect(sheet).toContain('Your best');
    expect(sheet).toContain('12,480');
    expect(sheet).toContain('3,240 short — one good combo away');
  });

  it("10.3b's progress bar measures the run against the standing best", () => {
    useMetaStore.setState({ endlessBest: 10000 });
    const { renderer, end } = mount();
    end(7400);
    const track = renderer.root
      .findByType(EndlessResultSheet)
      .findAll(
        (n) => typeof n.type === 'string' && flattenStyle(n.props.style).overflow === 'hidden',
      )[0]!;
    const fill = track.children.find((c) => typeof c !== 'string') as ReactTestInstance;
    expect(flattenStyle(fill.props.style).width).toBe('74%');
  });

  it('10.3a new best: the chip and the delta over the old best', () => {
    useMetaStore.setState({ endlessBest: 12480 });
    const { renderer, end } = mount();
    end(13920);
    const sheet = texts(renderer.root.findByType(EndlessResultSheet));
    expect(sheet).toContain('New personal best');
    expect(sheet).toContain('13,920');
    expect(sheet).toContain('+1,440 over your old best');
    expect(sheet).not.toContain('Board full');
  });

  it('§12.9 first ever run: a first record has no "old best" to beat', () => {
    const { renderer, end } = mount();
    end(3200);
    const sheet = texts(renderer.root.findByType(EndlessResultSheet));
    expect(sheet).toContain('New personal best');
    expect(sheet).toContain('Your first record — the bar is set');
    expect(sheet.some((s) => s.includes('over your old best'))).toBe(false);
  });

  it('the modal sheet does not collapse its own buttons out of the a11y tree', () => {
    const { renderer, end } = mount();
    end(300);
    const sheet = renderer.root.findByType(EndlessResultSheet);
    const overlay = sheet.findAll((n) => typeof n.type === 'string')[0]!;
    expect(overlay.props.accessibilityViewIsModal).toBe(true);
    // `accessible` here would flatten the sheet into a single a11y node and
    // make both actions unreachable to a screen reader.
    expect(overlay.props.accessible).not.toBe(true);
    expect(byLabel(sheet, 'Play again')).toBeDefined();
    expect(byLabel(sheet, 'Home')).toBeDefined();
  });

  it('every text on the cream sheet and the in-run HUD clears the 4.5:1 floor (§15)', () => {
    useMetaStore.setState({ endlessBest: 12480 });
    const { renderer, end } = mount();
    end(9240);
    const measured = [
      ...collectTextContrast(renderer.root.findByType(EndlessHud), colors.night),
      ...collectTextContrast(renderer.root.findByType(EndlessResultSheet), colors.night),
    ];
    expect(measured.length).toBeGreaterThanOrEqual(9);
    for (const m of measured) {
      expect(
        m.ratio,
        `"${m.text}" ${m.color} on ${m.background} = ${m.ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
