// src/domain/safeToSpendEngine.ts
import type { AppState, Money, FutureEvent } from "./types";
import { runCashflowProjection } from "./cashflowEngine";

export interface SafeToSpendResult {
  projectedMinBalance: Money;
  safeToSpendToday: Money;
}

/**
 * Pure helper: computes safe-to-spend from a starting balance,
 * a min safe balance threshold, and a list of future events.
 * Used for unit tests and by the main computeSafeToSpend() wrapper.
 */
export function computeSafeToSpendFromEvents(
  startingBalance: Money,
  minSafeBalance: Money,
  events: readonly Pick<FutureEvent, "date" | "effectiveAmount">[]
): SafeToSpendResult {
  // Sort events by date to get a stable projection order
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));

  let balance = startingBalance;
  let minBalance = startingBalance;

  for (const e of sorted) {
    balance += e.effectiveAmount;
    if (balance < minBalance) {
      minBalance = balance;
    }
  }

  // We want the future minimum balance to never go below minSafeBalance
  // If we spend an extra X today, the whole curve shifts down by X:
  //   newMin = minBalance - X >= minSafeBalance  =>  X <= minBalance - minSafeBalance
  const margin = minBalance - minSafeBalance;
  const safeToSpendToday = margin > 0 ? margin : 0;

  return {
    projectedMinBalance: minBalance,
    safeToSpendToday,
  };
}

/**
 * High-level wrapper: uses the existing projection engine
 * to generate events, then computes the safe-to-spend envelope.
 */
export function computeSafeToSpend(state: AppState): SafeToSpendResult {
  const { events } = runCashflowProjection(state);
  const starting = state.account.startingBalance;
  const minSafe = state.settings.minSafeBalance ?? 0;

  return computeSafeToSpendFromEvents(starting, minSafe, events);
}
