/**
 * §12.4's connectivity signal, derived rather than polled.
 *
 * Deliberately NOT `@react-native-community/netinfo`: that is a native module,
 * i.e. a new prebuild and another thing that can break an EAS build, bought to
 * answer a question the app can already answer. What §12.4 actually needs is
 * "did the last thing that needed the network work?" — a reachability flag is
 * a worse proxy for that anyway (a captive portal reports connected, and a
 * connected device with a dead Firebase project is still offline as far as the
 * Daily tile is concerned).
 *
 * So: every network-touching path reports its outcome here, and the UI reads
 * the last one. §8.3's daily client is the first real reporter; the analytics
 * queue is the second.
 *
 * ponytail: derived signal, not a reachability API — swap for netinfo only if a
 * screen ever needs to know about connectivity BEFORE it has tried anything.
 */
import { useSyncExternalStore } from 'react';

type Listener = () => void;

let online = true;
const listeners = new Set<Listener>();

/** Called by anything that just succeeded or failed a network round trip. */
export function reportNetworkResult(ok: boolean): void {
  if (online === ok) return;
  online = ok;
  for (const l of listeners) l();
}

export function isOnline(): boolean {
  return online;
}

/** Test-only: the module-level flag outlives a test file otherwise. */
export function resetConnectivity(): void {
  online = true;
  listeners.clear();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** §12.4: fires each time the app goes from offline back to online. */
export function onReconnect(listener: () => void): () => void {
  return subscribe(() => {
    if (online) listener();
  });
}

/** Re-renders only when the flag actually flips — `reportNetworkResult`
 * early-returns on an unchanged value, so a failing poll cannot thrash the UI. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, isOnline);
}
