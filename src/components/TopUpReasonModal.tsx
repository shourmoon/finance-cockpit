// src/components/TopUpReasonModal.tsx
//
// Asked once, at the moment a suggested top-up is applied: was this a
// one-off shock, or did the month genuinely not cover? Recording it here
// means coverage metrics can separate the two by measurement rather than
// inferring it from the shape of the draws.

import type { TopUpDeposit } from "../domain/safeToSpendEngine";
import type { TopUpReason } from "../domain/types";
import { formatDate } from "../utils/dates";
import { ui, colors } from "./ui";
import Modal from "./Modal";

export default function TopUpReasonModal({
  deposit,
  formatMoney,
  onChoose,
  onClose,
}: {
  deposit: TopUpDeposit | null;
  formatMoney: (amount: number) => string;
  onChoose: (reason: TopUpReason) => void;
  onClose: () => void;
}) {
  if (!deposit) return null;

  return (
    <Modal onClose={onClose} labelledBy="topup-reason-title">
      <h3 id="topup-reason-title" style={{ ...ui.cardTitle, marginBottom: 4 }}>
        Why this top-up?
      </h3>
      <div style={styles.amount}>
        {formatMoney(deposit.amount)} on {formatDate(deposit.date)}
      </div>

      <button style={styles.choice} onClick={() => onChoose("oneOff")}>
        <span style={styles.choiceTitle}>One-off</span>
        <span style={styles.choiceHint}>
          A shock — car repair, medical bill, travel. Savings doing its job.
        </span>
      </button>

      <button style={styles.choice} onClick={() => onChoose("shortfall")}>
        <span style={{ ...styles.choiceTitle, color: colors.danger }}>
          Recurring shortfall
        </span>
        <span style={styles.choiceHint}>
          The month simply didn't cover. Counts against the one-salary read.
        </span>
      </button>

      <button style={styles.cancel} onClick={onClose}>
        Cancel
      </button>
    </Modal>
  );
}

const styles: Record<string, React.CSSProperties> = {
  amount: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 14,
  },
  choice: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 3,
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    marginBottom: 8,
    borderRadius: 10,
    border: `1px solid ${colors.inputBorder}`,
    background: colors.inputBg,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  choiceTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: colors.text,
  },
  choiceHint: {
    fontSize: 12,
    lineHeight: 1.45,
    color: colors.muted,
  },
  cancel: { ...ui.secondaryButton, width: "100%", marginTop: 4 },
};
