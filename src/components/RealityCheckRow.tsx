// src/components/RealityCheckRow.tsx
//
// The line that says how much of what you are reading is still true.
//
// Two figures in this app are maintained by hand and nothing corrects them:
// the account balance and the loan's outstanding principal. Everything else
// on both tabs is computed from them, so a stale one makes a whole screen of
// confident numbers quietly wrong. This row shows when each was last
// confirmed against a statement, what the model got wrong that time, and
// whether it has been getting it wrong the same way repeatedly.
//
// It is deliberately one line until there is something worth saying. A
// nag that is always on screen is one nobody reads.

import type {
  CheckpointSummary,
  CheckpointTarget,
} from "../domain/reconciliation";
import { formatDate } from "../utils/dates";
import { ui, colors } from "./ui";

export default function RealityCheckRow({
  summary,
  target,
  formatMoney,
  onCheck,
}: {
  summary: CheckpointSummary;
  target: CheckpointTarget;
  formatMoney: (amount: number) => string;
  onCheck: () => void;
}) {
  const { freshness, latestDrift, systematic } = summary;
  const tone = toneFor(freshness.level);

  return (
    <div style={styles.wrap} data-testid={`reality-check-${target}`}>
      <div style={styles.line}>
        <span style={{ ...styles.dot, background: tone }} aria-hidden="true" />
        <span style={styles.age} data-testid={`reality-age-${target}`}>
          {ageLabel(freshness.level, freshness.ageDays, freshness.lastConfirmed)}
        </span>
        <button type="button" style={styles.action} onClick={onCheck}>
          {freshness.level === "unconfirmed" ? "Check it" : "Re-check"}
        </button>
      </div>

      {latestDrift && latestDrift.verdict !== "match" && (
        <div
          style={{
            ...styles.drift,
            color: latestDrift.verdict === "modelOptimistic" ? colors.amber : colors.muted,
          }}
          data-testid={`reality-drift-${target}`}
        >
          {driftLabel(target, latestDrift.verdict, formatMoney(latestDrift.magnitude))}
        </div>
      )}

      {latestDrift?.verdict === "match" && (
        <div style={styles.matched} data-testid={`reality-drift-${target}`}>
          Model matched the statement last time.
        </div>
      )}

      {systematic && (
        <div style={styles.systematic} data-testid={`reality-systematic-${target}`}>
          Every recent check missed the same way — something is missing from
          the model, and re-entering the figure will only hide it.
        </div>
      )}
    </div>
  );
}

function toneFor(level: CheckpointSummary["freshness"]["level"]): string {
  if (level === "fresh") return colors.positive;
  if (level === "aging") return colors.amber;
  return colors.danger;
}

function ageLabel(
  level: CheckpointSummary["freshness"]["level"],
  ageDays: number | null,
  lastConfirmed: string | null
): string {
  if (level === "unconfirmed" || ageDays === null || lastConfirmed === null) {
    return "Never checked against a statement";
  }
  if (ageDays === 0) return "Confirmed today";
  const span =
    ageDays === 1
      ? "yesterday"
      : ageDays < 60
        ? `${ageDays} days ago`
        : `${Math.round(ageDays / 30)} months ago`;
  return `Confirmed ${span} (${formatDate(lastConfirmed)})`;
}

/**
 * Phrased so the direction cannot be misread. "Optimistic" always means the
 * model flattered the household — too much cash, or too little debt — which
 * is the reading that costs money if it is missed.
 */
function driftLabel(
  target: CheckpointTarget,
  verdict: "modelOptimistic" | "modelPessimistic" | "unknown",
  amount: string
): string {
  if (verdict === "unknown") return "Last check could not be compared.";
  const optimistic = verdict === "modelOptimistic";
  if (target === "cash") {
    return optimistic
      ? `Last check: ${amount} less in the account than the model showed.`
      : `Last check: ${amount} more in the account than the model showed.`;
  }
  return optimistic
    ? `Last check: ${amount} more still owed than the model showed.`
    : `Last check: ${amount} less still owed than the model showed.`;
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    marginTop: 10,
    paddingTop: 9,
    borderTop: `1px solid ${colors.cardBorder}`,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  line: { display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" },
  dot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  age: { fontSize: 11.5, color: colors.muted, flex: 1, minWidth: 0 },
  action: {
    ...ui.miniLabel,
    background: "transparent",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 7,
    padding: "3px 9px",
    color: colors.text,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.03em",
  },
  drift: { fontSize: 11.5, paddingLeft: 14 },
  matched: { fontSize: 11.5, color: colors.faint, paddingLeft: 14 },
  systematic: {
    fontSize: 11.5,
    color: colors.danger,
    paddingLeft: 14,
    lineHeight: 1.35,
  },
};
