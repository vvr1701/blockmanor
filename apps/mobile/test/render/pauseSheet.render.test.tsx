/**
 * `PauseSheet` — PRD §12.2, rendered, plus the `GameplayScreen` wiring that
 * reaches it. Covers all four §12.2 clauses (resume / restart / settings
 * shortcut / quit-to-map with the >50% confirm), the §12.9 "no dead end"
 * escape from every state, the Android `BackHandler` contract (registered,
 * consumed, RELEASED on unmount), §4.5 (pausing stops the one indefinite
 * animation on the screen), the a11y payloads, and WCAG contrast read off
 * the RENDERED tree.
 *
 * Nothing here re-types a colour: `collectTextContrast` walks the real tree
 * and composites what the components actually set (the §7.6 audit's MAJOR-3).
 */
import { computeOcc, createGame, type EngineTuning, type GameState } from '@blockmanor/engine';
import React from 'react';
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectTextContrast, flattenStyle } from '../contrast';
import { deriveGoalBar, type GoalBarEntry } from '../../src/game/goalBar';
import { NEAR_DEATH_FILL_THRESHOLD } from '../../src/game/juice';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { PauseSheet } from '../../src/screens/PauseSheet';
import en from '../../src/i18n/en.json';
// Imported through the MOCK paths, not the packages: `tsc` doesn't apply
// vitest.config.ts's aliases, so the real modules' types don't carry these
// test-only helpers (same reason `levelMapScreen.render.test.tsx` does it).
import { BackHandler } from '../mocks/react-native';
import { mockAnimationCalls, resetMockAnimationCalls } from '../mocks/react-native-reanimated';

const TUNING: EngineTuning = {
  mercy_threshold: 0.55,
  mercy_small_prob: 0.65,
  score_clear_base: 10,
  combo_step: 0.25,
  perfect_clear_bonus: 300,
};

/** 12 crates; `prefill` deliberately light so no line is ever near clearing. */
function levelState(overrides: Partial<GameState> = {}): GameState {
  const state = createGame(
    {
      mode: 'level',
      tuning: TUNING,
      level: {
        id: 24,
        chapter: 1,
        seedSalt: 'pause-render-test',
        prefill: [{ r: 1, c: 1, type: 'crate' }],
        goals: [{ type: 'crate', count: 12 }],
        pieceWeightOverrides: {},
        mercy: true,
        stars: { s2: 1500, s3: 2600 },
        ivySpreadInterval: 3,
        ivyMaxTiles: 16,
      },
    },
    'pause-render-seed',
  );
  return { ...state, ...overrides };
}

function endlessState(): GameState {
  return createGame({ mode: 'endless', tuning: TUNING }, 'pause-endless-seed');
}

/** Goal-bar entries with `done` of `total` credited — same shape the screen
 * derives from a live `GameState`. */
function goals(done: number, total: number): GoalBarEntry[] {
  return [{ type: 'crate', remaining: total - done, total, icon: 'crossPlank' }];
}

const mounted: ReactTestRenderer[] = [];

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  mounted.push(renderer);
  return renderer;
}

function byLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const found = renderer.root.findAll((n) => n.props.accessibilityLabel === label);
  expect(found, `no node labelled "${label}"`).toHaveLength(1);
  return found[0]!;
}

function press(node: ReactTestInstance): void {
  act(() => {
    (node.props as { onPress: () => void }).onPress();
  });
}

/** A hardware back press, inside `act` so the state update it causes is
 * committed. Returns whether it was CONSUMED (`false` = real Android would
 * have exited the app). */
function backPress(): boolean {
  let consumed = false;
  act(() => {
    consumed = BackHandler.__press();
  });
  return consumed;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((n) => String(n.type) === 'RNText')
    .map((n) => n.children.map((c) => (typeof c === 'string' ? c : '')).join(''));
}

function sheetOf(renderer: ReactTestRenderer): ReactTestInstance | undefined {
  return renderer.root.findAll((n) => n.props.accessibilityViewIsModal === true)[0];
}

/** The opaque surface behind the sheet, read off the rendered tree — the
 * screen root's own `backgroundColor`, never a re-typed literal. */
function backdropOf(renderer: ReactTestRenderer): string {
  const root = renderer.root.findAll(
    (n) =>
      typeof n.type === 'string' && typeof flattenStyle(n.props.style).backgroundColor === 'string',
  )[0];
  return String(flattenStyle(root!.props.style).backgroundColor);
}

