/**
 * vitest setup — see vitest.config.ts. Tells React's `act()` (used by the
 * render-tree tests, `react-test-renderer`) that this IS a test environment,
 * silencing its "not configured to support act" warning.
 */
interface GlobalWithReactAct {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

(globalThis as GlobalWithReactAct).IS_REACT_ACT_ENVIRONMENT = true;

// Metro/Expo inject `__DEV__` at bundle time; vitest doesn't. Production-like
// default so render tests exercise the same path a release build takes.
interface GlobalWithDevFlag {
  __DEV__?: boolean;
}

(globalThis as GlobalWithDevFlag).__DEV__ = false;
