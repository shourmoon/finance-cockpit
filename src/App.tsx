import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  createInitialAppState,
  sanitizeHorizonDays,
} from "./domain/appState";
import { toISODate } from "./domain/dateUtils";
import { loadAppState, saveAppState } from "./domain/persistence";
import { balanceOn, runCashflowProjection } from "./domain/cashflowEngine";
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
import ErrorBoundary from "./components/ErrorBoundary";
// Import the SyncSection UI for cross-device synchronisation. This
// component exposes a form to enter a sync key and trigger sync
// operations. See src/components/SyncSection.tsx for details.
import SyncSection from "./components/SyncSection";
// Import a common date formatter to ensure all dates in the UI follow the
// same human‑friendly format (DD MMM 'YY). See src/utils/dates.ts for details.
import { formatDate, monthYearLabel, monthKey } from "./utils/dates";
import {
  DateInputWithDisplay as SharedDateInput,
  NumberInput,
  TopUpToggle,
} from "./components/shared";
import QuickAddTransactionModal from "./components/QuickAddTransactionModal";
import CoverageCard from "./components/CoverageCard";
import { computeCoverageMetrics } from "./domain/resilience";
import RealityCheckRow from "./components/RealityCheckRow";
import RealityCheckModal from "./components/RealityCheckModal";
import { summarizeCheckpoints } from "./domain/reconciliation";
import { ui, colors } from "./components/ui";

