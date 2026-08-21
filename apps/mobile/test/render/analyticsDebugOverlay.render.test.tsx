/**
 * §14 requirement 5: the debug overlay is gated by `DEV_BOARD_ENABLED` (the
 * existing build-time flag), NOT `__DEV__` — and its 2Hz poll only runs
 * while expanded (audit MINOR finding), not while collapsed.
 */
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function textOf(node: { props: { children?: unknown } }): string {
  const c = node.props.children;
  return Array.isArray(c) ? c.join('') : String(c ?? '');
}

describe('AnalyticsDebugOverlay — DEV_BOARD_ENABLED false (production default)', () => {
  it('renders nothing', async () => {
    vi.resetModules();
    const { AnalyticsDebugOverlay } = await import('../../src/components/AnalyticsDebugOverlay');
    const renderer = render(<AnalyticsDebugOverlay />);
    expect(renderer.toJSON()).toBeNull();
  });
});

describe('AnalyticsDebugOverlay — DEV_BOARD_ENABLED true (preview APK opt-in)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../../src/game/devFlag', () => ({
      DEV_BOARD_ENABLED: true,
      FTUE_FORCE_REPLAY: false,
    }));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.doUnmock('../../src/game/devFlag');
    vi.useRealTimers();
  });

  it('renders a toggle, collapsed by default, expanding to show queue counters', async () => {
    const { AnalyticsDebugOverlay } = await import('../../src/components/AnalyticsDebugOverlay');

    const renderer = render(<AnalyticsDebugOverlay />);
    const toggle = renderer.root.findAll(
      (n) => n.props.accessibilityLabel === 'Toggle analytics debug overlay',
    )[0];
    expect(toggle).toBeDefined();
    expect(renderer.root.findAllByType(Text).some((n) => textOf(n).includes('queued'))).toBe(false);

    act(() => {
      (toggle!.props as { onPress: () => void }).onPress();
    });

    expect(renderer.root.findAllByType(Text).some((n) => textOf(n).includes('queued'))).toBe(true);
    expect(renderer.root.findAllByType(Text).some((n) => textOf(n).includes('dropped'))).toBe(true);
  });

  it('MAJOR-2: shows the tracked event name and params, not just the two counters', async () => {
    const { analyticsQueue } = await import('../../src/services/analyticsQueue');
    analyticsQueue.track('debug_test_event', { foo: 'bar' });

    const { AnalyticsDebugOverlay } = await import('../../src/components/AnalyticsDebugOverlay');
    const renderer = render(<AnalyticsDebugOverlay />);
    const toggle = renderer.root.findAll(
      (n) => n.props.accessibilityLabel === 'Toggle analytics debug overlay',
    )[0];

    act(() => {
      (toggle!.props as { onPress: () => void }).onPress();
    });

    const texts = renderer.root.findAllByType(Text).map(textOf);
    expect(texts.some((t) => t.includes('debug_test_event'))).toBe(true);
    expect(texts.some((t) => t.includes('foo') && t.includes('bar'))).toBe(true);
  });

  it('does not poll while collapsed — only starts a timer once expanded', async () => {
    const { AnalyticsDebugOverlay } = await import('../../src/components/AnalyticsDebugOverlay');
    const renderer = render(<AnalyticsDebugOverlay />);
    expect(vi.getTimerCount()).toBe(0);

    const toggle = renderer.root.findAll(
      (n) => n.props.accessibilityLabel === 'Toggle analytics debug overlay',
    )[0];
    act(() => {
      (toggle!.props as { onPress: () => void }).onPress();
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => {
      (toggle!.props as { onPress: () => void }).onPress(); // collapse again
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
