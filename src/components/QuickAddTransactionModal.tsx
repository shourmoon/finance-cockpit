// src/components/QuickAddTransactionModal.tsx
//
// Minimal modal for adding a one-time transaction straight from the
// Dashboard ("just paid $400 for brakes"). Mirrors OverrideModal's
// backdrop/modal styling and reuses the shared inputs.

import { useState } from "react";
import { DateInputWithDisplay, NumberInput, TopUpToggle } from "./shared";
import { ui, colors } from "./ui";
import Modal from "./Modal";

export interface QuickAddValues {
  name: string;
  amount: number;
  date: string;
  kind?: "topUp";
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
  // Money moved from savings is often recorded here rather than through the
  // dashboard's Apply button, so it has to be markable at entry.
  const [isTopUp, setIsTopUp] = useState(false);

  // Reset the form whenever the modal transitions closed -> open, using
  // the render-time adjustment pattern (no effect, no cascading render).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName("");
      setAmount(0);
      setDate(defaultDate);
      setIsTopUp(false);
    }
  }

  if (!open) return null;

  function handleAdd() {
    onAdd({
      name: name.trim() === "" ? "One-time transaction" : name.trim(),
      amount,
      date,
      ...(isTopUp ? { kind: "topUp" as const } : {}),
    });
  }

  return (
    <Modal onClose={onClose} labelledBy="quickadd-modal-title">
      <h3 id="quickadd-modal-title" style={{ ...ui.cardTitle, marginBottom: 12 }}>
        Add one-time transaction
      </h3>

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

      <div style={styles.toggleRow}>
        <TopUpToggle checked={isTopUp} onChange={setIsTopUp} />
      </div>

      {isTopUp && amount <= 0 && (
        <div style={styles.warning}>
          A top-up must be a positive inflow — coverage ignores this amount.
        </div>
      )}

      <div style={styles.buttonRow}>
        <button onClick={handleAdd} style={styles.saveBtn}>
          Add
        </button>
        <button onClick={onClose} style={styles.cancelBtn}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

const styles: Record<string, React.CSSProperties> = {
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 12,
    fontSize: 13,
    color: colors.muted,
  },
  input: ui.input,
  toggleRow: { marginBottom: 12 },
  warning: {
    fontSize: 11.5,
    lineHeight: 1.45,
    color: colors.amber,
    marginTop: -6,
    marginBottom: 12,
  },
  buttonRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 16,
  },
  saveBtn: { ...ui.primaryButton, flex: 1, padding: "9px 14px", fontSize: 14 },
  cancelBtn: { ...ui.secondaryButton, flex: 1, padding: "9px 14px" },
};
