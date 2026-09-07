/**
 * `setLevelStars` / `claimChest` — the §7.10 data the level map's medallions
 * and chests render. Persistence itself goes through zustand's own
 * MMKV-backed `persist`, so these exercise the store, then a real
 * rehydrate for the round trip.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { mmkvStorage } from '../src/state/persist';
import { useMetaStore } from '../src/state/useMetaStore';

beforeEach(() => {
  useMetaStore.setState({ stars: {}, chestsClaimed: {}, ownedFrames: [] });
});

describe('§7.10 per-level stars', () => {
  it('records a level star count keyed by level id', () => {
    useMetaStore.getState().setLevelStars(12, 2);
    expect(useMetaStore.getState().stars).toEqual({ '12': 2 });
  });

  it('keeps the BEST star count — a worse replay never demotes a medallion', () => {
    useMetaStore.getState().setLevelStars(12, 3);
    useMetaStore.getState().setLevelStars(12, 1);
    expect(useMetaStore.getState().stars['12']).toBe(3);
  });

  it('still improves on a previous best', () => {
    useMetaStore.getState().setLevelStars(12, 1);
    useMetaStore.getState().setLevelStars(12, 3);
    expect(useMetaStore.getState().stars['12']).toBe(3);
  });

  it('survives a truncated MMKV blob leaving `stars` null instead of throwing', () => {
    useMetaStore.setState({ stars: null as unknown as Record<string, number> });
    expect(() => useMetaStore.getState().setLevelStars(12, 2)).not.toThrow();
    expect(useMetaStore.getState().stars).toEqual({ '12': 2 });
  });

  it('round-trips through the REAL persist/rehydrate path, not an in-memory assertion', async () => {
    useMetaStore.getState().setLevelStars(7, 3);
    useMetaStore.getState().claimChest(10, 'ivy_wreath');
    const image = mmkvStorage.getItem('meta');
    expect(typeof image).toBe('string');

    useMetaStore.setState({ stars: {}, chestsClaimed: {}, ownedFrames: [] });
    mmkvStorage.setItem('meta', String(image));
    await useMetaStore.persist.rehydrate();

    expect(useMetaStore.getState().stars['7']).toBe(3);
    expect(useMetaStore.getState().chestsClaimed['10']).toBe(true);
    expect(useMetaStore.getState().ownedFrames).toEqual(['ivy_wreath']);
  });
});

describe('§7.10 chest claims', () => {
  it('marks the chest claimed and grants exactly one frame', () => {
    useMetaStore.getState().claimChest(20, 'garden_gate');
    expect(useMetaStore.getState().chestsClaimed).toEqual({ '20': true });
    expect(useMetaStore.getState().ownedFrames).toEqual(['garden_gate']);
  });

  it('is idempotent — no duplicate frame ids', () => {
    useMetaStore.getState().claimChest(20, 'garden_gate');
    useMetaStore.getState().claimChest(20, 'garden_gate');
    expect(useMetaStore.getState().ownedFrames).toEqual(['garden_gate']);
  });

  it('accumulates distinct frames across chests', () => {
    useMetaStore.getState().claimChest(10, 'ivy_wreath');
    useMetaStore.getState().claimChest(20, 'garden_gate');
    expect(useMetaStore.getState().ownedFrames).toEqual(['ivy_wreath', 'garden_gate']);
  });

  it('survives a truncated MMKV blob leaving the claim maps null', () => {
    useMetaStore.setState({
      chestsClaimed: null as unknown as Record<string, boolean>,
      ownedFrames: null as unknown as string[],
    });
    expect(() => useMetaStore.getState().claimChest(10, 'ivy_wreath')).not.toThrow();
    expect(useMetaStore.getState().ownedFrames).toEqual(['ivy_wreath']);
  });
});
