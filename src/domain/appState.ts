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
} from "./types";
import { toISODate, isValidISODate } from "./dateUtils";
// One definition of the override key, shared with the engine that reads it.
import { makeEventKey } from "./cashflowEngine";
// One definition of a valid checkpoint, shared with the module that reads
// them, so storage and the summary can never disagree about what counts.
import { sanitizeCheckpoints } from "./reconciliation";
// Re-exported so the reserve default has exactly one definition; the
// surplus module owns it because that is where it is applied.
import { DEFAULT_RESERVE_MONTHS } from "./surplusAllocation";
export { DEFAULT_RESERVE_MONTHS };

// v1 -> v2: added adhocTransactions (additive; v1 states migrate
// field-by-field with an empty list, nothing is discarded).
// v2 -> v3: added top-up tracking — `kind`/`reason` on ad-hoc transactions
// and `trackingSince`/`coverageLens`/`secondSalaryMonthly` in settings
// (`reason` and `coverageLens` since retired; see v5 -> v6).
// Purely additive: existing transactions are left unmarked on purpose.
// Past top-ups were never recorded reliably (they were entered as edits to
// other rows), so name-matching "Top Up" would invent untrustworthy history.
// Tracking starts at the upgrade instead.
// v3 -> v4: added `settings.surplus` — parked cash plus the assumptions the
// market-vs-mortgage comparison runs on. Additive: v3 states keep everything
// and simply gain defaults, and parkedCash stays unset so the card is dormant
// until the user supplies a real balance.
// v4 -> v5: added `checkpoints` — the log of times the starting balance was
// checked against an actual statement. Additive, and deliberately NOT
// backfilled: there is no honest way to invent a date on which a figure was
// last confirmed, and stamping one would report a balance as fresh that
// nobody has looked at. An older state arrives with an empty log and reads
// as never confirmed, which is exactly what it is.
// v8 -> v9: retired `settings.followToday` and the rolling start date with
// it. The start date is the user's to set, so nothing moves it, and "today"
// is read from the clock where it is actually needed (staleness, coverage,
// the date a reality check records) rather than being impersonated by the
// forecast window. Subtractive like v6 and just as narrow: the stored
// `startDate` is left exactly where it is, and only the flag goes.
//
// v7 -> v8: added `settings.followToday`. Additive, and absent means true, so
// every existing state starts following today without its stored startDate
// being touched — the engine still receives a concrete date and no domain
// caller changes. This closes the oldest quiet failure in the app: startDate
// was stamped on the first install and never moved again, so the projection
// drifted a day further into the past every day, and the one feature built to
// catch drift could not see it. `assessFreshness` ages the last checkpoint
// against startDate, so with startDate frozen on the day a balance was
// confirmed, that balance read "confirmed today" forever.
// v6 -> v7: a one-time transaction can no longer carry an override. The
// override mechanism exists so one occurrence of a REPEATING rule can differ
// from the rule's default; a one-off happens once and has no default, so an
// override on it was simply a second stored value for a quantity that has
// one. The two drifted apart in plain sight — Settings showed the original
// while the dashboard showed the override — and because the key carries the
// date, moving the date orphaned the override and silently reverted the
// amount. Any override belonging to an ad-hoc transaction is folded into
// that transaction's amount and dropped. Folded, NOT discarded: the figure
// the user was looking at is the one that survives, so nothing on screen
// moves across the upgrade. An override left over from an older date is
// dropped outright — it can never apply again, and reviving it if the date
// happened to move back would be a surprise, not a feature.
// v5 -> v6: retired the two kinds of top-up. `reason` on an ad-hoc
// transaction and `settings.coverageLens` are dropped on read — the only
// subtractive migration here so far, and deliberately narrow: the top-up
// itself is money the household really moved, so `kind: "topUp"` and the
// amount, date and name all survive untouched. Only the label saying *why*
// goes, along with the lens that existed to filter on it. Nothing is
// backfilled in the other direction: a draw recorded as a one-off shock is
// still a draw, and coverage now counts it as one.
export const APP_STATE_VERSION = 9;

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
 * per day and the top-up plan walks every one of them, so an unbounded
 * value is a real hazard rather than a theoretical one: 200,000 days builds
 * a 200,001-point timeline. Ten years is far beyond any useful forecast
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

