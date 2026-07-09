import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    // Report the crash to Sentry (no-op when Sentry isn't initialised). Keeps our own fallback UI below.
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="screen" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card card-pad" style={{ textAlign: "center", maxWidth: 360 }}>
            <h2 style={{ marginBottom: 10 }}>Something went wrong</h2>
            <p className="muted" style={{ fontSize: 14, marginBottom: 20 }}>
              An unexpected error occurred. Reloading usually fixes it.
            </p>
            <button className="btn btn-volt" onClick={() => location.reload()}>Reload</button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
