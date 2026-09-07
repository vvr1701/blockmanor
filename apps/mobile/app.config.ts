import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ExpoConfig } from 'expo/config';

/**
 * Expo app config (PRD §4.1). Firebase is `@react-native-firebase/*`, whose
 * config plugin bakes the native credential files into the project at build
 * time. Both files are git-ignored (PRD §16: credentials never in the repo):
 *
 *   Android  google-services.json          EAS file secret GOOGLE_SERVICES_JSON
 *   iOS      GoogleService-Info.plist      EAS file secret GOOGLE_SERVICES_PLIST
 *
 * EAS injects a file secret as an absolute path in the env var of the same
 * name, so a build picks the file up with no repo change; locally the files
 * sit next to this config. There are no EXPO_PUBLIC_FIREBASE_* vars any more —
 * the native SDKs read these files, not `extra`.
 *
 * The plugin THROWS if it is enabled and its platform's file is missing, which
 * would break `eas build -p android --profile preview` on any machine without
 * the credentials. So Firebase is wired only when a credential file is
 * actually present; without one the app builds and boots into the §12.4
 * offline path (Home shows "not configured"), exactly as it does today.
 */
// Expo evaluates this config with the project dir as cwd; so does vitest.
const localPath = (file: string): string => (isAbsolute(file) ? file : join(process.cwd(), file));
const googleServicesJson = localPath(process.env.GOOGLE_SERVICES_JSON ?? './google-services.json');
const googleServicesPlist = localPath(
  process.env.GOOGLE_SERVICES_PLIST ?? './GoogleService-Info.plist',
);
const hasAndroidFirebase = existsSync(googleServicesJson);
const hasIosFirebase = existsSync(googleServicesPlist);
const firebasePlugins: NonNullable<ExpoConfig['plugins']> =
  hasAndroidFirebase || hasIosFirebase
    ? [
        '@react-native-firebase/app',
        // No JS import: this package exists for the Crashlytics Gradle plugin
        // and pod, which is what makes native crash reporting work (§4.1).
        // The §12.8 JS error boundary lands on its own branch.
        '@react-native-firebase/crashlytics',
      ]
    : [];
const config: ExpoConfig = {
  name: 'Block Manor',
  slug: 'blockmanor',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'blockmanor',
  userInterfaceStyle: 'dark',
  // New Architecture is the default from SDK 57 — no opt-in key needed.
  icon: './assets/icon.png',
  // §15 --night. A themed splash needs the expo-splash-screen plugin; it lands
  // with the design system in Stage 1, not for a placeholder screen.
  backgroundColor: '#131830',
  plugins: [
    ...firebasePlugins,
    // RNFB's iOS pods are static frameworks; use_frameworks! is required.
    ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
  ],
  android: {
    package: 'com.vvr1701.blockmanor',
    ...(hasAndroidFirebase ? { googleServicesFile: googleServicesJson } : {}),
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
      backgroundColor: '#131830',
    },
  },
  ios: {
    bundleIdentifier: 'com.vvr1701.blockmanor',
    supportsTablet: false,
    ...(hasIosFirebase ? { googleServicesFile: googleServicesPlist } : {}),
  },
  owner: 'vvr1701',
  extra: {
    eas: { projectId: '38d85265-4670-4f6b-95c2-76c1efebd319' },
  },
};

export default config;
