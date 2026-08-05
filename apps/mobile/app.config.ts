import type { ExpoConfig } from 'expo/config';

/**
 * Expo app config (PRD §4.1). Firebase credentials come from the environment —
 * PRD §16: secrets live in EAS/Firebase env config, never in the repo.
 * Copy .env.example to .env for local dev; CI/EAS inject the same names.
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
  android: {
    package: 'com.ashfieldgames.blockmanor',
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
      backgroundColor: '#131830',
    },
  },
  ios: {
    bundleIdentifier: 'com.ashfieldgames.blockmanor',
    supportsTablet: false,
  },
  owner: 'vvr1701',
  extra: {
    eas: { projectId: '38d85265-4670-4f6b-95c2-76c1efebd319' },
    firebase: {
      apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    },
  },
};

export default config;
