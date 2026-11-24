import { Button } from "@/components/ui/button";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { panel } from "./styles";

interface ErrorBoundaryProps {
  children: ReactNode;
  scope?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Isolates unexpected render exceptions so the user can recover without losing the whole session. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Diffcheck${this.props.scope ? `:${this.props.scope}` : ""}] Render error:`, error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const scopeLabel = this.props.scope ? `in ${this.props.scope}` : "";
    return (
      <div className={`${panel} mx-auto my-8 flex max-w-lg flex-col gap-3 p-5`} role="alert">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-remove/25 bg-remove-tint text-remove" aria-hidden>
            <AlertTriangleIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Something went wrong {scopeLabel}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground wrap-anywhere">
              {error.message || "An unexpected display error occurred."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={this.reset}>
            <RotateCcwIcon aria-hidden /> Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
      </div>
    );
  }
}
