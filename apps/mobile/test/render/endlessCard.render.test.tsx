/**
 * `EndlessCard` — PRD §7.6 / §7.11(e) / §12.9. Covers the locked/unlocked
 * variants, the §12.9 "no endless best" empty-state copy, the a11y labels,
 * and — per this PR's accessibility brief — COMPUTED contrast for every text
 * this component renders.
 *
 * That last part is read off the RENDERED TREE (`test/contrast.ts`), not off
 * a re-typed color literal: the previous version of this file hardcoded the
 * card's background as `#232A53` (wrong by one channel — the real composite
 * is `#232B53`) and never touched the component's styles, so mutating either
 * the card background or the locked subtitle's color left it green. Both
 * mutations are red now.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { colors } from '../../src/components/tokens';
import { collectTextContrast, composite, contrastRatio, flattenStyle } from '../contrast';
import { REMOTE_CONFIG_DEFAULTS } from '@blockmanor/shared';
import { EndlessCard } from '../../src/screens/HomeScreen/EndlessCard';

/** §13 Modes default. Read from the registry, not re-typed, so a retune of
 * `endless_unlock_level` moves these cases with it. */
const ENDLESS_UNLOCK_LEVEL = REMOTE_CONFIG_DEFAULTS.endless_unlock_level;

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

/** The card is laid out on `HomeScreen`'s `colors.night` surface — the only
 * color this file names, because it is the one thing NOT rendered by the
 * component under test. */
const SCREEN = colors.night;

/** §15 floors: 4.5:1 for text, 3:1 for meaningful non-text (WCAG 1.4.3/1.4.11). */
const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;

