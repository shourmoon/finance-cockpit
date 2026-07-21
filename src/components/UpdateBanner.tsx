// src/components/UpdateBanner.tsx
//
// Bottom banner shown when a new service-worker version is waiting. Pure
// and props-driven so it can be unit-tested without the PWA runtime; the
// wiring to virtual:pwa-register lives in main.tsx.

export default function UpdateBanner({
  visible,
  onRefresh,
  onDismiss,
}: {
  visible: boolean;
  onRefresh: () => void;
  onDismiss: () => void;
}) {
  if (!visible) return null;

  return (
    <div style={styles.banner} role="status">
      <span style={styles.text}>A new version is available.</span>
      <div style={styles.actions}>
        <button style={styles.refreshButton} onClick={onRefresh}>
          Refresh
        </button>
        <button
          style={styles.dismissButton}
          aria-label="Dismiss update notice"
          onClick={onDismiss}
        >
          Later
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    position: "fixed",
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 12,
    background: "#1d4ed8",
    color: "#f8fafc",
    boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
    maxWidth: 576,
    margin: "0 auto",
  },
  text: {
    fontSize: 14,
    fontWeight: 500,
  },
  actions: {
    display: "flex",
    gap: 8,
    flex: "0 0 auto",
  },
  refreshButton: {
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    border: "none",
    background: "#f8fafc",
    color: "#1d4ed8",
    cursor: "pointer",
  },
  dismissButton: {
    padding: "6px 12px",
    fontSize: 13,
    borderRadius: 8,
    border: "1px solid rgba(248,250,252,0.5)",
    background: "transparent",
    color: "#f8fafc",
    cursor: "pointer",
  },
};
