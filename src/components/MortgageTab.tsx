// src/components/MortgageTab.tsx
//
// The mortgage optimisation tab displays the baseline and actual
// mortgage metrics, allows users to enter past prepayments and
// compare different future prepayment scenarios.  This version
// includes several improvements:
//   • A shared date format helper ensures that all dates on the UI
//     use the `DD MMM 'YY` format (e.g. "26 Jan '25").
//   • Each past prepayment row now shows both the cumulative savings
//     versus the baseline mortgage and the incremental savings from
//     that prepayment alone.
//   • Type definitions and UI copy have been clarified.

import { useEffect, useMemo, useState } from "react";
import {
  computeBaselineMortgage,
  computeMortgageWithPrepayments,
  compareBaselineWithPrepayments,
  computeEffectiveAnnualRateFromSchedule,
  runMortgageScenarios,
} from "../domain/mortgage";
import type {
  MortgageOriginalTerms,
  PastPrepaymentLog,
  PastPrepayment,
} from "../domain/mortgage/types";
import type {
  MortgageScenarioConfig,
  MonthlyScenarioPattern,
  ScenarioPattern,
  ScenarioPatternKind,
  OneTimeScenarioPattern,
  YearlyScenarioPattern,
  BiweeklyScenarioPattern,
} from "../domain/mortgage";
import {
  loadMortgageUIState,
  saveMortgageUIState,
  createDefaultMortgageUIState,
  type MortgageUIState,
} from "../domain/mortgage/persistence";

// Shared date formatting helper.  This utility converts ISO dates
// (YYYY‑MM‑DD) into the display format required by the product
// specification, e.g. "2025-01-26" → "26 Jan '25".
import { formatDate } from "../utils/dates";

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
// and months.  E.g. 34 → "2 yrs 10 mos".  Zero or negative values
// return an em dash to indicate no savings.
function formatMonthsAsYearsMonths(
  totalMonths: number | null | undefined
): string {
  if (totalMonths == null || !Number.isFinite(totalMonths) || totalMonths <= 0) {
    return "—";
  }
  const months = Math.floor(totalMonths);
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
// YYYY‑MM‑DD internally, users always see the DD MMM 'YY
// representation alongside it.  Consumers must provide the value,
// onChange handler and styling for the input.
function DateInputWithDisplay({
  value,
  onChange,
  inputStyle,
}: {
  value: string;
  onChange: (val: string) => void;
  inputStyle: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
      <span style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
        {formatDate(value) || "—"}
      </span>
    </div>
  );
}

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
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <span style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 2 }}>{label}</span>
      <DateInputWithDisplay
        value={value}
        onChange={onChange}
        inputStyle={{
          borderRadius: 6,
          border: "1px solid #27272a",
          padding: "4px 6px",
          backgroundColor: "#020617",
          color: "#e4e4e7",
          fontSize: 11,
        }}
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
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <span style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 2 }}>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        step={step}
        style={{
          borderRadius: 6,
          border: "1px solid #27272a",
          padding: "4px 6px",
          backgroundColor: "#020617",
          color: "#e4e4e7",
          fontSize: 11,
        }}
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
    <div
      style={{
        borderRadius: 12,
        padding: 16,
        background: "linear-gradient(145deg, rgba(24, 24, 27, 0.98), rgba(9, 9, 11, 0.98))",
        border: "1px solid #27272a",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
        marginBottom: 24,
        width: "100%",
      }}
    >
      <h3
        style={{
          margin: 0,
          marginBottom: subtitle ? 4 : 12,
          fontSize: 16,
          fontWeight: 600,
          color: "#f4f4f5",
        }}
      >
        {title}
      </h3>
      {subtitle && (
        <div style={{ fontSize: 12, color: "#a1a1aa", marginBottom: 12 }}>{subtitle}</div>
      )}
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
  /** Interest saved by this prepayment alone compared with the previous scenario. */
  interestSavedIncremental: number;
  /** Months saved by this prepayment alone compared with the previous scenario. */
  monthsSavedIncremental: number;
};

