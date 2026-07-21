// src/domain/safeToSpendEngine.ts
import type { AppState, ISODate, Money, FutureEvent, TimelinePoint } from "./types";
import { runCashflowProjection } from "./cashflowEngine";

export interface TopUpHint {
  /** Amount to deposit so the balance never dips below the safety floor. */
  amountNeeded: Money;
  /** Date of the first projected dip below the floor — deposit before this. */
  neededBy: ISODate;
}

/**
 * For users who park cash elsewhere and top up this account on demand:
 * if the projected balance ever dips below minSafeBalance, return how
 * much must be deposited (before the first breach date) to keep the
 * whole horizon at or above the floor. Returns null when no top-up is
 * needed.
 */
export function computeTopUpHint(
  timeline: readonly TimelinePoint[],
  minSafeBalance: Money
): TopUpHint | null {
  let minBalance = Infinity;
  let neededBy: ISODate | null = null;

  for (const p of timeline) {
    if (p.balance < minBalance) minBalance = p.balance;
    if (neededBy === null && p.balance < minSafeBalance) neededBy = p.date;
  }

  if (neededBy === null) return null; // never breaches the floor (or empty)
  return { amountNeeded: minSafeBalance - minBalance, neededBy };
}

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
