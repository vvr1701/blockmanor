/**
 * §12.8 global error boundary — "a thrown render error is caught by the
 * boundary, shows the restart screen rather than a white screen, and reports
 * to Crashlytics."
 *
 * A class component on purpose: `getDerivedStateFromError` /
 * `componentDidCatch` have no hook equivalent, and this is the one place in
 * the app that needs them.
 *
 * It renders a RESTART, not a reload: resetting `error` remounts the subtree,
 * and every screen rehydrates from the §4.4 MMKV store, so a player lands back
 * where they were rather than at a cold start. §12.9's rule holds here too —
 * exactly one action, never a dead end.
 */
import React from 'react';
import { recordError } from '../services/firebase';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Rendered in place of `children` once a descendant throws. */
  fallback: (reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // The component stack is the part that makes a Crashlytics report
    // actionable — a bare message rarely says WHICH screen died.
    recordError(error, info.componentStack ?? undefined);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    return this.state.error ? this.props.fallback(this.reset) : this.props.children;
  }
}
