// src/components/OverrideModal.tsx
import { useState, useEffect } from "react";
import type { FutureEvent } from "../domain/types";

interface Props {
  event: FutureEvent | null;
  onSave: (amount: number | null) => void;
  onClose: () => void;
}

export default function OverrideModal({ event, onSave, onClose }: Props) {
  const [val, setVal] = useState<string>("");

  useEffect(() => {
    if (event) {
      setVal(event.isOverridden ? String(event.effectiveAmount) : "");
    }
  }, [event]);

  if (!event) return null;

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <h3 style={{ marginTop: 0 }}>
          Override: {event.ruleName}
          <br />
          <span style={{ fontSize: 13, fontWeight: 400 }}>{event.date}</span>
        </h3>

        <div style={styles.row}>
          <span>Default Amount:</span>
          <b>{formatMoney(event.defaultAmount)}</b>
        </div>

        <label style={styles.label}>
          Override Amount:
          <input
            type="number"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="(leave blank for none)"
            style={styles.input}
          />
        </label>

        <div style={styles.buttonRow}>
          <button
            onClick={() => {
              if (val.trim() === "") onSave(null);
              else onSave(Number(val));
            }}
            style={styles.saveBtn}
          >
            Save
          </button>

          <button onClick={onClose} style={styles.cancelBtn}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function formatMoney(amount: number): string {
  if (!Number.isFinite(amount)) return "$0.00";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const styles: Record<string, any> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999,
  },
  modal: {
    background: "#111827",
    padding: 20,
    borderRadius: 12,
    width: "92%",
    maxWidth: 380,
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    maxHeight: "90vh",
    overflowY: "auto",
    border: "1px solid #1f2937",
    color: "#e5e7eb",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 14,
    fontSize: 15,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    marginBottom: 12,
    fontSize: 14,
  },
  input: {
    marginTop: 6,
    padding: 8,
    fontSize: 16,
    background: "#020617",
    color: "#e5e7eb",
    border: "1px solid #4b5563",
    borderRadius: 8,
  },
  buttonRow: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 16,
  },
  saveBtn: {
    padding: "8px 14px",
    background: "#2196f3",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 15,
  },
  cancelBtn: {
    padding: "8px 14px",
    background: "#4b5563",
    border: "none",
    borderRadius: 6,
    fontSize: 15,
    color: "#e5e7eb",
  },
};
