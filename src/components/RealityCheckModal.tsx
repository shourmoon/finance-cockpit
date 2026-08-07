// src/components/RealityCheckModal.tsx
//
// "What does the statement actually say?" — the one place this app looks
// outside itself.
//
// The comparison is shown live, before anything is saved, because the
// useful moment is the one where the two figures are side by side. Saving
// records both, so the log can later answer whether the model has been
// wrong the same way repeatedly rather than merely wrong once.

import { useState } from "react";
import type { CheckpointTarget, Drift } from "../domain/reconciliation";
import { assessDrift } from "../domain/reconciliation";
import { DateInputWithDisplay } from "./shared";
import { formatDate } from "../utils/dates";
import { ui, colors } from "./ui";
import Modal from "./Modal";

export default function RealityCheckModal({
  open,
  target,
  defaultDate,
  dateEditable = true,
  /** What the model says on a date, or null where it has no opinion. */
  modelledOn,
  formatMoney,
  onSave,
  onClose,
}: {
  open: boolean;
  target: CheckpointTarget;
  defaultDate: string;
  /**
   * False when the check can only be about one date, and that date is fixed.
   * A cash check confirms the balance the app is holding *now*, so there is
   * no other date it could be about: the projection reaches only forward,
   * where no statement exists, and the figure being corrected is a single
   * "balance today". A servicer statement is genuinely dated, so the
   * mortgage check keeps the picker.
   */
  dateEditable?: boolean;
  modelledOn: (date: string) => number | null;
  formatMoney: (amount: number) => string;
  onSave: (values: { date: string; actual: number; modelled: number }) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(defaultDate);
  // Kept as text so empty stays distinct from zero: a statement can genuinely
  // report a zero balance, so nothing is compared until a figure is typed.
  const [actualText, setActualText] = useState("");

  if (!open) return null;

  const trimmed = actualText.replace(/[,$\s]/g, "");
  const parsed = Number(trimmed);
  const actual =
    trimmed !== "" && Number.isFinite(parsed) ? parsed : null;

  const modelled = modelledOn(date);
  const drift: Drift | null =
    modelled === null || actual === null
      ? null
      : assessDrift(target, actual, modelled);

  const noun = target === "cash" ? "your bank" : "your servicer";
  const figure = target === "cash" ? "balance" : "principal still owed";

  return (
    <Modal onClose={onClose} labelledBy="reality-check-title">
      <h3 id="reality-check-title" style={{ ...ui.cardTitle, marginBottom: 4 }}>
        Check against {noun}
      </h3>
      <div style={styles.blurb}>
        Enter the {figure} exactly as {noun} shows it
        {dateEditable ? ", and the date it was true of." : " right now."}
      </div>

      {dateEditable ? (
        <label style={styles.field}>
          <span style={ui.fieldLabel}>Statement date</span>
          <DateInputWithDisplay
            value={date}
            onChange={setDate}
            inputStyle={ui.input}
            ariaLabel="Statement date"
          />
        </label>
      ) : (
        <div style={styles.field}>
          <span style={ui.fieldLabel}>As of</span>
          <span style={styles.lockedDate} data-testid="reality-locked-date">
            {formatDate(date)}
          </span>
        </div>
      )}

      <label style={styles.field}>
        <span style={ui.fieldLabel}>
          {target === "cash" ? "Balance on the statement" : "Principal still owed"}
        </span>
        {/* Not the shared NumberInput: that one is seeded from a number and
            so cannot show an empty field, which would put a "0" here before
            the user has read anything off a statement. Zero is a balance a
            statement can genuinely report, so blank has to mean blank. */}
        <input
          type="text"
          inputMode="decimal"
          aria-label="Statement amount"
          placeholder="—"
          value={actualText}
          onChange={(e) => setActualText(e.target.value)}
          style={ui.input}
        />
      </label>

      <div style={styles.compare}>
        <div style={styles.compareRow}>
          <span style={styles.compareKey}>This app says</span>
          <span style={styles.compareVal} data-testid="reality-modelled">
            {modelled === null ? "—" : formatMoney(modelled)}
          </span>
        </div>
        <div style={styles.compareRow}>
          <span style={styles.compareKey}>Difference</span>
          <span
            style={{
              ...styles.compareVal,
              color:
                drift === null
                  ? colors.faint
                  : drift.verdict === "match"
                    ? colors.positive
                    : drift.verdict === "modelOptimistic"
                      ? colors.amber
                      : colors.textSoft,
            }}
            data-testid="reality-difference"
          >
            {drift === null ? "—" : drift.verdict === "match" ? "Matches" : formatMoney(drift.magnitude)}
          </span>
        </div>
      </div>

      {modelled === null && (
        <div style={styles.note} data-testid="reality-out-of-range">
          The model has nothing to say about that date, so there is nothing to
          compare against.
        </div>
      )}

      <div style={styles.actions}>
        <button style={styles.cancel} onClick={onClose}>
          Cancel
        </button>
        <button
          style={{
            ...ui.primaryButton,
            flex: 1,
            ...(modelled === null || actual === null ? styles.disabled : {}),
          }}
          disabled={modelled === null || actual === null}
          onClick={() => {
            if (modelled === null || actual === null) return;
            onSave({ date, actual, modelled });
          }}
        >
          Record check
        </button>
      </div>
    </Modal>
  );
}

const styles: Record<string, React.CSSProperties> = {
  blurb: { fontSize: 12, lineHeight: 1.45, color: colors.muted, marginBottom: 14 },
  field: { display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 },
  compare: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "9px 11px",
    borderRadius: 9,
    background: colors.surfaceInset,
    border: `1px solid ${colors.cardBorder}`,
    marginBottom: 10,
  },
  lockedDate: { fontSize: 13, fontWeight: 600, color: colors.text },
  compareRow: { display: "flex", justifyContent: "space-between", gap: 10 },
  compareKey: { fontSize: 12, color: colors.muted },
  compareVal: { fontSize: 13, fontWeight: 700, color: colors.text },
  note: {
    fontSize: 11.5,
    lineHeight: 1.45,
    color: colors.amber,
    marginBottom: 10,
  },
  actions: { display: "flex", gap: 8, marginTop: 2 },
  cancel: { ...ui.secondaryButton, flex: 1 },
  disabled: { opacity: 0.45, cursor: "not-allowed" },
};
