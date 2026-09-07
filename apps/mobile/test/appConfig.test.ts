import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * B-3: the `@react-native-firebase/app` config plugin THROWS at prebuild if it
 * is enabled and its platform's credential file is missing — which would break
 * `eas build -p android --profile preview`, the command the operator uses for
 * every device check, on any machine without the git-ignored credentials. So
 * the plugin is wired only when a file is actually present, and each
 * `googleServicesFile` is set only for the platform whose file exists.
 */
async function loadConfig(): Promise<{
  plugins?: unknown[];
  android?: { googleServicesFile?: string };
  ios?: { googleServicesFile?: string };
}> {
  // The config reads the env at module scope, so each case needs a fresh one.
  vi.resetModules();
  const mod = (await import('../app.config')) as {
    default: Awaited<ReturnType<typeof loadConfig>>;
  };
  return mod.default;
}

// Point at paths that CANNOT exist rather than deleting the vars. Deleting
// them makes `app.config.ts` fall back to `./google-services.json`, which is
// gitignored and therefore ABSENT on CI and in a fresh worktree but PRESENT in
// a checkout that has real credentials — so the "no credential file" case
// passed everywhere it was written and failed on the one machine that matters.
// An environment-dependent test is worse than no test: it is green where it is
// wrong and red where it is right.
const NO_SUCH = `${process.cwd()}/__no_such_credential__`;

beforeEach(() => {
  process.env['GOOGLE_SERVICES_JSON'] = `${NO_SUCH}.json`;
  process.env['GOOGLE_SERVICES_PLIST'] = `${NO_SUCH}.plist`;
});

describe('app.config.ts Firebase wiring', () => {
  it('omits the Firebase plugin (and both googleServicesFile keys) when no credential file exists', async () => {
    const config = await loadConfig();
    expect(config.plugins).not.toContain('@react-native-firebase/app');
    expect(config.plugins).not.toContain('@react-native-firebase/crashlytics');
    expect(config.android?.googleServicesFile).toBeUndefined();
    expect(config.ios?.googleServicesFile).toBeUndefined();
  });

  // The MIXED case — the realistic Stage-1 one, since the iOS plist needs an
  // Apple Developer account CLAUDE.md records as deferred. A QA audit found
  // only the neither/both cases tested, while the docblock promised a clean
  // offline fallback "when a file is absent" — which is false here: one plugin
  // entry registers both platforms' mods, so the plist-less iOS mod throws.
  // This pins what actually happens rather than what we wish happened.
  it('android-only credentials: the plugin is wired and only android gets a file', async () => {
    process.env['GOOGLE_SERVICES_JSON'] = `${process.cwd()}/package.json`;
    process.env['GOOGLE_SERVICES_PLIST'] = `${NO_SUCH}.plist`;
    const config = await loadConfig();
    expect(config.plugins).toEqual(
      expect.arrayContaining(['@react-native-firebase/app', '@react-native-firebase/crashlytics']),
    );
    expect(config.android?.googleServicesFile).toBe(`${process.cwd()}/package.json`);
    // Left unset ON PURPOSE: setting it would point the iOS mod at a file that
    // is not a plist. `eas build -p android` runs android mods only and is
    // fine; `-p ios` throws until the real plist lands, which is the same
    // thing already blocking iOS.
    expect(config.ios?.googleServicesFile).toBeUndefined();
  });

  it('wires each platform from its EAS file secret when the file is there', async () => {
    // Stand-ins for the real credential files, which are git-ignored and never
    // present in CI — any existing readable path proves the wiring.
    process.env['GOOGLE_SERVICES_JSON'] = `${process.cwd()}/package.json`;
    process.env['GOOGLE_SERVICES_PLIST'] = `${process.cwd()}/app.config.ts`;
    const config = await loadConfig();
    expect(config.plugins).toContain('@react-native-firebase/app');
    expect(config.plugins).toContain('@react-native-firebase/crashlytics');
    expect(config.android?.googleServicesFile).toBe(`${process.cwd()}/package.json`);
    expect(config.ios?.googleServicesFile).toBe(`${process.cwd()}/app.config.ts`);
  });
});
