// src/components/MortgageTab.tsx
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
} from "../domain/mortgage";
import {
  loadMortgageUIState,
  saveMortgageUIState,
  createDefaultMortgageUIState,
  type MortgageUIState,
} from "../domain/mortgage/persistence";

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function formatMonthsAsYearsMonths(totalMonths: number | null | undefined): string {
  if (totalMonths == null || !Number.isFinite(totalMonths) || totalMonths <= 0) {
    return "—";
  }
  const months = Math.floor(totalMonths);
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  const parts: string[] = [];
  if (years > 0) {
    parts.push(`${years} yr${years === 1 ? "" : "s"}`);
  }
  if (remainingMonths > 0) {
    parts.push(`${remainingMonths} mo${remainingMonths === 1 ? "" : "s"}`);
  }

  return parts.join(" ");
}

function formatDateDisplay(value: string | null | undefined): string {
  if (!value) return "";
  return value;
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type PrepaymentRow = PastPrepayment & { id: string };

export default function MortgageTab() {
  // Initialise from persisted state if available
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

  // -------- Scenario editing helpers (monthly-only v1) --------

  function addScenario() {
    const newMonthlyPattern: MonthlyScenarioPattern = {
      id: uuid(),
      label: "Monthly extra",
      kind: "monthly",
      amount: 200,
      startDate: asOfDate || terms.startDate,
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

  function updateScenarioMonthlyAmount(id: string, newAmount: number) {
    setScenarios((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const patterns = [...(s.patterns ?? [])];
        let first = patterns[0] as MonthlyScenarioPattern | undefined;

        if (!first || first.kind !== "monthly") {
          const created: MonthlyScenarioPattern = {
            id: uuid(),
            label: "Monthly extra",
            kind: "monthly",
            amount: newAmount,
            startDate: asOfDate || terms.startDate,
            dayOfMonthStrategy: "same-as-due-date",
          };
          return { ...s, patterns: [created] };
        }

        const updated: MonthlyScenarioPattern = {
          ...first,
          amount: newAmount,
          startDate: first.startDate || (asOfDate || terms.startDate),
        };
        patterns[0] = updated;
        return { ...s, patterns };
      })
    );
  }

  function getScenarioMonthlyAmount(s: MortgageScenarioConfig): number {
    const first = (s.patterns?.[0] ?? null) as
      | MonthlyScenarioPattern
      | null;
    if (!first || first.kind !== "monthly") return 0;
    return first.amount ?? 0;
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Mortgage Optimiser</h2>

      <div style={styles.grid}>
        {/* Left column: configuration */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Original terms</h3>

          <div style={styles.inputRow}>
            <label style={styles.label}>Principal</label>
            <input
              style={styles.input}
              type="text"
              value={principalInput}
              onChange={(e) => {
                const v = e.target.value;
                setPrincipalInput(v);
                updateTermsFromInputs({ principalInput: v });
              }}
            />
          </div>

          <div style={styles.inputRow}>
            <label style={styles.label}>Rate (APR %)</label>
            <input
              style={styles.input}
              type="text"
              value={rateInput}
              onChange={(e) => {
                const v = e.target.value;
                setRateInput(v);
                updateTermsFromInputs({ rateInput: v });
              }}
            />
          </div>

          <div style={styles.inputRow}>
            <label style={styles.label}>Term (years)</label>
            <input
              style={styles.input}
              type="text"
              value={yearsInput}
              onChange={(e) => {
                const v = e.target.value;
                setYearsInput(v);
                updateTermsFromInputs({ yearsInput: v });
              }}
            />
          </div>

          <div style={styles.inputRow}>
            <label style={styles.label}>Start date</label>
            <input
              style={styles.input}
              type="date"
              value={terms.startDate}
              onChange={(e) => {
                const v = e.target.value || terms.startDate;
                updateTermsFromInputs({ startDate: v });
              }}
            />
          </div>

          <div style={styles.inputRow}>
            <label style={styles.label}>Scenario as-of date</label>
            <input
              style={styles.input}
              type="date"
              value={asOfDate}
              onChange={(e) => {
                const v = e.target.value || terms.startDate;
                setAsOfDate(v);
              }}
            />
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={styles.subHeading}>Baseline summary</div>
            <div style={styles.summaryRow}>
              <span>Monthly payment</span>
              <span>{formatCurrency(baseline.schedule.length > 0 ? baseline.schedule[0].payment : null)}</span>
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
        </div>

        {/* Right column: prepayments, benefit, scenarios */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Prepayments</h3>

          <div style={{ marginBottom: 8 }}>
            <button style={styles.addButton} onClick={addPrepaymentRow}>
              + Add prepayment
            </button>
          </div>

          {prepayments.length === 0 ? (
            <div style={styles.emptyState}>
              No prepayments defined yet. Add rows to reflect extra principal
              payments you&apos;ve already made in the past.
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
                  <input
                    style={styles.input}
                    type="date"
                    value={row.date}
                    onChange={(e) =>
                      updatePrepaymentRow(row.id, { date: e.target.value })
                    }
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
                    onChange={(e) =>
                      updatePrepaymentRow(row.id, { note: e.target.value })
                    }
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
              <span>
                {formatMonthsAsYearsMonths(comparison.monthsSaved)}
              </span>
            </div>
          </div>

          {/* Scenarios section */}
          <div style={{ marginTop: 24 }}>
            <div style={styles.subHeading}>What-if scenarios (monthly extra)</div>
            <div style={{ marginBottom: 8 }}>
              <button style={styles.addButton} onClick={addScenario}>
                + Add scenario
              </button>
            </div>

            {scenarios.length === 0 ? (
              <div style={styles.emptyState}>
                No scenarios yet. Add scenarios to test different monthly extra
                payment strategies from the as-of date.
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
                            onChange={(e) =>
                              updateScenario(s.id, { name: e.target.value })
                            }
                          />
                          <label style={styles.scenarioToggleLabel}>
                            <input
                              type="checkbox"
                              checked={s.active}
                              onChange={(e) =>
                                updateScenario(s.id, { active: e.target.checked })
                              }
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
                            value={
                              monthlyAmount > 0 ? monthlyAmount.toString() : ""
                            }
                            placeholder="0"
                            onChange={(e) => {
                              const n = parseNumber(e.target.value) ?? 0;
                              updateScenarioMonthlyAmount(s.id, n);
                            }}
                          />
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
                          Payoff {formatDateDisplay(s.payoffDate)} · Interest{" "}
                          {formatCurrency(s.totalInterest)} · Saved vs actual{" "}
                          {formatCurrency(s.interestSavedVsActual)}{" "}
                          {s.monthsSavedVsActual > 0
                            ? `· ${s.monthsSavedVsActual} mo sooner`
                            : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
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
};
