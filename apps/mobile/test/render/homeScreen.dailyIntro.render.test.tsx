/**
 * §7.1 step 4: "Daily Board soft-gate: after first Home visit, butler card
 * introduces 'Today's Board'." Shown once, gone for good after either answer.
 */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../src/i18n/en.json';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { DailyIntroCard } from '../../src/screens/HomeScreen/DailyIntroCard';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useMetaStore } from '../../src/state/useMetaStore';
import { REMOTE_CONFIG_DEFAULTS } from '@blockmanor/shared';

const mounted: ReactTestRenderer[] = [];

function mount(onPlayDaily = vi.fn()) {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <HomeScreen
        onPlay={vi.fn()}
        onOpenMap={vi.fn()}
        onPlayDaily={onPlayDaily}
        now={Date.UTC(2026, 7, 9)}
      />,
    );
  });
  mounted.push(renderer);
  return { renderer, onPlayDaily };
}

function press(renderer: ReactTestRenderer, label: string): void {
  const node = renderer.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function',
  )[0];
  expect(node, `no button "${label}"`).toBeDefined();
  act(() => {
    (node!.props.onPress as () => void)();
  });
}

beforeEach(() => {
  act(() => {
    useConfigStore.setState({ snapshot: { ...REMOTE_CONFIG_DEFAULTS }, fetchedAt: null });
    useMetaStore.setState({ dailyIntroSeen: false, ftueComplete: true, currentLevel: 6 });
  });
});

afterEach(() => {
  while (mounted.length > 0) {
    const r = mounted.pop()!;
    act(() => {
      r.unmount();
    });
  }
});

describe('§7.1 step 4 Daily Board butler card', () => {
  it('introduces "Today\'s Board" on Home until answered', () => {
    const { renderer } = mount();
    expect(renderer.root.findAllByType(DailyIntroCard)).toHaveLength(1);
  });

  it('"Show me" opens the Daily gate and never shows the card again', () => {
    const { renderer, onPlayDaily } = mount();
    press(renderer, en['home.dailyIntro.open']);
    expect(onPlayDaily).toHaveBeenCalledTimes(1);
    expect(useMetaStore.getState().dailyIntroSeen).toBe(true);
    expect(renderer.root.findAllByType(DailyIntroCard)).toHaveLength(0);
  });

  it('"Later" dismisses it for good without opening anything', () => {
    const { renderer, onPlayDaily } = mount();
    press(renderer, en['home.dailyIntro.dismiss']);
    expect(onPlayDaily).not.toHaveBeenCalled();
    expect(useMetaStore.getState().dailyIntroSeen).toBe(true);
    expect(mount().renderer.root.findAllByType(DailyIntroCard)).toHaveLength(0);
  });

  it('never shows while flag_daily_board is off', () => {
    act(() => {
      useConfigStore.setState({
        snapshot: {
          ...REMOTE_CONFIG_DEFAULTS,
          flag_daily_board: false,
        } as unknown as typeof REMOTE_CONFIG_DEFAULTS,
        fetchedAt: null,
      });
    });
    expect(mount().renderer.root.findAllByType(DailyIntroCard)).toHaveLength(0);
  });
});
