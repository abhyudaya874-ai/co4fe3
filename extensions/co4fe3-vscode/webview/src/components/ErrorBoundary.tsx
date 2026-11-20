import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; /** "row": one transcript item failed; "app": the whole view failed. */ scope: "row" | "app"; label?: string }
interface State { error: Error | null }

/**
 * A render error in one row must cost that row, not the whole view. Before this existed, one bad value in the context card
 * (React error #62) unmounted the entire panel and the chat went blank.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  override componentDidCatch(error: Error): void { console.error(`co4fe3 webview (${this.props.label ?? this.props.scope}):`, error); }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.scope === "row") {
      return <div className="row broken" role="status">Could not show this item{this.props.label ? ` (${this.props.label})` : ""}. <span className="muted">{error.message.slice(0, 120)}</span></div>;
    }
    return (
      <div className="app-broken" role="alert">
        <p><strong>co4fe3 could not draw the chat.</strong></p>
        <p className="muted">{error.message.slice(0, 200)}</p>
        <button className="btn" onClick={() => location.reload()}>Reload the view</button>
      </div>
    );
  }
}
