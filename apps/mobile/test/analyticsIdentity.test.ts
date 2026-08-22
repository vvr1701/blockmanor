import { MMKV } from 'react-native-mmkv';
import { describe, expect, it, vi } from 'vitest';
import {
  installId,
  loadOrCreateInstallId,
  newId,
  sessionId,
} from '../src/services/analyticsIdentity';

/**
 * §14 requirement 3: "identity before auth exists." No PII in either id —
 * both are opaque random strings, asserted here only by shape.
 */
describe('analyticsIdentity', () => {
  it('installId is written to the persisted MMKV store under a stable key', () => {
    const storage = new MMKV({ id: 'blockmanor' });
    expect(storage.getString('analytics.installId')).toBe(installId);
  });

  it('installId survives a simulated restart (persisted id read back, not regenerated)', () => {
    // `loadOrCreateInstallId()` is exactly what module load calls once at
    // real app boot; calling it again here simulates a second cold start
    // against the same (already-seeded) MMKV store.
    const first = loadOrCreateInstallId();
    const second = loadOrCreateInstallId();
    expect(second).toBe(first);
    expect(second).toBe(installId);
  });

  it('sessionId is a non-empty opaque string, distinct from installId', () => {
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(0);
    expect(sessionId).not.toBe(installId);
  });

  it('newId produces distinct ids across calls (the freshness mechanism)', () => {
    const ids = new Set(Array.from({ length: 20 }, () => newId()));
    expect(ids.size).toBe(20);
  });
});

describe('analyticsIdentity — session freshness across a real cold start', () => {
  it('two independent module evaluations (two cold starts) get different sessionIds', async () => {
    vi.resetModules();
    const first = await import('../src/services/analyticsIdentity');
    vi.resetModules();
    const second = await import('../src/services/analyticsIdentity');
    expect(second.sessionId).not.toBe(first.sessionId);
  });
  // Note: installId's "survives a restart" guarantee is proven above via
  // `loadOrCreateInstallId()` directly, NOT via `vi.resetModules()` here —
  // resetModules also re-evaluates the mocked `react-native-mmkv` module,
  // wiping its in-memory store, which would make a real device restart's
  // persistence look broken when it isn't (a real device restart does NOT
  // wipe MMKV's on-disk file the way resetting this test double does).
});
