// src/domain/mortgage/persistence.ts
import type {
  MortgageOriginalTerms,
  PastPrepaymentLog,
  PaymentFrequency,
  ISODate,
} from "./types";
// Dates here are the same "YYYY-MM-DD denoting a real calendar day"
// contract the cashflow side uses, so the check lives in one place.
import { isValidISODate } from "../dateUtils";

/**
 * Note on stored payloads: earlier versions carried a `scenarios` array for
 * the what-if feature, which the surplus card replaced. Parsing simply
 * ignores the field — it is neither read nor written — so an old localStorage
 * value or an incoming sync snapshot still loads without complaint, and the
 * dead data falls away the next time state is saved.
 */
export interface MortgageUIState {
  terms: MortgageOriginalTerms;
  prepayments: PastPrepaymentLog;
  /**
   * As-of date used for scenario analysis.
   * If null, the UI is free to default to something sensible
   * (e.g. latest actual payment date or today).
   */
  asOfDate: ISODate | null;
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

/**
 * Field-by-field validation of an untrusted MortgageUIState-shaped value
 * (from localStorage or a sync snapshot). Returns a clean state, or null
 * if the terms — the one part with no sensible fallback — are invalid.
 */
export function sanitizeMortgageUIState(value: unknown): MortgageUIState | null {
  if (!value || typeof value !== "object") return null;
  const { terms, prepayments, asOfDate } = value as Partial<MortgageUIState>;

  if (!isValidTerms(terms)) return null;
  const safePrepayments = isValidPrepayments(prepayments) ? prepayments! : [];
  // A non-date asOfDate sorts lexically above every real ISO date, which
  // makes the scenario engine treat the entire schedule as already paid —
  // the app would quietly believe the mortgage was paid off.
  const safeAsOfDate = isValidISODate(asOfDate)
    ? (asOfDate as ISODate)
    : terms.startDate;
  return {
    terms: { ...terms, paymentFrequency: normalizeFrequency(terms.paymentFrequency) },
    prepayments: safePrepayments,
    asOfDate: safeAsOfDate,
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

    // Built field by field rather than by spreading `state`: a spread carries
    // through anything the caller happens to be holding, so retired fields
    // (the old `scenarios` array) would be written back forever, and any
    // future stray property would silently reach storage and the sync
    // payload. Only what this module knows about gets persisted.
    const payload: MortgageUIState = {
      terms: { ...safeTerms, paymentFrequency: normalizeFrequency(safeTerms.paymentFrequency) },
      prepayments: isValidPrepayments(state.prepayments)
        ? state.prepayments
        : [],
      asOfDate: isValidISODate(state.asOfDate)
        ? (state.asOfDate as ISODate)
        : safeTerms.startDate,
    };

    window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(payload));
  } catch {
    // Non-fatal for the UI if persistence fails.
  }
}
