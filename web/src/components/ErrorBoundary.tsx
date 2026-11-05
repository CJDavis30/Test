import { Component, type ReactNode } from 'react';

/**
 * If anything in the interface throws, show a calm recovery screen instead of a blank window.
 * Everything is saved on disk as it happens, so reloading loses nothing.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error, info: { componentStack?: string | null }) { console.error('Plexus UI error:', error, info.componentStack); }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p>Your cases and findings are saved. Reload to carry on where you left off.</p>
          <pre className="selectable">{String(this.state.error.message || this.state.error).slice(0, 400)}</pre>
          <div className="crash-actions">
            <button className="btn primary" onClick={() => location.reload()}>Reload Plexus</button>
            <button className="btn" onClick={() => this.setState({ error: null })}>Try to continue</button>
          </div>
        </div>
      </div>
    );
  }
}
