// src/domain/mortgage/persistence.ts
import type {
  MortgageOriginalTerms,
  PastPrepaymentLog,
  ISODate,
} from "./types";
import type {
  MortgageScenarioConfig,
} from "./scenarios";

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
    typeof startDate === "string" &&
    !!startDate
  );
}

function isValidPrepayments(value: any): value is PastPrepaymentLog {
  if (!Array.isArray(value)) return false;
  return value.every((p) => {
    if (!p || typeof p !== "object") return false;
    const { date, amount } = p as any;
    return (
      typeof date === "string" &&
      !!date &&
      typeof amount === "number" &&
      Number.isFinite(amount) &&
      amount > 0
    );
  });
}

function isValidScenarioConfigArray(value: any): value is MortgageScenarioConfig[] {
  if (!Array.isArray(value)) return false;
  // We keep this intentionally light; UI will do deeper validation if needed.
  return value.every((s) => {
    if (!s || typeof s !== "object") return false;
    return typeof (s as any).id === "string" && typeof (s as any).name === "string";
  });
}

/**
 * Try to load v2 state. Returns null if not present or invalid.
 */
function loadV2FromStorage(): MortgageUIState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY_V2);
  const parsed = tryParse<Partial<MortgageUIState>>(raw);
  if (!parsed) return null;

  const { terms, prepayments, asOfDate, scenarios } = parsed;

  if (!isValidTerms(terms)) return null;
  const safePrepayments = isValidPrepayments(prepayments) ? prepayments! : [];
  const safeAsOfDate =
    typeof asOfDate === "string" && asOfDate.trim().length > 0
      ? (asOfDate as ISODate)
      : terms.startDate;
  const safeScenarios = isValidScenarioConfigArray(scenarios)
    ? scenarios!
    : [];

  return {
    terms,
    prepayments: safePrepayments,
    asOfDate: safeAsOfDate,
    scenarios: safeScenarios,
  };
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
    const payload: MortgageUIState = {
      ...state,
      // Defensive: ensure fields are sane before persisting
      terms: isValidTerms(state.terms)
        ? state.terms
        : createDefaultMortgageUIState().terms,
      prepayments: isValidPrepayments(state.prepayments)
        ? state.prepayments
        : [],
      asOfDate:
        typeof state.asOfDate === "string" && state.asOfDate.trim().length > 0
          ? (state.asOfDate as ISODate)
          : (state.terms.startDate as ISODate),
      scenarios: Array.isArray(state.scenarios)
        ? state.scenarios
        : [],
    };

    window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(payload));
  } catch {
    // Non-fatal for the UI if persistence fails.
  }
}
