// src/components/QuickAddTransactionModal.tsx
//
// Minimal modal for adding a one-time transaction straight from the
// Dashboard ("just paid $400 for brakes"). Mirrors OverrideModal's
// backdrop/modal styling and reuses the shared inputs.

import { useState } from "react";
import { DateInputWithDisplay, NumberInput } from "./shared";

export interface QuickAddValues {
  name: string;
  amount: number;
  date: string;
}

export default function QuickAddTransactionModal({
  open,
  defaultDate,
  onAdd,
  onClose,
}: {
  open: boolean;
  defaultDate: string;
  onAdd: (values: QuickAddValues) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(defaultDate);

  // Reset the form whenever the modal transitions closed -> open, using
  // the render-time adjustment pattern (no effect, no cascading render).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName("");
      setAmount(0);
      setDate(defaultDate);
    }
  }

  if (!open) return null;

  function handleAdd() {
    onAdd({
      name: name.trim() === "" ? "One-time transaction" : name.trim(),
      amount,
      date,
    });
  }

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <h3 style={{ marginTop: 0 }}>Add one-time transaction</h3>

        <label style={styles.label}>
          Name
          <input
            style={styles.input}
            type="text"
            aria-label="Transaction name"
            value={name}
            placeholder="e.g. Car repair"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label style={styles.label}>
          Amount (positive = inflow, negative = expense)
          <NumberInput
            value={amount}
            onChange={setAmount}
            ariaLabel="Transaction amount"
            inputStyle={styles.input}
          />
        </label>

        <label style={styles.label}>
          Date
          <DateInputWithDisplay
            value={date}
            onChange={(val) => {
              if (val) setDate(val);
            }}
            inputStyle={styles.input}
          />
        </label>

        <div style={styles.buttonRow}>
          <button onClick={handleAdd} style={styles.saveBtn}>
            Add
          </button>
          <button onClick={onClose} style={styles.cancelBtn}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
  label: {
    display: "flex",
    flexDirection: "column",
    marginBottom: 12,
    fontSize: 14,
    gap: 6,
  },
  input: {
    padding: 8,
    fontSize: 16,
    background: "#020617",
    color: "#e5e7eb",
    border: "1px solid #4b5563",
    borderRadius: 8,
    width: "100%",
  },
  buttonRow: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 16,
    gap: 8,
  },
  saveBtn: {
    flex: 1,
    padding: "8px 14px",
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
  },
  cancelBtn: {
    flex: 1,
    padding: "8px 14px",
    background: "#4b5563",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    color: "#e5e7eb",
  },
};
