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
