/**
 * §12.8 acceptance, clause by clause. Per §0 rule 6a each clause gets its own
 * assertions — none of these leans on a neighbour's test.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectTextContrast } from '../contrast';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { RetryToast, TOAST_VISIBLE_MS } from '../../src/components/RetryToast';
import { RestartScreen } from '../../src/screens/RestartScreen';
import { colors } from '../../src/components/tokens';
import { firebaseMock, resetFirebaseMock } from '../mocks/react-native-firebase';

function render(el: React.ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(el);
  });
  return r;
}

function Boom(): React.JSX.Element {
  throw new Error('the butler dropped the tray');
}

function texts(r: ReactTestRenderer): string[] {
  return r.root.findAllByType('RNText' as never).map((n) => n.children.join(''));
}

beforeEach(() => {
  resetFirebaseMock();
  firebaseMock.configured = true;
});

describe('§12.8 error boundary', () => {
  // React logs the caught error to console.error; silence it so a PASSING
  // suite does not print a scary stack that looks like a failure.
  const quiet = (): (() => void) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    return () => spy.mockRestore();
  };

  it('catches a thrown render error and shows the restart screen, not a white screen', () => {
    const restore = quiet();
    const r = render(
      <ErrorBoundary fallback={(reset) => <RestartScreen onRestart={reset} />}>
        <Boom />
      </ErrorBoundary>,
    );
    // Not a white screen: real copy is on the tree.
    expect(texts(r)).toContain('The butler dropped something');
    restore();
  });

  it('reports the error to Crashlytics with its component stack', () => {
    const restore = quiet();
    render(
      <ErrorBoundary fallback={(reset) => <RestartScreen onRestart={reset} />}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(firebaseMock.crashes).toHaveLength(1);
    expect(firebaseMock.crashes[0]?.message).toBe('the butler dropped the tray');
    // The component stack is what makes a report actionable.
    expect(firebaseMock.crashes[0]?.context).toContain('Boom');
    restore();
  });

  it('does not report — or intercept — when nothing throws', () => {
    // A DISTINCT child, not another RestartScreen: with the same component on
    // both sides this assertion could not tell pass-through from interception.
    const r = render(
      <ErrorBoundary fallback={() => <RestartScreen onRestart={() => {}} />}>
        <RetryToast message="the child rendered" onDismiss={() => {}} />
      </ErrorBoundary>,
    );
    expect(firebaseMock.crashes).toHaveLength(0);
    expect(texts(r)).toContain('the child rendered');
    expect(texts(r)).not.toContain('The butler dropped something');
  });

  it('stays silent when Firebase is absent (§12.4) rather than throwing from the reporter', () => {
    const restore = quiet();
    firebaseMock.configured = false;
    expect(() =>
      render(
        <ErrorBoundary fallback={(reset) => <RestartScreen onRestart={reset} />}>
          <Boom />
        </ErrorBoundary>,
      ),
    ).not.toThrow();
    expect(firebaseMock.crashes).toHaveLength(0);
    restore();
  });

  it('the restart screen offers EXACTLY ONE action (§12.9: never a dead end)', () => {
    const onRestart = vi.fn();
    const r = render(<RestartScreen onRestart={onRestart} />);
    const pressables = r.root.findAllByType('RNPressable' as never);
    expect(pressables).toHaveLength(1);
    act(() => {
      (pressables[0]!.props as { onPress: () => void }).onPress();
    });
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('restart screen text clears the §15 contrast floor', () => {
    const r = render(<RestartScreen onRestart={() => {}} />);
    const measured = collectTextContrast(r.root, colors.night);
    expect(measured.length).toBeGreaterThanOrEqual(3);
    expect(measured.filter((m) => m.ratio < 4.5)).toEqual([]);
  });
});

describe('§12.8 retry toast — never a dead-end modal', () => {
  it('renders the message and a working retry', () => {
    const onRetry = vi.fn();
    const r = render(
      <RetryToast message="That didn't go through" onDismiss={() => {}} onRetry={onRetry} />,
    );
    expect(texts(r)).toContain("That didn't go through");
    const pressables = r.root.findAllByType('RNPressable' as never);
    expect(pressables).toHaveLength(1);
    act(() => {
      (pressables[0]!.props as { onPress: () => void }).onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('dismisses ITSELF — the property that makes it a toast and not a modal', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<RetryToast message="nope" onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a failure with no sensible retry still speaks, rather than being swallowed', () => {
    const r = render(<RetryToast message="offline" onDismiss={() => {}} />);
    expect(texts(r)).toContain('offline');
    expect(r.root.findAllByType('RNPressable' as never)).toHaveLength(0);
  });
});
