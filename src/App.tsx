import { useEffect, useMemo, useState } from "react";
import { createInitialAppState } from "./domain/appState";
import { loadAppState, saveAppState } from "./domain/persistence";
import { runCashflowProjection } from "./domain/cashflowEngine";
import { computeSafeToSpendFromEvents, computeTopUpHint } from "./domain/safeToSpendEngine";
import type {
  AdhocTransaction,
  AppState,
  FutureEvent,
  RecurringRule,
} from "./domain/types";
import OverrideModal from "./components/OverrideModal";
import RuleEditorModal from "./components/RuleEditorModal";
import MortgageTab from "./components/MortgageTab";
import BalanceChart from "./components/BalanceChart";
// Import the SyncSection UI for cross-device synchronisation. This
// component exposes a form to enter a sync key and trigger sync
// operations. See src/components/SyncSection.tsx for details.
import SyncSection from "./components/SyncSection";
// Import a common date formatter to ensure all dates in the UI follow the
// same human‑friendly format (DD MMM 'YY). See src/utils/dates.ts for details.
import { formatDate } from "./utils/dates";
import { DateInputWithDisplay as SharedDateInput, NumberInput } from "./components/shared";

// Shared date input bound to this screen's input styling.
function DateInputWithDisplay({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <SharedDateInput value={value} onChange={onChange} inputStyle={styles.input} />
  );
}

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

  const { metrics, events, timeline } = useMemo(
    () => runCashflowProjection(state),
    [state]
  );
  // Derive safe-to-spend from the projection above instead of re-running it.
  const safe = useMemo(
    () =>
      computeSafeToSpendFromEvents(
        state.account.startingBalance,
        state.settings.minSafeBalance ?? 0,
        events
      ),
    [state.account.startingBalance, state.settings.minSafeBalance, events]
  );

  const topUp = useMemo(
    () => computeTopUpHint(timeline, state.settings.minSafeBalance ?? 0),
    [timeline, state.settings.minSafeBalance]
  );

  const runningBalanceByDate = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const point of timeline) {
      byDate.set(point.date, point.balance);
    }
    return byDate;
  }, [timeline]);

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
      rules: s.rules.map((r) => (r.id === rule.id ? { ...r, amount: val } : r)),
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

  function makeId(prefix: string): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function addAdhocTransaction() {
    const txn: AdhocTransaction = {
      id: makeId("txn"),
      name: "One-time transaction",
      amount: 0,
      date: state.settings.startDate,
    };
    setState((s) => ({
      ...s,
      adhocTransactions: [...s.adhocTransactions, txn],
    }));
  }

  function updateAdhocTransaction(
    id: string,
    patch: Partial<Omit<AdhocTransaction, "id">>
  ) {
    setState((s) => ({
      ...s,
      adhocTransactions: s.adhocTransactions.map((t) =>
        t.id === id ? { ...t, ...patch } : t
      ),
    }));
  }

  function deleteAdhocTransaction(id: string) {
    setState((s) => ({
      ...s,
      adhocTransactions: s.adhocTransactions.filter((t) => t.id !== id),
    }));
  }

  function makeNewRule(): RecurringRule {
    const id = makeId("rule");

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
            activeTab === "dashboard" ? styles.tabButtonActive : styles.tabButton
          }
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>
        <button
          style={
            activeTab === "config" ? styles.tabButtonActive : styles.tabButton
          }
          onClick={() => setActiveTab("config")}
        >
          Settings & Rules
        </button>
        <button
          style={
            activeTab === "mortgage" ? styles.tabButtonActive : styles.tabButton
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

            <label style={{ ...styles.label, flexDirection: "column", alignItems: "flex-start" }}>
              <span>Start Date:</span>
              {/* Use the DateInputWithDisplay wrapper so that the native date input
                  always shows the human‑friendly formatted date underneath. */}
              <DateInputWithDisplay
                value={state.settings.startDate}
                onChange={(val) => updateStartDate(val)}
              />
            </label>

            <label style={styles.label}>
              Horizon (days):
              <input
                type="number"
                value={state.settings.horizonDays}
                onChange={(e) => updateHorizonDays(Number(e.target.value))}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Minimum Safe Balance:
              <NumberInput
                value={state.settings.minSafeBalance}
                onChange={updateMinSafeBalance}
                inputStyle={styles.input}
              />
            </label>

            <label style={styles.label}>
              Starting Balance:
              <NumberInput
                value={state.account.startingBalance}
                onChange={updateStartingBalance}
                inputStyle={styles.input}
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
                        Twice a month: {rule.schedule.day1} &amp; {rule.schedule.day2}
                        {rule.schedule.businessDayConvention ===
                          "previousBusinessDayUS" && " (prev US business day)"}
                      </span>
                    )}
                    {rule.schedule.type === "biweekly" && (
                      <span>
                        Biweekly from {formatDate(rule.schedule.anchorDate)}
                      </span>
                    )}
                  </div>
                </div>

                <div style={styles.ruleControls}>
                  <NumberInput
                    value={rule.amount}
                    onChange={(val) => updateRuleAmount(rule, val)}
                    inputStyle={styles.inputSmall}
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

          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <h3 style={styles.cardTitle}>One-Time Transactions</h3>
              <button style={styles.addButton} onClick={addAdhocTransaction}>
                + Add
              </button>
            </div>

            {state.adhocTransactions.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9ca3af" }}>
                No one-time transactions yet. Add a known one-off inflow or
                expense (bonus, car repair, tuition…) and it will appear in
                the projection alongside your recurring rules.
              </div>
            ) : (
              [...state.adhocTransactions]
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((txn) => (
                  <div key={txn.id} style={styles.ruleRow}>
                    <div style={styles.ruleInfo}>
                      <input
                        type="text"
                        aria-label="Transaction name"
                        value={txn.name}
                        onChange={(e) =>
                          updateAdhocTransaction(txn.id, { name: e.target.value })
                        }
                        style={{ ...styles.input, width: "100%" }}
                      />
                      <div style={{ marginTop: 6 }}>
                        <DateInputWithDisplay
                          value={txn.date}
                          onChange={(val) => {
                            if (val) updateAdhocTransaction(txn.id, { date: val });
                          }}
                        />
                      </div>
                    </div>
                    <div style={styles.ruleControls}>
                      <NumberInput
                        ariaLabel="Transaction amount"
                        value={txn.amount}
                        onChange={(val) =>
                          updateAdhocTransaction(txn.id, { amount: val })
                        }
                        inputStyle={styles.inputSmall}
                      />
                      <button
                        style={styles.editButton}
                        aria-label="Delete transaction"
                        onClick={() => deleteAdhocTransaction(txn.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
            )}
          </div>

          {/* Sync & Multi-Device section: placed at the end of the
              settings tab so users can configure synchronisation after
              setting up their basic data. */}
          <SyncSection />
        </>
      )}

      {/* DASHBOARD TAB */}
      {activeTab === "dashboard" && (
        <>
          <div style={styles.card}>
            {/* Hero: the number the user opens the app for. */}
            <div style={styles.heroLabel}>Safe to Spend today</div>
            <div style={{ ...styles.heroValue, color: statusColor(metrics.status) }}>
              {formatMoney(safe.safeToSpendToday)}
            </div>
            <div style={styles.impactRow}>
              <span
                style={{
                  ...styles.impactBadge,
                  ...(metrics.status === "ok"
                    ? styles.impactPositive
                    : metrics.status === "warning"
                    ? styles.impactNeutral
                    : styles.impactNegative),
                }}
              >
                {metrics.status === "ok"
                  ? "You have room to spend"
                  : metrics.status === "warning"
                  ? "Right at your safety floor"
                  : "Below safety floor"}
              </span>
              <span>
                Min balance over horizon is {formatMoney(metrics.minBalance)} on{" "}
                {metrics.minBalanceDate ? formatDate(metrics.minBalanceDate) : "—"}
              </span>
            </div>

            {/* Top-up hint: for topping this account up from savings. */}
            {topUp && (
              <div style={styles.topUpRow}>
                <span style={styles.topUpAmount}>
                  Top up {formatMoney(topUp.amountNeeded)} by{" "}
                  {formatDate(topUp.neededBy)}
                </span>
                <span style={styles.topUpBy}>
                  {topUp.lowestDate === topUp.neededBy
                    ? "keeps you above your floor"
                    : `sized for the ${formatDate(topUp.lowestDate)} low of ${formatMoney(topUp.lowestBalance)} — one transfer covers the whole horizon`}
                </span>
              </div>
            )}

            <div style={styles.metricGrid}>
              <div style={styles.metricCell}>
                <span style={styles.metricKey}>Balance today</span>
                <span style={styles.metricVal}>
                  {formatMoney(state.account.startingBalance)}
                </span>
              </div>
              <div style={styles.metricCell}>
                <span style={styles.metricKey}>Minimum balance</span>
                <span
                  style={{
                    ...styles.metricVal,
                    color:
                      metrics.minBalance < 0
                        ? "#f97373"
                        : metrics.minBalance < state.settings.minSafeBalance
                        ? "#fbbf24"
                        : "#e4e4e7",
                  }}
                >
                  {formatMoney(metrics.minBalance)}
                </span>
              </div>
              <div style={styles.metricCell}>
                <span style={styles.metricKey}>Min balance date</span>
                <span style={styles.metricVal}>
                  {metrics.minBalanceDate ? formatDate(metrics.minBalanceDate) : "—"}
                </span>
              </div>
              <div style={styles.metricCell}>
                <span style={styles.metricKey}>First negative date</span>
                <span
                  style={{
                    ...styles.metricVal,
                    color: metrics.firstNegativeDate ? "#f97373" : "#e4e4e7",
                  }}
                >
                  {metrics.firstNegativeDate
                    ? formatDate(metrics.firstNegativeDate)
                    : "None"}
                </span>
              </div>
            </div>
          </div>

          {timeline.length > 0 && (
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Balance over horizon</h3>
              <BalanceChart
                timeline={timeline}
                minSafeBalance={state.settings.minSafeBalance}
              />
              <div style={styles.chartCaption}>
                Blue line = projected balance · amber dashed = your floor ·
                red = below $0
              </div>
            </div>
          )}

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Upcoming Events</h3>
            {events.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9ca3af" }}>
                No upcoming events in this horizon.
              </div>
            ) : (
              <>
                <div style={styles.eventsHint}>Tap a row to override its amount</div>
                {/* Two-line rows instead of a fixed-column table so the list
                    fits any screen width — on phones the old 90/110/120px
                    columns overflowed the card and forced zooming. */}
                {events.map((e) => {
                  const runningBalance = runningBalanceByDate.get(e.date);
                  return (
                    <div
                      key={e.id}
                      style={styles.eventRow}
                      onClick={() => setSelectedEvent(e)}
                    >
                      <div style={styles.eventTopRow}>
                        <span style={styles.eventName}>
                          {e.ruleName}
                          {e.isOverridden && " *"}
                        </span>
                        <span
                          style={{
                            ...styles.eventAmount,
                            color: e.effectiveAmount >= 0 ? "#4ade80" : "#f97373",
                          }}
                        >
                          {formatMoney(e.effectiveAmount)}
                        </span>
                        <span style={styles.eventChevron}>›</span>
                      </div>
                      <div style={styles.eventBottomRow}>
                        <span>{formatDate(e.date)}</span>
                        <span style={styles.eventBalance}>
                          {runningBalance !== undefined
                            ? `Balance ${formatMoney(runningBalance)}`
                            : "—"}
                        </span>
                      </div>
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
            const exists = s.rules.some((r) => r.id === updatedRule.id);
            const rules = exists
              ? s.rules.map((r) => (r.id === updatedRule.id ? updatedRule : r))
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

function statusColor(status: "ok" | "warning" | "alert"): string {
  return status === "ok" ? "#4ade80" : status === "warning" ? "#fbbf24" : "#f97373";
}

const styles: Record<string, any> = {
  container: {
    maxWidth: 600,
    margin: "0 auto",
    padding: 16,
    // Use the same dark background and typography as other tabs for
    // consistency.  The container also controls the overall text color.
    backgroundColor: "#020617",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
    color: "#e4e4e7",
    minHeight: "100vh",
  },
  header: {
    textAlign: "center",
    marginBottom: 16,
    fontWeight: 600,
    fontSize: 24,
    color: "#f4f4f5",
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
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    // Match the mortgage tab cards with a subtle gradient and border.  The
    // gradient adds depth while staying within the dark palette.
    background:
      "linear-gradient(145deg, rgba(24,24,27,0.98), rgba(9,9,11,0.98))",
    border: "1px solid #27272a",
    boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
  },
  cardTitle: {
    marginTop: 0,
    marginBottom: 12,
    fontSize: 16,
    fontWeight: 600,
    color: "#f4f4f5",
  },
  label: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 12,
    fontSize: 13,
    color: "#a1a1aa",
  },
  input: {
    padding: 8,
    fontSize: 14,
    borderRadius: 8,
    border: "1px solid #3f3f46",
    background: "#18181b",
    color: "#e4e4e7",
    width: 160,
  },
  inputSmall: {
    width: 90,
    padding: 6,
    fontSize: 13,
    background: "#18181b",
    color: "#e4e4e7",
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
    fontSize: 13,
    color: "#d4d4d8",
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
  eventRow: {
    paddingBottom: 8,
    borderBottom: "1px dashed #1f2933",
    marginBottom: 8,
    cursor: "pointer",
  },
  eventTopRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    fontSize: 14,
  },
  eventName: {
    flex: "1 1 auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  eventAmount: {
    flex: "0 0 auto",
    whiteSpace: "nowrap",
    fontWeight: 600,
  },
  eventBottomRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 2,
    fontSize: 12,
    color: "#9ca3af",
  },
  eventBalance: {
    whiteSpace: "nowrap",
  },
  eventChevron: {
    flex: "0 0 auto",
    color: "#52525b",
    fontSize: 18,
    lineHeight: 1,
  },
  eventsHint: {
    fontSize: 11,
    color: "#6b7280",
    marginBottom: 10,
  },
  chartCaption: {
    marginTop: 8,
    fontSize: 11,
    color: "#9ca3af",
  },
  heroLabel: {
    fontSize: 13,
    color: "#a1a1aa",
    marginBottom: 2,
  },
  heroValue: {
    fontSize: 34,
    fontWeight: 700,
    lineHeight: 1.1,
    marginBottom: 8,
  },
  topUpRow: {
    marginTop: 12,
    padding: "8px 12px",
    borderRadius: 8,
    background: "rgba(251, 191, 36, 0.1)",
    border: "1px solid rgba(251, 191, 36, 0.35)",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  topUpAmount: {
    fontSize: 15,
    fontWeight: 700,
    color: "#fbbf24",
  },
  topUpBy: {
    fontSize: 12,
    color: "#d4d4d8",
  },
  metricGrid: {
    marginTop: 14,
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  metricCell: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  metricKey: {
    fontSize: 11,
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  metricVal: {
    fontSize: 15,
    fontWeight: 600,
    color: "#e4e4e7",
  },
};