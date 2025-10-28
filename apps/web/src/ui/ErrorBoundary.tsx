import { Component, type ErrorInfo, type ReactNode } from "react";
import { useRouteError } from "react-router-dom";

type BoundaryProps = {
  children?: ReactNode;
  title?: string;
  onReset?: () => void;
};

type BoundaryState = {
  error: Error | null;
};

type FallbackProps = {
  error: Error;
  onReset: () => void;
  title?: string;
};

function ErrorFallback({ error, onReset, title }: FallbackProps) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{title ?? "Something went wrong"}</h2>
          <p className="mt-1 text-sm">{error.message || "Unexpected error encountered."}</p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-red-600 bg-white px-3 py-1 text-sm font-medium text-red-600 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Try again
        </button>
      </div>
      {import.meta.env.DEV && error.stack ? (
        <pre className="mt-4 max-h-64 overflow-auto rounded bg-red-900/10 p-3 text-xs text-red-900">
          {error.stack}
        </pre>
      ) : null}
    </div>
  );
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, info);
  }

  private handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (error) {
      return <ErrorFallback error={error} onReset={this.handleReset} title={this.props.title} />;
    }
    return (this.props.children as ReactNode) ?? null;
  }
}

function RouteErrorBoundary() {
  const routeError = useRouteError();
  const error =
    routeError instanceof Error
      ? routeError
      : new Error(routeError ? String(routeError) : "Unknown routing error");
  return (
    <ErrorFallback
      error={error}
      onReset={() => {
        window.location.assign(window.location.pathname);
      }}
    />
  );
}

export default RouteErrorBoundary;
export { Boundary as ErrorBoundary };