export default function MortgageTab() {
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
  const [scenarios, setScenarios] = useState<MortgageScenarioConfig[]>(
    initialUI.scenarios ?? []
  );

  // Persist on any relevant change
  useEffect(() => {
    const uiState: MortgageUIState = {
      terms,
      prepayments: prepayments
        .filter((p) => p.date && p.amount > 0)
        .map((p) => ({ date: p.date, amount: p.amount, note: p.note })),
      asOfDate: asOfDate || terms.startDate,
      scenarios,
    };
    saveMortgageUIState(uiState);
  }, [terms, prepayments, asOfDate, scenarios]);

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
    const startDate = overrides?.startDate ?? terms.startDate;

    const principal = parseNumber(pStr) ?? initialUI.terms.principal;
    const annualRate =
      (parseNumber(rStr) ?? initialUI.terms.annualRate * 100) / 100;
    const years = parseNumber(yStr) ?? initialUI.terms.termMonths / 12;
    const termMonths = Math.max(1, Math.round(years * 12));

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

  const comparison = useMemo(
    () => compareBaselineWithPrepayments(terms, prepaymentLog),
    [baseline, withPrepayments]
  );

  const baselineEffectiveRate = useMemo(
    () =>
      computeEffectiveAnnualRateFromSchedule(
        baseline.schedule,
        terms.principal
      ),
    [baseline.schedule, terms.principal]
  );

  const actualEffectiveRate = useMemo(
    () =>
      computeEffectiveAnnualRateFromSchedule(
        withPrepayments.schedule,
        terms.principal
      ),
    [withPrepayments.schedule, terms.principal]
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
    // Keep track of the previous scenario to compute incremental savings.
    let prevActual = baseline;
    return sorted.map((p, index) => {
      // Build the prefix up to and including this prepayment
      const prefix = sorted.slice(0, index + 1);
      const actual = computeMortgageWithPrepayments(terms, prefix);
      // Total savings vs baseline
      const interestSaved = baseline.totalInterest - actual.totalInterest;
      const monthsSaved = baseline.schedule.length - actual.schedule.length;
      // Incremental savings compared with the previous scenario
      const interestSavedIncremental =
        prevActual.totalInterest - actual.totalInterest;
      const monthsSavedIncremental =
        prevActual.schedule.length - actual.schedule.length;
      // Effective rate after this prepayment
      const effectiveRate = computeEffectiveAnnualRateFromSchedule(
        actual.schedule,
        terms.principal
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepaymentLog, terms, baseline]);

  // -------- Scenario engine wiring --------

  const scenarioRun = useMemo(() => {
    return runMortgageScenarios(
      {
        terms,
        pastPrepayments: prepaymentLog,
        asOfDate: asOfDate || terms.startDate,
      },
      scenarios
    );
  }, [terms, prepaymentLog, asOfDate, scenarios]);

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

  // -------- Scenario editing helpers (patterns: one-time, monthly, yearly, biweekly) --------

  function addScenario() {
    const baseDate = asOfDate || terms.startDate;

    const newMonthlyPattern: MonthlyScenarioPattern = {
      id: uuid(),
      label: "Monthly extra",
      kind: "monthly",
      amount: 200,
      startDate: baseDate,
      dayOfMonthStrategy: "same-as-due-date",
    };

    const newScenario: MortgageScenarioConfig = {
      id: uuid(),
      name: `Scenario ${scenarios.length + 1}`,
      description: "",
      active: true,
      patterns: [newMonthlyPattern],
    };

    setScenarios((prev) => [...prev, newScenario]);
  }

  function updateScenario(
    id: string,
    patch: Partial<Pick<MortgageScenarioConfig, "name" | "description" | "active">>
  ) {
    setScenarios((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  }

  function deleteScenario(id: string) {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
  }

  function addScenarioPattern(
    scenarioId: string,
    kind: ScenarioPatternKind
  ) {
    const baseDate = asOfDate || terms.startDate;

    setScenarios((prev) =>
      prev.map((s) => {
        if (s.id !== scenarioId) return s;
        const patterns = [...(s.patterns ?? [])];

        let newPattern: ScenarioPattern;

        switch (kind) {
          case "oneTime": {
            const p: OneTimeScenarioPattern = {
              id: uuid(),
              label: "One-time extra",
              kind: "oneTime",
              amount: 0,
              date: baseDate,
            };
            newPattern = p;
            break;
          }
          case "monthly": {
            const p: MonthlyScenarioPattern = {
              id: uuid(),
              label: "Monthly extra",
              kind: "monthly",
              amount: 0,
              startDate: baseDate,
              dayOfMonthStrategy: "same-as-due-date",
            };
            newPattern = p;
            break;
          }
          case "yearly": {
            const [yStr, mStr, dStr] = baseDate.split("-");
            const year = Number(yStr) || new Date().getFullYear();
            const month = Number(mStr) || 1;
            const day = Number(dStr) || 1;
            const p: YearlyScenarioPattern = {
              id: uuid(),
              label: "Annual extra",
              kind: "yearly",
              amount: 0,
              month,
              day,
              firstYear: year,
            };
            newPattern = p;
            break;
          }
          case "biweekly": {
            const p: BiweeklyScenarioPattern = {
              id: uuid(),
              label: "Biweekly extra",
              kind: "biweekly",
              amount: 0,
              anchorDate: baseDate,
              startDate: baseDate,
            };
            newPattern = p;
            break;
          }
          default:
            return s;
        }

        return {
          ...s,
          patterns: [...patterns, newPattern],
        };
      })
    );
  }

  function updateScenarioPattern(
    scenarioId: string,
    patternId: string,
    patch: Partial<ScenarioPattern>
  ) {
    setScenarios((prev) =>
      prev.map((s) => {
        if (s.id !== scenarioId) return s;
        const patterns = (s.patterns ?? []).map((p) =>
          p.id === patternId ? ({ ...p, ...patch } as ScenarioPattern) : p
        );
        return { ...s, patterns };
      })
    );
  }

  function deleteScenarioPattern(scenarioId: string, patternId: string) {
    setScenarios((prev) =>
      prev.map((s) => {
        if (s.id !== scenarioId) return s;
        const patterns = (s.patterns ?? []).filter((p) => p.id !== patternId);
        return { ...s, patterns };
      })
    );
  }

  function updateScenarioMonthlyAmount(id: string, newAmount: number) {
    setScenarios((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const patterns = [...(s.patterns ?? [])];
        const existingMonthlyIndex = patterns.findIndex(
          (p) => p.kind === "monthly"
        );

        const baseDate = asOfDate || terms.startDate;

        if (existingMonthlyIndex === -1) {
          const created: MonthlyScenarioPattern = {
            id: uuid(),
            label: "Monthly extra",
            kind: "monthly",
            amount: newAmount,
            startDate: baseDate,
            dayOfMonthStrategy: "same-as-due-date",
          };
          return { ...s, patterns: [...patterns, created] };
        }

        const first = patterns[existingMonthlyIndex] as MonthlyScenarioPattern;

        const updated: MonthlyScenarioPattern = {
          ...first,
          amount: newAmount,
          startDate: first.startDate || baseDate,
        };
        patterns[existingMonthlyIndex] = updated;
        return { ...s, patterns };
      })
    );
  }

  function getScenarioMonthlyAmount(s: MortgageScenarioConfig): number {
    const patterns = s.patterns ?? [];
    const firstMonthly = patterns.find(
      (p) => p.kind === "monthly"
    ) as MonthlyScenarioPattern | undefined;
    if (!firstMonthly) return 0;
    return firstMonthly.amount ?? 0;
  }

  function renderScenarioPatternRow(
    scenarioId: string,
    pattern: ScenarioPattern
  ) {
    const onDelete = () => deleteScenarioPattern(scenarioId, pattern.id);

    // A common header row for each pattern card.  Shows the kind chip
    // on the left and a delete button on the right.  This header
    // appears at the top of each pattern card regardless of type.
    function PatternHeader({ kind }: { kind: string }) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={styles.patternTypeChip}>{kind}</span>
          <button
            style={styles.patternDeleteButton}
            onClick={onDelete}
          >
            ✕
          </button>
        </div>
      );
    }

    // For one‑time patterns, display a card with label, amount and date.
    if (pattern.kind === "oneTime") {
      const p = pattern as OneTimeScenarioPattern;
      return (
        <div key={pattern.id} style={styles.patternCard}>
          <PatternHeader kind="One‑time" />
          <div style={styles.fieldRow}>
            <span style={styles.fieldLabel}>Label</span>
            <input
              style={styles.fieldControl}
              type="text"
              value={p.label}
              placeholder="Description"
              onChange={(e) =>
                updateScenarioPattern(scenarioId, p.id, { label: e.target.value })
              }
            />
          </div>
          <div style={styles.fieldRow}>
            <span style={styles.fieldLabel}>Amount</span>
            <input
              style={{ ...styles.fieldControl, textAlign: "right" }}
              type="text"
              value={p.amount ? p.amount.toString() : ""}
              placeholder="0"
              onChange={(e) => {
                const n = parseNumber(e.target.value) ?? 0;
                updateScenarioPattern(scenarioId, p.id, { amount: n });
              }}
            />
          </div>
          <div style={styles.fieldRow}>
            <LabeledDateInput
              label="Date"
              value={p.date}
              onChange={(val) =>
                updateScenarioPattern(scenarioId, p.id, { date: val })
              }
            />
          </div>
        </div>
      );
    }

    // Monthly patterns: support start, until and cadence options in a
    // vertical layout with labelled fields.  Extra fields for
    // specific day and nth weekday are shown conditionally.
    if (pattern.kind === "monthly") {
      const p = pattern as MonthlyScenarioPattern;
      return (
        <div key={pattern.id} style={styles.patternCard}>
          <PatternHeader kind="Monthly" />
          <div style={styles.fieldRow}>
            <span style={styles.fieldLabel}>Label</span>
            <input
              style={styles.fieldControl}
              type="text"
              value={p.label}
              placeholder="Description"
              onChange={(e) =>
                updateScenarioPattern(scenarioId, p.id, { label: e.target.value })
              }
            />
          </div>
          <div style={styles.fieldRow}>
            <span style={styles.fieldLabel}>Amount</span>
            <input
              style={{ ...styles.fieldControl, textAlign: "right" }}
              type="text"
              value={p.amount ? p.amount.toString() : ""}
              placeholder="0"
              onChange={(e) => {
                const n = parseNumber(e.target.value) ?? 0;
                updateScenarioPattern(scenarioId, p.id, { amount: n });
              }}
            />
          </div>
          <div style={styles.fieldRow}>
            <LabeledDateInput
              label="Start date"
              value={p.startDate}
              onChange={(val) =>
                updateScenarioPattern(scenarioId, p.id, {
                  startDate: val,
                })
              }
            />
          </div>
          <div style={styles.fieldRow}>
            <LabeledDateInput
              label="Until (optional)"
              value={p.untilDate ?? ""}
              onChange={(val) =>
                updateScenarioPattern(scenarioId, p.id, {
                  untilDate: val || undefined,
                })
              }
            />
          </div>
          <div style={styles.fieldRow}>
            <span style={styles.fieldLabel}>Cadence</span>
            <select
              style={styles.fieldControl}
              value={p.dayOfMonthStrategy}
              onChange={(e) =>
                updateScenarioPattern(scenarioId, p.id, {
                  dayOfMonthStrategy: e.target
                    .value as MonthlyScenarioPattern["dayOfMonthStrategy"],
                })
              }
            >
              <option value="same-as-due-date">Due date</option>
              <option value="specific-day">Day of month</option>
              <option value="nth-weekday">Nth weekday</option>
            </select>
          </div>
          {p.dayOfMonthStrategy === "specific-day" && (
            <div style={styles.fieldRow}>
              <span style={styles.fieldLabel}>Day of month</span>
              <input
                style={styles.fieldControl}
                type="number"
                min={1}
                max={28}
                value={p.specificDayOfMonth ?? ""}
                placeholder="Day"
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!raw) {
                    updateScenarioPattern(scenarioId, p.id, {
                      specificDayOfMonth: undefined,
                    });
                    return;
                  }
                  let n = Number(raw);
                  if (!Number.isFinite(n)) n = 1;
                  n = Math.min(28, Math.max(1, Math.floor(n)));
                  updateScenarioPattern(scenarioId, p.id, {
                    specificDayOfMonth: n,
                  });
                }}
              />
            </div>
          )}
          {p.dayOfMonthStrategy === "nth-weekday" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <span style={styles.fieldLabel}>Nth</span>
                <input
                  style={styles.fieldControl}
                  type="number"
                  min={1}
                  max={5}
                  value={p.nthWeekday ?? ""}
                  placeholder="Nth"
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (!raw) {
                      updateScenarioPattern(scenarioId, p.id, {
                        nthWeekday: undefined,
                      });
                      return;
                    }
                    let n = Number(raw);
                    if (!Number.isFinite(n)) n = 1;
                    n = Math.min(5, Math.max(1, Math.floor(n)));
                    updateScenarioPattern(scenarioId, p.id, {
                      nthWeekday: n,
                    });
                  }}
                />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <span style={styles.fieldLabel}>Weekday</span>
                <select
                  style={styles.fieldControl}
                  value={p.weekday ?? 1}
                  onChange={(e) => {
                    let v = Number(e.target.value);
                    if (!Number.isFinite(v)) v = 1;
                    updateScenarioPattern(scenarioId, p.id, {
                      weekday: v,
                    });
                  }}
                >
                  <option value={1}>Mon</option>
                  <option value={2}>Tue</option>
                  <option value={3}>Wed</option>
                  <option value={4}>Thu</option>
                  <option value={5}>Fri</option>
                  <option value={6}>Sat</option>
                  <option value={7}>Sun</option>
                </select>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Annual patterns: choose month, day and year range in a vertical layout.
    if (pattern.kind === "yearly") {
      const p = pattern as YearlyScenarioPattern;
      return (
        <div key={pattern.id} style={styles.patternCard}>
          <PatternHeader kind="Annual" />
          <div style={styles.fieldRow}>
            <span style={styles.fieldLabel}>Label</span>
            <input
              style={styles.fieldControl}
              type="text"
              value={p.label}
              placeholder="Description"
              onChange={(e) =>
                updateScenarioPattern(scenarioId, p.id, { label: e.target.value })
              }
            />
          </div>
          <div style={styles.fieldRow}>
            <span style={styles.fieldLabel}>Amount</span>
            <input
              style={{ ...styles.fieldControl, textAlign: "right" }}
              type="text"
              value={p.amount ? p.amount.toString() : ""}
              placeholder="0"
              onChange={(e) => {
                const n = parseNumber(e.target.value) ?? 0;
                updateScenarioPattern(scenarioId, p.id, { amount: n });
              }}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span style={styles.fieldLabel}>Month (1‑12)</span>
              <input
                style={styles.fieldControl}
                type="number"
                min={1}
                max={12}
                value={p.month}
                placeholder="M"
                onChange={(e) => {
                  let n = Number(e.target.value);
                  if (!Number.isFinite(n)) n = 1;
                  n = Math.min(12, Math.max(1, Math.floor(n)));
                  updateScenarioPattern(scenarioId, p.id, { month: n });
                }}
              />
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span style={styles.fieldLabel}>Day (1‑31)</span>
              <input
                style={styles.fieldControl}
                type="number"
                min={1}
                max={31}
                value={p.day}
                placeholder="D"
                onChange={(e) => {
                  let n = Number(e.target.value);
                  if (!Number.isFinite(n)) n = 1;
                  n = Math.min(31, Math.max(1, Math.floor(n)));
                  updateScenarioPattern(scenarioId, p.id, { day: n });
                }}
              />
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span style={styles.fieldLabel}>From year</span>
              <input
                style={styles.fieldControl}
                type="number"
                value={p.firstYear}
                placeholder="From"
                onChange={(e) => {
                  let n = Number(e.target.value);
                  if (!Number.isFinite(n)) n = new Date().getFullYear();
                  n = Math.floor(n);
                  updateScenarioPattern(scenarioId, p.id, { firstYear: n });
                }}
              />
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span style={styles.fieldLabel}>To year (optional)</span>
              <input
                style={styles.fieldControl}
                type="number"
                value={p.lastYear ?? ""}
                placeholder="To"
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!raw) {
                    updateScenarioPattern(scenarioId, p.id, {
                      lastYear: undefined,
                    });
                    return;
                  }
                  let n = Number(raw);
                  if (!Number.isFinite(n)) n = p.firstYear;
                  n = Math.floor(n);
                  updateScenarioPattern(scenarioId, p.id, { lastYear: n });
                }}
              />
            </div>
          </div>
        </div>
      );
    }

    // Biweekly patterns: specify anchor, start and until dates.
    if (pattern.kind === "biweekly") {
      const p = pattern as BiweeklyScenarioPattern;
      return (
        <div key={pattern.id} style={styles.patternCard}>
          <PatternHeader kind="Biweekly" />
          <div style={styles.fieldRow}>
            <span style={styles.fieldLabel}>Label</span>
            <input
              style={styles.fieldControl}
              type="text"
              value={p.label}
              placeholder="Description"
              onChange={(e) =>
                updateScenarioPattern(scenarioId, p.id, { label: e.target.value })
              }
            />
          </div>
          <div style={styles.fieldRow}>
            <span style={styles.fieldLabel}>Amount</span>
            <input
              style={{ ...styles.fieldControl, textAlign: "right" }}
              type="text"
              value={p.amount ? p.amount.toString() : ""}
              placeholder="0"
              onChange={(e) => {
                const n = parseNumber(e.target.value) ?? 0;
                updateScenarioPattern(scenarioId, p.id, { amount: n });
              }}
            />
          </div>
          <div style={styles.fieldRow}>
            <LabeledDateInput
              label="Anchor date"
              value={p.anchorDate}
              onChange={(val) =>
                updateScenarioPattern(scenarioId, p.id, {
                  anchorDate: val,
                })
              }
            />
          </div>
          <div style={styles.fieldRow}>
            <LabeledDateInput
              label="Start (optional)"
              value={p.startDate ?? ""}
              onChange={(val) =>
                updateScenarioPattern(scenarioId, p.id, {
                  startDate: val || undefined,
                })
              }
            />
          </div>
          <div style={styles.fieldRow}>
            <LabeledDateInput
              label="Until (optional)"
              value={p.untilDate ?? ""}
              onChange={(val) =>
                updateScenarioPattern(scenarioId, p.id, {
                  untilDate: val || undefined,
                })
              }
            />
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Mortgage Optimiser</h2>

      {/* Original loan terms */}
      <SectionCard title="Original loan terms">
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
            label="Scenario as‑of date"
            value={asOfDate}
            onChange={(val) => {
              const v = val || terms.startDate;
              setAsOfDate(v);
            }}
          />
        </div>

        {/* Baseline summary */}
        <div style={{ marginTop: 16 }}>
          <div style={styles.subHeading}>Baseline summary</div>
          <div style={styles.summaryRow}>
            <span>Monthly payment</span>
            <span>
              {formatCurrency(
                baseline.schedule.length > 0 ? baseline.schedule[0].payment : null
              )}
            </span>
          </div>
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

      {/* Past prepayments and actual vs baseline summary */}
      <SectionCard title="Past prepayments" subtitle="Log the extra payments you've already made">
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
          <div style={styles.table}>
            <div style={styles.tableHeaderRow}>
              <div style={styles.th}>Date</div>
              <div style={styles.th}>Amount</div>
              <div style={styles.th}>Note</div>
              <div />
            </div>
            {prepayments.map((row) => (
              <div key={row.id} style={styles.tableRow}>
                <DateInputWithDisplay
                  value={row.date}
                  onChange={(val) => updatePrepaymentRow(row.id, { date: val })}
                  inputStyle={styles.input}
                />
                <input
                  style={styles.input}
                  type="text"
                  value={row.amount.toString()}
                  onChange={(e) => {
                    const n = parseNumber(e.target.value) ?? 0;
                    updatePrepaymentRow(row.id, { amount: n });
                  }}
                />
                <input
                  style={styles.input}
                  type="text"
                  value={row.note ?? ""}
                  placeholder="Optional"
                  onChange={(e) => updatePrepaymentRow(row.id, { note: e.target.value })}
                />
                <button
                  style={styles.deleteButton}
                  onClick={() => deletePrepaymentRow(row.id)}
                >
                  ✕
                </button>
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

        <div style={{ marginTop: 16 }}>
          <div style={styles.subHeading}>Benefit vs baseline</div>
          <div style={styles.summaryRow}>
            <span>Interest saved vs baseline</span>
            <span>{formatCurrency(comparison.interestSaved)}</span>
          </div>
          <div style={styles.summaryRow}>
            <span>Months saved vs baseline</span>
            <span>{formatMonthsAsYearsMonths(comparison.monthsSaved)}</span>
          </div>
        </div>
      </SectionCard>

      {/* Impact of each past prepayment */}
      {perPrepaymentImpacts.length > 0 && (
        <SectionCard title="Impact of each past prepayment">
          <div
            style={{
              borderRadius: 8,
              border: "1px solid #27272a",
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
                background: "linear-gradient(90deg, rgba(39,39,42,1), rgba(24,24,27,1))",
                borderBottom: "1px solid #3f3f46",
                color: "#a1a1aa",
              }}
            >
              <div>Date</div>
              <div>Amount</div>
              <div>Interest saved (tot | this)</div>
              <div>Months saved (tot | this)</div>
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
                  borderBottom: "1px solid #18181b",
                  backgroundColor: idx % 2 === 0 ? "#020617" : "#050816",
                }}
              >
                <div>{formatDateDisplay(row.date)}</div>
                <div>{formatCurrency(row.amount)}</div>
                <div>
                  <div>{formatCurrency(row.interestSaved)}</div>
                  <div style={{ fontSize: 10, color: "#6ee7b7" }}>
                    {row.interestSavedIncremental > 0
                      ? `+${formatCurrency(row.interestSavedIncremental)}`
                      : formatCurrency(row.interestSavedIncremental)}
                  </div>
                </div>
                <div>
                  <div>{formatMonthsAsYearsMonths(row.monthsSaved)}</div>
                  <div style={{ fontSize: 10, color: "#6ee7b7" }}>
                    {row.monthsSavedIncremental > 0
                      ? `+${formatMonthsAsYearsMonths(row.monthsSavedIncremental)}`
                      : formatMonthsAsYearsMonths(row.monthsSavedIncremental)}
                  </div>
                </div>
                <div>{formatPercent(row.effectiveRate)}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Scenarios */}
      <SectionCard title="What‑if scenarios" subtitle="Create scenarios to test future extra payments">
        <div style={{ marginBottom: 8 }}>
          <button style={styles.addButton} onClick={addScenario}>
            + Add scenario
          </button>
        </div>
        {scenarios.length === 0 ? (
          <div style={styles.emptyState}>
            No scenarios yet. Add scenarios to test different monthly extra payment strategies from the as‑of date.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {scenarios.map((s) => {
                const monthlyAmount = getScenarioMonthlyAmount(s);
                return (
                  <div key={s.id} style={styles.scenarioCard}>
                    <div style={styles.scenarioHeaderRow}>
                      <input
                        style={styles.scenarioNameInput}
                        type="text"
                        value={s.name}
                        onChange={(e) => updateScenario(s.id, { name: e.target.value })}
                      />
                      <label style={styles.scenarioToggleLabel}>
                        <input
                          type="checkbox"
                          checked={s.active}
                          onChange={(e) => updateScenario(s.id, { active: e.target.checked })}
                        />
                        <span style={{ marginLeft: 4 }}>Active</span>
                      </label>
                      <button
                        style={styles.deleteButton}
                        onClick={() => deleteScenario(s.id)}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={styles.scenarioBodyRow}>
                      <label style={styles.label}>Monthly extra</label>
                      <input
                        style={styles.input}
                        type="text"
                        value={monthlyAmount > 0 ? monthlyAmount.toString() : ""}
                        placeholder="0"
                        onChange={(e) => {
                          const n = parseNumber(e.target.value) ?? 0;
                          updateScenarioMonthlyAmount(s.id, n);
                        }}
                      />
                    </div>
                    <div style={styles.scenarioPatternsSection}>
                      <div style={styles.scenarioPatternsHeaderRow}>
                        <span style={styles.patternHeaderKind}>Type</span>
                        <span style={styles.patternHeaderLabel}>Label</span>
                        <span style={styles.patternHeaderAmount}>Amount</span>
                        <span style={styles.patternHeaderDates}>Dates / cadence</span>
                        <span style={styles.patternHeaderActions}></span>
                      </div>
                      {(s.patterns ?? []).length === 0 ? (
                        <div style={styles.scenarioPatternsEmpty}>
                          No future prepayment patterns yet. Use the Monthly extra above or add a pattern below.
                        </div>
                      ) : (
                        (s.patterns ?? []).map((p) => renderScenarioPatternRow(s.id, p))
                      )}
                      <div style={styles.scenarioPatternAddRow}>
                        <span style={styles.scenarioPatternAddLabel}>Add pattern:</span>
                        <button
                          style={styles.scenarioPatternAddButton}
                          onClick={() => addScenarioPattern(s.id, "oneTime")}
                        >
                          One-time
                        </button>
                        <button
                          style={styles.scenarioPatternAddButton}
                          onClick={() => addScenarioPattern(s.id, "monthly")}
                        >
                          Monthly
                        </button>
                        <button
                          style={styles.scenarioPatternAddButton}
                          onClick={() => addScenarioPattern(s.id, "yearly")}
                        >
                          Annual
                        </button>
                        <button
                          style={styles.scenarioPatternAddButton}
                          onClick={() => addScenarioPattern(s.id, "biweekly")}
                        >
                          Biweekly
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {scenarioRun.scenarios.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={styles.subHeading}>Scenario comparison</div>
                {scenarioRun.scenarios.map((s) => (
                  <div key={s.scenarioId} style={styles.summaryRow}>
                    <span>{s.scenarioName}</span>
                    <span>
                      Payoff {formatDateDisplay(s.payoffDate)} · Interest {formatCurrency(s.totalInterest)} · Saved vs actual {formatCurrency(s.interestSavedVsActual)} {formatMonthsAsYearsMonths(s.monthsSavedVsActual) !== "—" ? `· ${formatMonthsAsYearsMonths(s.monthsSavedVsActual)} sooner` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    color: "#e4e4e7",
    backgroundColor: "#020617",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  },
  heading: {
    fontSize: 20,
    fontWeight: 600,
    color: "#f9fafb",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 16,
  },
  card: {
    borderRadius: 12,
    border: "1px solid #27272a",
    padding: 16,
    background:
      "linear-gradient(145deg, rgba(24,24,27,0.98), rgba(9,9,11,0.98))",
    boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 12,
    color: "#f4f4f5",
  },
  subHeading: {
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 8,
    color: "#e4e4e7",
    textTransform: "uppercase",
    letterSpacing: 0.08,
  },
  inputRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  },
  label: {
    fontSize: 12,
    color: "#a1a1aa",
  },
  input: {
    borderRadius: 8,
    border: "1px solid #3f3f46",
    padding: "6px 8px",
    backgroundColor: "#18181b",
    color: "#e4e4e7",
    fontSize: 13,
  },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    padding: "4px 0",
    color: "#d4d4d8",
    gap: 12,
  },
  addButton: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #4ade80",
    background:
      "radial-gradient(circle at top left, #22c55e 0, #16a34a 45%, #15803d 100%)",
    color: "#ecfdf5",
    cursor: "pointer",
  },
  emptyState: {
    fontSize: 13,
    color: "#a1a1aa",
    padding: 8,
    borderRadius: 8,
    border: "1px dashed #27272a",
    backgroundColor: "#09090b",
  },
  table: {
    borderRadius: 8,
    border: "1px solid #27272a",
    overflow: "hidden",
  },
  tableHeaderRow: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1.2fr 1.6fr 0.4fr",
    padding: "6px 8px",
    gap: 4,
    background:
      "linear-gradient(90deg, rgba(39,39,42,1), rgba(24,24,27,1))",
    borderBottom: "1px solid #3f3f46",
    fontSize: 12,
    color: "#a1a1aa",
  },
  tableRow: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1.2fr 1.6fr 0.4fr",
    padding: "6px 8px",
    gap: 4,
    backgroundColor: "#09090b",
    borderTop: "1px solid #18181b",
  },
  th: {
    paddingRight: 4,
  },
  thSmall: {
    textAlign: "right",
  },
  deleteButton: {
    fontSize: 12,
    padding: "2px 6px",
    borderRadius: 999,
    border: "1px solid #52525b",
    backgroundColor: "#18181b",
    color: "#fda4af",
    cursor: "pointer",
  },
  scenarioCard: {
    borderRadius: 10,
    border: "1px solid #27272a",
    padding: 10,
    backgroundColor: "#0b0b0f",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  scenarioHeaderRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  scenarioNameInput: {
    flex: 1,
    borderRadius: 8,
    border: "1px solid #3f3f46",
    padding: "4px 8px",
    backgroundColor: "#18181b",
    color: "#e4e4e7",
    fontSize: 13,
  },
  scenarioToggleLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: 12,
    color: "#a1a1aa",
  },
  scenarioBodyRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  scenarioPatternsSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1px solid #27272a",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  scenarioPatternsHeaderRow: {
    // Hide the old header row for patterns now that each pattern card
    // contains its own labels.  Keeping this entry in place avoids
    // removing the markup but ensures it takes up no space.
    display: "none",
  },
  patternHeaderKind: {},
  patternHeaderLabel: {},
  patternHeaderAmount: {
    textAlign: "right",
  },
  patternHeaderDates: {
    textAlign: "left",
  },
  patternHeaderActions: {
    textAlign: "center",
  },
  scenarioPatternsEmpty: {
    fontSize: 12,
    color: "#a1a1aa",
    padding: "4px 0 6px",
  },
  scenarioPatternRow: {
    display: "grid",
    gridTemplateColumns:
      "minmax(0, 70px) minmax(0, 1.2fr) minmax(0, 0.8fr) minmax(0, 1.6fr) minmax(0, 40px)",
    alignItems: "center",
    gap: 6,
    padding: "4px 0",
  },
  patternKindChip: {
    fontSize: 11,
    borderRadius: 999,
    padding: "2px 6px",
    border: "1px solid #3f3f46",
    backgroundColor: "#18181b",
    color: "#d4d4d8",
    justifySelf: "flex-start",
  },
  scenarioPatternLabelInput: {
    borderRadius: 6,
    border: "1px solid #27272a",
    padding: "4px 6px",
    backgroundColor: "#18181b",
    color: "#e4e4e7",
    fontSize: 12,
    width: "100%",
  },
  scenarioPatternAmountInput: {
    borderRadius: 6,
    border: "1px solid #27272a",
    padding: "4px 6px",
    backgroundColor: "#020617",
    color: "#e4e4e7",
    fontSize: 12,
    width: "100%",
    textAlign: "right",
  },
  patternDatesGroup: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
  },
  scenarioPatternDateInput: {
    borderRadius: 6,
    border: "1px solid #27272a",
    padding: "4px 6px",
    backgroundColor: "#020617",
    color: "#e4e4e7",
    fontSize: 11,
  },
  scenarioPatternSelect: {
    borderRadius: 6,
    border: "1px solid #27272a",
    padding: "4px 6px",
    backgroundColor: "#020617",
    color: "#e4e4e7",
    fontSize: 11,
  },
  scenarioPatternSmallInput: {
    width: 56,
    borderRadius: 6,
    border: "1px solid #27272a",
    padding: "4px 6px",
    backgroundColor: "#020617",
    color: "#e4e4e7",
    fontSize: 11,
  },
  scenarioPatternYearInput: {
    width: 72,
    borderRadius: 6,
    border: "1px solid #27272a",
    padding: "4px 6px",
    backgroundColor: "#020617",
    color: "#e4e4e7",
    fontSize: 11,
  },
  scenarioPatternDeleteButton: {
    borderRadius: 999,
    border: "1px solid #3f3f46",
    backgroundColor: "#18181b",
    color: "#a1a1aa",
    width: 26,
    height: 26,
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  scenarioPatternAddRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  scenarioPatternAddLabel: {
    fontSize: 11,
    color: "#a1a1aa",
  },
  scenarioPatternAddButton: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid #3f3f46",
    backgroundColor: "#18181b",
    color: "#e4e4e7",
    cursor: "pointer",
  },
  // New styles for the redesigned scenario pattern cards.
  // Each pattern card is its own vertical container with a small
  // header and labelled field rows.  This layout scales nicely on
  // mobile because the rows stack naturally and there are no
  // wide grid columns.  Labels use a smaller font to distinguish
  // them from the input values.
  patternCard: {
    borderRadius: 8,
    border: "1px solid #27272a",
    backgroundColor: "#09090b",
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  patternTypeChip: {
    fontSize: 11,
    borderRadius: 999,
    padding: "2px 6px",
    border: "1px solid #3f3f46",
    backgroundColor: "#18181b",
    color: "#d4d4d8",
  },
  patternDeleteButton: {
    borderRadius: 999,
    border: "1px solid #3f3f46",
    backgroundColor: "#18181b",
    color: "#a1a1aa",
    width: 26,
    height: 26,
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  fieldRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fieldLabel: {
    fontSize: 11,
    color: "#a1a1aa",
    minWidth: 80,
  },
  fieldControl: {
    flex: 1,
    borderRadius: 6,
    border: "1px solid #27272a",
    padding: "4px 6px",
    backgroundColor: "#020617",
    color: "#e4e4e7",
    fontSize: 11,
  },
};