// src/domain/mortgage/irr.ts
import type { AmortizationEntry, Money } from "./types";

/**
 * Compute the effective annual interest rate implied by a mortgage schedule.
 *
 * We treat:
 *  - CF_0 = +principal (borrower receives the loan amount)
 *  - CF_t = -payment_t for each period t >= 1
 *
 * Then solve for the monthly rate r such that:
 *    NPV = sum_t CF_t / (1 + r)^t = 0
 *
 * Finally convert to an effective annual rate:
 *    (1 + r)^12 - 1
 */
export function computeEffectiveAnnualRateFromSchedule(
  schedule: AmortizationEntry[],
  principal: Money,
  /** 12 for a monthly schedule, 26 for biweekly. */
  periodsPerYear = 12
): number {
  if (schedule.length === 0) {
    throw new Error("Schedule is empty");
  }
  if (principal <= 0) {
    throw new Error("principal must be positive");
  }

  const cashflows: Money[] = [principal, ...schedule.map((e) => -e.payment)];

  function npv(rateMonthly: number): number {
    let total = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const cf = cashflows[t];
      total += cf / Math.pow(1 + rateMonthly, t);
    }
    return total;
  }

  // We assume rates are between 0% and 100% annually (0 to ~0.083 per month).
  // We'll search over monthly rate in [0, 0.2] to be generous.
  let lo = 0;
  let hi = 0.2;

  const npvLo = npv(lo);
  const npvHi = npv(hi);

  // If NPV does not change sign over [0, hi], IRR is not well-defined.
  // In that case just return 0 as a safe fallback.
  if (npvLo * npvHi > 0) {
    return 0;
  }

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    // Exact floating-point zero is not reachable for real schedules.
    /* v8 ignore next 4 */
    if (fMid === 0) {
      lo = hi = mid;
      break;
    }
    if (fMid * npvLo > 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const rPerPeriod = (lo + hi) / 2;
  const rAnnualEffective = Math.pow(1 + rPerPeriod, periodsPerYear) - 1;
  return rAnnualEffective;
}

/**
 * The effective annual rate for a schedule, or null when there isn't one.
 *
 * `computeEffectiveAnnualRateFromSchedule` throws on an empty schedule, and
 * empty is reachable: the Mortgage tab's principal field accepts any positive
 * number, so a typed `0.000000001` clears its `> 0` commit guard and then buys
 * no schedule at all (the engine stops at a balance under its 1e-6 epsilon).
 * A non-positive principal lands in the same place, for the same reason.
 *
 * Thrown from a render-time useMemo that took the whole tab down. Callers that
 * render a rate should use this: a rate that does not exist reads as absent,
 * and every other figure on the row survives.
 */
export function effectiveAnnualRateOrNull(
  schedule: AmortizationEntry[],
  principal: Money,
  periodsPerYear = 12
): number | null {
  if (schedule.length === 0) return null;
  return computeEffectiveAnnualRateFromSchedule(schedule, principal, periodsPerYear);
}
