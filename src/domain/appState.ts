// src/domain/appState.ts
import type {
    AppState,
AdhocTransaction,
CashAccount,
CashflowSettings,
RecurringRule,
RecurringSchedule,
EventOverridesMap,
UUID,
} from "./types";
import { toISODate, isValidISODate } from "./dateUtils";

// v1 -> v2: added adhocTransactions (additive; v1 states migrate
// field-by-field with an empty list, nothing is discarded).
// v2 -> v3: added top-up tracking — `kind`/`reason` on ad-hoc transactions
// and `trackingSince`/`coverageLens`/`secondSalaryMonthly` in settings.
// Purely additive: existing transactions are left unmarked on purpose.
// Past top-ups were never recorded reliably (they were entered as edits to
// other rows), so name-matching "Top Up" would invent untrustworthy history.
// Tracking starts at the upgrade instead.
export const APP_STATE_VERSION = 3;

/**
 * Bounds for the projection horizon. The engine walks one timeline point
 * per day and the chart holds them all in memory, so an unbounded value
 * is a real hazard rather than a theoretical one: 200,000 days builds a
 * 200,001-point timeline. Ten years is far beyond any useful forecast
 * while keeping the work trivially small.
 */
export const MIN_HORIZON_DAYS = 1;
export const MAX_HORIZON_DAYS = 3650;
export const DEFAULT_HORIZON_DAYS = 90;

/**
 * Coerce an untrusted horizon into a usable whole number of days.
 * NaN/Infinity/missing fall back to the default; anything else is clamped
 * into range and floored (a fractional horizon silently rounded anyway).
 */
export function sanitizeHorizonDays(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_HORIZON_DAYS;
  }
  return Math.min(MAX_HORIZON_DAYS, Math.max(MIN_HORIZON_DAYS, Math.floor(raw)));
}

function createDefaultAccount(): CashAccount {
  return {
    startingBalance: 0,
  };
}

function createDefaultSettings(): CashflowSettings {
  const today = toISODate(new Date());
  return {
    startDate: today,
    horizonDays: DEFAULT_HORIZON_DAYS,
    minSafeBalance: 0,
    // Coverage tracking begins now — there is no earlier history to claim.
    trackingSince: today,
    coverageLens: "all",
  };
}

function createDefaultRules(): RecurringRule[] {
  const todayIso = toISODate(new Date());
  const mkId = (suffix: string): UUID => `rule-${suffix}`;

  return [
    {
      id: mkId("paycheck"),
      name: "Paycheck (Twice a Month)",
      amount: 2000,
      isVariable: false,
      schedule: {
        type: "twiceMonth",
        day1: 15,
        day2: 31,
        businessDayConvention: "previousBusinessDayUS",
      },
    },
    {
      id: mkId("rent"),
      name: "Rent",
      amount: -1500,
      isVariable: false,
      schedule: {
        type: "monthly",
        day: 1,
      },
    },
    {
      id: mkId("credit-card"),
      name: "Credit Card Payment",
      amount: -400,
      isVariable: true,
      schedule: {
        type: "monthly",
        day: 20,
      },
    },
    {
      id: mkId("groceries"),
      name: "Groceries (Biweekly)",
      amount: -150,
      isVariable: true,
      schedule: {
        type: "biweekly",
        anchorDate: todayIso,
      },
    },
  ];
}

function createDefaultOverrides(): EventOverridesMap {
  return {};
}

export function createInitialAppState(): AppState {
  return {
    version: APP_STATE_VERSION,
    account: createDefaultAccount(),
    settings: createDefaultSettings(),
    rules: createDefaultRules(),
    adhocTransactions: [],
    overrides: createDefaultOverrides(),
  };
}

function isDayOfMonth(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 31;
}

/**
 * Validate a raw schedule object from storage. Returns a clean
 * RecurringSchedule or null if the shape is not usable — rules with
 * unusable schedules are dropped by upgradeAppState so the cashflow
 * engine never sees them.
 */
export function sanitizeSchedule(raw: any): RecurringSchedule | null {
  if (!raw || typeof raw !== "object") return null;

  switch (raw.type) {
    case "monthly":
      return isDayOfMonth(raw.day) ? { type: "monthly", day: raw.day } : null;

    case "twiceMonth": {
      if (!isDayOfMonth(raw.day1) || !isDayOfMonth(raw.day2)) return null;
      const convention =
        raw.businessDayConvention === "previousBusinessDayUS"
          ? "previousBusinessDayUS"
          : raw.businessDayConvention === "none" ||
              raw.businessDayConvention === undefined
            ? raw.businessDayConvention
            : undefined;
      const sched: RecurringSchedule = {
        type: "twiceMonth",
        day1: raw.day1,
        day2: raw.day2,
      };
      if (convention !== undefined) sched.businessDayConvention = convention;
      return sched;
    }

    case "biweekly":
      return isValidISODate(raw.anchorDate)
        ? { type: "biweekly", anchorDate: raw.anchorDate }
        : null;

    default:
      return null;
  }
}

