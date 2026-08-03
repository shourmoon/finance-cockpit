// src/domain/appState.ts
import type {
    AppState,
AdhocTransaction,
CashAccount,
CashflowSettings,
SurplusSettings,
RecurringRule,
RecurringSchedule,
EventOverridesMap,
UUID,
} from "./types";
import { toISODate, isValidISODate } from "./dateUtils";
// Re-exported so the reserve default has exactly one definition; the
// surplus module owns it because that is where it is applied.
import { DEFAULT_RESERVE_MONTHS } from "./surplusAllocation";
export { DEFAULT_RESERVE_MONTHS };

// v1 -> v2: added adhocTransactions (additive; v1 states migrate
// field-by-field with an empty list, nothing is discarded).
// v2 -> v3: added top-up tracking — `kind`/`reason` on ad-hoc transactions
// and `trackingSince`/`coverageLens`/`secondSalaryMonthly` in settings.
// Purely additive: existing transactions are left unmarked on purpose.
// Past top-ups were never recorded reliably (they were entered as edits to
// other rows), so name-matching "Top Up" would invent untrustworthy history.
// Tracking starts at the upgrade instead.
// v3 -> v4: added `settings.surplus` — parked cash plus the assumptions the
// market-vs-mortgage comparison runs on. Additive: v3 states keep everything
// and simply gain defaults, and parkedCash stays unset so the card is dormant
// until the user supplies a real balance.
export const APP_STATE_VERSION = 4;

/** Long-run pre-tax equity return. Conservative relative to historical. */
export const DEFAULT_EXPECTED_RETURN = 0.07;

/**
 * Combined marginal rate on long-term capital gains: 15% federal + 3.8% NIIT
 * + 6.37% NJ. Editable — it is a default, not an assertion about the user.
 */
export const DEFAULT_CAPITAL_GAINS_RATE = 0.2517;

/** Years over which the two allocation paths are compared. */
export const DEFAULT_COMPARISON_YEARS = 30;

/**
 * Coerce one untrusted surplus number. Anything unusable falls back to the
 * default rather than to zero: a zero reserve would present the whole balance
 * as investable and a zero return would make prepaying win automatically —
 * both far worse than reverting to a sane value.
 */
function sanitizeSurplusNumber(
  raw: unknown,
  fallback: number,
  max: number
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  if (raw <= 0 || raw > max) return fallback;
  return raw;
}

/** Field-by-field validation of an untrusted `settings.surplus`. */
export function sanitizeSurplusSettings(raw: any): SurplusSettings {
  const surplus: SurplusSettings = {
    // Zero is the sensible default and a legitimate value, so this one is
    // clamped up from bad input rather than replaced by a non-zero default.
    monthlyContribution:
      typeof raw?.monthlyContribution === "number" &&
      Number.isFinite(raw.monthlyContribution) &&
      raw.monthlyContribution > 0
        ? raw.monthlyContribution
        : 0,
    yearlyContribution:
      typeof raw?.yearlyContribution === "number" &&
      Number.isFinite(raw.yearlyContribution) &&
      raw.yearlyContribution > 0
        ? raw.yearlyContribution
        : 0,
    // A month outside 1-12 is meaningless; January is the neutral fallback.
    yearlyMonth:
      typeof raw?.yearlyMonth === "number" &&
      Number.isInteger(raw.yearlyMonth) &&
      raw.yearlyMonth >= 1 &&
      raw.yearlyMonth <= 12
        ? raw.yearlyMonth
        : 1,
    reserveMonths: sanitizeSurplusNumber(raw?.reserveMonths, DEFAULT_RESERVE_MONTHS, 120),
    expectedReturn: sanitizeSurplusNumber(raw?.expectedReturn, DEFAULT_EXPECTED_RETURN, 1),
    capitalGainsRate: sanitizeSurplusNumber(
      raw?.capitalGainsRate,
      DEFAULT_CAPITAL_GAINS_RATE,
      1
    ),
    horizonYears: sanitizeSurplusNumber(raw?.horizonYears, DEFAULT_COMPARISON_YEARS, 100),
  };

  // An unusable end date is dropped rather than defaulted: "no end date"
  // is the safe reading, since inventing one would silently truncate a plan
  // the user believes is open-ended.
  if (isValidISODate(raw?.contributionsUntil)) {
    surplus.contributionsUntil = raw.contributionsUntil;
  }

  // Zero is a real answer here ("nothing parked"), so it is accepted where
  // the others clamp it away. Only a non-number leaves the field unset.
  if (
    typeof raw?.parkedCash === "number" &&
    Number.isFinite(raw.parkedCash) &&
    raw.parkedCash >= 0
  ) {
    surplus.parkedCash = raw.parkedCash;
  }

  return surplus;
}

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
    surplus: sanitizeSurplusSettings(undefined),
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
    surplus: sanitizeSurplusSettings(raw.settings?.surplus),
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