/**
 * A money amount from untrusted storage.
 *
 * `typeof x === "number"` is not enough: NaN and Infinity are numbers, and
 * JSON.parse will hand them straight through from a hand-edited value or a
 * corrupt sync payload. One NaN poisons the whole projection — the balance
 * becomes NaN from that day on, every comparison against it is false, and the
 * dashboard reports status "ok" over figures that are all NaN. Coerce to the
 * fallback so a broken field degrades one number instead of all of them.
 */
function money(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
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
    surplus: sanitizeSurplusSettings(undefined),
  };
}

/**
 * No rules. The app used to ship four — a $2,000 paycheck, $1,500 rent, a
 * credit card and groceries — so the first thing anyone saw was a stranger's
 * finances presented as their own, complete with a projected shortfall and a
 * prompt to move money that did not exist. An app whose whole claim is that
 * it never shows a figure it cannot stand behind cannot open with invented
 * ones. Nothing to forecast is the honest starting state, and the dashboard
 * asks for what it needs instead of filling the gap.
 */
function createDefaultRules(): RecurringRule[] {
  return [];
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
    checkpoints: [],
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
    amount: money(raw.amount, 0),
    date: raw.date,
  };

  // The top-up marker is only carried through when it is exactly the value
  // we write; anything else in stored JSON is dropped rather than trusted.
  // A `reason` from v5 or earlier is not read at all — there is one kind of
  // top-up now, so the transaction comes through as a top-up and the label
  // stops being written back.
  if (raw.kind === "topUp") {
    txn.kind = "topUp";
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
    if (raw.account && Number.isFinite(raw.account.startingBalance)) {
      fresh.account.startingBalance = raw.account.startingBalance;
    }
    return fresh;
  }

  const account: CashAccount = {
    startingBalance: money(raw.account?.startingBalance, 0),
  };

  const settings: CashflowSettings = {
    startDate:
      raw.settings && isValidISODate(raw.settings.startDate)
        ? raw.settings.startDate
        : toISODate(new Date()),
    horizonDays: sanitizeHorizonDays(raw.settings?.horizonDays),
    minSafeBalance: money(raw.settings?.minSafeBalance, 0),
    // Stamped once, on the first load that upgrades to v3. Keeping any
    // existing value matters: re-stamping would silently reset the clock
    // and discard however many months of coverage history had accrued.
    trackingSince:
      raw.settings && isValidISODate(raw.settings.trackingSince)
        ? raw.settings.trackingSince
        : toISODate(new Date()),
    surplus: sanitizeSurplusSettings(raw.settings?.surplus),
  };

  // `followToday` is not read. The start date no longer rolls, so the flag
  // means nothing; a retired field that is still copied forward is one the
  // app keeps writing back forever, so this simply stops looking at it.

  // Optional: omitted entirely when unset, which is what hides the
  // "second salary kept" metric rather than showing a placeholder.
  if (
    raw.settings &&
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
              // A rule is kept rather than dropped so the user can see and
              // fix it; a silently missing rule is harder to notice than a
              // zero one.
              amount: money(r.amount, 0),
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

  // v6 -> v7: fold any one-off's override into its own amount (see above).
  for (const txn of adhocTransactions) {
    const applies = overrides[makeEventKey(txn.id, txn.date)];
    if (applies) txn.amount = applies.overrideAmount;
    // Drop every override belonging to this transaction, including ones
    // stranded on a date it no longer has.
    for (const key of Object.keys(overrides)) {
      if (key.startsWith(`${txn.id}__`)) delete overrides[key];
    }
  }

  return {
    version: APP_STATE_VERSION,
    account,
    settings,
    rules,
    adhocTransactions,
    overrides,
    // Absent before v5, and never invented: an empty log reads as "never
    // confirmed", which is the truth about a state that predates the log.
    checkpoints: sanitizeCheckpoints(raw.checkpoints),
  };
}
