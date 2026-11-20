// src/test/mortgageFixture.ts
//
// A valid mortgage, for tests that need one.
//
// This was `createDefaultMortgageUIState()` and it lived in
// `src/domain/mortgage/persistence.ts`, where three production paths reached
// for it whenever the real loan was missing or unreadable: a fresh install, a
// save handed unusable terms, and a pulled sync snapshot that would not
// sanitize. A new user was shown what they owed on a $300,000 loan at 5% that
// did not exist, and a garbled payload from another device became a confident
// debt on this one.
//
// It was never a bad *loan* — it is a perfectly good fixture, and the figures
// a dozen test files assert against are its. It was a bad *default*. So it
// moved here, to `src/test/`, which is excluded from the bundle's coverage
// gate and, more to the point, cannot be imported by production code without
// that being obvious in review.

import type { MortgageUIState } from "../domain/mortgage/persistence";

/** A plain 30-year, $300,000 loan at 5%. */
export function sampleMortgageUIState(): MortgageUIState {
  return {
    terms: {
      principal: 300_000,
      annualRate: 0.05,
      termMonths: 360,
      startDate: "2025-01-01",
      paymentFrequency: "monthly",
    },
    prepayments: [],
    asOfDate: "2025-01-01",
    checkpoints: [],
  };
}
