import { useState } from "react";
import type { FutureEvent } from "../domain/types";
// Use the shared date formatter so the modal displays dates consistently
import { formatDate } from "../utils/dates";
import { ui, colors } from "./ui";

interface Props {
  event: FutureEvent | null;
  onSave: (amount: number | null) => void;
  onClose: () => void;
}

export default function OverrideModal({ event, onSave, onClose }: Props) {
  const [val, setVal] = useState<string>("");

  // Reset the input when a different event is shown — the render-time
  // state-adjustment pattern (no effect, no cascading re-render).
  const [prevEvent, setPrevEvent] = useState<FutureEvent | null>(null);
  if (event !== prevEvent) {
    setPrevEvent(event);
    if (event) {
      setVal(event.isOverridden ? String(event.effectiveAmount) : "");
    }
  }

  if (!event) return null;

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <h3 style={{ ...ui.cardTitle, marginBottom: 10 }}>
          Override: {event.ruleName}
          <br />
          <span style={{ fontSize: 13, fontWeight: 400, color: colors.muted }}>
            {formatDate(event.date)}
          </span>
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
  backdrop: ui.modalBackdrop,
  modal: ui.modalSurface,
  row: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 12,
    fontSize: 14,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 12,
    fontSize: 13,
    color: colors.muted,
  },
  input: { ...ui.input, marginTop: 2 },
  buttonRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 16,
  },
  saveBtn: { ...ui.primaryButton, flex: 1, padding: "9px 14px", fontSize: 14 },
  cancelBtn: { ...ui.secondaryButton, flex: 1, padding: "9px 14px" },
};