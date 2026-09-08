/**
 * §12.3 acceptance, clause by clause:
 *   - name/avatar edits persist and are reflected on Home
 *   - every stat matches its SOURCE OF TRUTH rather than a re-derivation
 *   - an empty badge case renders §12.9's empty state with exactly one action
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { levelsCompleted, ProfileScreen } from '../../src/screens/ProfileScreen';
import { useMetaStore } from '../../src/state/useMetaStore';

function render(el: React.ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(el);
  });
  return r;
}

function texts(r: ReactTestRenderer): string[] {
  return r.root.findAllByType('RNText' as never).map((n) => n.children.join(''));
}

beforeEach(() => {
  useMetaStore.setState({
    playerName: null,
    avatarId: null,
    stars: {},
    ownedFrames: [],
    longestStreak: 0,
    totalLines: 0,
    bestDailyPercentile: 0,
    currentLevel: 1,
  });
});

describe('§12.3 profile', () => {
  it('levels-done counts the stars map, NOT currentLevel - 1', () => {
    // The re-derivation §12.3 rejects: this player is on level 20 but has
    // only ever won 3 levels (FTUE landing + replays). currentLevel - 1 would
    // say 19; the source of truth says 3.
    useMetaStore.setState({ currentLevel: 20, stars: { '1': 3, '2': 2, '7': 1 } });
    expect(levelsCompleted(useMetaStore.getState().stars)).toBe(3);
    expect(texts(render(<ProfileScreen onClose={() => {}} />))).toContain('3');
  });

  it('an avatar tap persists to the store', () => {
    const r = render(<ProfileScreen onClose={() => {}} />);
    const avatar = r.root.findAllByProps({ accessibilityLabel: 'Avatar 2' } as never)[0]!;
    act(() => {
      (avatar.props as { onPress: () => void }).onPress();
    });
    expect(useMetaStore.getState().avatarId).toBe(1);
  });

  it('a name edit persists on submit — and blank clears to guest, never ""', () => {
    const r = render(<ProfileScreen onClose={() => {}} />);
    const input = r.root.findByType('RNTextInput' as never);
    act(() => {
      (input.props as { onChangeText: (s: string) => void }).onChangeText('  Sanjeev  ');
    });
    act(() => {
      (input.props as { onSubmitEditing: () => void }).onSubmitEditing();
    });
    expect(useMetaStore.getState().playerName).toBe('Sanjeev');

    act(() => {
      (input.props as { onChangeText: (s: string) => void }).onChangeText('   ');
    });
    act(() => {
      (input.props as { onSubmitEditing: () => void }).onSubmitEditing();
    });
    // Whitespace is not a name: §7.1 allows a guest, and null is what guest is.
    expect(useMetaStore.getState().playerName).toBeNull();
  });

  it('longest streak and total lines read the store, not a derivation', () => {
    useMetaStore.setState({ longestStreak: 30, totalLines: 1234 });
    const shown = texts(render(<ProfileScreen onClose={() => {}} />));
    expect(shown).toContain('30');
    expect(shown).toContain('1,234');
  });

  it('longest streak is monotonic — a broken streak does not lower it', () => {
    const { recordStreak } = useMetaStore.getState();
    act(() => {
      recordStreak(12);
    });
    act(() => {
      recordStreak(0);
    });
    expect(useMetaStore.getState().longestStreak).toBe(12);
    expect(useMetaStore.getState().streak).toBe(0);
  });

  it('best daily percentile shows no fake 0% before §8.4 can supply one', () => {
    expect(texts(render(<ProfileScreen onClose={() => {}} />))).toContain('—');
    useMetaStore.setState({ bestDailyPercentile: 12 });
    expect(texts(render(<ProfileScreen onClose={() => {}} />))).toContain('Top 12%');
  });

  it('an empty badge case renders §12.9 empty state with EXACTLY ONE action', () => {
    const onClose = vi.fn();
    const r = render(<ProfileScreen onClose={onClose} />);
    const pressables = r.root
      .findAllByType('RNPressable' as never)
      // The four avatar buttons are not the empty state's action.
      .filter(
        (n) =>
          !String((n.props as { accessibilityLabel?: string }).accessibilityLabel ?? '').startsWith(
            'Avatar',
          ),
      );
    expect(pressables).toHaveLength(1);
    act(() => {
      (pressables[0]!.props as { onPress: () => void }).onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('owned frames replace the empty state', () => {
    useMetaStore.setState({ ownedFrames: ['ivy_wreath'] });
    const shown = texts(render(<ProfileScreen onClose={() => {}} />));
    expect(shown).toContain('Ivy Wreath');
    expect(shown.some((x) => x.includes('Early bird'))).toBe(false);
  });
});
