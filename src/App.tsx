// src/App.tsx
import { useEffect, useState } from "react";
import { createInitialAppState } from "./domain/appState";
import { loadAppState, saveAppState } from "./domain/persistence";
import { runCashflowProjection } from "./domain/cashflowEngine";
import { computeSafeToSpend } from "./domain/safeToSpendEngine";
import type {
  AppState,
  FutureEvent,
  RecurringRule,
} from "./domain/types";
import OverrideModal from "./components/OverrideModal";
import RuleEditorModal from "./components/RuleEditorModal";
import MortgageTab from "./components/MortgageTab";

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

  const { metrics, events, timeline } = runCashflowProjection(state);
  const safe = computeSafeToSpend(state);

  const runningBalanceByDate = new Map<string, number>();
  for (const point of timeline) {
    runningBalanceByDate.set(point.date, point.balance);
  }

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
            <div style={styles.impactRow}>
              <span
                style={{
                  ...styles.impactBadge,
                  ...(safe.safeToSpendToday > 0
                    ? styles.impactPositive
                    : safe.safeToSpendToday === 0
                    ? styles.impactNeutral
                    : styles.impactNegative),
                }}
              >
                {safe.safeToSpendToday > 0
                  ? "You have room to spend"
                  : safe.safeToSpendToday === 0
                  ? "Right at your safety floor"
                  : "Below safety floor"}
              </span>
              <span>
                Min balance over horizon stays at{" "}
                {formatMoney(metrics.minBalance)} on{" "}
                {metrics.minBalanceDate ?? "—"}
              </span>
            </div>

            <div style={styles.metric}>
              First Negative Date:
              <b> {metrics.firstNegativeDate ?? "None"}</b>
            </div>
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Upcoming Events</h3>
            {events.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9ca3af" }}>
                No upcoming events in this horizon.
              </div>
            ) : (
              <>
                <div style={styles.eventHeaderRow}>
                  <span style={styles.eventDateCell}>Date</span>
                  <span style={styles.eventNameCell}>Name</span>
                  <span style={styles.eventAmountCell}>Amount</span>
                  <span style={styles.eventBalanceCell}>Balance</span>
                </div>
                {events.map((e) => {
                  const runningBalance = runningBalanceByDate.get(e.date);
                  return (
                    <div
                      key={e.id}
                      style={styles.eventRow}
                      onClick={() => setSelectedEvent(e)}
                    >
                      <span style={styles.eventDateCell}>{e.date}</span>
                      <span style={styles.eventNameCell}>
                        {e.ruleName}
                        {e.isOverridden && " *"}
                      </span>
                      <span
                        style={{
                          ...styles.eventAmountCell,
                          color:
                            e.effectiveAmount >= 0 ? "#4ade80" : "#f97373",
                          fontWeight: 600,
                        }}
                      >
                        {formatMoney(e.effectiveAmount)}
                      </span>
                      <span style={styles.eventBalanceCell}>
                        {runningBalance !== undefined
                          ? formatMoney(runningBalance)
                          : "—"}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}

      {/* MORTGAGE TAB */}
      {activeTab === "mortgage" && <MortgageTab />}

      {/* OVERRIDE MODAL */}      {/* OVERRIDE MODAL */}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 12,
    fontSize: 14,
  },
  input: {
    padding: 8,
    fontSize: 16,
    borderRadius: 8,
    border: "1px solid #1f2937",
    background: "#020617",
    color: "#e5e7eb",
    width: 160,
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
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  impactRow: {
    marginTop: 4,
    marginBottom: 8,
    fontSize: 12,
    color: "#9ca3af",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  impactBadge: {
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 500,
    border: "1px solid transparent",
  },
  impactPositive: {
    backgroundColor: "rgba(22, 163, 74, 0.15)",
    borderColor: "rgba(22, 163, 74, 0.6)",
    color: "#4ade80",
  },
  impactNeutral: {
    backgroundColor: "rgba(113, 113, 122, 0.25)",
    borderColor: "rgba(82, 82, 91, 0.9)",
    color: "#e4e4e7",
  },
  impactNegative: {
    backgroundColor: "rgba(220, 38, 38, 0.15)",
    borderColor: "rgba(248, 113, 113, 0.8)",
    color: "#fecaca",
  },

  eventHeaderRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: 11,
    fontWeight: 600,
    paddingBottom: 4,
    borderBottom: "1px solid #1f2933",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#9ca3af",
  },
  eventDateCell: {
    flex: "0 0 90px",
    textAlign: "left",
  },
  eventNameCell: {
    flex: "1 1 auto",
    textAlign: "left",
  },
  eventAmountCell: {
    flex: "0 0 110px",
    textAlign: "right",
  },
  eventBalanceCell: {
    flex: "0 0 120px",
    textAlign: "right",
  },
  eventRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: 14,
    paddingBottom: 8,
    borderBottom: "1px dashed #1f2933",
    marginBottom: 8,
    cursor: "pointer",
  },
};
