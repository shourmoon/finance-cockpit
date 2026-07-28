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

  switch (value.kind) {
    case "oneTime":
      return typeof value.date === "string" && value.date.length > 0;
    case "monthly":
      return typeof value.startDate === "string" && value.startDate.length > 0;
    case "yearly":
      return (
        Number.isFinite(value.month) &&
        Number.isFinite(value.day) &&
        Number.isFinite(value.firstYear)
      );
    case "biweekly":
      return typeof value.anchorDate === "string" && value.anchorDate.length > 0;
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
  const safeAsOfDate =
    typeof asOfDate === "string" && asOfDate.trim().length > 0
      ? (asOfDate as ISODate)
      : terms.startDate;
  const safeScenarios = sanitizeScenarios(scenarios);

  return {
    terms,
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
      scenarios: sanitizeScenarios(state.scenarios),
    };

    window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(payload));
  } catch {
    // Non-fatal for the UI if persistence fails.
  }
}
