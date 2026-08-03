// src/components/MortgageTab.tsx
//
// The mortgage tab: the loan as written, how far ahead of it the household
// already is, the surplus allocation decision, and the log of prepayments
// already made.
//
// The what-if scenario builder that used to live here has been retired. It
// could only ever optimise the mortgage in isolation, so it never showed what
// a prepayment cost elsewhere and so quietly argued for prepaying. The
// surplus card answers the same question with the market in frame, and covers
// the patterns that mattered — a lump, a monthly amount and a yearly bonus,
// each with an end date.

import { useEffect, useMemo, useState } from "react";
import {
  computeBaselineMortgage,
  computeMortgageWithPrepayments,
  computeEffectiveAnnualRateFromSchedule,
} from "../domain/mortgage";
import type {
  MortgageOriginalTerms,
  PastPrepaymentLog,
  PastPrepayment,
  PaymentFrequency,
} from "../domain/mortgage/types";
import type { RecurringRule, SurplusSettings } from "../domain/types";
import {
  loadMortgageUIState,
  saveMortgageUIState,
  createDefaultMortgageUIState,
  type MortgageUIState,
} from "../domain/mortgage/persistence";

// Shared date formatting helper.  This utility converts ISO dates
// (YYYY‑MM‑DD) into the display format required by the product
// specification, e.g. "2025-01-26" → "26 Jan '25".
import { periodsPerYear, periodsToMonths } from "../domain/mortgage/baseline";
import { formatDate } from "../utils/dates";
import { isValidISODate } from "../domain/dateUtils";
import { DateInputWithDisplay, NumberInput } from "./shared";
import SurplusAllocationCard from "./SurplusAllocationCard";
import { ui, colors } from "./ui";

// Format a currency value (number) into a US dollar string with no
// fractional digits.  If the input is null or NaN the em dash is
// returned instead.
function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

// Format a decimal ratio (0–1) into a percentage string with two
// fractional digits.  Null or NaN values are rendered as an em dash.
function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

// Wrap the shared date formatter to avoid changing existing call
// sites.  This function simply delegates to `formatDate`.
function formatDateDisplay(value: string | null | undefined): string {
  return formatDate(value);
}

// Convert a number of months into a human friendly string of years
// and months.  E.g. 34 → "2 yrs 10 mos".  Zero or negative values
// return an em dash to indicate no savings.
function formatMonthsAsYearsMonths(
  totalMonths: number | null | undefined
): string {
  if (totalMonths == null || !Number.isFinite(totalMonths) || totalMonths <= 0) {
    return "—";
  }
  const months = Math.round(totalMonths);
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  const parts: string[] = [];
  if (years > 0) {
    parts.push(`${years} yr${years === 1 ? "" : "s"}`);
  }
  if (remainingMonths > 0) {
    parts.push(
      `${remainingMonths} mo${remainingMonths === 1 ? "" : "s"}`
    );
  }

  return parts.join(" ");
}

// Parse an input string into a number.  Strings containing commas
// (e.g. "10,000") are stripped before parsing.  Returns null if the
// input is empty or cannot be converted to a finite number.
function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Reusable component that wraps a native date input and shows the
// selected date in the product's human‑friendly format underneath.
// This ensures that even though the browser native input uses
// YYYY‑MM‑DD internally, users always see the DD MMM 'YY
// representation alongside it.  Consumers must provide the value,
// onChange handler and styling for the input.
// (The date input itself now lives in src/components/shared.tsx.)

// A helper that combines a label with a date input.  It uses the
// DateInputWithDisplay component internally and displays the label
// above the input to clearly communicate the purpose of the field.
function LabeledDateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 130 }}>
      <span style={ui.fieldLabel}>{label}</span>
      <DateInputWithDisplay
        value={value}
        onChange={onChange}
        captionStyle={{ fontSize: 10, marginTop: 2 }}
        inputStyle={ui.input}
      />
    </div>
  );
}

// A helper for labelled numeric inputs. It uses a simple input of type
// number but accepts comma separated strings and passes the parsed
// number back to callers. The component does not enforce any
// particular currency formatting on input – callers should handle
// formatting on display if desired.
function LabeledNumberInput({
  label,
  value,
  onChange,
  placeholder,
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  min?: number;
  step?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 130 }}>
      <span style={ui.fieldLabel}>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        step={step}
        style={ui.input}
      />
    </div>
  );
}

