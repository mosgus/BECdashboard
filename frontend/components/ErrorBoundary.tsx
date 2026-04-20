"use client";
import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { hasError: boolean }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-sm">
            <p className="mb-2 text-3xl">Something went wrong</p>
            <p className="mb-4 text-sm text-[var(--color-muted)]">
              An unexpected error occurred. Please reload the page.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
