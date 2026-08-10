import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; onReset: () => void };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[AURA] screen crashed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center px-8 text-center gap-4">
          <p className="font-serif text-2xl italic">Something went wrong</p>
          <p className="text-xs text-muted-foreground break-words max-w-full">
            {this.state.error.message || String(this.state.error)}
          </p>
          <button
            onClick={() => { this.setState({ error: null }); this.props.onReset(); }}
            className="h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em]"
          >Back to Home</button>
        </div>
      );
    }
    return this.props.children;
  }
}
