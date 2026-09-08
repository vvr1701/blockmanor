/**
 * `appInfo.ts` — PRD §12.5's version-compare trap and §12.5's store
 * link-out. Each acceptance clause below gets its OWN assertion (§0 rule
 * 6a): "1.10 is correctly newer than 1.9" is not the same clause as "a
 * below-minimum build is blocked" (that lives in `app.render.test.tsx`) —
 * this file only proves the comparison primitive itself.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compareVersions,
  getBuildLabel,
  getInstalledVersion,
  getStoreUrl,
  isBelowMinVersion,
} from '../src/services/appInfo';

describe('compareVersions (PRD §12.5 — numeric, not lexicographic)', () => {
  it('THE NAMED TRAP: "1.10" is correctly newer than "1.9" (string compare gets this backwards)', () => {
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
    // Prove the trap is real: naive string compare on these two literals
    // disagrees with the numeric answer, so this test cannot pass by
    // accident on an implementation that silently reverted to it.
    expect('1.10' < '1.9').toBe(true);
  });

  it('equal versions compare equal', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('a missing trailing component reads as 0 — "1.2" equals "1.2.0"', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('a lower major version is older regardless of minor/patch', () => {
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });

  it('a higher patch on an equal major/minor is newer', () => {
    expect(compareVersions('1.2.4', '1.2.3')).toBeGreaterThan(0);
  });

  it('a malformed component degrades to 0 rather than throwing or NaN-poisoning the result', () => {
    expect(() => compareVersions('1.x.0', '1.0.0')).not.toThrow();
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
  });
});

describe('isBelowMinVersion', () => {
  it('true when the installed build is strictly older', () => {
    expect(isBelowMinVersion('1.9', '1.10')).toBe(true);
  });

  it('false when the installed build already meets the minimum', () => {
    expect(isBelowMinVersion('1.10', '1.10')).toBe(false);
  });

  it('false when the installed build exceeds the minimum', () => {
    expect(isBelowMinVersion('2.0.0', '1.10')).toBe(false);
  });
});

describe('getInstalledVersion', () => {
  afterEach(() => {
    Constants.expoConfig!.version = '0.1.0';
  });

  it('reads the version baked into app.config.ts via Constants', () => {
    Constants.expoConfig!.version = '3.4.5';
    expect(getInstalledVersion()).toBe('3.4.5');
  });

  it('falls back to "0.0.0" rather than throwing when the config is absent', () => {
    const original = Constants.expoConfig;
    // @ts-expect-error — simulating a config-less runtime
    Constants.expoConfig = undefined;
    try {
      expect(getInstalledVersion()).toBe('0.0.0');
    } finally {
      Constants.expoConfig = original;
    }
  });
});

describe('getStoreUrl (PRD §12.5 — a working link-out, not a purchase flow)', () => {
  afterEach(() => {
    Platform.OS = 'android';
  });

  it('Android: a real Play Store URL built from the app package id', () => {
    Platform.OS = 'android';
    expect(getStoreUrl()).toBe(
      'https://play.google.com/store/apps/details?id=com.vvr1701.blockmanor',
    );
  });

  it('iOS: a working (if generic) App Store URL — no App Store id exists yet', () => {
    Platform.OS = 'ios';
    const url = getStoreUrl();
    expect(url.startsWith('https://apps.apple.com/')).toBe(true);
  });
});

describe('getBuildLabel (PRD §12.1 — "the version/build footer matches the running build")', () => {
  afterEach(() => {
    delete Constants.expoConfig!.android!.versionCode;
    delete Constants.expoConfig!.ios!.buildNumber;
  });

  it('reads android.versionCode when present', () => {
    Constants.expoConfig!.android!.versionCode = 42;
    expect(getBuildLabel()).toBe('42');
  });

  it('falls back to ios.buildNumber when there is no android versionCode', () => {
    Constants.expoConfig!.ios!.buildNumber = '7';
    expect(getBuildLabel()).toBe('7');
  });

  it('falls back to "1" rather than inventing a number when neither is configured', () => {
    expect(getBuildLabel()).toBe('1');
  });

  it('prefers android.versionCode over ios.buildNumber when both are set', () => {
    Constants.expoConfig!.android!.versionCode = 42;
    Constants.expoConfig!.ios!.buildNumber = '7';
    expect(getBuildLabel()).toBe('42');
  });
});