/**
 * Validate a raw ad-hoc transaction from storage. Returns a clean
 * AdhocTransaction or null if the entry is unusable (no id, or a date
 * the engine cannot place on the timeline).
 */
export function sanitizeAdhocTransaction(raw: any): AdhocTransaction | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (!isValidISODate(raw.date)) return null;

  const txn: AdhocTransaction = {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : "Transaction",
    amount: typeof raw.amount === "number" ? raw.amount : 0,
    date: raw.date,
  };

  // Top-up markers are only carried through when they're exactly the values
  // we write; anything else in stored JSON is dropped rather than trusted.
  if (raw.kind === "topUp") {
    txn.kind = "topUp";
    if (raw.reason === "oneOff" || raw.reason === "shortfall") {
      txn.reason = raw.reason;
    }
  }

  return txn;
}

/**
 * Validate the per-event override map entry by entry. This was the one
 * persisted structure taken wholesale, which let an array or arbitrary
 * entry shapes through — including a non-finite amount, which the engine
 * accepts (`typeof === "number"`) and which then poisons every balance
 * downstream. Unusable entries are dropped; the rest are kept.
 */
export function sanitizeOverrides(raw: unknown): EventOverridesMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const out: EventOverridesMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const amount = (value as { overrideAmount?: unknown }).overrideAmount;
    if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
    out[key] = { eventKey: key, overrideAmount: amount };
  }
  return out;
}

/**
 * Upgrade raw JSON from storage into a valid AppState,
 * filling in defaults and migrating versions if needed.
 */
export function upgradeAppState(raw: any): AppState {
  if (!raw || typeof raw !== "object") {
    return createInitialAppState();
  }

  const version = typeof raw.version === "number" ? raw.version : 0;

  // True legacy (pre-v1, unknown shape): start fresh, keeping only the
  // balance. v1 and later migrate additively through the field-by-field
  // path below — never discard a user's rules on a version bump.
  if (version < 1) {
    const fresh = createInitialAppState();
    if (raw.account && typeof raw.account.startingBalance === "number") {
      fresh.account.startingBalance = raw.account.startingBalance;
    }
    return fresh;
  }

  const account: CashAccount = {
    startingBalance:
      raw.account && typeof raw.account.startingBalance === "number"
        ? raw.account.startingBalance
        : 0,
  };

  const settings: CashflowSettings = {
    startDate:
      raw.settings && isValidISODate(raw.settings.startDate)
        ? raw.settings.startDate
        : toISODate(new Date()),
    horizonDays: sanitizeHorizonDays(raw.settings?.horizonDays),
    minSafeBalance:
      raw.settings && typeof raw.settings.minSafeBalance === "number"
        ? raw.settings.minSafeBalance
        : 0,
    // Stamped once, on the first load that upgrades to v3. Keeping any
    // existing value matters: re-stamping would silently reset the clock
    // and discard however many months of coverage history had accrued.
    trackingSince:
      raw.settings && isValidISODate(raw.settings.trackingSince)
        ? raw.settings.trackingSince
        : toISODate(new Date()),
    coverageLens:
      raw.settings && raw.settings.coverageLens === "recurring" ? "recurring" : "all",
  };

  // Optional: omitted entirely when unset, which is what hides the
  // "second salary kept" metric rather than showing a placeholder.
  if (
    raw.settings &&
    typeof raw.settings.secondSalaryMonthly === "number" &&
    Number.isFinite(raw.settings.secondSalaryMonthly)
  ) {
    settings.secondSalaryMonthly = raw.settings.secondSalaryMonthly;
  }

  const rules: RecurringRule[] = Array.isArray(raw.rules)
    ? raw.rules
        .filter((r: any) => r && typeof r.id === "string")
        .flatMap((r: any) => {
          const schedule = sanitizeSchedule(r.schedule);
          if (!schedule) return []; // drop rules the engine cannot run
          return [
            {
              id: r.id,
              name: typeof r.name === "string" ? r.name : "Rule",
              amount: typeof r.amount === "number" ? r.amount : 0,
              isVariable: !!r.isVariable,
              schedule,
            },
          ];
        })
    : createDefaultRules();

  const adhocTransactions: AdhocTransaction[] = Array.isArray(
    raw.adhocTransactions
  )
    ? raw.adhocTransactions.flatMap((t: any) => {
        const txn = sanitizeAdhocTransaction(t);
        return txn ? [txn] : [];
      })
    : [];

  const overrides: EventOverridesMap = sanitizeOverrides(raw.overrides);

  return {
    version: APP_STATE_VERSION,
    account,
    settings,
    rules,
    adhocTransactions,
    overrides,
  };
}
