import { MMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

/** MMKV-backed persistence for Zustand (PRD §4.4). */
const storage = new MMKV({ id: 'blockmanor' });

export const mmkvStorage: StateStorage = {
  getItem: (name) => storage.getString(name) ?? null,
  setItem: (name, value) => storage.set(name, value),
  removeItem: (name) => storage.delete(name),
};
