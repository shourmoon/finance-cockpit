// src/components/SurplusAllocationCard.tsx
//
// "There's cash sitting in savings. Market, or mortgage?"
//
// The card is a shell over three pure modules: computeSurplus decides how
// much is genuinely free, compareSurplusAllocations runs the head-to-head,
// and solveBreakEvenReturn says what the market would have to average for
// investing to win. No arithmetic lives here.
//
// It is deliberately reluctant. It shows no surplus until it has been told
// the balance, refuses to offer money that is still funding the emergency
// reserve, and says plainly when it cannot size that reserve at all —
// because the failure mode of guessing is that someone empties their savings
// into a mortgage on the strength of a number the app made up.

import { useMemo, useState } from "react";
import type { MortgageOriginalTerms, PastPrepaymentLog } from "../domain/mortgage/types";
import type { RecurringRule, SurplusSettings, ISODate } from "../domain/types";
import { decomposeMortgageSavings } from "../domain/mortgage";
import {
  deriveMonthlyExpenses,
  computeSurplus,
} from "../domain/surplusAllocation";
import {
  compareSurplusAllocations,
  solveBreakEvenReturn,
} from "../domain/portfolioProjection";
import { formatDate } from "../utils/dates";
import { ui, colors } from "./ui";

const money = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });

const percent = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`;

/** Months as "4 yrs 7 mos". Returns an em dash for nothing gained. */
function yearsMonths(totalMonths: number | null | undefined): string {
  if (totalMonths == null || !Number.isFinite(totalMonths) || totalMonths < 1) {
    return "—";
  }
  const months = Math.round(totalMonths);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} yr${y === 1 ? "" : "s"}`);
  if (m > 0) parts.push(`${m} mo${m === 1 ? "" : "s"}`);
  return parts.join(" ") || "—";
}

/** The splits offered, as fractions of the surplus sent to the mortgage. */
const SPLITS = [0, 0.5, 1];
const SPLIT_LABELS = ["All to market", "Half and half", "All to mortgage"];

const styles = {
  note: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 1.45,
  },
  emptyState: {
    fontSize: 13,
    color: colors.muted,
    background: colors.surfaceInset,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 8,
    padding: 10,
    lineHeight: 1.45,
  },
  fieldRow: {
    display: "flex",
    gap: 10,
    marginTop: 10,
    // Bottom-aligned so a label that wraps to two lines doesn't drop its
    // input half a row below its neighbour.
    alignItems: "flex-end",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
  },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 8,
    fontSize: 13,
    color: colors.textSoft,
    padding: "3px 0",
  },
  freeAmount: {
    fontSize: 20,
    fontWeight: 600,
    color: colors.positive,
  },
  splitRow: {
    borderTop: `1px solid ${colors.hairline}`,
    padding: "9px 0",
  },
  splitName: {
    fontSize: 13,
    fontWeight: 600,
    color: colors.title,
    marginBottom: 3,
  },
  splitFigures: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 8,
  },
  bigFigure: {
    fontSize: 15,
    fontWeight: 600,
  },
  // Explicitly smaller than the two headline figures: the per-month price is
  // only meaningful as a unit for comparing splits, never on its own.
  unitPrice: {
    fontSize: 11,
    color: colors.faint,
    marginTop: 2,
  },
  verdict: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 1.5,
    color: colors.text,
    background: colors.surfaceInset,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 8,
    padding: 10,
  },
} as const;

/**
 * A numeric field that keeps its own raw text, so a half-typed value is never
 * coerced mid-edit, and — unlike the shared NumberInput — distinguishes empty
 * from zero. That distinction is the whole point here: "nothing parked" is an
 * answer, "I haven't said" is not, and the card behaves very differently.
 */
