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
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { colors as contrastColors } from '../../src/components/tokens';
import { collectTextContrast, flattenStyle } from '../contrast';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { HudBar } from '../../src/screens/HomeScreen/HudBar';
import { BottomNav } from '../../src/screens/HomeScreen/BottomNav';
import { EventBannerSlot } from '../../src/screens/HomeScreen/EventBannerSlot';
import { DailyBoardTile } from '../../src/screens/HomeScreen/DailyBoardTile';
import { HUD_ECONOMY_SLOT_WIDTH, HUD_ICON_SIZE } from '../../src/screens/HomeScreen/homeTokens';
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

// Deliberately NOT "cold start" — that's §4.5's ≤3.0s device-timing clause
// (qa-prd-auditor B-1), which no host/vitest render can measure and which
// the PRD now marks `[device]` (the EAS device gate covers it, not this
// suite). This describes ONLY §7.11's "renders from cache instantly, no
// network wait" clause, which IS host-testable: no async gate before the
// first paint.
describe('HomeScreen renders from cache — no network wait (§7.11 Acceptance)', () => {
  it('the PLAY CTA, with the correct level number, is present on the FIRST synchronous render pass', () => {
    // No `waitFor`, no async `act`: if HomeScreen ever grew an effect that
    // awaited a fetch before showing content, this render would come back
    // empty and the label lookup below would fail on the very first pass.
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    // Exact match, not `.startsWith('PLAY')` (qa-prd-auditor B-3): a prefix
    // check alone lets the level NUMBER drift (e.g. `currentLevel + 1`) with
    // the suite green — `currentLevel` is 12 in `beforeEach`.
    const label = renderer.root.findAll((n) => n.props.accessibilityLabel === 'PLAY — Level 12');
    expect(label.length).toBe(1);
  });
});

/** Any host node painting `colors.gold` — the exact "second gold button"
 * shape qa-prd-auditor B-4 found: `EndlessCard`'s own inner CTA pill, once
 * Endless unlocks, was a second one next to (d)'s real PLAY CTA. */
function goldFillCount(root: ReactTestInstance): number {
  return root.findAll((n) => {
    if (typeof n.type !== 'string') return false;
    const style = flattenStyle((n.props as { style?: unknown }).style);
    return style.backgroundColor === contrastColors.gold;
  }).length;
}

describe('HomeScreen — exactly ONE gold button (mockup: "never a second gold button", qa-prd-auditor B-4)', () => {
  it.each([1, 5, 9, 10, 11, 25, 60])(
    'currentLevel %i: exactly 1 gold-filled node on the whole screen',
    (level) => {
      setMeta({ currentLevel: level });
      const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
      expect(goldFillCount(renderer.root)).toBe(1);
    },
  );
});

describe('HomeScreen (a) HUD bar', () => {
  it('reserves two TRUE-LEAF S2 economy slots — zero children, zero a11y payload (qa-prd-auditor M-8)', () => {
    // Stronger than a bare-digit text filter (which a mutation filling the
    // slot with "🪙 500"/"❤ 5" — what a real Stage-2 chip looks like —
    // survives): finds the two slot Views STRUCTURALLY (their own reserved
    // dimensions, §0 rule 2a's "render nothing"), and asserts each has
    // NO children at all and NO accessibilityLabel of its own — closing the
    // second half of rule 2a too ("reads no later-stage state"), since a
    // slot that read Stage-2 state and dropped it straight into an
    // `accessibilityLabel` would have no rendered TEXT to catch either.
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    const hud = renderer.root.findByType(HudBar);
    const slots = hud.findAll((n) => {
      if (typeof n.type !== 'string') return false;
      const style = flattenStyle((n.props as { style?: unknown }).style);
      return style.width === HUD_ECONOMY_SLOT_WIDTH && style.height === HUD_ICON_SIZE;
    });
    expect(slots.length).toBe(2);
    for (const slot of slots) {
      expect(slot.children.length).toBe(0);
      expect((slot.props as { accessibilityLabel?: unknown }).accessibilityLabel).toBeUndefined();
    }
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

describe('HomeScreen (c) Daily Board tile flag gate (qa-prd-auditor M-11)', () => {
  it('flag_daily_board off: DailyBoardTile is not mounted at all', () => {
    setFlags({ flag_daily_board: false });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    expect(renderer.root.findAllByType(DailyBoardTile).length).toBe(0);
  });

  it('flag_daily_board on (Stage 1 default): DailyBoardTile mounts', () => {
    setFlags({ flag_daily_board: true });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    expect(renderer.root.findAllByType(DailyBoardTile).length).toBe(1);
  });
});

describe('HomeScreen (f) event banner slot', () => {
  it('flag_events off (Stage 1 default): EventBannerSlot is not mounted at all (qa-prd-auditor M-9)', () => {
    setFlags({ flag_events: false });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    expect(renderer.root.findAllByType(EventBannerSlot).length).toBe(0);
  });

  it('flag_events on: EventBannerSlot mounts', () => {
    setFlags({ flag_events: true });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    expect(renderer.root.findAllByType(EventBannerSlot).length).toBe(1);
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

  it('daily-unplayed: badges.dailyUnplayed=true — red dot + "New today" copy (pulse itself is mutation-tested below)', () => {
    setMeta({ badges: { dailyUnplayed: true }, streak: 0 });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    const texts = collectTextContrast(renderer.root, contrastColors.night).map((c) => c.text);
    expect(texts).toContain('New today');
    expect(texts).not.toContain('Played today');
    expect(
      renderer.root.findAll((n) => n.props.accessibilityLabel === 'Unplayed today').length,
    ).toBe(1);
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

const TEXT_MIN = 4.5;
/** `AVATAR_COLORS` is `Object.values(blockColors)` in source order (coral,
 * teal, gold, violet, amber, sky, rose) — indices, not hex, so this stays
 * correct if the palette is ever reordered. */
const AVATAR_ID_COUNT = 7;

describe('M-10 — HudBar / BottomNav contrast, computed off the RENDERED tree (never hand-typed)', () => {
  it('every avatar-chip ink/fill combination clears 4.5:1 — guest, every block color, both the initial and the glyph fallback', () => {
    const cases: Array<{ avatarId: number | null; playerName: string | null }> = [
      { avatarId: null, playerName: null }, // guest: night2 fill, cream glyph
      { avatarId: null, playerName: 'Sam' }, // still night2 (no avatarId), cream initial
      ...Array.from({ length: AVATAR_ID_COUNT }, (_, i) => ({
        avatarId: i,
        playerName: i % 2 === 0 ? 'Sam' : null, // alternate initial vs. glyph fallback
      })),
    ];
    for (const c of cases) {
      setMeta({ avatarId: c.avatarId, playerName: c.playerName });
      const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
      const hud = renderer.root.findByType(HudBar);
      const failing = collectTextContrast(hud, contrastColors.night).filter(
        (t) => t.ratio < TEXT_MIN,
      );
      expect(failing, JSON.stringify({ case: c, failing })).toEqual([]);
    }
  });

  it('every BottomNav label/glyph clears 4.5:1 — active (Home) and every inactive tab', () => {
    setFlags({ flag_manor: true, flag_events: true, flag_team: true, flag_economy: true });
    const renderer = render(<HomeScreen onPlay={noop} onOpenMap={noop} />);
    const nav = renderer.root.findByType(BottomNav);
    const failing = collectTextContrast(nav, contrastColors.night).filter(
      (t) => t.ratio < TEXT_MIN,
    );
    expect(failing, JSON.stringify(failing)).toEqual([]);
  });
});
