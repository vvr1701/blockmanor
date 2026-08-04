import Constants from 'expo-constants';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';

/**
 * Firebase wiring (PRD §4.1) — configuration only.
 *
 * Stage 0 provisions the project and proves config resolution. No Auth, Firestore,
 * Messaging, or Remote Config calls yet: those arrive with the features that need
 * them (anonymous auth + daily board in Stage 1, §8).
 */
export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

function readConfig(): FirebaseConfig | null {
  const raw = Constants.expoConfig?.extra?.['firebase'] as Partial<FirebaseConfig> | undefined;
  if (!raw) return null;
  const required = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
  ] as const;
  for (const key of required) {
    if (!raw[key]) return null;
  }
  return raw as FirebaseConfig;
}

/** True when the dev project's env vars are present (see .env.example). */
export function isFirebaseConfigured(): boolean {
  return readConfig() !== null;
}

/**
 * Initialises the Firebase app once. Returns null when unconfigured so the app
 * still boots offline — PRD §12.4: levels stay playable without connectivity.
 */
export function getFirebaseApp(): FirebaseApp | null {
  const config = readConfig();
  if (!config) return null;
  return getApps().length > 0 ? getApp() : initializeApp(config);
}
