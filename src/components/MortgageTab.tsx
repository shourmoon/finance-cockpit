// src/components/MortgageTab.tsx
import { useMemo, useState } from "react";
import {
  computeBaselineMortgage,
  computeMortgageWithPrepayments,
  compareBaselineWithPrepayments,
  computeEffectiveAnnualRateFromSchedule,
} from "../domain/mortgage";
import type {
  MortgageOriginalTerms,
  PastPrepaymentLog,
  PastPrepayment,
} from "../domain/mortgage/types";

type PrepaymentRow = PastPrepayment & { id: string };

const emptyTerms: MortgageOriginalTerms = {
  principal: 300_000,
  annualRate: 0.05,
  termMonths: 360,
  startDate: "2025-01-01",
};

const initialPrepayments: PrepaymentRow[] = [];

function formatMoney(value: number | null | undefined): string {
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

export default function MortgageTab() {
  const [terms, setTerms] = useState<MortgageOriginalTerms>(emptyTerms);
  const [yearsInput, setYearsInput] = useState<string>(
    (emptyTerms.termMonths / 12).toString()
  );
  const [principalInput, setPrincipalInput] = useState<string>(
    emptyTerms.principal.toString()
  );
  const [rateInput, setRateInput] = useState<string>(
    (emptyTerms.annualRate * 100).toString()
  );
  const [prepayments, setPrepayments] =
    useState<PrepaymentRow[]>(initialPrepayments);

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

    const principal = parseNumber(pStr) ?? emptyTerms.principal;
    const annualRate =
      (parseNumber(rStr) ?? emptyTerms.annualRate * 100) / 100;
    const years = parseNumber(yStr) ?? emptyTerms.termMonths / 12;
    const termMonths = Math.max(1, Math.round(years * 12));

    setTerms({
      principal,
      annualRate,
      termMonths,
      startDate,
    });
  }

  const domainPrepayments: PastPrepaymentLog = useMemo(
    () =>
      prepayments
        .filter((p) => p.date && p.amount > 0)
        .map((p) => ({ date: p.date, amount: p.amount, note: p.note })),
    [prepayments]
  );

  const derived = useMemo(() => {
    try {
      const baseline = computeBaselineMortgage(terms);
      const actual = computeMortgageWithPrepayments(terms, domainPrepayments);
      const comparison = compareBaselineWithPrepayments(
        terms,
        domainPrepayments
      );

      const effBaseline = computeEffectiveAnnualRateFromSchedule(
        baseline.schedule,
        terms.principal
      );
      const effActual = computeEffectiveAnnualRateFromSchedule(
        actual.schedule,
        terms.principal
      );

      return {
        baseline,
        actual,
        comparison,
        effBaseline,
        effActual,
      };
    } catch {
      return null;
    }
  }, [terms, domainPrepayments]);

  function addPrepaymentRow() {
    setPrepayments((rows) => [
      ...rows,
      {
        id: uuid(),
        date: terms.startDate,
        amount: 1_000,
        note: "",
      },
    ]);
  }

  function updatePrepayment(
    id: string,
    field: keyof Omit<PrepaymentRow, "id">,
    value: string
  ) {
    setPrepayments((rows) =>
      rows.map((row) => {
        if (row.id !== id) return row;
        if (field === "amount") {
          const parsed = parseNumber(value) ?? 0;
          return { ...row, amount: parsed };
        }
        if (field === "date") {
          return { ...row, date: value };
        }
        if (field === "note") {
          return { ...row, note: value };
        }
        return row;
      })
    );
  }

  function removePrepayment(id: string) {
    setPrepayments((rows) => rows.filter((r) => r.id !== id));
  }

  return (
    <div style={styles.container}>
      <div style={styles.leftColumn}>
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Mortgage Inputs</h3>

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
                const v = e.target.value;
                updateTermsFromInputs({ startDate: v });
              }}
            />
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Past Prepayments</h3>
          {prepayments.length === 0 && (
            <div style={styles.metric}>No prepayments added yet.</div>
          )}

          {prepayments.length > 0 && (
            <div style={styles.table}>
              <div style={styles.tableHeader}>
                <div style={styles.th}>Date</div>
                <div style={styles.th}>Amount</div>
                <div style={styles.th}>Note</div>
                <div style={styles.thSmall}></div>
              </div>
              {prepayments.map((row) => (
                <div key={row.id} style={styles.tableRow}>
                  <div style={styles.td}>
                    <input
                      type="date"
                      style={styles.input}
                      value={row.date}
                      onChange={(e) =>
                        updatePrepayment(row.id, "date", e.target.value)
                      }
                    />
                  </div>
                  <div style={styles.td}>
                    <input
                      type="text"
                      style={styles.input}
                      value={row.amount.toString()}
                      onChange={(e) =>
                        updatePrepayment(row.id, "amount", e.target.value)
                      }
                    />
                  </div>
                  <div style={styles.td}>
                    <input
                      type="text"
                      style={styles.input}
                      value={row.note ?? ""}
                      onChange={(e) =>
                        updatePrepayment(row.id, "note", e.target.value)
                      }
                    />
                  </div>
                  <div style={styles.tdSmall}>
                    <button
                      type="button"
                      style={styles.deleteButton}
                      onClick={() => removePrepayment(row.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button type="button" style={styles.addButton} onClick={addPrepaymentRow}>
            + Add prepayment
          </button>
        </div>
      </div>

      <div style={styles.rightColumn}>
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Baseline (no prepayments)</h3>
          {derived ? (
            <>
              <div style={styles.metric}>
                Monthly payment{" "}
                <span style={styles.metricValue}>
                  {formatMoney(
                    derived.baseline.schedule[0]?.payment ?? null
                  )}
                </span>
              </div>
              <div style={styles.metric}>
                Payoff date{" "}
                <span style={styles.metricValue}>
                  {formatDateDisplay(derived.baseline.payoffDate)}
                </span>
              </div>
              <div style={styles.metric}>
                Total interest paid{" "}
                <span style={styles.metricValue}>
                  {formatMoney(derived.baseline.totalInterest)}
                </span>
              </div>
              <div style={styles.metric}>
                Effective annual rate{" "}
                <span style={styles.metricValue}>
                  {formatPercent(derived.effBaseline)}
                </span>
              </div>
            </>
          ) : (
            <div style={styles.metric}>
              Enter valid mortgage inputs to see baseline metrics.
            </div>
          )}
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Actual (with past prepayments)</h3>
          {derived ? (
            <>
              <div style={styles.metric}>
                Payoff date{" "}
                <span style={styles.metricValue}>
                  {formatDateDisplay(derived.actual.payoffDate)}
                </span>
              </div>
              <div style={styles.metric}>
                Total interest paid{" "}
                <span style={styles.metricValue}>
                  {formatMoney(derived.actual.totalInterest)}
                </span>
              </div>
              <div style={styles.metric}>
                Effective annual rate{" "}
                <span style={styles.metricValue}>
                  {formatPercent(derived.effActual)}
                </span>
              </div>
            </>
          ) : (
            <div style={styles.metric}>
              Enter valid mortgage inputs and prepayments to see actual path.
            </div>
          )}
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Comparison</h3>
          {derived ? (
            <>
              <div style={styles.metric}>
                Interest saved vs baseline{" "}
                <span style={styles.metricValueHighlight}>
                  {formatMoney(derived.comparison.interestSaved)}
                </span>
              </div>
              <div style={styles.metric}>
                Months shaved off{" "}
                <span style={styles.metricValueHighlight}>
                  {derived.comparison.monthsSaved}
                </span>
              </div>
            </>
          ) : (
            <div style={styles.metric}>
              Provide inputs to see savings vs the original mortgage.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    display: "flex",
    flexDirection: "row",
    gap: "16px",
    alignItems: "flex-start",
    justifyContent: "space-between",
    width: "100%",
  },
  leftColumn: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  rightColumn: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  card: {
    backgroundColor: "#111",
    borderRadius: 12,
    padding: "16px 16px 12px 16px",
    border: "1px solid #333",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.02)",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 12,
    color: "#fafafa",
  },
  inputRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginBottom: 8,
  } as React.CSSProperties,
  label: {
    fontSize: 12,
    color: "#ccc",
  },
  input: {
    backgroundColor: "#18181b",
    color: "#fafafa",
    borderRadius: 6,
    border: "1px solid #27272a",
    padding: "6px 8px",
    fontSize: 13,
    outline: "none",
  },
  metric: {
    fontSize: 13,
    color: "#e4e4e7",
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  metricValue: {
    fontWeight: 600,
    marginLeft: 8,
  },
  metricValueHighlight: {
    fontWeight: 700,
    marginLeft: 8,
    color: "#4ade80",
  },
  table: {
    borderRadius: 8,
    border: "1px solid #27272a",
    overflow: "hidden",
    marginBottom: 8,
  },
  tableHeader: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1.2fr 1.6fr 0.4fr",
    fontSize: 11,
    backgroundColor: "#18181b",
    color: "#a1a1aa",
    padding: "6px 8px",
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
  td: {
    paddingRight: 4,
  },
  tdSmall: {
    textAlign: "right",
  },
  addButton: {
    marginTop: 4,
    fontSize: 12,
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid #3f3f46",
    backgroundColor: "#18181b",
    color: "#e4e4e7",
    cursor: "pointer",
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
};
