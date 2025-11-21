// src/domain/persistence.ts
import type { AppState } from "./types";
import { upgradeAppState, createInitialAppState } from "./appState";

const STORAGE_KEY = "finance-cockpit-app-state-v1";

export function saveAppState(state: AppState): void {
  try {
    const json = JSON.stringify(state);
    window.localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // ignore persistence failures
  }
}

export function loadAppState(): AppState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return upgradeAppState(parsed);
  } catch {
    return createInitialAppState();
  }
}

export function clearAppState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

import type { Money, ISODate } from "./types";

export interface PersistedMortgageSettings {
  principal: Money;
  annualRate: number;
  termMonths: number;
  startDate: ISODate;
  extraMonthlyPayment: Money;
}

// Key used in localStorage for mortgage settings
const MORTGAGE_SETTINGS_KEY = "finance-cockpit:mortgage-settings";

export function saveMortgageSettings(settings: PersistedMortgageSettings): void {
  try {
    const json = JSON.stringify(settings);
    window.localStorage.setItem(MORTGAGE_SETTINGS_KEY, json);
  } catch {
    // ignore storage failures gracefully
  }
}

export function loadMortgageSettings():
  | PersistedMortgageSettings
  | null {
  try {
    const raw = window.localStorage.getItem(MORTGAGE_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // Basic shape validation and fallback
    if (
      typeof parsed.principal !== "number" ||
      typeof parsed.annualRate !== "number" ||
      typeof parsed.termMonths !== "number" ||
      typeof parsed.startDate !== "string" ||
      typeof parsed.extraMonthlyPayment !== "number"
    ) {
      return null;
    }

    return parsed as PersistedMortgageSettings;
  } catch {
    return null;
  }
}