const noop = (): void => undefined;

/**
 * The §12.2 confirm layer is controlled by `GameplayScreen` (so its one
 * `BackHandler` can pop layers in order — audit nit 7). These describes drive
 * the sheet directly, so they hold the same one bit of state locally. The
 * rendered subject is still the real `PauseSheet`.
 */
function Sheet(
  props: Omit<React.ComponentProps<typeof PauseSheet>, 'confirming' | 'onConfirmingChange'>,
): React.JSX.Element {
  const [confirming, setConfirming] = React.useState(false);
  return <PauseSheet {...props} confirming={confirming} onConfirmingChange={setConfirming} />;
}

beforeEach(() => {
  resetMockAnimationCalls();
});

afterEach(() => {
  while (mounted.length > 0) {
    const renderer = mounted.pop()!;
    act(() => {
      renderer.unmount();
    });
  }
});

describe('PauseSheet — §12.2 clause by clause', () => {
  function sheet(over: Partial<React.ComponentProps<typeof PauseSheet>> = {}) {
    const props = {
      levelId: 24,
      goals: goals(0, 12),
      moves: 0,
      onResume: vi.fn(),
      onRestart: vi.fn(),
      onQuit: vi.fn(),
      ...over,
    };
    return { renderer: render(<Sheet {...props} />), props };
  }

  it('titles itself "Paused" and states level, goal progress and moves in one tabular line', () => {
    const { renderer } = sheet({ goals: goals(7, 12), moves: 18 });
    expect(texts(renderer)).toContain(en['pause.title']);
    const status = renderer.root
      .findAll((n) => String(n.type) === 'RNText')
      .find((n) => String(n.children[0]).startsWith('Level 24'))!;
    expect(String(status.children[0])).toBe('Level 24 · Crates 7/12 · Moves 18');
    // §15 / CLAUDE.md a11y: tabular numerals for scores and counts.
    expect(flattenStyle(status.props.style).fontVariant).toEqual(['tabular-nums']);
  });

  it('§12.9 empty state: a goal-less config drops the goal segments, and Resume is still the one action', () => {
    const { renderer, props } = sheet({ goals: [], moves: 3 });
    const status = renderer.root
      .findAll((n) => String(n.type) === 'RNText')
      .find((n) => String(n.children[0]).startsWith('Level 24'))!;
    expect(String(status.children[0])).toBe('Level 24 · Moves 3');
    expect(String(status.children[0])).not.toContain('0/0');
    press(byLabel(renderer, en['pause.resume']));
    expect(props.onResume).toHaveBeenCalledTimes(1);
  });

  it('a config with no level at all omits the level segment rather than printing "Level 0"', () => {
    const { renderer } = sheet({ levelId: undefined, goals: [], moves: 2 });
    expect(texts(renderer)).toContain('Moves 2');
    expect(texts(renderer).join('|')).not.toContain('Level 0');
  });

  it('RESUME calls back exactly once', () => {
    const { renderer, props } = sheet();
    press(byLabel(renderer, en['pause.resume']));
    expect(props.onResume).toHaveBeenCalledTimes(1);
    expect(props.onRestart).not.toHaveBeenCalled();
    expect(props.onQuit).not.toHaveBeenCalled();
  });

  it('RESTART calls back exactly once and mentions no life cost (free in S1 — §9.2 is Stage 2)', () => {
    const { renderer, props } = sheet();
    const row = renderer.root.findAll((n) =>
      String(n.props.accessibilityLabel ?? '').startsWith(en['pause.restart']),
    )[0]!;
    press(row);
    expect(props.onRestart).toHaveBeenCalledTimes(1);
    const all = texts(renderer).join(' ').toLowerCase();
    expect(all).not.toContain('life');
    expect(all).not.toContain('lives');
  });

  it('the SETTINGS shortcut renders as a disabled button with an honest reason, and cannot be pressed', () => {
    const { renderer } = sheet();
    const row = renderer.root.findAll((n) =>
      String(n.props.accessibilityLabel ?? '').startsWith(en['pause.settings']),
    )[0]!;
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityState).toEqual({ disabled: true });
    expect(row.props.onPress).toBeUndefined();
    expect(String(row.props.accessibilityLabel)).toContain(en['pause.settingsUnavailable']);
  });
});

