// src/App.tsx
import { useEffect, useState } from "react";
import { createInitialAppState } from "./domain/appState";
import { loadAppState, saveAppState } from "./domain/persistence";
import { runCashflowProjection } from "./domain/cashflowEngine";
import { computeSafeToSpend } from "./domain/safeToSpendEngine";
import { computeMonthlyPayment, simulateMortgage } from "./domain/mortgageEngine";
import type {
  AppState,
  FutureEvent,
  RecurringRule,
  MortgageConfig,
} from "./domain/types";
import OverrideModal from "./components/OverrideModal";
import RuleEditorModal from "./components/RuleEditorModal";

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    const loaded = loadAppState();
    return loaded ?? createInitialAppState();
  });

  const [selectedEvent, setSelectedEvent] = useState<FutureEvent | null>(
    null
  );

  const [editingRule, setEditingRule] = useState<RecurringRule | null>(
    null
  );
  const [editingIsNew, setEditingIsNew] = useState(false);

  const [activeTab, setActiveTab] = useState<
    "dashboard" | "config" | "mortgage"
  >("dashboard");

  // Mortgage UI state (local for now)
  const [mortgagePrincipal, setMortgagePrincipal] = useState(400000);
  const [mortgageRatePct, setMortgageRatePct] = useState(6.5); // % per year
  const [mortgageTermYears, setMortgageTermYears] = useState(30);
  const [mortgageStartDate, setMortgageStartDate] = useState(
    state.settings.startDate
  );
  const [mortgageExtraPayment, setMortgageExtraPayment] = useState(0);

  const { metrics, events } = runCashflowProjection(state);
  const safe = computeSafeToSpend(state);
  useEffect(() => {
    saveAppState(state);
  }, [state]);

  function updateStartingBalance(val: number) {
    setState((s) => ({ ...s, account: { startingBalance: val } }));
  }

  function updateStartDate(val: string) {
    setState((s) => ({
      ...s,
      settings: { ...s.settings, startDate: val },
    }));
    setMortgageStartDate((prev) => (prev ? prev : val));
  }

  function updateHorizonDays(val: number) {
    setState((s) => ({
      ...s,
      settings: { ...s.settings, horizonDays: val },
    }));
  }

  function updateMinSafeBalance(val: number) {
    setState((s) => ({
      ...s,
      settings: { ...s.settings, minSafeBalance: val },
    }));
  }

  function updateRuleAmount(rule: RecurringRule, val: number) {
    setState((s) => ({
      ...s,
      rules: s.rules.map((r) =>
        r.id === rule.id ? { ...r, amount: val } : r
      ),
    }));
  }

  function applyOverride(eventId: string, amount: number | null) {
    setState((s) => {
      const overrides = { ...s.overrides };

      if (amount === null) {
        delete overrides[eventId];
      } else {
        overrides[eventId] = {
          eventKey: eventId,
          overrideAmount: amount,
        };
      }

      return { ...s, overrides };
    });
  }

  function makeNewRule(): RecurringRule {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return {
      id,
      name: "New Rule",
      amount: 0,
      isVariable: false,
      schedule: {
        type: "monthly",
        day: 1,
      },
    };
  }

  // ---------------------------
  // Mortgage derived view model
  // ---------------------------

  type MortgageView = {
    baseConfig: MortgageConfig;
    monthlyPayment: number;
    baselineTotalInterest: number;
    baselinePayoffDate: string;
    extraPayment: number;
    withExtraTotalInterest: number;
    withExtraPayoffDate: string;
    interestSaved: number;
    monthsSaved: number;
    yearsSavedApprox: number;
  } | null;

  const mortgageView: MortgageView = (() => {
    const principal = Math.max(0, mortgagePrincipal);
    const ratePct = Math.max(0, mortgageRatePct);
    const termYears = Math.max(0.1, mortgageTermYears);
    const start =
      mortgageStartDate && mortgageStartDate.trim().length > 0
        ? mortgageStartDate
        : state.settings.startDate;

    if (!principal || !termYears || !start) {
      return null;
    }

    const termMonths = Math.max(1, Math.round(termYears * 12));
    const annualRate = ratePct / 100;
    const extra = Math.max(0, mortgageExtraPayment);

    const baseConfig: MortgageConfig = {
      principal,
      annualRate,
      termMonths,
      startDate: start,
      monthlyPayment: 0,
    };

    const monthlyPayment = computeMonthlyPayment(baseConfig);

    const configWithPayment: MortgageConfig = {
      ...baseConfig,
      monthlyPayment,
    };

    const baseline = simulateMortgage(configWithPayment, 0);
    const withExtra = simulateMortgage(configWithPayment, extra);

    const baselineInterest = baseline.totalInterestPaid;
    const withExtraInterest = withExtra.totalInterestPaid;
    const interestSaved = baselineInterest - withExtraInterest;

    const monthsSavedRaw =
      baseline.schedule.length - withExtra.schedule.length;
    const monthsSaved = Math.max(0, monthsSavedRaw);
    const yearsSavedApprox = monthsSaved / 12;

    return {
      baseConfig: configWithPayment,
      monthlyPayment,
      baselineTotalInterest: baselineInterest,
      baselinePayoffDate: baseline.payoffDate,
      extraPayment: extra,
      withExtraTotalInterest: withExtraInterest,
      withExtraPayoffDate: withExtra.payoffDate,
      interestSaved,
      monthsSaved,
      yearsSavedApprox,
    };
  })();

  return (
    <div style={styles.container}>
      <h2 style={styles.header}>💰 Finance Cockpit</h2>

      {/* TABS */}
      <div style={styles.tabRow}>
        <button
          style={
            activeTab === "dashboard"
              ? styles.tabButtonActive
              : styles.tabButton
          }
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>
        <button
          style={
            activeTab === "config"
              ? styles.tabButtonActive
              : styles.tabButton
          }
          onClick={() => setActiveTab("config")}
        >
          Settings & Rules
        </button>
        <button
          style={
            activeTab === "mortgage"
              ? styles.tabButtonActive
              : styles.tabButton
          }
          onClick={() => setActiveTab("mortgage")}
        >
          Mortgage Optimizer
        </button>
      </div>

      {/* CONFIG TAB */}
      {activeTab === "config" && (
        <>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Settings</h3>

            <label style={styles.label}>
              Start Date:
              <input
                type="date"
                value={state.settings.startDate}
                onChange={(e) => updateStartDate(e.target.value)}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Horizon (days):
              <input
                type="number"
                value={state.settings.horizonDays}
                onChange={(e) =>
                  updateHorizonDays(Number(e.target.value))
                }
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Minimum Safe Balance:
              <input
                type="number"
                value={state.settings.minSafeBalance}
                onChange={(e) =>
                  updateMinSafeBalance(Number(e.target.value))
                }
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Starting Balance:
              <input
                type="number"
                value={state.account.startingBalance}
                onChange={(e) =>
                  updateStartingBalance(Number(e.target.value))
                }
                style={styles.input}
              />
            </label>
          </div>

          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <h3 style={styles.cardTitle}>Recurring Rules</h3>
              <button
                style={styles.addButton}
                onClick={() => {
                  const newRule = makeNewRule();
                  setEditingRule(newRule);
                  setEditingIsNew(true);
                }}
              >
                + Add
              </button>
            </div>

            {state.rules.map((rule) => (
              <div key={rule.id} style={styles.ruleRow}>
                <div style={styles.ruleInfo}>
                  <div style={styles.ruleName}>{rule.name}</div>
                  <div style={styles.ruleMeta}>
                    {rule.schedule.type === "monthly" && (
                      <span>Monthly on day {rule.schedule.day}</span>
                    )}
                    {rule.schedule.type === "twiceMonth" && (
                      <span>
                        Twice a month: {rule.schedule.day1} &amp;{" "}
                        {rule.schedule.day2}
                        {rule.schedule.businessDayConvention ===
                          "previousBusinessDayUS" && " (prev US business day)"}
                      </span>
                    )}
                    {rule.schedule.type === "biweekly" && (
                      <span>
                        Biweekly from {rule.schedule.anchorDate}
                      </span>
                    )}
                  </div>
                </div>

                <div style={styles.ruleControls}>
                  <input
                    type="number"
                    value={rule.amount}
                    onChange={(e) =>
                      updateRuleAmount(rule, Number(e.target.value))
                    }
                    style={styles.inputSmall}
                  />
                  <button
                    style={styles.editButton}
                    onClick={() => {
                      setEditingRule(rule);
                      setEditingIsNew(false);
                    }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* DASHBOARD TAB */}
      {activeTab === "dashboard" && (
        <>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Projection Metrics</h3>

            <div style={styles.metric}>
              Balance Today:
              <b> {formatMoney(state.account.startingBalance)}</b>
            </div>

            <div style={styles.metric}>
              Minimum Balance:
              <b> {formatMoney(metrics.minBalance)}</b>
            </div>

            <div style={styles.metric}>
              Minimum Balance Date:
              <b> {metrics.minBalanceDate ?? "—"}</b>
            </div>

            <div style={styles.metric}>
              Projected Minimum Balance:
              <b> {formatMoney(safe.projectedMinBalance)}</b>
            </div>

            <div style={styles.metric}>
              Safe to Spend (based on projection):
              <b> {formatMoney(safe.safeToSpendToday)}</b>
            </div>

            <div style={styles.metric}>
              First Negative Date:
              <b> {metrics.firstNegativeDate ?? "None"}</b>
            </div>
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Upcoming Events</h3>
            {events.slice(0, 20).map((e) => (
              <div
                key={e.id}
                style={styles.eventRow}
                onClick={() => setSelectedEvent(e)}
              >
                <span>{e.date}</span>
                <span>
                  {e.ruleName}
                  {e.isOverridden && " *"}
                </span>

                <span
                  style={{
                    color: e.effectiveAmount >= 0 ? "#4ade80" : "#f97373",
                    fontWeight: 600,
                  }}
                >
                  {formatMoney(e.effectiveAmount)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* MORTGAGE TAB */}
      {activeTab === "mortgage" && (
        <>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Mortgage Inputs</h3>

            <label style={styles.label}>
              Principal
              <input
                type="number"
                value={mortgagePrincipal}
                onChange={(e) =>
                  setMortgagePrincipal(Number(e.target.value))
                }
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Annual Interest Rate (%)
              <input
                type="number"
                value={mortgageRatePct}
                onChange={(e) =>
                  setMortgageRatePct(Number(e.target.value))
                }
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Term (years)
              <input
                type="number"
                value={mortgageTermYears}
                onChange={(e) =>
                  setMortgageTermYears(Number(e.target.value))
                }
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Start Date
              <input
                type="date"
                value={mortgageStartDate}
                onChange={(e) =>
                  setMortgageStartDate(e.target.value)
                }
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Extra Monthly Payment (prepayment)
              <input
                type="number"
                value={mortgageExtraPayment}
                onChange={(e) =>
                  setMortgageExtraPayment(Number(e.target.value))
                }
                style={styles.input}
              />
            </label>
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Mortgage Summary</h3>

            {!mortgageView && (
              <div style={styles.metric}>
                Enter valid mortgage details to see results.
              </div>
            )}

            {mortgageView && (
              <>
                <div style={styles.metric}>
                  Baseline Monthly Payment:
                  <b> {formatMoney(mortgageView.monthlyPayment)}</b>
                </div>
                <div style={styles.metric}>
                  Baseline Payoff Date:
                  <b> {mortgageView.baselinePayoffDate}</b>
                </div>
                <div style={styles.metric}>
                  Baseline Total Interest:
                  <b>
                    {" "}
                    {formatMoney(mortgageView.baselineTotalInterest)}
                  </b>
                </div>

                <hr style={{ borderColor: "#1f2937", margin: "12px 0" }} />

                <div style={styles.metric}>
                  Extra Monthly Payment:
                  <b> {formatMoney(mortgageView.extraPayment)}</b>
                </div>
                <div style={styles.metric}>
                  New Payoff Date:
                  <b> {mortgageView.withExtraPayoffDate}</b>
                </div>
                <div style={styles.metric}>
                  New Total Interest:
                  <b>
                    {" "}
                    {formatMoney(mortgageView.withExtraTotalInterest)}
                  </b>
                </div>
                <div style={styles.metric}>
                  Interest Saved:
                  <b> {formatMoney(mortgageView.interestSaved)}</b>
                </div>
                <div style={styles.metric}>
                  Time Saved:
                  <b>
                    {" "}
                    {mortgageView.monthsSaved} months (
                    {mortgageView.yearsSavedApprox.toFixed(1)} years)
                  </b>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* OVERRIDE MODAL */}
      <OverrideModal
        event={selectedEvent}
        onSave={(amount) => {
          if (selectedEvent) applyOverride(selectedEvent.id, amount);
          setSelectedEvent(null);
        }}
        onClose={() => setSelectedEvent(null)}
      />

      {/* RULE EDITOR MODAL */}
      <RuleEditorModal
        rule={editingRule}
        defaultStartDate={state.settings.startDate}
        canDelete={!editingIsNew}
        onSave={(updatedRule) => {
          setState((s) => {
            const exists = s.rules.some(
              (r) => r.id === updatedRule.id
            );
            const rules = exists
              ? s.rules.map((r) =>
                  r.id === updatedRule.id ? updatedRule : r
                )
              : [...s.rules, updatedRule];
            return { ...s, rules };
          });
          setEditingRule(null);
          setEditingIsNew(false);
        }}
        onDelete={(ruleId) => {
          setState((s) => ({
            ...s,
            rules: s.rules.filter((r) => r.id !== ruleId),
          }));
          setEditingRule(null);
          setEditingIsNew(false);
        }}
        onClose={() => {
          setEditingRule(null);
          setEditingIsNew(false);
        }}
      />
    </div>
  );
}

function formatMoney(amount: number): string {
  if (!Number.isFinite(amount)) return "$0.00";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const styles: Record<string, any> = {
  container: {
    maxWidth: 520,
    margin: "0 auto",
    padding: 16,
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    color: "#e5e7eb",
  },
  header: {
    textAlign: "center",
    marginBottom: 16,
  },
  tabRow: {
    display: "flex",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid #374151",
    background: "transparent",
    color: "#9ca3af",
    fontSize: 14,
  },
  tabButtonActive: {
    flex: 1,
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid #2563eb",
    background: "#1d4ed8",
    color: "#f9fafb",
    fontSize: 14,
  },
  card: {
    background: "#111827",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    boxShadow: "0 1px 8px rgba(0,0,0,0.5)",
    border: "1px solid #1f2937",
  },
  cardTitle: {
    marginTop: 0,
    marginBottom: 12,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    marginBottom: 12,
    fontSize: 14,
  },
  input: {
    padding: 8,
    fontSize: 16,
    marginTop: 4,
    background: "#020617",
    color: "#e5e7eb",
    border: "1px solid #4b5563",
    borderRadius: 8,
  },
  inputSmall: {
    width: 90,
    padding: 6,
    fontSize: 14,
    background: "#020617",
    color: "#e5e7eb",
    border: "1px solid #4b5563",
    borderRadius: 8,
  },
  cardHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  addButton: {
    padding: "4px 10px",
    fontSize: 14,
    borderRadius: 999,
    border: "none",
    background: "#22c55e",
    color: "#022c22",
    fontWeight: 600,
  },
  ruleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 10,
    marginBottom: 10,
    borderBottom: "1px solid #1f2933",
    gap: 8,
  },
  ruleInfo: {
    flex: 1,
  },
  ruleName: {
    fontSize: 15,
    fontWeight: 600,
  },
  ruleMeta: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 4,
  },
  ruleControls: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
  },
  editButton: {
    padding: "4px 8px",
    fontSize: 13,
    borderRadius: 999,
    border: "none",
    background: "#3b82f6",
    color: "#f9fafb",
  },
  metric: {
    marginBottom: 8,
    fontSize: 14,
  },
  eventRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 14,
    paddingBottom: 8,
    borderBottom: "1px dashed #1f2933",
    marginBottom: 8,
    cursor: "pointer",
  },
};
