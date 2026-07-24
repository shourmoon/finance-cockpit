import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createInitialAppState } from "./domain/appState";
import { loadAppState, saveAppState } from "./domain/persistence";
import { runCashflowProjection } from "./domain/cashflowEngine";
import {
  computeSafeToSpendFromEvents,
  computeTopUpHint,
  computeTopUpSchedule,
  transferDepositToTransaction,
  type TopUpDeposit,
} from "./domain/safeToSpendEngine";
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
import { formatDate, monthYearLabel, monthKey } from "./utils/dates";
import { DateInputWithDisplay as SharedDateInput, NumberInput } from "./components/shared";
import QuickAddTransactionModal from "./components/QuickAddTransactionModal";
import { ui, colors } from "./components/ui";

// Shared date input bound to this screen's input styling.
function DateInputWithDisplay({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <SharedDateInput value={value} onChange={onChange} inputStyle={ui.input} />
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

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);

  const EVENTS_PREVIEW_COUNT = 25;

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

  const topUpSchedule = useMemo(
    () => computeTopUpSchedule(timeline, state.settings.minSafeBalance ?? 0),
    [timeline, state.settings.minSafeBalance]
  );

  // Running balance *after each individual event*, so a ledger row shows
  // the balance that transaction produces — not the day's closing balance
  // repeated on every same-day row. Events are in the engine's processing
  // order, so this prefix sum matches the timeline: the last event of a day
  // lands on that day's closing balance.
  const runningBalanceByEvent = useMemo(() => {
    const byEvent = new Map<string, number>();
    let balance = state.account.startingBalance;
    for (const e of events) {
      balance += e.effectiveAmount;
      byEvent.set(e.id, balance);
    }
    return byEvent;
  }, [events, state.account.startingBalance]);


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

  // Fallback id generator, always invoked from event handlers (see call
  // sites below), never during render. Suppressed below: this experimental
  // rule misclassifies a .map()-nested onClick closure as render-time
  // execution once a second such closure exists.
  function makeId(prefix: string): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    // eslint-disable-next-line react-hooks/purity
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function applyTransfer(deposit: TopUpDeposit) {
    const txn: AdhocTransaction = {
      id: makeId("txn"),
      ...transferDepositToTransaction(deposit),
    };
    setState((s) => ({
      ...s,
      adhocTransactions: [...s.adhocTransactions, txn],
    }));
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

            {/* Stacked label-over-input fields in a wrapping two-column
                grid — the same control pattern the Mortgage tab's
                Original Loan Terms card uses, so the two config surfaces
                read as one form. Each field stays a <label> so the input
                keeps its accessible name. */}
            <div style={styles.settingsGrid}>
              <label style={styles.field}>
                <span style={ui.fieldLabel}>Start date</span>
                {/* DateInputWithDisplay shows the human-friendly date underneath. */}
                <DateInputWithDisplay
                  value={state.settings.startDate}
                  onChange={(val) => updateStartDate(val)}
                />
              </label>

              <label style={styles.field}>
                <span style={ui.fieldLabel}>Horizon (days)</span>
                <input
                  type="number"
                  value={state.settings.horizonDays}
                  onChange={(e) => updateHorizonDays(Number(e.target.value))}
                  style={ui.input}
                />
                <div style={styles.presetRow}>
                  {[30, 60, 90, 180].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => updateHorizonDays(days)}
                      style={
                        state.settings.horizonDays === days
                          ? styles.presetChipActive
                          : styles.presetChip
                      }
                    >
                      {days}d
                    </button>
                  ))}
                </div>
              </label>

              <label style={styles.field}>
                <span style={ui.fieldLabel}>Minimum safe balance</span>
                <NumberInput
                  value={state.settings.minSafeBalance}
                  onChange={updateMinSafeBalance}
                  inputStyle={ui.input}
                />
              </label>

              <label style={styles.field}>
                <span style={ui.fieldLabel}>Starting balance</span>
                <NumberInput
                  value={state.account.startingBalance}
                  onChange={updateStartingBalance}
                  inputStyle={ui.input}
                />
              </label>
            </div>
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
                    inputStyle={moneyInputStyle(rule.amount)}
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
              <div style={{ fontSize: 13, color: colors.muted }}>
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
                        style={ui.input}
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
                        inputStyle={moneyInputStyle(txn.amount)}
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

            {/* Transfer plan: topping this account up from savings, keeping
                the most cash in high-yield for the longest. One deposit per
                below-floor stretch; falls back to the single hint otherwise. */}
            {topUpSchedule.length > 1 ? (
              <div style={styles.topUpRow}>
                <span style={styles.topUpAmount}>
                  {topUpSchedule.length} transfers keep you above your floor
                </span>
                {topUpSchedule.map((d, idx) => (
                  <span key={`${d.date}-${idx}`} style={styles.topUpDeposit}>
                    <span style={styles.topUpDepositAmount}>
                      {formatMoney(d.amount)}
                    </span>
                    <span style={styles.topUpDepositBy}>
                      by {formatDate(d.date)}
                    </span>
                    <button
                      style={{ ...ui.primaryButton, padding: "3px 10px", fontSize: 12 }}
                      onClick={() => applyTransfer(d)}
                      aria-label={`Apply transfer of ${formatMoney(d.amount)} on ${formatDate(d.date)}`}
                    >
                      Apply
                    </button>
                  </span>
                ))}
                <span style={styles.topUpBy}>
                  each transfer is the latest, smallest one that holds — the
                  rest stays earning yield
                </span>
              </div>
            ) : (
              topUp && (
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
                  {topUpSchedule[0] && (
                    <button
                      style={{ ...ui.primaryButton, alignSelf: "flex-start", marginTop: 6 }}
                      onClick={() => applyTransfer(topUpSchedule[0])}
                      aria-label={`Apply transfer of ${formatMoney(topUp.amountNeeded)} on ${formatDate(topUp.neededBy)}`}
                    >
                      Apply
                    </button>
                  )}
                </div>
              )
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
                        ? colors.danger
                        : metrics.minBalance < state.settings.minSafeBalance
                        ? colors.amber
                        : colors.text,
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
                    color: metrics.firstNegativeDate ? colors.danger : colors.text,
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
              <h3 style={styles.cardTitle}>Balance Over Horizon</h3>
              <BalanceChart
                timeline={timeline}
                minSafeBalance={state.settings.minSafeBalance}
              />
              <div style={styles.chartCaption}>
                Soft line = trend · thin line = daily balance · amber dashed =
                your floor · red = below $0. Drag to inspect any day.
              </div>
            </div>
          )}

          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <h3 style={styles.cardTitle}>Upcoming Events</h3>
              <button
                style={styles.addButton}
                onClick={() => setQuickAddOpen(true)}
              >
                + One-time
              </button>
            </div>
            {events.length === 0 ? (
              <div style={{ fontSize: 13, color: colors.muted }}>
                No upcoming events in this horizon.
              </div>
            ) : (
              <>
                <div style={styles.eventsHint}>Tap a row to override its amount</div>

                {/* Ledger opening line: where the balance starts, before any
                    upcoming event moves it. */}
                <div style={styles.openingRow}>
                  <span style={styles.openingLabel}>Starting balance</span>
                  <span style={styles.openingValue}>
                    {formatMoney(state.account.startingBalance)}
                  </span>
                </div>

                {/* Flat, compact rows with the date inline in a left column
                    (shown per row, no wasted header row). A divider marks each
                    new day so same-date transactions read as one group, and a
                    month banner breaks the list into months. Only the first
                    EVENTS_PREVIEW_COUNT events show until "Show all" is tapped. */}
                {(showAllEvents
                  ? events
                  : events.slice(0, EVENTS_PREVIEW_COUNT)
                ).map((e, i, shown) => {
                  const prev = shown[i - 1];
                  const newMonth =
                    i === 0 || monthKey(e.date) !== monthKey(prev.date);
                  const newDay = i === 0 || e.date !== prev.date;
                  const runningBalance = runningBalanceByEvent.get(e.id);
                  return (
                    <div key={e.id}>
                      {newMonth && (
                        <div style={styles.monthSeparator}>
                          {monthYearLabel(e.date)}
                        </div>
                      )}
                      <div
                        style={
                          newDay && !newMonth
                            ? { ...styles.eventRow, ...styles.eventRowNewDay }
                            : styles.eventRow
                        }
                        onClick={() => setSelectedEvent(e)}
                      >
                        {/* Date only on the first row of each day; blank on the
                            rest so a day reads as one group. */}
                        <span style={styles.eventDate}>
                          {newDay ? dayOfMonth(e.date) : ""}
                        </span>
                        <div style={styles.eventMain}>
                          <span style={styles.eventName}>
                            {e.ruleName}
                            {e.isOverridden && " *"}
                          </span>
                        </div>
                        {/* Amount and balance sit in fixed columns so the
                            arrows and running balances line up down the list. */}
                        <span
                          style={{
                            ...styles.eventAmount,
                            color:
                              e.effectiveAmount >= 0
                                ? colors.positive
                                : colors.danger,
                          }}
                        >
                          {e.effectiveAmount >= 0 ? "+" : ""}
                          {formatMoney(e.effectiveAmount)}
                        </span>
                        <span style={styles.eventArrow}>→</span>
                        <span
                          style={{
                            ...styles.eventBalance,
                            color:
                              runningBalance === undefined
                                ? colors.text
                                : runningBalance < 0
                                ? colors.danger
                                : runningBalance < state.settings.minSafeBalance
                                ? colors.amber
                                : colors.text,
                          }}
                        >
                          {runningBalance !== undefined
                            ? formatMoney(runningBalance)
                            : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {!showAllEvents && events.length > EVENTS_PREVIEW_COUNT && (
                  <button
                    style={styles.showMoreButton}
                    onClick={() => setShowAllEvents(true)}
                  >
                    Show all {events.length} events
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* QUICK-ADD ONE-TIME TRANSACTION (from Dashboard) */}
      <QuickAddTransactionModal
        open={quickAddOpen}
        defaultDate={state.settings.startDate}
        onAdd={(values) => {
          setState((s) => ({
            ...s,
            adhocTransactions: [
              ...s.adhocTransactions,
              { id: makeId("txn"), ...values },
            ],
          }));
          setQuickAddOpen(false);
        }}
        onClose={() => setQuickAddOpen(false)}
      />

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

// Just the day-of-month for the inline ledger column — the month banner
// above already carries the month and year, so "2026-07-10" -> "10".
function dayOfMonth(iso: string): string {
  const d = parseInt(iso.split("-")[2] ?? "", 10);
  return Number.isFinite(d) ? String(d) : formatDate(iso);
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
  return status === "ok" ? colors.positive : status === "warning" ? colors.amber : colors.danger;
}

// Editable amount inputs in Settings borrow the dashboard's ledger colors:
// outflows read red, inflows green — the same money semantics the Upcoming
// Events rows use, so the config tab speaks the same visual language.
function moneyInputStyle(amount: number): CSSProperties {
  return {
    ...styles.inputSmall,
    fontWeight: 600,
    color:
      amount < 0 ? colors.danger : amount > 0 ? colors.positive : colors.text,
  };
}

const styles: Record<string, CSSProperties> = {
  container: {
    maxWidth: 600,
    margin: "0 auto",
    padding: 13,
    // Use the same dark background and typography as other tabs for
    // consistency.  The container also controls the overall text color.
    backgroundColor: colors.bg,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
    color: colors.text,
    minHeight: "100vh",
  },
  header: {
    textAlign: "center",
    marginBottom: 12,
    fontWeight: 600,
    fontSize: 24,
    color: colors.title,
  },
  tabRow: {
    display: "flex",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12,
  },
  tabButton: {
    flex: 1,
    padding: "8px 12px",
    borderRadius: 999,
    border: `1px solid ${colors.tabBorder}`,
    background: "transparent",
    color: colors.muted,
    fontSize: 14,
  },
  tabButtonActive: {
    flex: 1,
    padding: "8px 12px",
    borderRadius: 999,
    border: `1px solid ${colors.blueEdge}`,
    background: colors.blueStrong,
    color: colors.blueInk,
    fontSize: 14,
  },
  card: ui.card,
  cardTitle: ui.cardTitle,
  // Wrapping two-column grid of stacked fields, mirroring the Mortgage
  // tab's Original Loan Terms card so both config forms match.
  settingsGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  },
  // Matches the Mortgage tab's LabeledNumberInput container exactly
  // (flex: 1, minWidth: 130) so both config forms wrap to the same
  // number of columns at any width — at ~360px CSS (common phones) a
  // wider minWidth left Settings single-column while Mortgage stayed
  // two-column, so the tabs looked nothing alike.
  field: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 130,
  },
  inputSmall: {
    width: 90,
    padding: 6,
    fontSize: 13,
    background: colors.inputBg,
    color: colors.text,
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: 8,
  },
  cardHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  addButton: ui.addButton,
  ruleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 8,
    marginBottom: 8,
    borderBottom: `1px solid ${colors.hairline}`,
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
    color: colors.muted,
    marginTop: 4,
  },
  ruleControls: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  editButton: ui.primaryButton,
  metric: {
    marginBottom: 8,
    fontSize: 13,
    color: colors.textSoft,
  },
  impactRow: {
    marginTop: 4,
    marginBottom: 8,
    fontSize: 12,
    color: colors.muted,
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
    color: colors.positive,
  },
  impactNeutral: {
    backgroundColor: "rgba(113, 113, 122, 0.25)",
    borderColor: "rgba(82, 82, 91, 0.9)",
    color: colors.text,
  },
  impactNegative: {
    backgroundColor: "rgba(220, 38, 38, 0.15)",
    borderColor: "rgba(248, 113, 113, 0.8)",
    color: colors.dangerText,
  },
  // Ledger opening line — the balance before any upcoming event.
  openingRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 10,
    paddingBottom: 10,
    marginBottom: 10,
    borderBottom: `1px solid ${colors.cardBorder}`,
  },
  openingLabel: {
    ...ui.miniLabel,
  },
  openingValue: {
    fontSize: 16,
    fontWeight: 700,
    color: colors.text,
  },
  // Compact ledger row: inline date column | name | figures. A divider
  // above the first row of each new day groups same-date transactions
  // without a wasted header row or any indent.
  eventRow: {
    display: "grid",
    gridTemplateColumns: "20px minmax(0, 1fr) 78px 12px 82px",
    alignItems: "center",
    columnGap: 6,
    paddingTop: 4,
    paddingBottom: 4,
    cursor: "pointer",
  },
  eventRowNewDay: {
    borderTop: `1px solid ${colors.dayDivider}`,
    marginTop: 2,
  },
  // Inline date column — shown on the first row of each day, blank on the
  // rest. Small and muted; the month banner carries the year.
  eventDate: {
    fontSize: 13,
    fontWeight: 600,
    color: colors.muted,
    whiteSpace: "nowrap",
    alignSelf: "center",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  eventMain: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  // Wrap to at most two lines (then ellipsis) instead of a hard one-line
  // truncation, so names like "Withdraw from savings" stay readable next
  // to the figures rather than collapsing to "Withd…".
  // Name, amount, and balance share one 13px size — hierarchy comes from
  // weight and colour (bold balance, medium amount, regular name), never
  // from mismatched sizes.
  eventName: {
    fontSize: 13,
    lineHeight: 1.25,
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflowWrap: "anywhere",
  },
  eventAmount: {
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  eventArrow: {
    fontSize: 11,
    color: colors.glyph,
    lineHeight: 1,
    textAlign: "center",
  },
  eventBalance: {
    fontSize: 13,
    fontWeight: 700,
    whiteSpace: "nowrap",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  eventsHint: {
    fontSize: 11,
    color: colors.faint,
    marginBottom: 8,
  },
  chartCaption: {
    marginTop: 8,
    fontSize: 11,
    color: colors.muted,
  },
  // Bolder, full-width month band so months are obvious at a glance —
  // filled and heavier than the old faint small-caps label.
  monthSeparator: {
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: colors.title,
    background: "rgba(255,255,255,0.05)",
    borderRadius: 8,
    padding: "6px 10px",
    marginTop: 14,
    marginBottom: 10,
  },
  showMoreButton: {
    width: "100%",
    marginTop: 8,
    padding: "8px 12px",
    fontSize: 13,
    borderRadius: 8,
    border: `1px solid ${colors.cardBorder}`,
    background: colors.inputBg,
    color: colors.link,
    cursor: "pointer",
  },
  presetRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  presetChip: ui.chip,
  presetChipActive: ui.chipActive,
  heroLabel: {
    fontSize: 13,
    color: colors.muted,
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
    color: colors.amber,
  },
  topUpBy: {
    fontSize: 12,
    color: colors.textSoft,
  },
  topUpDeposit: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    marginTop: 2,
  },
  topUpDepositAmount: {
    fontSize: 14,
    fontWeight: 700,
    color: colors.amber,
  },
  topUpDepositBy: {
    fontSize: 12,
    color: colors.textSoft,
  },
  metricGrid: {
    marginTop: 10,
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  metricCell: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  metricKey: {
    ...ui.miniLabel,
  },
  metricVal: {
    fontSize: 15,
    fontWeight: 600,
    color: colors.text,
  },
};