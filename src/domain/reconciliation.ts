// src/domain/reconciliation.ts
//
// Checking the model against reality.
//
// Everything else in this app verifies that the app agrees with itself: the
// invariant suites prove the engines obey conservation, units and timing,
// and the browser harness proves the screen agrees with the engines. None
// of that can tell you the model matches your actual bank account. Two
// figures here are maintained by hand — the starting balance and the parked
// cash — and a mortgage schedule is a model of what a servicer is doing,
// not a record of it. Both drift silently, and a projection built on a
// six-week-old balance is confidently wrong.
//
// A *checkpoint* is the user saying "on this date, the statement said this".
// Recording one does two jobs at once, which is why they are one feature and
// not two:
//
//   - it resets the freshness clock, because the figure has just been
//     confirmed against the source of truth, and
//   - it captures how far the model had drifted by then.
//
// `modelled` is stored, not recomputed later. For cash it is the only
// option: the user updates the starting balance to match the statement
// moments afterwards, which destroys the counterfactual. Keeping it also
// makes the log answer the question that matters most — is the error
// systematic (a rule is missing) or noise (timing of a payment)?

import type { Checkpoint, ISODate, Money } from "./types";
import { isValidISODate, parseISODate } from "./dateUtils";

// The persisted shape lives in ./types with the rest of the stored state.
// Freshness is measured from a checkpoint's `date`, never from when it was
// typed in: a two-month-old statement entered today is two months old.
export type { Checkpoint };

/** Which hand-maintained figure a checkpoint is about. */
export type CheckpointTarget = "cash" | "mortgage";

/**
 * Which way the model was wrong, in terms the two targets share.
 *
 * The raw sign means opposite things for cash and a loan — more cash than
 * modelled is good news, more debt than modelled is bad — so the sign is
 * resolved here rather than left for each caller to get right. "Optimistic"
 * always means *reality is worse than the model said*.
 */
export type DriftVerdict =
  | "unknown"
  | "match"
  | "modelOptimistic"
  | "modelPessimistic";

export interface Drift {
  /** actual − modelled, in the figure's own sign. */
  delta: Money;
  /** Distance apart, regardless of direction. */
  magnitude: Money;
  /** Share of the modelled figure; 0 when the model said zero. */
  relative: number;
  verdict: DriftVerdict;
}

export interface DriftTolerance {
  /** Ignore differences at or below this many currency units. */
  absolute: Money;
  /** Ignore differences at or below this share of the modelled figure. */
  relative: number;
}

/**
 * What counts as agreement.
 *
 * Neither target can be expected to match to the cent. A bank balance moves
 * between the moment a statement is read and the moment it is typed. A
 * servicer's balance differs from any amortization model by its day-count
 * convention and by when it posts a payment, which is a real difference of
 * a few dollars on a large loan and is not a defect in either. The tolerance
 * is deliberately loose enough that a "mismatch" means something.
 */
export const DEFAULT_TOLERANCE: Record<CheckpointTarget, DriftTolerance> = {
  cash: { absolute: 1, relative: 0.001 },
  mortgage: { absolute: 25, relative: 0.001 },
};

export type FreshnessLevel = "unconfirmed" | "fresh" | "aging" | "stale";

export interface Freshness {
  level: FreshnessLevel;
  /** Days since the most recent statement date; null when never confirmed. */
  ageDays: number | null;
  lastConfirmed: ISODate | null;
}

export interface FreshnessThresholds {
  /** Days after which the figure is worth a second look. */
  aging: number;
  /** Days after which it should not be trusted without confirming. */
  stale: number;
}

/**
 * How long each figure stays believable.
 *
 * Cash moves every day and nothing in the app corrects it, so a balance
 * confirmed a fortnight ago is already a guess. A loan balance moves on a
 * schedule the model reproduces, so it is allowed to go much longer before
 * it needs re-checking; the point of checking it at all is to catch a wrong
 * rate or a missed payment, which shows up over months, not days.
 */