// Generic container card for each section of the mortgage tab.  It
// accepts a title and optional subtitle.  Children are rendered
// inside a padded container.  Cards use a consistent dark
// background with subtle borders and shadows to match the overall
// dashboard aesthetic.  On narrow screens the card spans the full
// width of the view.
function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={ui.card}>
      <h3 style={{ ...ui.cardTitle, marginBottom: subtitle ? 4 : 12 }}>{title}</h3>
      {subtitle && <div style={ui.subtitle}>{subtitle}</div>}
      <div>{children}</div>
    </div>
  );
}

// Generate a pseudo unique identifier based on random and timestamp.
function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Augment the base prepayment with a synthetic id for React list keys.
type PrepaymentRow = PastPrepayment & { id: string };

// Each row in the past prepayment impact table.  It captures both
// cumulative savings versus the baseline mortgage and incremental
// savings for the specific prepayment.
type PrepaymentImpactRow = {
  date: string;
  amount: number;
  note?: string;
  /** Cumulative interest saved compared with the baseline (no prepayments). */
  interestSaved: number;
  /** Cumulative months saved compared with the baseline (no prepayments). */
  monthsSaved: number;
  /** Effective annual rate after this prepayment and all previous ones. */
  effectiveRate: number | null;
  /** Interest saved by this prepayment alone, over and above the earlier ones. */
  interestSavedIncremental: number;
  /** Months saved by this prepayment alone, over and above the earlier ones. */
  monthsSavedIncremental: number;
};

/**
 * Cashflow-side inputs the surplus card needs. Optional so the tab can still
 * be rendered standalone (its own tests do), in which case the card simply
 * reports that it cannot size a safety net.
 */
export interface MortgageTabProps {
  rules?: RecurringRule[];
  surplus?: SurplusSettings;
  onSurplusChange?: (next: SurplusSettings) => void;
}

