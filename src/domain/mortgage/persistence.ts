// src/domain/mortgage/persistence.ts
import type {
  MortgageOriginalTerms,
  PastPrepaymentLog,
  PaymentFrequency,
  ISODate,
} from "./types";
import type {
  MortgageScenarioConfig,
} from "./scenarios";
// Dates here are the same "YYYY-MM-DD denoting a real calendar day"
// contract the cashflow side uses, so the check lives in one place.
import { isValidISODate } from "../dateUtils";

export interface MortgageUIState {
  terms: MortgageOriginalTerms;
  prepayments: PastPrepaymentLog;
  /**
   * As-of date used for scenario analysis.
   * If null, the UI is free to default to something sensible
   * (e.g. latest actual payment date or today).
   */
  asOfDate: ISODate | null;
  /**
   * Saved scenario configurations (labels, patterns, etc.).
   */
  scenarios: MortgageScenarioConfig[];
}

const STORAGE_KEY_V2 = "finance-cockpit-mortgage-v2";
const LEGACY_STORAGE_KEY_V1 = "finance-cockpit-mortgage-v1";

export function createDefaultMortgageUIState(): MortgageUIState {
  const defaultTerms: MortgageOriginalTerms = {
    principal: 300_000,
    annualRate: 0.05,
    termMonths: 360,
    startDate: "2025-01-01",
    paymentFrequency: "monthly",
  };

  return {
    terms: defaultTerms,
    prepayments: [],
    asOfDate: defaultTerms.startDate,
    scenarios: [],
  };
}

/**
 * Very defensive JSON parsing to avoid runtime crashes due to malformed
 * localStorage content. Returns null if anything looks off.
 */
function tryParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? null;
  } catch {
    return null;
  }
}

function isValidTerms(value: any): value is MortgageOriginalTerms {
  if (!value || typeof value !== "object") return false;
  const { principal, annualRate, termMonths, startDate } = value;
  return (
    typeof principal === "number" &&
    Number.isFinite(principal) &&
    principal > 0 &&
    typeof annualRate === "number" &&
    Number.isFinite(annualRate) &&
    annualRate >= 0 &&
    typeof termMonths === "number" &&
    Number.isInteger(termMonths) &&
    termMonths > 0 &&
    // Must be a real calendar day, not merely a non-empty string: a
    // startDate like "hello" flows straight into addMonths and yields a
    // schedule whose every date is "NaN-NaN-NaN", rendered to the user as
    // "NaN NaN 'N" beside otherwise plausible money figures.
    isValidISODate(startDate)
  );
}

/**
 * Normalise the payment cadence. Anything unrecognised — including absent,
 * which is every loan saved before biweekly support existed — becomes
 * "monthly", so stored loans keep the behaviour they were created with.
 */
function normalizeFrequency(value: unknown): PaymentFrequency {
  return value === "biweekly" ? "biweekly" : "monthly";
}

function isValidPrepayments(value: any): value is PastPrepaymentLog {
  if (!Array.isArray(value)) return false;
  return value.every((p) => {
    if (!p || typeof p !== "object") return false;
    const { date, amount } = p as any;
    return (
      // A prepayment whose date isn't a real day is never applied at all
      // (it compares against payment dates as a string), so it would sit
      // in the log looking recorded while contributing nothing.
      isValidISODate(date) &&
      typeof amount === "number" &&
      Number.isFinite(amount) &&
      amount > 0
    );
  });
}

const SCENARIO_PATTERN_KINDS = new Set(["oneTime", "monthly", "yearly", "biweekly"]);

/**
 * A pattern missing a field its own kind depends on (or carrying a
 * non-finite amount) would otherwise silently inject NaN into the
 * simulated schedule, or throw outright (a biweekly pattern with no
 * anchorDate). Rather than let corrupted data (a bad sync payload, a
 * hand-edited localStorage value) reach the domain layer, drop only the
 * offending pattern here and keep the rest of the scenario intact.
 */
function isValidScenarioPattern(value: any): boolean {
  if (!value || typeof value !== "object") return false;
  if (typeof value.id !== "string" || typeof value.kind !== "string") return false;
  if (!SCENARIO_PATTERN_KINDS.has(value.kind)) return false;
  if (!Number.isFinite(value.amount)) return false;

  // Optional date bounds still have to be real days when present: they are
  // compared against schedule dates as strings, and a biweekly anchorDate
  // additionally reaches parseIsoToDate, which throws — from inside a
  // render-time useMemo, taking the whole tab down.
  const optionalDateOk = (d: unknown) => d === undefined || isValidISODate(d);

  switch (value.kind) {
    case "oneTime":
      return isValidISODate(value.date);
    case "monthly":
      return isValidISODate(value.startDate) && optionalDateOk(value.untilDate);
    case "yearly":
      return (
        Number.isFinite(value.month) &&
        Number.isFinite(value.day) &&
        Number.isFinite(value.firstYear)
      );
    case "biweekly":
      return (
        isValidISODate(value.anchorDate) &&
        optionalDateOk(value.startDate) &&
        optionalDateOk(value.untilDate)
      );
    // Unreachable: SCENARIO_PATTERN_KINDS.has(value.kind) above already
    // narrows to exactly these four cases.
    /* v8 ignore next 2 */
    default:
      return false;
  }
}

