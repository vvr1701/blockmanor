/**
 * `expo-application` stand-in (§12.1 build footer). A plain mutable object so a
 * test can set `nativeBuildVersion` and restore it. `null` by default — the
 * value the real module reports outside a native build (Expo Go, tests).
 */
export let nativeBuildVersion: string | null = null;

export function __setNativeBuildVersion(v: string | null): void {
  nativeBuildVersion = v;
}