describe('EndlessCard (PRD §7.6 / §7.11(e))', () => {
  it('unlocked: shows the CTA and the persisted best score', () => {
    const renderer = render(
      <EndlessCard
        unlocked
        unlockLevel={ENDLESS_UNLOCK_LEVEL}
        currentLevel={12}
        best={4200}
        onPress={vi.fn()}
      />,
    );
    const texts = renderer.root.findAllByType('RNText' as never).map((n) => n.children.join(''));
    // Grouped, as the mockup renders every score (§15 / NIT 9).
    expect(texts).toContain('4,200');
    expect(texts).toContain('Play Endless');
  });

  it('§12.9 empty state: no best yet renders "Set your first record", never "0"', () => {
    const renderer = render(
      <EndlessCard
        unlocked
        unlockLevel={ENDLESS_UNLOCK_LEVEL}
        currentLevel={12}
        best={0}
        onPress={vi.fn()}
      />,
    );
    const texts = renderer.root.findAllByType('RNText' as never).map((n) => n.children.join(''));
    expect(texts).toContain('Set your first record');
    expect(texts).not.toContain('0');
  });

  it("unlocked card is a single pressable that fires onPress (the empty state's one action, §12.9)", () => {
    const onPress = vi.fn();
    const renderer = render(
      <EndlessCard
        unlocked
        unlockLevel={ENDLESS_UNLOCK_LEVEL}
        currentLevel={12}
        best={0}
        onPress={onPress}
      />,
    );
    const pressables = renderer.root.findAllByType('RNPressable' as never);
    expect(pressables.length).toBe(1);
    act(() => {
      (pressables[0]!.props as { onPress: () => void }).onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it(`locked (currentLevel <= ${ENDLESS_UNLOCK_LEVEL}): shows the unlock copy and is NOT pressable`, () => {
    const renderer = render(
      <EndlessCard
        unlocked={false}
        unlockLevel={ENDLESS_UNLOCK_LEVEL}
        currentLevel={7}
        best={0}
        onPress={vi.fn()}
      />,
    );
    const texts = renderer.root.findAllByType('RNText' as never).map((n) => n.children.join(''));
    expect(texts.some((s) => s.includes("Unlocks after Level 10 — you're on 7"))).toBe(true);
    expect(renderer.root.findAllByType('RNPressable' as never).length).toBe(0);
  });

  it(`the boundary case (currentLevel === ${ENDLESS_UNLOCK_LEVEL}, still locked) does not contradict itself`, () => {
    const renderer = render(
      <EndlessCard
        unlocked={false}
        unlockLevel={ENDLESS_UNLOCK_LEVEL}
        currentLevel={ENDLESS_UNLOCK_LEVEL}
        best={0}
        onPress={vi.fn()}
      />,
    );
    const texts = renderer.root.findAllByType('RNText' as never).map((n) => n.children.join(''));
    // "Unlocks AT Level 10 — you're on 10" beside a padlock is a lie: the gate
    // opens once level 10 is CLEARED (`currentLevel > 10`, see HomeScreen).
    expect(texts.some((s) => s.includes("Unlocks after Level 10 — you're on 10"))).toBe(true);
    expect(texts.some((s) => s.includes("at Level 10 — you're on 10"))).toBe(false);
  });

  it('the locked progress bar never reads 100% while the padlock is up, and hits 100% exactly when it lifts', () => {
    const fillWidth = (currentLevel: number): string => {
      const renderer = render(
        <EndlessCard
          unlocked={false}
          unlockLevel={ENDLESS_UNLOCK_LEVEL}
          currentLevel={currentLevel}
          best={0}
          onPress={vi.fn()}
        />,
      );
      const track = renderer.root.findAll(
        (n) => typeof n.type === 'string' && flattenStyle(n.props.style).overflow === 'hidden',
      )[0]!;
      const fill = track.children.find((c) => typeof c !== 'string');
      if (!fill || typeof fill === 'string') throw new Error('progress fill not rendered');
      return String(flattenStyle(fill.props.style).width);
    };
    // Locked at 10 (mid-attempt on the gate level) => strictly under full.
    expect(fillWidth(ENDLESS_UNLOCK_LEVEL)).toBe('90%');
    expect(fillWidth(7)).toBe('60%');
    // The pointer the gate actually opens on. (Renders locked only because
    // this test forces `unlocked={false}`; the fill is what's under test.)
    expect(fillWidth(ENDLESS_UNLOCK_LEVEL + 1)).toBe('100%');
  });

  it('a11y: the locked label announces the unlock status, not just "locked" (§15)', () => {
    const renderer = render(
      <EndlessCard
        unlocked={false}
        unlockLevel={ENDLESS_UNLOCK_LEVEL}
        currentLevel={7}
        best={0}
        onPress={vi.fn()}
      />,
    );
    // `accessible` collapses the card into ONE node, so the subtitle text is
    // NOT independently announced — the label has to carry it.
    const card = renderer.root.findAll((n) => typeof n.type === 'string')[0]!;
    expect(card.props.accessible).toBe(true);
    expect(String(card.props.accessibilityLabel)).toBe(
      "Endless mode, locked. Unlocks after Level 10 — you're on 7",
    );
  });

  it('a11y: the unlocked label announces the personal best — the one thing §7.6 tracks', () => {
    const withBest = render(
      <EndlessCard
        unlocked
        unlockLevel={ENDLESS_UNLOCK_LEVEL}
        currentLevel={12}
        best={12480}
        onPress={vi.fn()}
      />,
    );
    expect(String(withBest.root.findByType('RNPressable' as never).props.accessibilityLabel)).toBe(
      'Play Endless. Your best 12,480',
    );

    const empty = render(
      <EndlessCard
        unlocked
        unlockLevel={ENDLESS_UNLOCK_LEVEL}
        currentLevel={12}
        best={0}
        onPress={vi.fn()}
      />,
    );
    expect(String(empty.root.findByType('RNPressable' as never).props.accessibilityLabel)).toBe(
      'Play Endless. Set your first record',
    );
  });

  it('every text on the LOCKED card clears the 4.5:1 floor against its real composited background', () => {
    const renderer = render(
      <EndlessCard
        unlocked={false}
        unlockLevel={ENDLESS_UNLOCK_LEVEL}
        currentLevel={7}
        best={0}
        onPress={vi.fn()}
      />,
    );
    const measured = collectTextContrast(renderer.root, SCREEN);
    // Title + subtitle: if either stops rendering, this test must not quietly
    // pass on an empty list.
    expect(measured.filter((m) => m.text.trim().length > 0).length).toBeGreaterThanOrEqual(2);
    for (const m of measured) {
      expect(
        m.ratio,
        `"${m.text}" ${m.color} on ${m.background} = ${m.ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it('every text on the UNLOCKED card clears the 4.5:1 floor (incl. the CTA pill and the best row on its inset)', () => {
    const renderer = render(
      <EndlessCard
        unlocked
        unlockLevel={ENDLESS_UNLOCK_LEVEL}
        currentLevel={12}
        best={12480}
        onPress={vi.fn()}
      />,
    );
    const measured = collectTextContrast(renderer.root, SCREEN);
    expect(measured.length).toBeGreaterThanOrEqual(5);
    for (const m of measured) {
      expect(
        m.ratio,
        `"${m.text}" ${m.color} on ${m.background} = ${m.ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it("the locked progress bar's fill clears the 3:1 non-text floor against its own track", () => {
    const renderer = render(
      <EndlessCard
        unlocked={false}
        unlockLevel={ENDLESS_UNLOCK_LEVEL}
        currentLevel={7}
        best={0}
        onPress={vi.fn()}
      />,
    );
    // Walk down to the bar off the tree: the card surface, then the only
    // clipped track inside it, then the fill it contains.
    const card = renderer.root.findAll((n) => typeof n.type === 'string')[0]!;
    const cardBg = composite(String(flattenStyle(card.props.style).backgroundColor), SCREEN);
    const track = renderer.root.findAll(
      (n) => typeof n.type === 'string' && flattenStyle(n.props.style).overflow === 'hidden',
    )[0]!;
    const trackBg = composite(String(flattenStyle(track.props.style).backgroundColor), cardBg);
    const fill = track.children.find((c) => typeof c !== 'string') as (typeof track)['children'][0];
    if (typeof fill === 'string') throw new Error('progress fill not rendered');
    const fillBg = composite(String(flattenStyle(fill.props.style).backgroundColor), trackBg);
    expect(contrastRatio(fillBg, trackBg)).toBeGreaterThanOrEqual(NON_TEXT_MIN);
  });
});
