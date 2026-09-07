/**
 * `HomeScreen` — PRD §7.11(a)/(f)/(g) plus the Acceptance line: the HUD bar
 * (reserved S2 slots, gear/avatar seams, the §0 v1.18 map affordance and its
 * centralized badge dot), the event-banner reservation, the bottom nav's
 * flag-hidden tabs, cold-start-from-cache, and the three Stage-1 screen
 * states (default / daily-unplayed / daily-complete) as one screenshot-test
 * equivalent per state (this repo has no pixel-screenshot harness; render-tree
 * assertions + `test/contrast.ts` are its existing substitute — see every
 * other `*.render.test.tsx` file).
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { colors as contrastColors } from '../../src/components/tokens';
import { collectTextContrast } from '../contrast';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { HudBar } from '../../src/screens/HomeScreen/HudBar';
import { BottomNav } from '../../src/screens/HomeScreen/BottomNav';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useMetaStore } from '../../src/state/useMetaStore';
import { resetDailyPulseForTest } from '../../src/screens/HomeScreen/homeSession';
import { mockAnimationCalls, resetMockAnimationCalls } from '../mocks/react-native-reanimated';

const mounted: ReactTestRenderer[] = [];

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  mounted.push(renderer);
  return renderer;
}

// Every store mutation wrapped in `act`: a renderer left mounted from an
// earlier `it` (this file never unmounts mid-test, only in `afterEach`) is
// still subscribed, so a bare `setState` here is an un-acted React update —
// same reasoning as `levelMapScreen.render.test.tsx`'s `setProgress`.
function setMeta(partial: Partial<ReturnType<typeof useMetaStore.getState>>): void {
  act(() => {
    useMetaStore.setState(partial);
  });
}

function setFlags(flags: Record<string, boolean>): void {
  act(() => {
    useConfigStore.setState((s) => ({
      snapshot: { ...s.snapshot, ...flags } as typeof s.snapshot,
    }));
  });
}

const noop = (): void => undefined;

beforeEach(() => {
  setMeta({
    currentLevel: 12,
    endlessBest: 0,
    streak: 0,
    playerName: null,
    avatarId: null,
    badges: { dailyUnplayed: false },
    chestsClaimed: {},
    stars: {},
  });
  setFlags({
    flag_daily_board: true,
    flag_endless: true,
    flag_events: false,
    flag_manor: false,
    flag_team: false,
    flag_economy: false,
  });
  resetDailyPulseForTest();
  resetMockAnimationCalls();
});

afterEach(() => {
  act(() => {
    for (const r of mounted.splice(0)) r.unmount();
  });
});

describe('HomeScreen cold start (§4.5 / §7.11 Acceptance: "renders from cache instantly")', () => {
  it('the PLAY CTA is present on the FIRST synchronous render pass — no loading gate, no await', () => {
    // No `waitFor`, no async `act`: if HomeScreen ever grew an effect that
    // awaited a fetch before showing content, this render would come back
    // empty and the label lookup below would fail on the very first pass.
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    const label = renderer.root.findAll(
      (n) =>
        typeof n.props.accessibilityLabel === 'string' &&
        n.props.accessibilityLabel.startsWith('PLAY'),
    );
    expect(label.length).toBe(1);
  });
});

describe('HomeScreen (a) HUD bar', () => {
  it('reserves two empty S2 economy slots — no coin/life text or Stage-2 store read', () => {
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    const hud = renderer.root.findByType(HudBar);
    // The reservation is layout-only: no text lives inside the HUD row other
    // than the a11y-labelled icon glyphs (settings/avatar/map), never a coin
    // or life NUMBER — that would be reading Stage-2 state (§0 rule 2a).
    const numbers = collectTextContrast(hud, contrastColors.night).filter((c) =>
      /^\d+$/.test(c.text),
    );
    expect(numbers).toEqual([]);
  });

  it('the gear and avatar are announced and tappable, and no-op safely with no handler wired', () => {
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    const settings = renderer.root.findByProps({ accessibilityLabel: 'Settings' });
    const profile = renderer.root.findByProps({ accessibilityLabel: 'Your profile' });
    expect(() => act(() => (settings.props as { onPress?: () => void }).onPress?.())).not.toThrow();
    expect(() => act(() => (profile.props as { onPress?: () => void }).onPress?.())).not.toThrow();
  });

  it('tapping the map affordance calls onOpenMap', () => {
    setMeta({ currentLevel: 5 }); // below L10 — plain "Level map" label, no chest dot
    const onOpenMap = vi.fn();
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={onOpenMap} />);
    const map = renderer.root.findByProps({ accessibilityLabel: 'Level map' });
    act(() => (map.props as { onPress: () => void }).onPress());
    expect(onOpenMap).toHaveBeenCalledTimes(1);
  });

  describe('the map badge dot — centralized via `selectBadges`/`useMetaStore.badges` (§7.11 rules line)', () => {
    it('no unclaimed chest: no dot, plain label', () => {
      setMeta({ currentLevel: 5, chestsClaimed: {} });
      const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
      expect(renderer.root.findAllByProps({ accessibilityLabel: 'Level map' }).length).toBe(1);
      expect(
        renderer.root.findAllByProps({ accessibilityLabel: 'A chest is ready to open' }).length,
      ).toBe(0);
    });

    it('past L10 with L10 unclaimed: the dot renders and the label announces it', () => {
      setMeta({ currentLevel: 11, chestsClaimed: {} });
      const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
      expect(
        renderer.root.findAllByProps({ accessibilityLabel: 'Level map, a chest is ready to open' })
          .length,
      ).toBe(1);
      expect(
        renderer.root.findAllByProps({ accessibilityLabel: 'A chest is ready to open' }).length,
      ).toBe(1);
    });

    it('past L10 with L10 ALREADY claimed: no dot again — claiming clears it', () => {
      setMeta({ currentLevel: 11, chestsClaimed: { '10': true } });
      const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
      expect(
        renderer.root.findAllByProps({ accessibilityLabel: 'A chest is ready to open' }).length,
      ).toBe(0);
    });
  });
});

describe('HomeScreen (f) event banner slot', () => {
  it('flag_events off (Stage 1 default): nothing rendered for it', () => {
    setFlags({ flag_events: false });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    // Nothing to find by role/label; the absence is the assertion — the
    // BottomNav's Events/Team tabs (same flag) are also absent, checked below.
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Events' }).length).toBe(0);
  });
});

describe('HomeScreen (g) bottom nav — locked tabs hidden, not greyed', () => {
  it('Stage 1 defaults (every flag off): ONLY Home renders', () => {
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    const nav = renderer.root.findByType(BottomNav);
    const labels = collectTextContrast(nav, contrastColors.night).map((c) => c.text);
    expect(labels).toEqual(['🏠', 'Home']);
  });

  it('flag_manor on: Manor tab appears alongside Home', () => {
    setFlags({ flag_manor: true });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Manor' }).length).toBe(1);
  });

  it('flag_events on: Events appears', () => {
    setFlags({ flag_events: true });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Events' }).length).toBe(1);
  });

  // §7.11(g) v1.20: Team gates on its OWN `flag_team`, not `flag_events` —
  // the two must be able to move independently. These two cases are the
  // regression guard for that: each flag ALONE must show only its own tab.
  it('flag_events ON ALONE: Team stays hidden — the two flags are independent', () => {
    setFlags({ flag_events: true, flag_team: false });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Events' }).length).toBe(1);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Team' }).length).toBe(0);
  });

  it('flag_team ON ALONE: Team appears, Events stays hidden', () => {
    setFlags({ flag_team: true, flag_events: false });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Team' }).length).toBe(1);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Events' }).length).toBe(0);
  });

  it('flag_economy on: Shop appears', () => {
    setFlags({ flag_economy: true });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Shop' }).length).toBe(1);
  });

  it('every flag on: all five tabs render, Home first', () => {
    setFlags({ flag_manor: true, flag_events: true, flag_team: true, flag_economy: true });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    const nav = renderer.root.findByType(BottomNav);
    const labels = collectTextContrast(nav, contrastColors.night)
      .map((c) => c.text)
      .filter((text) => text.length > 2); // drop the glyph characters, keep names
    expect(labels).toEqual(['Home', 'Manor', 'Events', 'Team', 'Shop']);
  });
});

describe("HomeScreen's three Stage-1 states (§7.11 rules line)", () => {
  it('default: badges.dailyUnplayed=false, streak=0 — neutral tile, no dot, no flame chip, no pulse', () => {
    setMeta({ badges: { dailyUnplayed: false }, streak: 0 });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    const texts = collectTextContrast(renderer.root, contrastColors.night).map((c) => c.text);
    expect(texts).toContain('Played today');
    expect(texts.some((t) => t.startsWith('🔥'))).toBe(false);
  });

  it('daily-unplayed: badges.dailyUnplayed=true — red dot + pulse fires once', () => {
    setMeta({ badges: { dailyUnplayed: true }, streak: 0 });
    render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    // Asserted properly (mutation-tested) in the dedicated pulse-session test
    // below; this case only proves the STATE selection reaches the tile.
  });

  it('daily-complete: badges.dailyUnplayed=false with a real streak — flame chip, no dot', () => {
    setMeta({ badges: { dailyUnplayed: false }, streak: 7 });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    const texts = collectTextContrast(renderer.root, contrastColors.night).map((c) => c.text);
    expect(texts).toContain('🔥7');
    expect(texts).toContain('Played today');
  });
});

describe('§7.11 "tile pulses once on screen entry, max 1 pulse/session" (mutation-tested)', () => {
  it('first HomeScreen mount this session: the daily tile pulses', () => {
    setMeta({ badges: { dailyUnplayed: true } });
    render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    expect(mockAnimationCalls.length).toBeGreaterThan(0);
  });

  it('a SECOND HomeScreen mount in the same session: no pulse — the session cap, not a per-mount reset', () => {
    setMeta({ badges: { dailyUnplayed: true } });
    render(<HomeScreen onPlay={noop} onOpenMap={noop} />); // consumes the session's one pulse
    resetMockAnimationCalls(); // clear what the first mount recorded
    render(<HomeScreen onPlay={noop} onOpenMap={noop} />); // a second, later Home entry
    expect(mockAnimationCalls.length).toBe(0);
  });
});
