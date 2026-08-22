/**
 * `LevelMapScreen` — PRD §7.10, rendered. Covers the four medallion states,
 * the chest claim interaction, the scroll-to-current contract as the list
 * actually receives it, the §12.9 content-ceiling state, §4.5 (one animated
 * element, a windowed list), a11y payloads, and WCAG contrast read off the
 * RENDERED tree.
 */
import { MAX_LEVEL_ID, frameForChest } from '@blockmanor/content';
import React from 'react';
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectTextContrast, composite, contrastRatio, flattenStyle } from '../contrast';
import { track } from '../../src/services/analytics';
import { LevelMapScreen } from '../../src/screens/LevelMapScreen';
import { ROW_HEIGHT } from '../../src/screens/LevelMapScreen/mapNodes';
import en from '../../src/i18n/en.json';
import { useMetaStore } from '../../src/state/useMetaStore';

/** The opaque screen background the composite stack starts from — read off
 * the screen's own root style, never re-typed as a literal. */
function backdropOf(renderer: ReactTestRenderer): string {
  const root = renderer.root.findAll(
    (n) =>
      typeof n.type === 'string' && typeof flattenStyle(n.props.style).backgroundColor === 'string',
  )[0];
  return String(flattenStyle(root!.props.style).backgroundColor);
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

function setProgress(over: {
  currentLevel?: number;
  stars?: Record<string, number>;
  chestsClaimed?: Record<string, boolean>;
  ownedFrames?: readonly string[];
}): void {
  // Inside `act`: a previously-mounted renderer is still subscribed to the
  // store, so a bare `setState` here is an un-acted React update.
  act(() => {
    useMetaStore.setState({
      currentLevel: over.currentLevel ?? 1,
      stars: over.stars ?? {},
      chestsClaimed: over.chestsClaimed ?? {},
      ownedFrames: over.ownedFrames ?? [],
    });
  });
}

function labels(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((n) => typeof n.props.accessibilityLabel === 'string')
    .map((n) => String(n.props.accessibilityLabel));
}

function byLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const found = renderer.root.findAll((n) => n.props.accessibilityLabel === label);
  expect(found, `no node labelled "${label}"`).toHaveLength(1);
  return found[0]!;
}

function texts(node: ReactTestInstance): string[] {
  return node.findAllByType('RNText' as never).map((n) => String(n.props.children));
}

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

const noop = (): void => undefined;

beforeEach(() => {
  setProgress({ currentLevel: 1 });
});

afterEach(() => {
  act(() => {
    for (const r of mounted.splice(0)) r.unmount();
  });
});

describe('§7.10 medallion states, rendered', () => {
  it('announces all four states with their real payload — never a generic label', () => {
    setProgress({ currentLevel: 24, stars: { '21': 1, '22': 2, '23': 3 } });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const all = labels(renderer);
    expect(all).toContain('Level 21, completed, 1 of 3 stars');
    expect(all).toContain('Level 22, completed, 2 of 3 stars');
    expect(all).toContain('Level 23, completed, 3 of 3 stars');
    expect(all).toContain('Level 24, your current level');
    expect(all).toContain('Level 25, locked');
  });

  it('fills exactly `stars` of the 3 pips on a completed medallion', () => {
    setProgress({ currentLevel: 24, stars: { '22': 2 } });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const medallion = byLabel(renderer, 'Level 22, completed, 2 of 3 stars');
    expect(texts(medallion).filter((c) => c === '★')).toHaveLength(2);
    expect(texts(medallion).filter((c) => c === '☆')).toHaveLength(1);
  });

  it('draws no star pips on the current or a locked medallion', () => {
    setProgress({ currentLevel: 24 });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    expect(texts(byLabel(renderer, 'Level 24, your current level'))).not.toContain('★');
    expect(texts(byLabel(renderer, 'Level 25, locked'))).not.toContain('★');
  });

  it('tags the current medallion "You are here" (mockup panel 5.1) and nothing else', () => {
    setProgress({ currentLevel: 24 });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const here = renderer.root.findAll(
      (n) => String(n.type) === 'RNText' && n.props.children === en['map.youAreHere'],
    );
    expect(here).toHaveLength(1);
  });

  it('§4.5: exactly ONE element animates — the current medallion, not sixty', () => {
    setProgress({ currentLevel: 24 });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    expect(renderer.root.findAll((n) => String(n.type) === 'AnimatedView')).toHaveLength(1);
  });
});