export default function MortgageTab({
  rules = [],
  surplus,
  onSurplusChange,
}: MortgageTabProps = {}) {
  // Initialise from persisted state if available.
  const initialUI: MortgageUIState =
    loadMortgageUIState() ?? createDefaultMortgageUIState();

  const [terms, setTerms] = useState<MortgageOriginalTerms>(
    initialUI.terms
  );
  const [yearsInput, setYearsInput] = useState<string>(
    (initialUI.terms.termMonths / 12).toString()
  );
  const [principalInput, setPrincipalInput] = useState<string>(
    initialUI.terms.principal.toString()
  );
  const [rateInput, setRateInput] = useState<string>(
    (initialUI.terms.annualRate * 100).toString()
  );
  const [prepayments, setPrepayments] = useState<PrepaymentRow[]>(
    initialUI.prepayments.map((p) => ({
      ...p,
      id: uuid(),
    }))
  );
  const [asOfDate, setAsOfDate] = useState<string>(
    initialUI.asOfDate ?? initialUI.terms.startDate
  );
  // Row ids whose optional note editor the user has opened this session.
  // A row with an existing note renders expanded regardless; empty notes
  // stay collapsed behind a "+ Add note" affordance to keep the log light.
  const [openNoteRows, setOpenNoteRows] = useState<Set<string>>(new Set());

  // Persist on any relevant change
  useEffect(() => {
    const uiState: MortgageUIState = {
      terms,
      prepayments: prepayments
        .filter((p) => p.date && p.amount > 0)
        .map((p) => ({ date: p.date, amount: p.amount, note: p.note })),
      asOfDate: asOfDate || terms.startDate,
    };
    saveMortgageUIState(uiState);
  }, [terms, prepayments, asOfDate]);

  function updateTermsFromInputs(
    overrides?: Partial<{
      principalInput: string;
      rateInput: string;
      yearsInput: string;
      startDate: string;
    }>
  ) {
    const pStr = overrides?.principalInput ?? principalInput;
    const rStr = overrides?.rateInput ?? rateInput;
    const yStr = overrides?.yearsInput ?? yearsInput;
    const rawStartDate = overrides?.startDate ?? terms.startDate;

    // Each field falls back to the *current* committed value when what the
    // user has typed so far isn't a usable loan term. The raw text stays in
    // its own state, so the box still shows exactly what was typed — but a
    // mid-edit "0" or "-5" never reaches the domain layer, which rightly
    // throws on a non-positive principal and would take the whole tab down
    // from inside a render-time useMemo. Falling back to the mounted-at
    // value (initialUI) instead of the current one was also wrong: it
    // silently reverted edits made earlier in the session.
    const parsedPrincipal = parseNumber(pStr);
    const principal =
      parsedPrincipal !== null && parsedPrincipal > 0
        ? parsedPrincipal
        : terms.principal;

    const parsedRate = parseNumber(rStr);
    const annualRate =
      parsedRate !== null && parsedRate >= 0 ? parsedRate / 100 : terms.annualRate;

    const parsedYears = parseNumber(yStr);
    const termMonths =
      parsedYears !== null && parsedYears > 0
        ? Math.max(1, Math.round(parsedYears * 12))
        : terms.termMonths;

    const startDate = isValidISODate(rawStartDate) ? rawStartDate : terms.startDate;

    setTerms({
      principal,
      annualRate,
      termMonths,
      startDate,
    });
  }

  const baseline = useMemo(
    () => computeBaselineMortgage(terms),
    [terms]
  );

  const prepaymentLog: PastPrepaymentLog = useMemo(
    () =>
      prepayments
        .filter((p) => p.date && p.amount > 0)
        .map((p) => ({
          date: p.date,
          amount: p.amount,
          note: p.note,
        })),
    [prepayments]
  );

  const withPrepayments = useMemo(
    () => computeMortgageWithPrepayments(terms, prepaymentLog),
    [terms, prepaymentLog]
  );

  // The loan document says N years of MONTHLY payments. Paying biweekly is
  // already an acceleration against that, so the two are credited apart.
  const baselineEffectiveRate = useMemo(
    () =>
      computeEffectiveAnnualRateFromSchedule(
        baseline.schedule,
        terms.principal,
        periodsPerYear(terms.paymentFrequency)
      ),
    [baseline.schedule, terms.principal, terms.paymentFrequency]
  );

  const actualEffectiveRate = useMemo(
    () =>
      computeEffectiveAnnualRateFromSchedule(
        withPrepayments.schedule,
        terms.principal,
        periodsPerYear(terms.paymentFrequency)
      ),
    [withPrepayments.schedule, terms.principal, terms.paymentFrequency]
  );

  const totalPastPrepayments = useMemo(
    () => prepaymentLog.reduce((sum, p) => sum + p.amount, 0),
    [prepaymentLog]
  );

  const perPrepaymentImpacts = useMemo<PrepaymentImpactRow[]>(() => {
    if (!prepaymentLog.length) return [];
    // Sort prepayments chronologically
    const sorted = [...prepaymentLog].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    // Keep track of the previous state to compute incremental savings.
    let prevActual = baseline;
    return sorted.map((p, index) => {
      // Build the prefix up to and including this prepayment
      const prefix = sorted.slice(0, index + 1);
      const actual = computeMortgageWithPrepayments(terms, prefix);
      // Total savings vs baseline
      const interestSaved = baseline.totalInterest - actual.totalInterest;
      // Schedule lengths are payment periods, not months — on a biweekly
      // loan the two differ by 26/12 and this row is rendered as years+months.
      const monthsSaved = periodsToMonths(
        baseline.schedule.length - actual.schedule.length,
        terms.paymentFrequency
      );
      // Incremental savings compared with the previous prepayment
      const interestSavedIncremental =
        prevActual.totalInterest - actual.totalInterest;
      const monthsSavedIncremental = periodsToMonths(
        prevActual.schedule.length - actual.schedule.length,
        terms.paymentFrequency
      );
      // Effective rate after this prepayment
      const effectiveRate = computeEffectiveAnnualRateFromSchedule(
        actual.schedule,
        terms.principal,
        periodsPerYear(terms.paymentFrequency)
      );
      // Update prevActual for the next iteration
      prevActual = actual;
      return {
        date: p.date,
        amount: p.amount,
        note: p.note,
        interestSaved,
        monthsSaved,
        effectiveRate,
        interestSavedIncremental,
        monthsSavedIncremental,
      };
    });
  }, [prepaymentLog, terms, baseline]);

  function addPrepaymentRow() {
    setPrepayments((prev) => [
      ...prev,
      {
        id: uuid(),
        date: terms.startDate,
        amount: 0,
        note: "",
      },
    ]);
  }

  function updatePrepaymentRow(id: string, patch: Partial<PrepaymentRow>) {
    setPrepayments((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  function deletePrepaymentRow(id: string) {
    setPrepayments((prev) => prev.filter((row) => row.id !== id));
  }

  return (
    <div style={styles.container}>
      {/* Original loan terms */}
      <SectionCard title="Original Loan Terms">
        {/* Inputs arranged in a responsive wrap so they stack on narrow screens */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <LabeledNumberInput
            label="Principal ($)"
            value={principalInput}
            onChange={(v) => {
              setPrincipalInput(v);
              updateTermsFromInputs({ principalInput: v });
            }}
          />
          <LabeledNumberInput
            label="Rate (APR %)"
            value={rateInput}
            onChange={(v) => {
              setRateInput(v);
              updateTermsFromInputs({ rateInput: v });
            }}
          />
          <LabeledNumberInput
            label="Term (years)"
            value={yearsInput}
            onChange={(v) => {
              setYearsInput(v);
              updateTermsFromInputs({ yearsInput: v });
            }}
          />
          <LabeledDateInput
            label="Start date"
            value={terms.startDate}
            onChange={(val) => {
              const v = val || terms.startDate;
              updateTermsFromInputs({ startDate: v });
            }}
          />
          <LabeledDateInput
            label="Planning from"
            value={asOfDate}
            onChange={(val) => {
              const v = val || terms.startDate;
              setAsOfDate(v);
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 130 }}>
            <span style={ui.fieldLabel}>Payment frequency</span>
            <select
              aria-label="Payment frequency"
              style={ui.input}
              value={terms.paymentFrequency ?? "monthly"}
              onChange={(e) =>
                setTerms((t) => ({
                  ...t,
                  paymentFrequency: e.target.value as PaymentFrequency,
                }))
              }
            >
              <option value="monthly">Monthly</option>
              <option value="biweekly">Every 2 weeks</option>
            </select>
            <span style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
              {terms.paymentFrequency === "biweekly"
                ? "Half the monthly payment every 14 days — 26 a year"
                : "One full payment a month"}
            </span>
          </div>
        </div>

        {/* Baseline summary */}
        <div style={{ marginTop: 16 }}>
          <div style={styles.subHeading}>Baseline summary</div>
          {/* The figure below is the amount handed over each period, which
              for a biweekly loan is half the monthly payment — so the label
              has to follow the cadence rather than always saying "monthly". */}
          <div style={styles.summaryRow}>
            <span>
              {terms.paymentFrequency === "biweekly"
                ? "Payment every 2 weeks"
                : "Monthly payment"}
            </span>
            <span>
              {formatCurrency(
                baseline.schedule.length > 0 ? baseline.schedule[0].payment : null
              )}
            </span>
          </div>
          {terms.paymentFrequency === "biweekly" && (
            <div style={styles.summaryRow}>
              <span>Paid per year</span>
              <span>
                {formatCurrency(
                  baseline.schedule.length > 0 ? baseline.schedule[0].payment * 26 : null
                )}
                <span style={{ color: colors.muted }}> · 13 months’ worth</span>
              </span>
            </div>
          )}
          <div style={styles.summaryRow}>
            <span>Total interest (no prepayments)</span>
            <span>{formatCurrency(baseline.totalInterest)}</span>
          </div>
          <div style={styles.summaryRow}>
            <span>Payoff date</span>
            <span>{formatDateDisplay(baseline.payoffDate)}</span>
          </div>
          <div style={styles.summaryRow}>
            <span>Effective APR (baseline)</span>
            <span>{formatPercent(baselineEffectiveRate)}</span>
          </div>
        </div>
      </SectionCard>

      {surplus && onSurplusChange && (
        <SurplusAllocationCard
          terms={terms}
          prepayments={prepaymentLog}
          asOfDate={asOfDate || terms.startDate}
          rules={rules}
          surplus={surplus}
          onSurplusChange={onSurplusChange}
        />
      )}

      {/* Past prepayments and actual vs baseline summary */}
      <SectionCard title="Past Prepayments" subtitle="Log the extra payments you've already made">
        <div style={{ marginBottom: 8 }}>
          <button style={styles.addButton} onClick={addPrepaymentRow}>
            + Add prepayment
          </button>
        </div>
        {prepayments.length === 0 ? (
          <div style={styles.emptyState}>
            No prepayments defined yet. Add rows to reflect extra principal payments you've already made in the past.
          </div>
        ) : (
          /* Stacked cards rather than a fixed 4-column grid: the note
             field and delete button used to be clipped off-screen on
             phones because three inputs could not fit side by side. */
          <div style={styles.prepayList}>
            {prepayments.map((row) => (
              <div key={row.id} style={styles.prepayCard}>
                <div style={styles.prepayTopRow}>
                  <div style={{ flex: "3 1 auto", minWidth: 0 }}>
                    <DateInputWithDisplay
                      value={row.date}
                      onChange={(val) =>
                        updatePrepaymentRow(row.id, { date: val || row.date })
                      }
                      captionStyle={{ fontSize: 11, marginTop: 3, color: colors.muted }}
                      ariaLabel="Prepayment date"
                      // A firm min-width so MM/DD/YYYY never clips the year
                      // on narrow phones (previously showed "12/23/202").
                      inputStyle={{ ...ui.input, minWidth: 150 }}
                    />
                  </div>
                  <NumberInput
                    inputStyle={{ ...ui.input, flex: "2 1 0", minWidth: 72, textAlign: "right", fontWeight: 600 }}
                    ariaLabel="Prepayment amount"
                    placeholder="Amount"
                    value={row.amount}
                    onChange={(n) => updatePrepaymentRow(row.id, { amount: n })}
                  />
                  <button
                    style={ui.deleteButton}
                    aria-label="Delete prepayment"
                    onClick={() => deletePrepaymentRow(row.id)}
                  >
                    ✕
                  </button>
                </div>
                {(row.note && row.note.length > 0) || openNoteRows.has(row.id) ? (
                  <input
                    style={{ ...ui.input, fontSize: 13, padding: "6px 8px" }}
                    type="text"
                    aria-label="Prepayment note"
                    // Autofocus only when the user just opened it, not when a
                    // saved note renders expanded on load.
                    autoFocus={openNoteRows.has(row.id)}
                    value={row.note ?? ""}
                    placeholder="Note (optional)"
                    onChange={(e) => updatePrepaymentRow(row.id, { note: e.target.value })}
                  />
                ) : (
                  <button
                    style={styles.addNoteButton}
                    onClick={() =>
                      setOpenNoteRows((prev) => new Set(prev).add(row.id))
                    }
                  >
                    + Add note
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {prepaymentLog.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={styles.summaryRow}>
              <span>Total past prepayments</span>
              <span>{formatCurrency(totalPastPrepayments)}</span>
            </div>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <div style={styles.subHeading}>With prepayments (actual)</div>
          <div style={styles.summaryRow}>
            <span>Total interest with prepayments</span>
            <span>{formatCurrency(withPrepayments.totalInterest)}</span>
          </div>
          <div style={styles.summaryRow}>
            <span>Payoff date with prepayments</span>
            <span>{formatDateDisplay(withPrepayments.payoffDate)}</span>
          </div>
          <div style={styles.summaryRow}>
            <span>Effective APR (with prepayments)</span>
            <span>{formatPercent(actualEffectiveRate)}</span>
          </div>
        </div>

        {perPrepaymentImpacts.length > 0 && (
          <details style={styles.details}>
            <summary style={styles.detailsSummary}>
              Impact of each past prepayment
              <span style={styles.detailsHint}>
                (shows total impact up to that point + incremental impact of that payment)
              </span>
            </summary>
            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  borderRadius: 8,
                  border: `1px solid ${colors.cardBorder}`,
                  overflow: "hidden",
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.1fr 1fr 1.6fr 1.3fr 1.3fr",
                    padding: "6px 8px",
                    gap: 4,
                    background:
                      "linear-gradient(90deg, rgba(39,39,42,1), rgba(24,24,27,1))",
                    borderBottom: `1px solid ${colors.inputBorder}`,
                    color: colors.muted,
                  }}
                >
                  <div>Date</div>
                  <div>Amount</div>
                  <div>Interest saved (tot | this)</div>
                  <div>Months saved (tot | this)</div>
                  <div>Effective APR after</div>
                </div>
                {perPrepaymentImpacts.map((row, idx) => (
                  <div
                    key={`${row.date}-${row.amount}-${idx}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.1fr 1fr 1.6fr 1.3fr 1.3fr",
                      padding: "6px 8px",
                      gap: 4,
                      borderBottom: `1px solid ${colors.inputBg}`,
                      backgroundColor: idx % 2 === 0 ? colors.bg : colors.surfaceInset,
                    }}
                  >
                    <div>{formatDateDisplay(row.date)}</div>
                    <div>{formatCurrency(row.amount)}</div>
                    <div>
                      <div>{formatCurrency(row.interestSaved)}</div>
                      <div style={{ fontSize: 10, color: colors.positiveSoft }}>
                        {row.interestSavedIncremental > 0
                          ? `+${formatCurrency(row.interestSavedIncremental)}`
                          : formatCurrency(row.interestSavedIncremental)}
                      </div>
                    </div>
                    <div>
                      <div>{formatMonthsAsYearsMonths(row.monthsSaved)}</div>
                      <div style={{ fontSize: 10, color: colors.positiveSoft }}>
                        {row.monthsSavedIncremental > 0
                          ? `+${formatMonthsAsYearsMonths(row.monthsSavedIncremental)}`
                          : formatMonthsAsYearsMonths(row.monthsSavedIncremental)}
                      </div>
                    </div>
                    <div>{formatPercent(row.effectiveRate)}</div>
                  </div>
                ))}
              </div>
            </div>
          </details>
        )}
      </SectionCard>

    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // The tab is rendered inside App's already-padded, max-width container,
  // so it adds no padding of its own (that produced a double inset that
  // made the Mortgage cards sit narrower than Dashboard/Settings). Card
  // spacing comes from ui.card's own marginBottom, matching the other
  // tabs exactly — no extra gap here. Colors/font are inherited.
  container: {
    display: "flex",
    flexDirection: "column",
  },
  subHeading: {
    ...ui.miniLabel,
    marginBottom: 8,
  },
  details: {
    marginTop: 14,
    borderTop: `1px solid ${colors.cardBorder}`,
    paddingTop: 12,
  },
  detailsSummary: {
    cursor: "pointer",
    listStyle: "none",
    fontSize: 13,
    fontWeight: 600,
    color: colors.title,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 8,
  },
  detailsHint: {
    fontSize: 11,
    fontWeight: 400,
    color: colors.muted,
  },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    padding: "4px 0",
    color: colors.text,
    gap: 12,
  },
  addButton: ui.addButton,
  emptyState: {
    fontSize: 13,
    color: colors.muted,
    padding: 8,
    borderRadius: 8,
    border: `1px dashed ${colors.cardBorder}`,
    backgroundColor: colors.surfaceInset,
  },
  deleteButton: ui.deleteButton,
  prepayList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  // Flat, divider-separated row rather than a filled nested card — matches
  // the Recurring Rules / Upcoming Events lists, so the log reads as a
  // light ledger instead of a stack of heavy boxes-in-a-box.
  prepayCard: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingBottom: 10,
    borderBottom: `1px dashed ${colors.cardBorder}`,
  },
  prepayTopRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  },
  addNoteButton: {
    alignSelf: "flex-start",
    background: "transparent",
    border: "none",
    padding: "2px 0",
    fontSize: 12,
    color: colors.muted,
    cursor: "pointer",
  },
  // Dense control for the compact rows. It shares the app-wide input chrome
  // (colors.inputBg fill, colors.inputBorder outline) so these fields read
  // like every other input; only the padding/font are tightened.
  fieldControl: {
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`,
    padding: "6px 8px",
    backgroundColor: colors.inputBg,
    color: colors.text,
    fontSize: 13,
  },
};