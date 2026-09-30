import { beforeEach, describe, expect, it } from 'vitest';
import {
  BOOSTER_SHOWCASE_LEVELS,
  parseWinstreakThresholds,
  randomBoosterType,
  winstreakGrantFor,
} from '../src/services/boosters';
import { useBoosterStore } from '../src/state/useBoosterStore';

describe('§9.3 BOOSTER_SHOWCASE_LEVELS', () => {
  it('names exactly L12 hammer / L18 broom / L26 hourglass', () => {
    expect(BOOSTER_SHOWCASE_LEVELS).toEqual({ 12: 'hammer', 18: 'broom', 26: 'hourglass' });
  });
});

describe('§9.3 parseWinstreakThresholds', () => {
  it('parses the RC default shape', () => {
    expect(parseWinstreakThresholds('2:1,3:2,5:2+200')).toEqual([
      { threshold: 2, count: 1, bonus: 0 },
      { threshold: 3, count: 2, bonus: 0 },
      { threshold: 5, count: 2, bonus: 200 },
    ]);
  });

  it('sorts out of order input ascending by threshold', () => {
    expect(parseWinstreakThresholds('5:2+200,2:1,3:2').map((t) => t.threshold)).toEqual([2, 3, 5]);
  });

  it('drops a malformed entry rather than throwing', () => {
    expect(parseWinstreakThresholds('2:1,garbage,3:2')).toEqual([
      { threshold: 2, count: 1, bonus: 0 },
      { threshold: 3, count: 2, bonus: 0 },
    ]);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseWinstreakThresholds(' 2 : 1 , 3:2 ')).toEqual([
      { threshold: 2, count: 1, bonus: 0 },
      { threshold: 3, count: 2, bonus: 0 },
    ]);
  });

  it('an empty string yields no tiers', () => {
    expect(parseWinstreakThresholds('')).toEqual([]);
  });
});

describe('§9.3 winstreakGrantFor', () => {
  const TIERS = parseWinstreakThresholds('2:1,3:2,5:2+200');

  it('no tiers match streak values between thresholds', () => {
    expect(winstreakGrantFor(1, TIERS)).toBeNull();
    expect(winstreakGrantFor(4, TIERS)).toBeNull();
  });

  it('exact match for the non-top tiers (x2, x3)', () => {
    expect(winstreakGrantFor(2, TIERS)).toEqual({ threshold: 2, count: 1, bonus: 0 });
    expect(winstreakGrantFor(3, TIERS)).toEqual({ threshold: 3, count: 2, bonus: 0 });
  });

  it('the top tier ("5+") matches at and beyond its threshold, every time', () => {
    expect(winstreakGrantFor(5, TIERS)).toEqual({ threshold: 5, count: 2, bonus: 200 });
    expect(winstreakGrantFor(6, TIERS)).toEqual({ threshold: 5, count: 2, bonus: 200 });
    expect(winstreakGrantFor(100, TIERS)).toEqual({ threshold: 5, count: 2, bonus: 200 });
  });

  it('no tiers at all grants nothing', () => {
    expect(winstreakGrantFor(5, [])).toBeNull();
  });
});

describe('§9.3 randomBoosterType', () => {
  it('is one of the three types', () => {
    for (let i = 0; i < 50; i++) {
      expect(['hammer', 'broom', 'hourglass']).toContain(randomBoosterType());
    }
  });

  it('is injectable and deterministic given a fixed `rand`', () => {
    expect(randomBoosterType(() => 0)).toBe('hammer');
    expect(randomBoosterType(() => 0.34)).toBe('broom');
    expect(randomBoosterType(() => 0.99)).toBe('hourglass');
  });
});

describe('§9.3 useBoosterStore', () => {
  beforeEach(() => {
    useBoosterStore.setState({
      counts: { hammer: 0, broom: 0, hourglass: 0 },
      showcaseGranted: { hammer: false, broom: false, hourglass: false },
      tooltip: null,
      preSelected: null,
    });
  });

  it('grant adds to the count, additively across calls', () => {
    useBoosterStore.getState().grant('hammer', 2);
    useBoosterStore.getState().grant('hammer', 1);
    expect(useBoosterStore.getState().counts.hammer).toBe(3);
  });

  it('consume spends one and reports success; refuses at zero', () => {
    useBoosterStore.getState().grant('broom', 1);
    expect(useBoosterStore.getState().consume('broom')).toBe(true);
    expect(useBoosterStore.getState().counts.broom).toBe(0);
    expect(useBoosterStore.getState().consume('broom')).toBe(false);
    expect(useBoosterStore.getState().counts.broom).toBe(0);
  });

  it('grantShowcase fires exactly once per type, granting + queuing its tooltip', () => {
    expect(useBoosterStore.getState().grantShowcase('hourglass')).toBe(true);
    expect(useBoosterStore.getState().counts.hourglass).toBe(1);
    expect(useBoosterStore.getState().tooltip).toBe('hourglass');
    expect(useBoosterStore.getState().grantShowcase('hourglass')).toBe(false);
    expect(useBoosterStore.getState().counts.hourglass).toBe(1);
  });

  it('dismissTooltip clears it without touching inventory', () => {
    useBoosterStore.getState().grantShowcase('hammer');
    useBoosterStore.getState().dismissTooltip();
    expect(useBoosterStore.getState().tooltip).toBeNull();
    expect(useBoosterStore.getState().counts.hammer).toBe(1);
  });

  it('setPreSelected records the §9.3 pre-level slot default', () => {
    useBoosterStore.getState().setPreSelected('broom');
    expect(useBoosterStore.getState().preSelected).toBe('broom');
    useBoosterStore.getState().setPreSelected(null);
    expect(useBoosterStore.getState().preSelected).toBeNull();
  });
});