// Shared date input bound to this screen's input styling.
function DateInputWithDisplay({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (val: string) => void;
  ariaLabel?: string;
}) {
  return (
    <SharedDateInput
      value={value}
      onChange={onChange}
      inputStyle={ui.input}
      ariaLabel={ariaLabel}
    />
  );
}

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    // The start date is left exactly where the user put it. Nothing moves
    // it on load. It used to roll to today, which was a workaround for
    // freshness ageing against it — see `today` below for the actual fix.
    return loadAppState() ?? createInitialAppState();
  });

  /**
   * The clock. Read once per mount, at the App boundary, because nothing in
   * `src/domain` may ask what day it is.
   *
   * This exists because three different dates were being treated as one:
   * today, the day the balance was confirmed, and the day the forecast
   * window opens. Anchoring the balance to the window gave the engine its
   * worst bug; measuring staleness against the window made the one feature
   * built to catch drift blind to it, which is why the window was made to
   * roll. With "now" meaning the clock, the window is free to be the user's
   * alone and staleness still works.
   */
  const today = useMemo(() => todayIso(), []);

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
  // The balance at the moment the window opens.
  //
  // `account.startingBalance` is what the bank said on the day of the last
  // reality check; the window opens on `settings.startDate`, which follows
  // today. Those are two different dates, so the confirmed figure is rolled
  // across the gap (see openingBalanceAtStart). Everything on this screen
  // that means "the balance now" reads THIS, not the stored figure — three
  // places used the stored one and each was wrong by whatever had happened
  // since the check: safe-to-spend, the ledger's running total, and the
  // headline figure itself.
  // What is in the account NOW — rolled to today, not to the window. These
  // differ whenever the window does not open today, and they are different
  // questions: "Balance" means what you have, while the ledger's opening row
  // means where its running total starts. Rolling the headline to the window
  // meant typing today's bank balance into a reality check and watching the
  // page show a different number back.
  const balanceNow = useMemo(() => balanceOn(state, today), [state, today]);
  const rolledSinceCheck = balanceNow - state.account.startingBalance;

  // Where the ledger's running total starts. Same source, different day.
  const balanceAtWindow = useMemo(
    () => balanceOn(state, state.settings.startDate),
    [state]
  );
  const windowIsToday = state.settings.startDate === today;

  // Derive safe-to-spend from the projection above instead of re-running it.
  const safe = useMemo(
    () =>
      computeSafeToSpendFromEvents(
        balanceAtWindow,
        state.settings.minSafeBalance ?? 0,
        events
      ),
    [balanceAtWindow, state.settings.minSafeBalance, events]
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
    let balance = balanceAtWindow;
    for (const e of events) {
      balance += e.effectiveAmount;
      byEvent.set(e.id, balance);
    }
    return byEvent;
  }, [events, balanceAtWindow]);


  // Coverage asks whether one salary covered the household up to *now*, and
  // now is the clock. It used to be `settings.startDate`, so moving the
  // forecast window silently changed how many months of history the card
  // claimed to have measured — and clearing that field blanked the card
  // outright, as though a year of recorded top-ups depended on where you
  // pointed the forecast.
  const coverage = useMemo(
    () =>
      computeCoverageMetrics(state.adhocTransactions, {
        asOf: today,
        trackingSince: state.settings.trackingSince,
        secondSalaryMonthly: state.settings.secondSalaryMonthly,
      }),
    [
      state.adhocTransactions,
      today,
      state.settings.trackingSince,
      state.settings.secondSalaryMonthly,
    ]
  );

  // How long since the starting balance was last checked against a real
  // statement, and what the model got wrong that time. Measured against the
  // app's notion of "now" (settings.startDate), the same reference the
  // projection and the coverage card use, so nothing on the page disagrees
  // with anything else about what day it is.
  const cashChecks = useMemo(
    () =>
      summarizeCheckpoints(state.checkpoints, "cash", today),
    [state.checkpoints, today]
  );
  const [realityCheckOpen, setRealityCheckOpen] = useState(false);

  // One number, one name, one date. `account.startingBalance` used to appear
  // as "Balance today" on the dashboard (a lie whenever it wasn't), as
  // "Starting balance" three inches below it in the ledger, and as a third
  // free-text "Starting balance" in Settings. Three names for one quantity,
  // and only one of them ever said what day it was true of.
  //
  // The figure shown is `balanceNow`, not the stored one, so there is still
  // exactly one number on screen for "what is in the account". But it is no
  // longer true *as of* the check date once anything has happened since, so
  // the stamp says what it actually is: the day it was confirmed, and what
  // has been added or taken since. "as of 18 Nov" over a figure rolled
  // forward to today would be the same class of lie as the old "Balance
  // today" — a date that does not belong to the number beside it.
  const balanceAsOf = cashChecks.freshness.lastConfirmed;
  const balanceStamp = !balanceAsOf
    ? "never checked against your bank"
    : Math.abs(rolledSinceCheck) < 0.005
      ? `confirmed ${formatDate(balanceAsOf)}`
      : `confirmed ${formatDate(balanceAsOf)} · ${
          rolledSinceCheck > 0 ? "+" : "−"
        }${formatMoney(Math.abs(rolledSinceCheck))} since`;
  const balanceStale = cashChecks.freshness.level !== "fresh";

  // What the forecast still needs before it can say anything true. The app
  // used to fill these gaps with invented rules and forecast confidently
  // from them; it now asks instead. Each step is "done" by evidence in the
  // data, not by a flag, so it cannot drift out of step with reality.
  const setupSteps = [
    {
      key: "balance",
      label: "Tell me your balance",
      hint: "What the account holds right now. Everything else is counted from it.",
      done: state.checkpoints.length > 0,
      action: () => setRealityCheckOpen(true),
      cta: "Set balance",
    },
    {
      key: "income",
      label: "Add what comes in",
      hint: "Pay, and anything else that arrives on a schedule.",
      done: state.rules.some((r) => r.amount > 0),
      action: () => {
        setEditingRule(makeNewRule("Income"));
        setEditingIsNew(true);
      },
      cta: "Add income",
    },
    {
      key: "bills",
      label: "Add what goes out",
      hint: "Rent, bills, subscriptions — the payments you can see coming.",
      done: state.rules.some((r) => r.amount < 0),
      action: () => {
        setEditingRule(makeNewRule("Bill"));
        setEditingIsNew(true);
      },
      cta: "Add a bill",
    },
  ];
  const setupDone = setupSteps.every((step) => step.done);
  // Only a genuinely untouched app gets the setup card alone. Rules are not
  // the test: a confirmed balance is worth showing on its own, and so is
  // recorded top-up history, neither of which needs a single rule to exist.
  // Gating on rules hid both from people who had them.
  const nothingToForecast =
    state.rules.length === 0 &&
    state.adhocTransactions.length === 0 &&
    state.checkpoints.length === 0;

  useEffect(() => {
    saveAppState(state);
  }, [state]);

  function updateStartDate(val: string) {
    setState((s) => ({
      ...s,
      settings: { ...s.settings, startDate: val },
    }));
  }

  function updateHorizonDays(val: number) {
    setState((s) => ({
      ...s,
      // Clamped at the edge rather than trusted: the engine builds one
      // timeline point per day, so an unbounded value here is what makes
      // the dashboard hang or blank out.
      settings: { ...s.settings, horizonDays: sanitizeHorizonDays(val) },
    }));
  }

  function updateSecondSalary(val: number) {
    setState((s) => ({
      ...s,
      settings: { ...s.settings, secondSalaryMonthly: val },
    }));
  }

  function updateTrackingSince(val: string) {
    setState((s) => ({ ...s, settings: { ...s.settings, trackingSince: val } }));
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

  function applyOverride(event: FutureEvent, amount: number | null) {
    setState((s) => {
      // A one-time transaction happens once, so there is no "default vs this
      // time" to override — editing the amount IS editing the transaction.
      // Storing an override beside it would put two numbers on one quantity,
      // which is how Settings and the dashboard came to disagree.
      const oneOff = s.adhocTransactions.find((t) => t.id === event.ruleId);
      if (oneOff) {
        // Nothing to reset to: a blank box leaves the amount as it is.
        if (amount === null) return s;
        return {
          ...s,
          adhocTransactions: s.adhocTransactions.map((t) =>
            t.id === oneOff.id ? { ...t, amount } : t
          ),
        };
      }

      const overrides = { ...s.overrides };
      if (amount === null) {
        delete overrides[event.id];
      } else {
        overrides[event.id] = {
          eventKey: event.id,
          overrideAmount: amount,
        };
      }
      return { ...s, overrides };
    });
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

  // Marking a transaction as a top-up (or back to ordinary) is what lets
  // coverage count transfers the app never predicted — money moved before
  // the shortfall showed up, which is the common real-world case.
  function markAsTopUp(id: string, isTopUp: boolean) {
    setState((s) => ({
      ...s,
      adhocTransactions: s.adhocTransactions.map((t) => {
        if (t.id !== id) return t;
        if (isTopUp) return { ...t, kind: "topUp" as const };
        // Drop the marker entirely rather than storing a falsy kind, so the
        // persisted shape stays exactly as it was before tagging.
        const next = { ...t };
        delete next.kind;
        return next;
      }),
    }));
  }

  function deleteAdhocTransaction(id: string) {
    setState((s) => ({
      ...s,
      adhocTransactions: s.adhocTransactions.filter((t) => t.id !== id),
    }));
  }

  function makeNewRule(name = "New Rule"): RecurringRule {
    const id = makeId("rule");

    return {
      id,
      name,
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

            {/* The balance leads, outside any group. Everything in the app
                is counted forward from it, and it is the one field here
                that gets updated regularly rather than set once.

                Read-only on purpose: a free-text balance with no date
                attached is how this figure drifts, and it quietly bypassed
                the one dialog built to stop that. Correcting it is still
                one tap — it just cannot happen any more without recording
                the day it was true. */}
            <div style={styles.settingsBalance} data-testid="settings-balance">
              <span style={ui.fieldLabel}>Balance</span>
              <div style={styles.balanceReadout}>
                <span style={styles.balanceReadoutValue}>
                  {formatMoney(balanceNow)}
                </span>
                <button
                  type="button"
                  style={styles.balanceUpdate}
                  onClick={() => setRealityCheckOpen(true)}
                >
                  Update balance
                </button>
              </div>
              <span
                style={balanceStale ? styles.balanceAgeStale : styles.balanceAge}
              >
                {balanceStamp}
              </span>
              <span style={styles.fieldHint}>
                Every figure in the app is counted forward from this one, so
                it is only ever set by checking it against your bank.
              </span>
            </div>

            {/* Grouped by what each field changes, rather than left as one
                undifferentiated grid of six. Every field already explained
                itself, but a reader still had to read all six to find the
                one they came for.

                Stacked label-over-input fields in a wrapping two-column
                grid — the same control pattern the Mortgage tab's
                Original Loan Terms card uses, so the two config surfaces
                read as one form. Each field stays a <label> so the input
                keeps its accessible name. */}
            <div data-testid="settings-group-forecast">
            <h4 style={styles.settingsGroupTitle}>Forecast</h4>
            <div style={styles.settingsGrid}>
              {/* A plain date, set by hand and left alone. It used to roll
                  to today on every load, which was a workaround for ageing
                  the balance against it rather than against the clock. */}
              <div style={styles.field}>
                <span style={ui.fieldLabel}>Forecasting from</span>
                <DateInputWithDisplay
                  value={state.settings.startDate}
                  onChange={(val) => updateStartDate(val)}
                  ariaLabel="Start date"
                />
                <span style={styles.fieldHint}>
                  The day the forecast window opens. Yours to set — nothing
                  moves it. Your balance is counted from the day you last
                  checked it against the bank, whichever day this is.
                </span>
                {state.settings.startDate !== today && (
                  <span style={styles.windowNote} data-testid="window-note">
                    {state.settings.startDate < today
                      ? `Looking from the past — today is ${formatDate(today)}.`
                      : `Looking ahead — today is ${formatDate(today)}.`}
                  </span>
                )}
              </div>

              <label style={styles.field}>
                <span style={ui.fieldLabel}>Horizon (days)</span>
                {/* The shared NumberInput keeps in-progress text local and
                    only commits finite parses, so clearing the box to retype
                    doesn't momentarily push a 0/NaN horizon into the engine.
                    This was the last numeric field still bypassing it. */}
                <NumberInput
                  value={state.settings.horizonDays}
                  onChange={updateHorizonDays}
                  ariaLabel="Horizon (days)"
                  inputStyle={ui.input}
                />
                <span style={styles.fieldHint}>
                  How far ahead to forecast.
                </span>
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
                <span style={styles.fieldHint}>
                  The cushion you never want to drop below. Safe to Spend and
                  the top-up plan both keep you above it.
                </span>
              </label>

            </div>
            </div>

            <div data-testid="settings-group-coverage">
            <h4 style={styles.settingsGroupTitle}>One-salary coverage</h4>
            <div style={styles.settingsGrid}>
              <label style={styles.field}>
                <span style={ui.fieldLabel}>Top-ups tracked since</span>
                <SharedDateInput
                  value={state.settings.trackingSince ?? state.settings.startDate}
                  onChange={(val) => {
                    if (val) updateTrackingSince(val);
                  }}
                  inputStyle={ui.input}
                  ariaLabel="Tracking since"
                />
                <span style={styles.fieldHint}>
                  When you started recording transfers from savings. Months
                  before this count as unknown, never as months you coped.
                </span>
              </label>

              <label style={styles.field}>
                <span style={ui.fieldLabel}>Second salary (monthly, optional)</span>
                <NumberInput
                  value={state.settings.secondSalaryMonthly ?? 0}
                  onChange={updateSecondSalary}
                  inputStyle={ui.input}
                />
                <span style={styles.fieldHint}>
                  Only used to work out how much of it you have managed to
                  leave untouched. Leave at 0 to hide that figure.
                </span>
              </label>
            </div>
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
              {/* Opens the same dialog the dashboard's "+ One-time" uses.
                  Dropping a blank $0 row dated today and making the user
                  correct three fields was never the kinder option. */}
              <button style={styles.addButton} onClick={() => setQuickAddOpen(true)}>
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
              // Deliberately NOT sorted by date. These rows carry the date
              // inputs, and sorting a list by the field being edited moves
              // the row out from under the cursor on every keystroke — which
              // scrambled the rest of what was being typed into a date with
              // a six-digit year. The dashboard ledger is where these appear
              // in date order; nothing there is editable.
              state.adhocTransactions.map((txn) => (
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
                          ariaLabel="Transaction date"
                          onChange={(val) => {
                            if (val) updateAdhocTransaction(txn.id, { date: val });
                          }}
                        />
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <TopUpToggle
                          checked={txn.kind === "topUp"}
                          onChange={(v) => markAsTopUp(txn.id, v)}
                        />
                        {txn.kind === "topUp" && txn.amount <= 0 && (
                          <div style={styles.topUpWarning}>
                            A top-up must be a positive inflow — coverage ignores
                            this amount.
                          </div>
                        )}
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

      {/* FIRST RUN: ask, rather than forecast from nothing */}
      {activeTab === "dashboard" && !setupDone && (
        <div style={styles.card} data-testid="first-run">
          <h3 style={styles.cardTitle}>
            {nothingToForecast ? "Let's set this up" : "Nearly there"}
          </h3>
          <div style={styles.setupIntro}>
            {nothingToForecast
              ? "Three things, and the forecast starts telling you something true."
              : "A couple of things still missing before the forecast is complete."}
          </div>
          {setupSteps.map((step) => (
            <div key={step.key} style={styles.setupStep}>
              <span
                style={step.done ? styles.setupTickDone : styles.setupTick}
                aria-hidden="true"
              >
                {step.done ? "✓" : ""}
              </span>
              <div style={styles.setupText}>
                <span style={step.done ? styles.setupLabelDone : styles.setupLabel}>
                  {step.label}
                </span>
                {!step.done && <span style={styles.setupHint}>{step.hint}</span>}
              </div>
              {!step.done && (
                <button type="button" style={styles.setupCta} onClick={step.action}>
                  {step.cta}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* DASHBOARD TAB */}
      {activeTab === "dashboard" && !nothingToForecast && (
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
                <span style={styles.metricKey} data-testid="balance-label">
                  Balance
                </span>
                <span style={styles.metricVal}>
                  {formatMoney(balanceNow)}
                </span>
                {/* Always stamped, not only once it has gone stale: a figure
                    that says when it is from needs no explaining, while one
                    that says so only sometimes teaches the reader that a
                    missing date means nothing in particular. Every figure on
                    this screen is computed from this one, so its age
                    qualifies all of them. */}
                <span
                  style={balanceStale ? styles.balanceAgeStale : styles.balanceAge}
                  data-testid="balance-age"
                >
                  {balanceStamp}
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

            {/* Every figure above is computed from the balance, so how long
                ago that balance was true belongs with them, not buried in
                settings. */}
            <RealityCheckRow
              summary={cashChecks}
              target="cash"
              formatMoney={formatMoney}
              onCheck={() => setRealityCheckOpen(true)}
            />
          </div>

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

                {/* Where the running totals below start.
                    
                    Normally this IS the figure the card above shows — same
                    name, same stamp — because the window opens today. When
                    it does not, the two are different questions and are
                    labelled as such: the card says what is in the account
                    now, this row says what it was (or will be) on the day
                    the ledger starts. Showing one number under both
                    headings is how this card used to read as two numbers
                    that happened to agree. */}
                <div style={styles.openingRow}>
                  <span style={styles.openingLabel}>
                    <span data-testid="balance-label">
                      {windowIsToday
                        ? "Balance"
                        : `Balance on ${formatDate(state.settings.startDate)}`}
                    </span>
                    {windowIsToday && (
                      <span
                        style={balanceStale ? styles.balanceAgeStale : styles.balanceAge}
                        data-testid="balance-age"
                      >
                        {balanceStamp}
                      </span>
                    )}
                  </span>
                  <span style={styles.openingValue}>
                    {formatMoney(balanceAtWindow)}
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

      {/* ONE-SALARY COVERAGE (Dashboard, below the events ledger) */}
      {activeTab === "dashboard" && !nothingToForecast && (
        <CoverageCard
          metrics={coverage}
          trackingSince={state.settings.trackingSince}
          needsTopUp={topUpSchedule.length > 0 || topUp !== null}
          slack={metrics.minBalance - (state.settings.minSafeBalance ?? 0)}
          slackDate={metrics.minBalanceDate}
          formatMoney={formatMoney}
        />
      )}

      {/* REALITY CHECK: what the bank actually says */}
      <RealityCheckModal
        open={realityCheckOpen}
        target="cash"
        defaultDate={today}
        // "Balance today" is the one hand-maintained cash figure, and the
        // one the whole projection is anchored on, so it is what a statement
        // is held against — not the timeline's first point, which already has
        // today's scheduled events applied and would put a second, different
        // number for one quantity inside the same card.
        dateEditable={false}
        /* What the model believes the opening balance is today — rolled
           from the last check, not the last check's own figure. Comparing a
           statement against the figure it was last set to would measure
           nothing but the gap between two statements; the drift this card
           exists to capture is the model's error since then. */
        modelledOn={() => balanceNow}
        formatMoney={formatMoney}
        onSave={({ date, actual, modelled }) => {
          setState((s) => ({
            ...s,
            // Recording the check and correcting the balance are one action:
            // confirming a figure and then still projecting from the old one
            // would leave the freshness note claiming a balance was checked
            // while the app carried on using a number the bank disagrees with.
            account: { startingBalance: actual },
            checkpoints: [
              ...s.checkpoints,
              { id: makeId("chk"), date, actual, modelled },
            ],
          }));
          setRealityCheckOpen(false);
        }}
        onClose={() => setRealityCheckOpen(false)}
      />

      {/* QUICK-ADD ONE-TIME TRANSACTION (from Dashboard) */}
      <QuickAddTransactionModal
        open={quickAddOpen}
        defaultDate={today}
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
      {activeTab === "mortgage" && (
        <ErrorBoundary label="The mortgage optimizer">
          <MortgageTab
            rules={state.rules}
            surplus={state.settings.surplus}
            onSurplusChange={(surplus) =>
              setState((s) => ({
                ...s,
                settings: { ...s.settings, surplus },
              }))
            }
          />
        </ErrorBoundary>
      )}

      {/* OVERRIDE MODAL */}
      <OverrideModal
        event={selectedEvent}
        isOneOff={
          selectedEvent !== null &&
          state.adhocTransactions.some((t) => t.id === selectedEvent.ruleId)
        }
        onSave={(amount) => {
          if (selectedEvent) applyOverride(selectedEvent, amount);
          setSelectedEvent(null);
        }}
        onClose={() => setSelectedEvent(null)}
      />

      {/* RULE EDITOR MODAL */}
      <RuleEditorModal
        rule={editingRule}
        defaultStartDate={today}
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

/** Today, in the app's UTC convention. Outside the component: it reads the
 *  clock, and a render must not. */
function todayIso(): string {
  return toISODate(new Date());
}

// Fallback id generator. Lives outside the component because it reads the
// clock and the RNG: called during render those would be unstable, and only
// event handlers ever call it.
function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    // The name and its as-of stamp are two spans; without this they render
    // run together as "BALANCEas of 1 Sep '26".
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    flexWrap: "wrap",
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
  topUpWarning: {
    fontSize: 11,
    lineHeight: 1.4,
    color: colors.amber,
    marginTop: 4,
  },
  eventsHint: {
    fontSize: 11,
    color: colors.faint,
    marginBottom: 8,
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
  windowNote: {
    fontSize: 11,
    color: colors.amber,
    lineHeight: 1.4,
    marginTop: 4,
  },
  settingsGroupTitle: {
    ...ui.miniLabel,
    margin: "18px 0 10px",
    paddingTop: 14,
    borderTop: `1px solid ${colors.hairline}`,
  },
  settingsBalance: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  fieldHint: {
    fontSize: 11,
    color: colors.faint,
    lineHeight: 1.4,
    marginTop: 4,
  },
  setupIntro: {
    fontSize: 12.5,
    color: colors.textSoft,
    marginTop: -4,
    marginBottom: 12,
    lineHeight: 1.45,
  },
  setupStep: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    paddingTop: 9,
    paddingBottom: 9,
    borderTop: `1px solid ${colors.hairline}`,
  },
  setupTick: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: `1px solid ${colors.cardBorder}`,
    flexShrink: 0,
    marginTop: 1,
  },
  setupTickDone: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    background: colors.green,
    color: colors.greenInk,
    flexShrink: 0,
    marginTop: 1,
    fontSize: 12,
    lineHeight: "18px",
    textAlign: "center",
    fontWeight: 700,
  },
  setupText: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 },
  setupLabel: { fontSize: 14, fontWeight: 600, color: colors.text },
  setupLabelDone: { fontSize: 14, fontWeight: 500, color: colors.muted },
  setupHint: { fontSize: 11.5, color: colors.faint, lineHeight: 1.4 },
  setupCta: {
    ...ui.primaryButton,
    padding: "5px 11px",
    fontSize: 12.5,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  followRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    fontSize: 12,
    color: colors.muted,
    cursor: "pointer",
  },
  // `textTransform: none` because the ledger's opening label is uppercased
  // and the stamp would inherit it — the same words rendering as "AS OF 1
  // SEP '26" in one place and "as of 1 Sep '26" in the other, which is the
  // very impression this change exists to remove.
  balanceAge: {
    fontSize: 10.5,
    color: colors.faint,
    textTransform: "none",
    letterSpacing: "normal",
  },
  balanceAgeStale: {
    fontSize: 10.5,
    color: colors.amber,
    textTransform: "none",
    letterSpacing: "normal",
  },
  balanceReadout: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  balanceReadoutValue: {
    fontSize: 15,
    fontWeight: 700,
    color: colors.text,
    fontVariantNumeric: "tabular-nums",
  },
  balanceUpdate: {
    ...ui.miniLabel,
    background: "transparent",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 7,
    padding: "3px 9px",
    color: colors.text,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.03em",
    whiteSpace: "nowrap",
  },
  forecastFrom: {
    fontSize: 14,
    fontWeight: 600,
    color: colors.text,
    padding: "6px 0",
  },
  metricVal: {
    fontSize: 15,
    fontWeight: 600,
    color: colors.text,
  },
};