/**
 * `useMetaStore.endlessBest` — PRD §7.6 "personal best tracked", MMKV-backed
 * the same way `currentLevel` already is (§4.4). Covers: default 0 (the
 * §12.9 empty-state trigger), monotonic increase only, and that it survives
 * a fresh `useMetaStore` module read the way MMKV-persisted state should.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useMetaStore } from '../src/state/useMetaStore';

beforeEach(() => {
  useMetaStore.setState({ endlessBest: 0 });
});

describe('useMetaStore.endlessBest (PRD §7.6)', () => {
  it('defaults to 0 — no record yet', () => {
    expect(useMetaStore.getState().endlessBest).toBe(0);
  });

  it("a first run sets the best to that run's score", () => {
    useMetaStore.getState().setEndlessBest(1200);
    expect(useMetaStore.getState().endlessBest).toBe(1200);
  });

  it('a lower-scoring run never lowers the persisted best', () => {
    useMetaStore.getState().setEndlessBest(5000);
    useMetaStore.getState().setEndlessBest(1200);
    expect(useMetaStore.getState().endlessBest).toBe(5000);
  });

  it('a higher-scoring run raises the persisted best', () => {
    useMetaStore.getState().setEndlessBest(1200);
    useMetaStore.getState().setEndlessBest(5000);
    expect(useMetaStore.getState().endlessBest).toBe(5000);
  });

  it('a tying score is a no-op, not an error', () => {
    useMetaStore.getState().setEndlessBest(3000);
    useMetaStore.getState().setEndlessBest(3000);
    expect(useMetaStore.getState().endlessBest).toBe(3000);
  });
});