describe('§7.10 "Map scrolls to current level on open"', () => {
  it('hands the list an `initialScrollIndex` pointing at the current level row', () => {
    setProgress({ currentLevel: 24 });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const list = renderer.root.findAll((n) => String(n.type) === 'RNFlatList')[0]!;
    const index = list.props.initialScrollIndex as number;
    // The row at that index is the one labelled as the current level — read
    // out of the rendered rows, not recomputed from the same helper the
    // component used.
    const rows = renderer.root.findAll((n) => {
      const style = flattenStyle(n.props.style);
      return typeof n.type === 'string' && style.height === ROW_HEIGHT;
    });
    expect(texts(rows[index]!)).toContain('24');
    expect(
      rows[index]!.findAll((n) => n.props.accessibilityLabel === 'Level 24, your current level'),
    ).toHaveLength(1);
  });

  it('opens near the top for a brand-new player and deep in the list for a late one', () => {
    setProgress({ currentLevel: 1 });
    const early = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const earlyIndex = early.root.findAll((n) => String(n.type) === 'RNFlatList')[0]!.props
      .initialScrollIndex as number;

    setProgress({ currentLevel: 58 });
    const late = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const lateIndex = late.root.findAll((n) => String(n.type) === 'RNFlatList')[0]!.props
      .initialScrollIndex as number;

    expect(earlyIndex).toBeLessThan(5);
    expect(lateIndex).toBeGreaterThan(50);
  });

  it('§4.5: the list is windowed — uniform `getItemLayout` rows, bounded initial render', () => {
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const list = renderer.root.findAll((n) => String(n.type) === 'RNFlatList')[0]!;
    const getItemLayout = list.props.getItemLayout as (
      d: unknown,
      i: number,
    ) => { length: number; offset: number; index: number };
    expect(getItemLayout).toBeTypeOf('function');
    // Uniform heights are what make `initialScrollIndex` land on the right
    // pixel without measuring 66 rows first.
    expect(getItemLayout(null, 0)).toEqual({ length: ROW_HEIGHT, offset: 0, index: 0 });
    expect(getItemLayout(null, 7)).toEqual({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * 7,
      index: 7,
    });
    expect(list.props.initialNumToRender as number).toBeLessThan(20);
  });
});

describe('§7.10 chests — L10/20/30…, and the claim', () => {
  it('announces each chest state with its level and what it means', () => {
    setProgress({ currentLevel: 24, chestsClaimed: { '10': true } });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const all = labels(renderer);
    expect(all).toContain('Level 10 chest, already collected');
    expect(all).toContain('Level 20 chest, ready to open');
    expect(all).toContain('Level 30 chest, locked — clear level 30 to open it');
  });

  it('only a claimable chest is a button, with a ≥44dp target', () => {
    setProgress({ currentLevel: 24 });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const ready = byLabel(renderer, 'Level 20 chest, ready to open');
    expect(ready.props.accessibilityRole).toBe('button');
    const style = flattenStyle(ready.props.style);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);

    const locked = byLabel(renderer, 'Level 30 chest, locked — clear level 30 to open it');
    expect(locked.props.accessibilityRole).toBeUndefined();
    expect(locked.props.onPress).toBeUndefined();
  });

  it('opening a chest grants and PERSISTS the cosmetic avatar frame — and nothing else', () => {
    setProgress({ currentLevel: 24 });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    act(() => {
      (
        byLabel(renderer, 'Level 20 chest, ready to open').props as { onPress: () => void }
      ).onPress();
    });
    act(() => {
      const open = renderer.root.findAll(
        (n) => n.props.accessibilityLabel === en['map.chest.open'],
      )[0]!;
      (open.props as { onPress: () => void }).onPress();
    });

    const frame = frameForChest(20)!;
    expect(useMetaStore.getState().ownedFrames).toEqual([frame.id]);
    expect(useMetaStore.getState().chestsClaimed['20']).toBe(true);
    // Stage 2 is Stage 2: no wallet key appeared alongside the grant.
    expect(Object.keys(useMetaStore.getState())).not.toContain('coins');
  });

  it('the sheet shows the frame it granted, then collapses to the map on Collect', () => {
    setProgress({ currentLevel: 24 });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    act(() => {
      (
        byLabel(renderer, 'Level 20 chest, ready to open').props as { onPress: () => void }
      ).onPress();
    });
    act(() => {
      const open = renderer.root.findAll(
        (n) => n.props.accessibilityLabel === en['map.chest.open'],
      )[0]!;
      (open.props as { onPress: () => void }).onPress();
    });

    const shown = texts(renderer.root);
    expect(shown).toContain(en['frames.garden_gate']);
    expect(shown).toContain(en['map.chest.rewardKind']);

    act(() => {
      const collect = renderer.root.findAll(
        (n) => n.props.accessibilityLabel === en['map.chest.collect'],
      )[0]!;
      (collect.props as { onPress: () => void }).onPress();
    });
    expect(texts(renderer.root)).not.toContain(en['map.chest.rewardKind']);
    // Re-labelled on the map now that it is spent.
    expect(labels(renderer)).toContain('Level 20 chest, already collected');
  });

  it('re-claiming never duplicates a frame (double tap, replayed grant)', () => {
    setProgress({ currentLevel: 24 });
    const frame = frameForChest(20)!;
    act(() => {
      useMetaStore.getState().claimChest(20, frame.id);
      useMetaStore.getState().claimChest(20, frame.id);
    });
    expect(useMetaStore.getState().ownedFrames).toEqual([frame.id]);
  });

  it('§12.9: the chest sheet has a way out BEFORE it is opened', () => {
    setProgress({ currentLevel: 24 });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    act(() => {
      (
        byLabel(renderer, 'Level 20 chest, ready to open').props as { onPress: () => void }
      ).onPress();
    });
    act(() => {
      (byLabel(renderer, en['map.chest.dismissLabel']).props as { onPress: () => void }).onPress();
    });
    expect(texts(renderer.root)).not.toContain(en['map.chest.teaser']);
    expect(useMetaStore.getState().ownedFrames).toEqual([]);
  });
});