function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));

  // Resync on external change, but never clobber text that already parses to
  // the current value (the user is mid-edit and means it).
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    const parsed = text.trim() === "" ? undefined : Number(text.replace(/,/g, ""));
    if (parsed !== value) setText(value === undefined ? "" : String(value));
  }

  return (
    <>
      <span style={ui.fieldLabel}>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === "") {
            onChange(undefined);
            return;
          }
          const n = Number(raw.replace(/,/g, ""));
          if (Number.isFinite(n) && n >= 0) onChange(n);
        }}
        style={ui.input}
      />
    </>
  );
}

export interface SurplusAllocationCardProps {
  terms: MortgageOriginalTerms;
  prepayments: PastPrepaymentLog;
  asOfDate: ISODate;
  /** Recurring rules, used to derive the monthly outflow the reserve covers. */
  rules: RecurringRule[];
  surplus: SurplusSettings;
  onSurplusChange: (next: SurplusSettings) => void;
}

export default function SurplusAllocationCard({
  terms,
  prepayments,
  asOfDate,
  rules,
  surplus,
  onSurplusChange,
}: SurplusAllocationCardProps) {
  const monthlyExpenses = useMemo(() => deriveMonthlyExpenses(rules), [rules]);

  const breakdown = useMemo(
    () => computeSurplus({
      parkedCash: surplus.parkedCash ?? 0,
      monthlyExpenses,
      reserveMonths: surplus.reserveMonths,
    }),
    [surplus.parkedCash, surplus.reserveMonths, monthlyExpenses]
  );

  const ahead = useMemo(
    () => decomposeMortgageSavings(terms, prepayments),
    [terms, prepayments]
  );

  const free = breakdown.surplus;

  const comparison = useMemo(
    () =>
      compareSurplusAllocations({
        terms,
        prepayments,
        asOfDate,
        surplus: free,
        annualReturn: surplus.expectedReturn,
        capitalGainsRate: surplus.capitalGainsRate,
        horizonYears: surplus.horizonYears,
        splits: SPLITS,
      }),
    [terms, prepayments, asOfDate, free, surplus]
  );

  const breakEven = useMemo(
    () =>
      solveBreakEvenReturn({
        terms,
        prepayments,
        asOfDate,
        surplus: free,
        capitalGainsRate: surplus.capitalGainsRate,
        horizonYears: surplus.horizonYears,
      }),
    [terms, prepayments, asOfDate, free, surplus]
  );

  const set = (patch: Partial<SurplusSettings>) =>
    onSurplusChange({ ...surplus, ...patch });

  const paidOff = ahead.actual.payoffDate <= asOfDate;
  const knowsBalance = surplus.parkedCash !== undefined;
  const canSizeReserve = monthlyExpenses > 0;

  return (
    <div style={ui.card}>
      <h3 style={ui.cardTitle}>Surplus allocation</h3>

      {/* Context first: the household is not starting from the contract. */}
      <div style={styles.note}>
        You're already{" "}
        <strong>{yearsMonths(ahead.total.monthsSaved)}</strong> ahead of your
        original {Math.round(terms.termMonths / 12)}-year contract, worth{" "}
        {money(ahead.total.interestSaved)} of interest. The question is how much
        further ahead is worth buying.
      </div>

      <div style={styles.fieldRow}>
        <div style={{ ...styles.field, flex: 2 }}>
          <NumberField
            label="Parked in savings"
            value={surplus.parkedCash}
            onChange={(v) => set({ parkedCash: v })}
            placeholder="e.g. 120,000"
          />
        </div>
        <div style={{ ...styles.field, flex: 1 }}>
          <NumberField
            label="Reserve months"
            value={surplus.reserveMonths}
            onChange={(v) => set({ reserveMonths: v ?? surplus.reserveMonths })}
          />
        </div>
      </div>

      {!knowsBalance ? (
        <div style={{ ...styles.emptyState, marginTop: 10 }}>
          Tell me what's parked in savings and I'll work out how much of it is
          genuinely free, after holding back {surplus.reserveMonths} months of
          expenses.
        </div>
      ) : !canSizeReserve ? (
        <div style={{ ...styles.emptyState, marginTop: 10 }}>
          I can't size your safety net without knowing your monthly outgoings —
          add your recurring expenses on the Config tab first.
        </div>
      ) : breakdown.reserveShortfall > 0 ? (
        <div style={{ ...styles.emptyState, marginTop: 10 }}>
          You're {money(breakdown.reserveShortfall)} short of your safety net (
          {surplus.reserveMonths} months of expenses ={" "}
          {money(breakdown.reserveTarget)}). Nothing to allocate yet — fill that
          first.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 12 }}>
            <div style={styles.summaryRow}>
              <span>
                Safety net ({surplus.reserveMonths} mo &times;{" "}
                {money(monthlyExpenses)})
              </span>
              <span>{money(breakdown.reserveTarget)}</span>
            </div>
            <div style={styles.summaryRow}>
              <span style={{ color: colors.text }}>Free to allocate</span>
              <span style={styles.freeAmount}>{money(free)}</span>
            </div>
          </div>

          {paidOff ? (
            <div style={{ ...styles.emptyState, marginTop: 10 }}>
              Your mortgage is already paid off — there's nothing left to
              prepay, so this is all a market decision now.
            </div>
          ) : (
            <>
              <div style={{ ...ui.miniLabel, marginTop: 14, marginBottom: 2 }}>
                What each choice buys
              </div>

              {comparison.outcomes.map((o, i) => (
                <div
                  key={o.fractionToPrepayment}
                  style={styles.splitRow}
                  data-testid={`split-row-${i}`}
                >
                  <div style={styles.splitName}>
                    {SPLIT_LABELS[i]}
                    {o.toPrepayment > 0 && (
                      <span style={{ color: colors.faint, fontWeight: 400 }}>
                        {" "}
                        · {money(o.toPrepayment)} to the mortgage
                      </span>
                    )}
                  </div>
                  <div style={styles.splitFigures}>
                    <span
                      data-testid="months-sooner"
                      style={{ ...styles.bigFigure, color: colors.positive }}
                    >
                      {o.monthsShaved >= 1
                        ? `${yearsMonths(o.monthsShaved)} sooner`
                        : `Debt-free ${formatDate(o.payoffDate)}`}
                    </span>
                    <span
                      data-testid="wealth-given-up"
                      style={{ ...styles.bigFigure, color: colors.danger }}
                    >
                      {o.wealthGivenUp > 0 ? `−${money(o.wealthGivenUp)}` : "—"}
                    </span>
                  </div>
                  <div data-testid="per-month-price" style={styles.unitPrice}>
                    {o.costPerMonthShaved != null
                      ? `${money(o.costPerMonthShaved)} per month bought`
                      : "your current path — nothing given up"}
                  </div>
                </div>
              ))}

              <div style={styles.verdict} data-testid="verdict">
                {breakEven == null ? (
                  <>
                    Not enough to compare at these settings — check the parked
                    balance and horizon.
                  </>
                ) : comparison.marketFavoured ? (
                  <>
                    The market has to average <strong>{percent(breakEven)}</strong>{" "}
                    a year for investing to come out ahead here. You're assuming{" "}
                    <strong>{percent(surplus.expectedReturn)}</strong>, so on
                    expected value the <strong>market</strong> wins — but it wins
                    with risk, and prepaying is certain.
                  </>
                ) : (
                  <>
                    The market has to average <strong>{percent(breakEven)}</strong>{" "}
                    a year to beat prepaying, and you're assuming only{" "}
                    <strong>{percent(surplus.expectedReturn)}</strong>. On these
                    numbers the <strong>mortgage</strong> wins — and it wins
                    without risk.
                  </>
                )}
              </div>

              <div style={{ ...styles.note, marginTop: 8 }}>
                Measured {surplus.horizonYears} years out, after{" "}
                {percent(surplus.capitalGainsRate)} capital gains tax, with the
                freed mortgage payment reinvested in every case.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
