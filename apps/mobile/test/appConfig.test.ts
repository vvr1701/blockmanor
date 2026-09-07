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

beforeEach(() => {
  delete process.env['GOOGLE_SERVICES_JSON'];
  delete process.env['GOOGLE_SERVICES_PLIST'];
});

describe('app.config.ts Firebase wiring', () => {
  it('omits the Firebase plugin (and both googleServicesFile keys) when no credential file exists', async () => {
    const config = await loadConfig();
    expect(config.plugins).not.toContain('@react-native-firebase/app');
    expect(config.plugins).not.toContain('@react-native-firebase/crashlytics');
    expect(config.android?.googleServicesFile).toBeUndefined();
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
