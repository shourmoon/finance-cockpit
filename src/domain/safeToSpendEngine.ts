// src/domain/safeToSpendEngine.ts
import type { AppState, AdhocTransaction, ISODate, Money, FutureEvent, TimelinePoint } from "./types";
import { runCashflowProjection } from "./cashflowEngine";

export interface TopUpHint {
  /** Amount to deposit so the balance never dips below the safety floor. */
  amountNeeded: Money;
  /** Date of the first projected dip below the floor — deposit by this. */
  neededBy: ISODate;
  /** The deepest projected balance over the horizon (drives the amount). */
  lowestBalance: Money;
  /** Date of that deepest point (may be later than neededBy). */
  lowestDate: ISODate;
}

/**
 * For users who park cash elsewhere and top up this account on demand:
 * if the projected balance ever dips below minSafeBalance, return the
 * single deposit that keeps the whole horizon at or above the floor.
 *
 * This is the yield-optimal single transfer: the amount is sized to the
 * horizon's deepest point (`lowestBalance`/`lowestDate`), and `neededBy`
 * is the first breach date — the latest you can deposit and still keep
 * every day above the floor, since a deposit only lifts days on or after
 * it. Returns null when no top-up is needed.
 */
export function computeTopUpHint(
  timeline: readonly TimelinePoint[],
  minSafeBalance: Money
): TopUpHint | null {
  let lowestBalance = Infinity;
  let lowestDate: ISODate | null = null;
  let neededBy: ISODate | null = null;

  for (const p of timeline) {
    if (p.balance < lowestBalance) {
      lowestBalance = p.balance;
      lowestDate = p.date;
    }
    if (neededBy === null && p.balance < minSafeBalance) neededBy = p.date;
  }

  // neededBy is null exactly when nothing breaches the floor (incl. empty
  // timeline); lowestDate is then also null.
  if (neededBy === null || lowestDate === null) return null;
  return {
    amountNeeded: minSafeBalance - lowestBalance,
    neededBy,
    lowestBalance,
    lowestDate,
  };
}

export interface TopUpDeposit {
  /** The latest date this deposit can be made — the day the balance would
   *  otherwise breach the floor. */
  date: ISODate;
  /** How much to move in on that date (sized to reach the floor exactly). */
  amount: Money;
  /** Projected balance on `date` before this deposit (always below floor). */
  balanceBefore: Money;
}

/**
 * The just-in-time transfer plan for users who park cash in high-yield
 * savings and top this account up only when a payment is due.
 *
 * `computeTopUpHint` gives one deposit sized to the horizon's deepest
 * point, made by the first breach. When the balance dips below the floor
 * in several separate stretches, that front-loads the whole amount into
 * the first transfer even though later dips are months away, leaving cash
 * sitting idle in checking. This schedule instead makes one deposit per
 * below-floor stretch: at the stretch's first day (the latest moment you
 * can still stay at the floor, since a deposit only lifts days on or after
 * it) and sized to that stretch's deepest point (so you never have to top
 * up twice in the same stretch). Deposits carry forward, so an earlier
 * top-up can lift a later raw dip clear of the floor on its own.
 *
 * The deposits' total equals the single-hint amount, but split so the
 * maximum cash stays earning yield for the maximum time, with the fewest
 * transfers. Returns [] when no top-up is ever needed.
 */
export function computeTopUpSchedule(
  timeline: readonly TimelinePoint[],
  minSafeBalance: Money
): TopUpDeposit[] {
  const deposits: TopUpDeposit[] = [];
  let deposited = 0; // cumulative top-ups scheduled so far
  let i = 0;

  while (i < timeline.length) {
    const running = timeline[i].balance + deposited;
    if (running >= minSafeBalance) {
      i++;
      continue;
    }
    // Start of a below-floor stretch at the first breach day. Scan to its
    // end (where the raw balance, plus deposits so far, recovers to the
    // floor on its own) and find its deepest adjusted point.
    const breachDate = timeline[i].date;
    let lowest = Infinity;
    let j = i;
    while (j < timeline.length && timeline[j].balance + deposited < minSafeBalance) {
      const adjusted = timeline[j].balance + deposited;
      if (adjusted < lowest) lowest = adjusted;
      j++;
    }
    const amount = minSafeBalance - lowest;
    deposits.push({ date: breachDate, amount, balanceBefore: running });
    deposited += amount;
    i = j;
  }

  return deposits;
}

/**
 * Turns a scheduled deposit into the ad-hoc inflow transaction it
 * represents once the user actually makes the transfer in real life —
 * so it feeds back into the projection and the plan recomputes without
 * that stretch (the caller only needs to attach an id).
 *
 * Amount is rounded to the nearest cent: `computeTopUpSchedule` derives
 * amounts by subtraction over a chain of deposits, and without rounding
 * that can leave a sub-cent residue that would show up as a phantom
 * leftover stretch in the recomputed schedule.
 */
export function transferDepositToTransaction(
  deposit: TopUpDeposit
): Omit<AdhocTransaction, "id"> {
  return {
    name: "Top Up",
    amount: Math.round(deposit.amount * 100) / 100,
    date: deposit.date,
  };
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
