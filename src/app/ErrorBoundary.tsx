import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** A chunk that no longer exists is fixed by reloading, so say so plainly. */
  stale: boolean;
}

/**
 * The last line of defence. Without this, one render error leaves a blank white page with no
 * explanation and no way out — the worst thing a room full of people waiting can be shown.
 *
 * The common real-world case isn't a code bug: it's a deploy landing while someone has the old
 * page open, so a lazily-imported chunk 404s. That one is cured by reloading, and is told apart
 * from a genuine crash because it deserves a different message.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, stale: false };

  static getDerivedStateFromError(error: Error): State {
    const text = `${error.name} ${error.message}`;
    const stale = /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(
      text,
    );
    return { error, stale };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("render_error", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error, stale } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="crash">
        <div className="crash__box frame">
          <p className="eyebrow">✦ {stale ? "New version available" : "Something broke"}</p>
          <h1 className="crash__title pixel">{stale ? "Reload to continue" : "The projector jammed"}</h1>
          <p className="crash__body">
            {stale
              ? "STARBYTE was updated while this page was open, so part of it could no longer be loaded. Reloading picks up the new version."
              : "Something in the page failed unexpectedly. Reloading usually clears it — your room is on the server, so rejoining with the same link puts you back where you were."}
          </p>
          <div className="crash__actions">
            <button type="button" className="pbtn pbtn--primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <a className="pbtn pbtn--ghost" href="/">
              Go home
            </a>
          </div>
          {!stale && (
            <details className="crash__details">
              <summary>Technical detail</summary>
              <pre>{`${error.name}: ${error.message}`}</pre>
            </details>
          )}
        </div>
      </main>
    );
  }
}
