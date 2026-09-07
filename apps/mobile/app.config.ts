import type { ExpoConfig } from 'expo/config';

/**
 * Expo app config (PRD §4.1). Firebase is `@react-native-firebase/*`, whose
 * config plugin bakes `google-services.json` into the native project at build
 * time — the file is git-ignored (PRD §16: credentials never in the repo), so
 * fetch it from the Firebase console before a build. No EXPO_PUBLIC_FIREBASE_*
 * env vars any more: the native SDK reads the plist/json, not `extra`.
 */
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
    '@react-native-firebase/app',
    '@react-native-firebase/crashlytics',
    // RNFB's iOS pods are static frameworks; use_frameworks! is required.
    ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
  ],
  android: {
    package: 'com.vvr1701.blockmanor',
    googleServicesFile: './google-services.json',
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
  },
  owner: 'vvr1701',
  extra: {
    eas: { projectId: '38d85265-4670-4f6b-95c2-76c1efebd319' },
  },
};

export default config;