describe('PauseSheet — §12.2 quit-to-map, the >50% confirm boundary', () => {
  function quitAt(done: number, total: number) {
    const onQuit = vi.fn();
    const renderer = render(
      <Sheet
        levelId={24}
        goals={goals(done, total)}
        moves={4}
        onResume={noop}
        onRestart={noop}
        onQuit={onQuit}
      />,
    );
    press(byLabel(renderer, en['pause.quit']));
    return { renderer, onQuit };
  }

  function isConfirming(renderer: ReactTestRenderer): boolean {
    return texts(renderer).includes(en['pause.confirm.title']);
  }

  it('0% — leaves immediately, no confirm', () => {
    const { renderer, onQuit } = quitAt(0, 12);
    expect(isConfirming(renderer)).toBe(false);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('just under 50% (5/12) — leaves immediately, no confirm', () => {
    const { renderer, onQuit } = quitAt(5, 12);
    expect(isConfirming(renderer)).toBe(false);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('EXACTLY 50% (6/12) — leaves immediately: §12.2 says ">50%", not ">=50%"', () => {
    const { renderer, onQuit } = quitAt(6, 12);
    expect(isConfirming(renderer)).toBe(false);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('just over 50% (7/12) — CONFIRMS, and does not leave yet', () => {
    const { renderer, onQuit } = quitAt(7, 12);
    expect(isConfirming(renderer)).toBe(true);
    expect(onQuit).not.toHaveBeenCalled();
  });

  it('100% — confirms', () => {
    const { renderer, onQuit } = quitAt(12, 12);
    expect(isConfirming(renderer)).toBe(true);
    expect(onQuit).not.toHaveBeenCalled();
  });

  it('the confirm is not a dead end: "Keep playing" returns to the pause sheet unchanged (§12.9)', () => {
    const { renderer, onQuit } = quitAt(7, 12);
    press(byLabel(renderer, en['pause.confirm.stay']));
    expect(isConfirming(renderer)).toBe(false);
    expect(texts(renderer)).toContain(en['pause.title']);
    expect(onQuit).not.toHaveBeenCalled();
    // …and quitting again still re-confirms rather than falling through.
    press(byLabel(renderer, en['pause.quit']));
    expect(isConfirming(renderer)).toBe(true);
  });

  it('"Leave anyway" quits, once', () => {
    const { renderer, onQuit } = quitAt(7, 12);
    press(byLabel(renderer, en['pause.confirm.leave']));
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});

describe('PauseSheet — a11y and contrast (§15, CLAUDE.md a11y rules)', () => {
  function full() {
    return render(
      <Sheet
        levelId={24}
        goals={goals(7, 12)}
        moves={18}
        onResume={noop}
        onRestart={noop}
        onQuit={noop}
      />,
    );
  }

  it('is a modal view WITHOUT `accessible` on the same node (that collapses it — §7.6 fix pass)', () => {
    const renderer = full();
    const modal = sheetOf(renderer)!;
    expect(modal).toBeDefined();
    expect(modal.props.accessible).toBeUndefined();
    // The controls are therefore still individually reachable.
    expect(
      renderer.root.findAll((n) => n.props.accessibilityRole === 'button').length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('every control announces its real payload, none is an empty or duplicate label', () => {
    const renderer = full();
    const labels = renderer.root
      .findAll((n) => n.props.accessibilityRole === 'button')
      .map((n) => String(n.props.accessibilityLabel));
    expect(labels).toContain(en['pause.resume']);
    expect(labels).toContain(en['pause.quit']);
    expect(labels).toContain(`${en['pause.restart']} · ${en['pause.restartHint']}`);
    expect(labels).toContain(`${en['pause.settings']} · ${en['pause.settingsUnavailable']}`);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l.trim().length).toBeGreaterThan(0);
  });

  it('every interactive element reaches the 44dp touch floor', () => {
    const renderer = full();
    // Host nodes only: the composite `GoldButton` element also carries an
    // `onPress` prop, but it is its rendered `RNPressable` that has the size.
    for (const node of renderer.root.findAll(
      (n) => typeof n.type === 'string' && typeof n.props.onPress === 'function',
    )) {
      const style = flattenStyle(node.props.style);
      const slop = typeof node.props.hitSlop === 'number' ? node.props.hitSlop : 0;
      const h = Number(style.minHeight ?? style.height ?? 0) + slop * 2;
      expect(h, `"${String(node.props.accessibilityLabel)}" is ${h}dp tall`).toBeGreaterThanOrEqual(
        44,
      );
    }
  });

  it('every text on the sheet clears the WCAG 4.5:1 normal-text floor', () => {
    const renderer = full();
    // The sheet is an overlay: the surface behind it is the gameplay night
    // background, which this component does not render. Composite from the
    // token the SCREEN uses, read off a real GameplayScreen render.
    const backdrop = backdropOf(render(<GameplayScreen initialState={levelState()} />));
    const measured = collectTextContrast(renderer.root, backdrop);
    expect(measured.length).toBeGreaterThan(5);
    for (const m of measured) {
      expect(
        m.ratio,
        `"${m.text}" ${m.color} on ${m.background} = ${m.ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the confirm state clears it too', () => {
    const renderer = full();
    press(byLabel(renderer, en['pause.quit']));
    const backdrop = backdropOf(render(<GameplayScreen initialState={levelState()} />));
    for (const m of collectTextContrast(renderer.root, backdrop)) {
      expect(
        m.ratio,
        `"${m.text}" ${m.color} on ${m.background} = ${m.ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('GameplayScreen — the §12.2 pause affordance', () => {
  const controls = () => ({ onRestart: vi.fn(), onQuit: vi.fn() });

  it('without `pause` there is NO announced control at all and no BackHandler (FTUE / dev board)', () => {
    const before = BackHandler.__count();
    const renderer = render(<GameplayScreen initialState={levelState()} />);
    expect(BackHandler.__count()).toBe(before);
    expect(sheetOf(renderer)).toBeUndefined();
    // §12.9 "invitations, never dead ends": TalkBack must not hear a
    // permanently-disabled "Pause the game" button on a screen §7.1 specs as
    // "no HUD, no menus" (`FtueScreen` shows this row from L5). The glyph is
    // decorative here, so it is hidden from the accessibility tree entirely.
    // Lengths, not `toEqual([])`: a failing deep-equal on `ReactTestInstance`
    // objects walks the whole fiber tree into the differ and OOMs the worker.
    expect(
      renderer.root.findAll((n) => n.props.accessibilityLabel === en['pause.openLabel']),
    ).toHaveLength(0);
    expect(renderer.root.findAll((n) => n.props.accessibilityRole === 'button')).toHaveLength(0);
    const glyph = renderer.root.findAll(
      (n) => typeof n.type === 'string' && n.props.accessibilityElementsHidden === true,
    )[0]!;
    expect(glyph).toBeDefined();
    expect(glyph.props.importantForAccessibility).toBe('no-hide-descendants');
    // …and it still occupies the SAME 38dp box, so the HUD row never reflows
    // between a pausable screen and an FTUE one.
    const withPause = render(<GameplayScreen initialState={levelState()} pause={controls()} />);
    const live = flattenStyle(byLabel(withPause, en['pause.openLabel']).props.style);
    const dead = flattenStyle(glyph.props.style);
    expect([dead.width, dead.height]).toEqual([live.width, live.height]);
  });

  it('with `pause`, tapping the HUD affordance opens the sheet; Resume closes it', () => {
    const renderer = render(<GameplayScreen initialState={levelState()} pause={controls()} />);
    expect(sheetOf(renderer)).toBeUndefined();
    press(byLabel(renderer, en['pause.openLabel']));
    expect(sheetOf(renderer)).toBeDefined();
    press(byLabel(renderer, en['pause.resume']));
    expect(sheetOf(renderer)).toBeUndefined();
  });

  it('the HUD affordance clears 44dp once its hitSlop is counted (the glyph itself is 38dp)', () => {
    const renderer = render(<GameplayScreen initialState={levelState()} pause={controls()} />);
    const pause = byLabel(renderer, en['pause.openLabel']);
    const style = flattenStyle(pause.props.style);
    const slop = Number(pause.props.hitSlop);
    expect(Number(style.width) + slop * 2).toBeGreaterThanOrEqual(44);
    expect(Number(style.height) + slop * 2).toBeGreaterThanOrEqual(44);
  });

  it('the sheet reads the LIVE goal bar and placement count off the engine state', () => {
    const state = levelState();
    const mid: GameState = { ...state, goals: [{ type: 'crate', remaining: 5 }], placements: 9 };
    const renderer = render(<GameplayScreen initialState={mid} pause={controls()} />);
    press(byLabel(renderer, en['pause.openLabel']));
    const sheet = renderer.root.findByType(PauseSheet);
    expect(sheet.props.goals).toEqual(deriveGoalBar(mid));
    expect(sheet.props.moves).toBe(9);
    expect(sheet.props.levelId).toBe(24);
  });

  it("quit hands the caller `state.placements` as §14's `moves`", () => {
    const c = controls();
    const state = levelState();
    const renderer = render(
      <GameplayScreen initialState={{ ...state, placements: 13 }} pause={c} />,
    );
    press(byLabel(renderer, en['pause.openLabel']));
    press(byLabel(renderer, en['pause.quit']));
    expect(c.onQuit).toHaveBeenCalledTimes(1);
    expect(c.onQuit).toHaveBeenCalledWith(13);
  });

  it('restart calls through and closes the sheet, so a caller that does not remount is not stranded', () => {
    const c = controls();
    const renderer = render(<GameplayScreen initialState={levelState()} pause={c} />);
    press(byLabel(renderer, en['pause.openLabel']));
    const row = renderer.root.findAll((n) =>
      String(n.props.accessibilityLabel ?? '').startsWith(en['pause.restart']),
    )[0]!;
    press(row);
    expect(c.onRestart).toHaveBeenCalledTimes(1);
    expect(sheetOf(renderer)).toBeUndefined();
  });

  it('pause is refused once the board is terminal — the §7.5 win/fail HOLD is not a pausable state', () => {
    const renderer = render(
      <GameplayScreen initialState={{ ...levelState(), status: 'won' }} pause={controls()} />,
    );
    const pause = byLabel(renderer, en['pause.openLabel']);
    expect(pause.props.disabled).toBe(true);
    // Android back is still CONSUMED (it must never kill the app), it just
    // opens nothing.
    expect(backPress()).toBe(true);
    expect(sheetOf(renderer)).toBeUndefined();
  });

  it('pausing DISABLES the drag recognizer — a release mid-drag cannot commit behind the scrim', () => {
    // Audit nit 8: the sheet renders ABOVE `DragLayer`, but a gesture that is
    // already active is unaffected by a view appearing over it — pressing
    // 3-button back with a second finger down would otherwise land a
    // placement behind the scrim and desync §14 `level_quit.moves`.
    const renderer = render(<GameplayScreen initialState={levelState()} pause={controls()} />);
    const enabled = (): boolean[] =>
      (
        renderer.root.findAllByType('GHDetector' as never) as unknown as {
          props: { gesture: { __enabled: boolean } };
        }[]
      ).map((d) => d.props.gesture.__enabled);
    expect(enabled().length).toBeGreaterThan(0);
    expect(enabled()).not.toContain(false);
    press(byLabel(renderer, en['pause.openLabel']));
    expect(enabled()).not.toContain(true);
    press(byLabel(renderer, en['pause.resume']));
    expect(enabled()).not.toContain(false);
  });

  it('an endless-shaped config (no level, no goals) still pauses without a dead end', () => {
    const renderer = render(<GameplayScreen initialState={endlessState()} pause={controls()} />);
    press(byLabel(renderer, en['pause.openLabel']));
    const sheet = renderer.root.findByType(PauseSheet);
    expect(sheet.props.levelId).toBeUndefined();
    expect(sheet.props.goals).toEqual([]);
    press(byLabel(renderer, en['pause.resume']));
    expect(sheetOf(renderer)).toBeUndefined();
  });
});

describe('GameplayScreen — Android hardware back (§12.9, no dead ends)', () => {
  const controls = () => ({ onRestart: vi.fn(), onQuit: vi.fn() });

  it('opens pause, closes it on a second press, and CONSUMES both (never exits the app)', () => {
    const renderer = render(<GameplayScreen initialState={levelState()} pause={controls()} />);
    expect(backPress()).toBe(true);
    expect(sheetOf(renderer)).toBeDefined();
    expect(backPress()).toBe(true);
    expect(sheetOf(renderer)).toBeUndefined();
  });

  it('registers exactly one handler while mounted and RELEASES it on unmount (no leak)', () => {
    const before = BackHandler.__count();
    const renderer = render(<GameplayScreen initialState={levelState()} pause={controls()} />);
    expect(BackHandler.__count()).toBe(before + 1);
    // Toggling re-subscribes (the handler closes over `paused`) — still one.
    backPress();
    expect(BackHandler.__count()).toBe(before + 1);
    act(() => {
      renderer.unmount();
    });
    mounted.splice(mounted.indexOf(renderer), 1);
    expect(BackHandler.__count()).toBe(before);
    // The released handler is really gone: nothing consumes the next press.
    expect(backPress()).toBe(false);
  });

  it('pops ONE layer per press: confirm -> pause menu -> board, never the app', () => {
    const c = controls();
    const renderer = render(
      <GameplayScreen
        initialState={{ ...levelState(), goals: [{ type: 'crate', remaining: 1 }] }}
        pause={c}
      />,
    );
    press(byLabel(renderer, en['pause.openLabel']));
    press(byLabel(renderer, en['pause.quit']));
    expect(texts(renderer)).toContain(en['pause.confirm.title']);

    // Back from the confirm returns to the PAUSE MENU (the Android
    // convention: back pops the topmost layer), not out of the sheet.
    expect(backPress()).toBe(true);
    expect(sheetOf(renderer)).toBeDefined();
    expect(texts(renderer)).not.toContain(en['pause.confirm.title']);
    expect(texts(renderer)).toContain(en['pause.title']);

    // The next press pops the menu, and only then is the board back.
    expect(backPress()).toBe(true);
    expect(sheetOf(renderer)).toBeUndefined();
    expect(c.onQuit).not.toHaveBeenCalled();
  });

  it('closing the sheet drops the confirm layer, so the next open is the MENU', () => {
    // Reachable on any caller that does not unmount this screen after a quit
    // (`LevelSession` does; §12.2 does not require it). Without the reset the
    // next pause would open straight into "Leave this level?".
    const c = controls();
    const renderer = render(
      <GameplayScreen
        initialState={{ ...levelState(), goals: [{ type: 'crate', remaining: 1 }] }}
        pause={c}
      />,
    );
    press(byLabel(renderer, en['pause.openLabel']));
    press(byLabel(renderer, en['pause.quit']));
    press(byLabel(renderer, en['pause.confirm.leave']));
    expect(c.onQuit).toHaveBeenCalledTimes(1);
    press(byLabel(renderer, en['pause.openLabel']));
    expect(texts(renderer)).toContain(en['pause.title']);
    expect(texts(renderer)).not.toContain(en['pause.confirm.title']);
  });
});

describe('GameplayScreen — §4.5: pausing stops the running animation', () => {
  const controls = () => ({ onRestart: vi.fn(), onQuit: vi.fn() });

  /** A board past §7.4's near-death threshold, whose vignette is the only
   * INDEFINITE (`withRepeat(..., -1)`) animation this screen runs. */
  function nearDeathState(): GameState {
    const state = levelState();
    const filled = Math.ceil((NEAR_DEATH_FILL_THRESHOLD + 0.05) * state.board.kinds.length);
    const kinds = state.board.kinds.slice();
    for (let i = 0; i < filled; i += 1) kinds[i] = 'filled';
    // `fillRatio` reads the memoized `occ` mask, so the engine's own
    // `computeOcc` oracle rebuilds it — never a hand-maintained invariant.
    const board = { ...state.board, kinds, colors: state.board.colors.slice() };
    return { ...state, board: { ...board, occ: computeOcc(board) } };
  }

  function infiniteRepeats(): number {
    return mockAnimationCalls.filter((c) => c.fn === 'withRepeat' && c.config !== null).length;
  }

  it('the near-death loop IS running on a near-death board (the guard is not vacuous)', () => {
    resetMockAnimationCalls();
    render(<GameplayScreen initialState={nearDeathState()} pause={controls()} />);
    expect(infiniteRepeats()).toBeGreaterThan(0);
  });

  it('pausing cancels it, and resuming starts it again', () => {
    const renderer = render(<GameplayScreen initialState={nearDeathState()} pause={controls()} />);

    resetMockAnimationCalls();
    press(byLabel(renderer, en['pause.openLabel']));
    expect(infiniteRepeats()).toBe(0);
    // …and the vignette was told to fade OUT, not merely left alone.
    expect(mockAnimationCalls.some((c) => c.fn === 'withTiming' && c.toValue === 0)).toBe(true);

    resetMockAnimationCalls();
    press(byLabel(renderer, en['pause.resume']));
    expect(infiniteRepeats()).toBeGreaterThan(0);
  });

  it('a board that is NOT near death never starts the loop, paused or not', () => {
    resetMockAnimationCalls();
    const renderer = render(<GameplayScreen initialState={levelState()} pause={controls()} />);
    expect(infiniteRepeats()).toBe(0);
    press(byLabel(renderer, en['pause.openLabel']));
    expect(infiniteRepeats()).toBe(0);
  });
});
