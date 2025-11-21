// src/domain/mortgage/persistence.ts
import type {
  MortgageOriginalTerms,
  PastPrepaymentLog,
} from "./types";

export interface MortgageUIState {
  terms: MortgageOriginalTerms;
  prepayments: PastPrepaymentLog;
}

const STORAGE_KEY = "finance-cockpit-mortgage-v1";

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
  };
}

export function saveMortgageUIState(state: MortgageUIState): void {
  try {
    const json = JSON.stringify(state);
    window.localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // ignore persistence failures
  }
}

export function loadMortgageUIState(): MortgageUIState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const terms = (parsed as any).terms;
    const prepayments = (parsed as any).prepayments;

    if (!terms || typeof terms !== "object") return null;
    if (!Array.isArray(prepayments)) return null;

    const principal = Number(terms.principal);
    const annualRate = Number(terms.annualRate);
    const termMonths = Number(terms.termMonths);
    const startDate = String(terms.startDate);

    if (
      !Number.isFinite(principal) ||
      !Number.isFinite(annualRate) ||
      !Number.isFinite(termMonths) ||
      typeof startDate !== "string"
    ) {
      return null;
    }

    const sanitizedTerms: MortgageOriginalTerms = {
      principal,
      annualRate,
      termMonths,
      startDate,
    };

    const sanitizedPrepayments: PastPrepaymentLog = prepayments
      .filter((p: any) => p && typeof p === "object")
      .map((p: any) => ({
        date: String(p.date),
        amount: Number(p.amount),
        note: typeof p.note === "string" ? p.note : undefined,
      }))
      .filter(
        (p) =>
          !!p.date &&
          Number.isFinite(p.amount) &&
          p.amount > 0
      );

    return {
      terms: sanitizedTerms,
      prepayments: sanitizedPrepayments,
    };
  } catch {
    return null;
  }
}