function sanitizeScenarios(value: any): MortgageScenarioConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (s): s is any =>
        !!s &&
        typeof s === "object" &&
        typeof s.id === "string" &&
        typeof s.name === "string"
    )
    .map((s) => ({
      ...s,
      patterns: Array.isArray(s.patterns)
        ? s.patterns.filter(isValidScenarioPattern)
        : [],
    }));
}

/**
 * Field-by-field validation of an untrusted MortgageUIState-shaped value
 * (from localStorage or a sync snapshot). Returns a clean state, or null
 * if the terms — the one part with no sensible fallback — are invalid.
 */
export function sanitizeMortgageUIState(value: unknown): MortgageUIState | null {
  if (!value || typeof value !== "object") return null;
  const { terms, prepayments, asOfDate, scenarios } =
    value as Partial<MortgageUIState>;

  if (!isValidTerms(terms)) return null;
  const safePrepayments = isValidPrepayments(prepayments) ? prepayments! : [];
  // A non-date asOfDate sorts lexically above every real ISO date, which
  // makes the scenario engine treat the entire schedule as already paid —
  // the app would quietly believe the mortgage was paid off.
  const safeAsOfDate = isValidISODate(asOfDate)
    ? (asOfDate as ISODate)
    : terms.startDate;
  const safeScenarios = sanitizeScenarios(scenarios);

  return {
    terms: { ...terms, paymentFrequency: normalizeFrequency(terms.paymentFrequency) },
    prepayments: safePrepayments,
    asOfDate: safeAsOfDate,
    scenarios: safeScenarios,
  };
}

/**
 * Try to load v2 state. Returns null if not present or invalid.
 */
function loadV2FromStorage(): MortgageUIState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY_V2);
  return sanitizeMortgageUIState(tryParse<Partial<MortgageUIState>>(raw));
}

/**
 * Try to load legacy v1 state and upgrade it to v2 shape.
 * v1 only had: { terms, prepayments }.
 */
function loadAndMigrateV1(): MortgageUIState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY_V1);
  const parsed = tryParse<any>(raw);
  if (!parsed || typeof parsed !== "object") return null;

  const { terms, prepayments } = parsed as {
    terms?: unknown;
    prepayments?: unknown;
  };

  if (!isValidTerms(terms)) return null;
  const safePrepayments = isValidPrepayments(prepayments) ? prepayments! : [];

  const migrated: MortgageUIState = {
    terms,
    prepayments: safePrepayments,
    asOfDate: terms.startDate,
    scenarios: [],
  };

  // Persist as v2 so next loads hit the new key.
  try {
    window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(migrated));
  } catch {
    // Non-fatal if we can't save.
  }

  return migrated;
}

/**
 * Load mortgage UI state with:
 *  1) v2 (current)
 *  2) fallback to migrated v1
 *  3) fallback to hard-coded defaults
 */
export function loadMortgageUIState(): MortgageUIState {
  const v2 = loadV2FromStorage();
  if (v2) return v2;

  const migrated = loadAndMigrateV1();
  if (migrated) return migrated;

  return createDefaultMortgageUIState();
}

export function saveMortgageUIState(state: MortgageUIState): void {
  if (typeof window === "undefined") return;
  try {
    // Terms are the one field with no safe substitute: overwriting them
    // with the hard-coded defaults would silently destroy the user's real
    // mortgage the moment anything hands us an unusable value. Keep
    // whatever valid terms are already stored instead, and only fall back
    // to defaults when there is nothing good to preserve.
    const safeTerms = isValidTerms(state.terms)
      ? state.terms
      : loadV2FromStorage()?.terms ?? createDefaultMortgageUIState().terms;

    const payload: MortgageUIState = {
      ...state,
      terms: { ...safeTerms, paymentFrequency: normalizeFrequency(safeTerms.paymentFrequency) },
      prepayments: isValidPrepayments(state.prepayments)
        ? state.prepayments
        : [],
      asOfDate: isValidISODate(state.asOfDate)
        ? (state.asOfDate as ISODate)
        : safeTerms.startDate,
      scenarios: sanitizeScenarios(state.scenarios),
    };

    window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(payload));
  } catch {
    // Non-fatal for the UI if persistence fails.
  }
}