export const DEFAULT_FRESHNESS: Record<CheckpointTarget, FreshnessThresholds> = {
  cash: { aging: 14, stale: 45 },
  mortgage: { aging: 90, stale: 210 },
};

export interface CheckpointSummary {
  count: number;
  /** The most recent check by statement date; null when there are none. */
  latest: Checkpoint | null;
  latestDrift: Drift | null;
  freshness: Freshness;
  /** Mean signed delta across every check — the model's bias, if any. */
  meanDelta: Money;
  /** The largest single miss on record. */
  worstMagnitude: Money;
  /**
   * True when enough checks have missed, and every one of them missed the
   * same way. A model that is wrong in one direction three times running is
   * not unlucky: something is missing from it, and re-entering the balance
   * will paper over it until the next time.
   */
  systematic: boolean;
}

/** Checks needed before a run of same-direction misses means anything. */
const SYSTEMATIC_MIN_MISSES = 3;

/** How far apart the model and the statement were, and which way. */
export function assessDrift(
  target: CheckpointTarget,
  actual: Money,
  modelled: Money,
  tolerance: DriftTolerance = DEFAULT_TOLERANCE[target]
): Drift {
  // A figure that is not a number cannot be compared to one. "match" would
  // be the worst available answer — it reads as "the model agrees" — so the
  // comparison reports that it could not be made. The numbers are zeroed
  // rather than left NaN so nothing downstream can render "NaN" from them.
  if (!Number.isFinite(actual) || !Number.isFinite(modelled)) {
    return { delta: 0, magnitude: 0, relative: 0, verdict: "unknown" };
  }

  const delta = actual - modelled;
  const magnitude = Math.abs(delta);
  const relative = modelled === 0 ? 0 : magnitude / Math.abs(modelled);

  const absTol = Number.isFinite(tolerance.absolute)
    ? Math.max(0, tolerance.absolute)
    : 0;
  const relTol = Number.isFinite(tolerance.relative)
    ? Math.max(0, tolerance.relative)
    : 0;
  const allowed = Math.max(absTol, relTol * Math.abs(modelled));

  if (magnitude <= allowed) {
    return { delta, magnitude, relative, verdict: "match" };
  }

  // More cash than modelled is good news; more debt than modelled is bad.
  const realityIsWorse = target === "cash" ? delta < 0 : delta > 0;
  return {
    delta,
    magnitude,
    relative,
    verdict: realityIsWorse ? "modelOptimistic" : "modelPessimistic",
  };
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
function daysBetween(from: ISODate, to: ISODate): number {
  const a = parseISODate(from).getTime();
  const b = parseISODate(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * How long since this figure was last confirmed against its source.
 *
 * A statement dated after `asOf` is treated as zero days old rather than
 * negative: it is the most recent thing we know, and "confirmed in −3 days"
 * is not a sentence.
 */
export function assessFreshness(
  checkpoints: readonly Checkpoint[],
  target: CheckpointTarget,
  asOf: ISODate,
  thresholds: FreshnessThresholds = DEFAULT_FRESHNESS[target]
): Freshness {
  const latest = latestCheckpoint(checkpoints);
  if (!latest || !isValidISODate(asOf)) {
    return { level: "unconfirmed", ageDays: null, lastConfirmed: null };
  }

  const ageDays = Math.max(0, daysBetween(latest.date, asOf));
  const aging = Number.isFinite(thresholds.aging) ? thresholds.aging : Infinity;
  const stale = Number.isFinite(thresholds.stale) ? thresholds.stale : Infinity;

  const level: FreshnessLevel =
    ageDays > stale ? "stale" : ageDays > aging ? "aging" : "fresh";

  return { level, ageDays, lastConfirmed: latest.date };
}

/**
 * The most recent usable check by statement date; null when there are none.
 *
 * "Usable" means exactly what `sanitizeCheckpoint` accepts, here and in
 * every other function in this module. Two definitions of a valid
 * checkpoint would let the summary count a record that storage discards, so
 * the same list would read differently before and after a reload.
 */
export function latestCheckpoint(
  checkpoints: readonly Checkpoint[]
): Checkpoint | null {
  let best: Checkpoint | null = null;
  for (const raw of checkpoints) {
    const c = sanitizeCheckpoint(raw);
    if (!c) continue;
    // Ties go to the later entry in the array, which is the later record.
    if (best === null || c.date >= best.date) best = c;
  }
  return best;
}

/** Freshness, the latest drift, and whether the misses form a pattern. */
export function summarizeCheckpoints(
  checkpoints: readonly Checkpoint[],
  target: CheckpointTarget,
  asOf: ISODate,
  tolerance: DriftTolerance = DEFAULT_TOLERANCE[target],
  thresholds: FreshnessThresholds = DEFAULT_FRESHNESS[target]
): CheckpointSummary {
  const usable = sanitizeCheckpoints(checkpoints);

  const latest = latestCheckpoint(usable);
  const drifts = usable.map((c) =>
    assessDrift(target, c.actual, c.modelled, tolerance)
  );
  const misses = drifts.filter((d) => d.verdict !== "match");

  return {
    count: usable.length,
    latest,
    latestDrift: latest
      ? assessDrift(target, latest.actual, latest.modelled, tolerance)
      : null,
    freshness: assessFreshness(usable, target, asOf, thresholds),
    meanDelta:
      usable.length === 0
        ? 0
        : drifts.reduce((s, d) => s + d.delta, 0) / usable.length,
    worstMagnitude: drifts.reduce((m, d) => Math.max(m, d.magnitude), 0),
    systematic:
      misses.length >= SYSTEMATIC_MIN_MISSES &&
      misses.every((d) => d.verdict === misses[0].verdict),
  };
}

/**
 * The principal the mortgage model shows outstanding on a date: the balance
 * left after the last payment on or before it.
 *
 * Before the first payment the answer is the full original principal. After
 * payoff the schedule's last entry already reads zero, so the same rule
 * gives the right answer without a special case.
 *
 * A prepayment made between two payment dates is applied by the schedule at
 * the *next* payment date, so a statement taken in that gap will legitimately
 * read lower than the model. That is a real difference in timing, not an
 * error in either — which is why the mortgage tolerance is not tight.
 */
export function modelledMortgageOn(
  schedule: readonly { date: ISODate; remaining: Money }[],
  principal: Money,
  date: ISODate
): Money | null {
  if (!isValidISODate(date)) return null;
  if (!Number.isFinite(principal)) return null;

  let balance = principal;
  for (const entry of schedule) {
    if (entry.date > date) break;
    if (Number.isFinite(entry.remaining)) balance = entry.remaining;
  }
  return balance;
}

/**
 * Validate an untrusted checkpoint from storage or a sync snapshot. A
 * checkpoint with a missing or non-finite figure is dropped rather than
 * defaulted: a zero here would read as "the bank said you have nothing",
 * which is a statement about reality that nobody made.
 */
export function sanitizeCheckpoint(raw: unknown): Checkpoint | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (!isValidISODate(value.date)) return null;
  if (typeof value.actual !== "number" || !Number.isFinite(value.actual)) {
    return null;
  }
  if (typeof value.modelled !== "number" || !Number.isFinite(value.modelled)) {
    return null;
  }

  return {
    id: value.id,
    date: value.date as ISODate,
    actual: value.actual,
    modelled: value.modelled,
  };
}

/** Validate a stored list of checkpoints, dropping only the unusable ones. */
export function sanitizeCheckpoints(raw: unknown): Checkpoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const checkpoint = sanitizeCheckpoint(entry);
    return checkpoint ? [checkpoint] : [];
  });
}