describe('§7.10 chapter cards and the footer', () => {
  it('shows both chapter titles, the level count and the next chest', () => {
    setProgress({ currentLevel: 24 });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const all = texts(renderer.root);
    expect(all).toContain(en['map.chapter.1.title']);
    expect(all).toContain(en['map.chapter.2.title']);
    expect(all).toContain('23 of 30 levels · next chest at 10');
  });

  it('the footer star chip totals the persisted stars, with tabular numerals', () => {
    setProgress({ currentLevel: 5, stars: { '1': 3, '2': 2, '3': 1, '4': 3 } });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const chip = byLabel(renderer, '9 stars earned');
    expect(texts(chip)).toContain('9');
    const value = chip.findAllByType('RNText' as never).find((n) => n.props.children === 9)!;
    expect(flattenStyle(value.props.style).fontVariant).toEqual(['tabular-nums']);
  });

  it('the one play affordance fires `onPlay` and names the current level', () => {
    setProgress({ currentLevel: 24 });
    const onPlay = vi.fn();
    const renderer = render(<LevelMapScreen onPlay={onPlay} onExit={noop} />);
    const cta = byLabel(renderer, 'PLAY — Level 24');
    act(() => {
      (cta.props as { onPress: () => void }).onPress();
    });
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('§12.9: a save past the content ceiling gets exactly ONE action, not a dead CTA', () => {
    setProgress({ currentLevel: MAX_LEVEL_ID + 1 });
    const onPlay = vi.fn();
    const onExit = vi.fn();
    const renderer = render(<LevelMapScreen onPlay={onPlay} onExit={onExit} />);
    expect(texts(renderer.root)).toContain(en['map.allShippedLine']);
    expect(labels(renderer)).not.toContain(`PLAY — Level ${MAX_LEVEL_ID + 1}`);
    act(() => {
      (byLabel(renderer, en['map.backHome']).props as { onPress: () => void }).onPress();
    });
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('the close affordance is a ≥44dp labelled button routing to `onExit` (§12.9, no dead end)', () => {
    const onExit = vi.fn();
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={onExit} />);
    const close = byLabel(renderer, en['map.closeLabel']);
    const style = flattenStyle(close.props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
    act(() => {
      (close.props as { onPress: () => void }).onPress();
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('§15 accessibility — contrast computed from the RENDERED tree', () => {
  it('every text on the map clears the WCAG normal-text 4.5:1 floor', () => {
    setProgress({ currentLevel: 24, stars: { '23': 3 } });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const measured = collectTextContrast(renderer.root, backdropOf(renderer));
    expect(measured.length).toBeGreaterThan(10);
    for (const m of measured) {
      expect(
        m.ratio,
        `"${m.text}" ${m.color} on ${m.background} = ${m.ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every text on the chest sheet clears it too', () => {
    setProgress({ currentLevel: 24 });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    act(() => {
      (
        byLabel(renderer, 'Level 20 chest, ready to open').props as { onPress: () => void }
      ).onPress();
    });
    act(() => {
      const open = renderer.root.findAll(
        (n) => n.props.accessibilityLabel === en['map.chest.open'],
      )[0]!;
      (open.props as { onPress: () => void }).onPress();
    });
    const measured = collectTextContrast(renderer.root, backdropOf(renderer));
    for (const m of measured) {
      expect(
        m.ratio,
        `"${m.text}" ${m.color} on ${m.background} = ${m.ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * WCAG 1.4.11 non-text: a medallion has to be VISIBLE as a component.
   * Nothing here is a colour literal — the fill and outline are read off the
   * rendered style of the node found by its own a11y label, and the backdrop
   * off the screen root. A locked medallion's `night2` fill is 1.06:1 on
   * `night`, so it is its outline that must carry the 3:1.
   */
  it('every medallion state is distinguishable from the map background at ≥3:1', () => {
    setProgress({ currentLevel: 24, stars: { '23': 3 } });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const backdrop = backdropOf(renderer);

    for (const label of [
      'Level 23, completed, 3 of 3 stars',
      'Level 24, your current level',
      'Level 25, locked',
      'Level 20 chest, ready to open',
    ]) {
      const shape = byLabel(renderer, label).findAll((n) => {
        const s = flattenStyle(n.props.style);
        return (
          typeof n.type === 'string' &&
          typeof s.backgroundColor === 'string' &&
          typeof s.borderRadius === 'number'
        );
      })[0]!;
      const s = flattenStyle(shape.props.style);
      const fill = contrastRatio(composite(String(s.backgroundColor), backdrop), backdrop);
      const outline =
        typeof s.borderColor === 'string'
          ? contrastRatio(composite(String(s.borderColor), backdrop), backdrop)
          : 0;
      expect(
        Math.max(fill, outline),
        `${label}: fill ${fill.toFixed(2)}:1, outline ${outline.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('i18n', () => {
  it('every avatar frame the content package ships has a display string', () => {
    const keys = Object.keys(en);
    for (const level of [10, 20, 30, 40, 50, 60]) {
      expect(keys).toContain(`frames.${frameForChest(level)!.id}`);
    }
  });

  it('every chapter on the map has a title string', () => {
    expect(Object.keys(en)).toContain('map.chapter.1.title');
    expect(Object.keys(en)).toContain('map.chapter.2.title');
  });

  it('a key using the same placeholder twice substitutes BOTH occurrences', () => {
    setProgress({ currentLevel: 24 });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    const label = labels(renderer).find((l) => l.startsWith('Level 30 chest, locked'))!;
    expect(label).not.toContain('{{');
  });
});

/**
 * §14 names NO event for the level map. Its taxonomy covers Session/FTUE,
 * Core (`level_start/complete/fail/quit`, `endless_end`), Daily, Share, and
 * the Stage-2/3 groups — nothing for a map view, a medallion, or a chest
 * claim. So this screen fires nothing, and that is the correct behaviour
 * rather than an omission: inventing `map_view`/`chest_open` would be an
 * unregistered event name (which §14's compile-time guard rejects anyway) and
 * a §14 amendment smuggled into a feature PR. This guards against a later
 * "while we're here" addition.
 */
describe('§14 analytics', () => {
  it('fires no event — §14 specifies none for this screen', () => {
    vi.mocked(track).mockClear();
    setProgress({ currentLevel: 24 });
    const renderer = render(<LevelMapScreen onPlay={noop} onExit={noop} />);
    act(() => {
      (
        byLabel(renderer, 'Level 20 chest, ready to open').props as { onPress: () => void }
      ).onPress();
    });
    act(() => {
      const open = renderer.root.findAll(
        (n) => n.props.accessibilityLabel === en['map.chest.open'],
      )[0]!;
      (open.props as { onPress: () => void }).onPress();
    });
    expect(vi.mocked(track)).not.toHaveBeenCalled();
  });
});
