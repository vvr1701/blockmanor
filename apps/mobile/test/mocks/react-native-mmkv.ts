/**
 * Minimal `react-native-mmkv` stand-in for render-tree tests — see
 * vitest.config.ts. The real package is a native module and throws outside
 * an RN runtime; `useMetaStore` (§4.4) constructs one at module load
 * (`src/state/persist.ts`), so any test importing that store transitively
 * needs this. In-memory only — persistence itself is out of scope for a
 * unit test; the contract this mock has to honor is just `getString` /
 * `set` / `delete` round-tripping within one test run, and separate `id`s
 * getting separate stores (real MMKV's own guarantee).
 */

const instances = new Map<string, Map<string, string>>();

export class MMKV {
  private readonly store: Map<string, string>;

  constructor(config: { id: string }) {
    let store = instances.get(config.id);
    if (!store) {
      store = new Map();
      instances.set(config.id, store);
    }
    this.store = store;
  }

  getString(key: string): string | undefined {
    return this.store.get(key);
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}
