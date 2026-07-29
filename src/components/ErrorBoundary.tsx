// src/components/ErrorBoundary.tsx
//
// Catches render-time throws so one broken subtree degrades to an
// explanatory card instead of unmounting the whole app.
//
// The domain layer deliberately throws on contract violations (a
// non-positive principal, an unparseable date), and those calls run inside
// render-time useMemos. Without a boundary React tears the entire tree down
// and the user is left staring at a blank page with no way back except a
// reload — and because state is persisted, a reload can land straight back
// on the same crash. The reset button clears the error so a normal state
// change (fixing the offending input) can re-render the subtree in place.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { ui, colors } from "./ui";

interface Props {
  children: ReactNode;
  /** Shown in the fallback so the user knows which part failed. */
  label?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep a trace in the console for debugging; the UI stays calm.
    console.error("Render error caught by ErrorBoundary:", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { label } = this.props;
    return (
      <div style={styles.card} role="alert">
        <div style={styles.title}>
          {label ? `${label} couldn't be displayed` : "Something went wrong"}
        </div>
        <div style={styles.body}>
          The rest of the app is still working. This usually means a value in
          your settings can't be used — adjust it and this section will come
          back.
        </div>
        <div style={styles.detail}>{error.message}</div>
        <button
          type="button"
          style={styles.button}
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    ...ui.card,
    borderColor: colors.amber,
  },
  title: {
    ...ui.cardTitle,
    marginBottom: 6,
    color: colors.amber,
  },
  body: {
    fontSize: 13,
    lineHeight: 1.5,
    color: colors.textSoft,
    marginBottom: 8,
  },
  detail: {
    fontSize: 11.5,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    color: colors.faint,
    marginBottom: 12,
    wordBreak: "break-word",
  },
  button: {
    ...ui.secondaryButton,
    padding: "7px 14px",
  },
};
