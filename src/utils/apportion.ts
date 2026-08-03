// src/utils/apportion.ts

/**
 * Round `parts` to whole numbers that sum to exactly `Math.round(total)`.
 *
 * Rounding each part on its own is what makes a breakdown fail to add up on
 * screen. It can undershoot the whole (0.6 + 0.6 rounds to 1 + 1 = 2 against
 * a total of 1) or overshoot it (0.4 + 0.4 + 0.4 rounds to nothing at all
 * against a total of 1). Either way the reader sees a column of figures that
 * does not reconcile with its own total, which on a page about money
 * undermines every other number on it.
 *
 * Largest-remainder: floor everything, then hand the leftover units to
 * whichever parts lost the most to flooring. Each result therefore stays
 * within one unit of its exact value — no part is inflated to make the books
 * balance — and the total is matched exactly.
 *
 * `total` is taken from the caller rather than summed here, because it is the
 * figure actually displayed as the whole and that is what must be matched.
 */
export function apportion(parts: number[], total: number): number[] {
  const safe = parts.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const out = safe.map((p) => Math.floor(p));

  const target =
    Number.isFinite(total) && total > 0 ? Math.round(total) : 0;
  const floored = out.reduce((a, b) => a + b, 0);

  // Flooring can only ever land at or below the target when the total is the
  // sum of the parts, but the caller may pass an independent total, so handle
  // an overshoot by taking units back from the parts that lost the least.
  let left = target - floored;

  const byRemainder = safe
    .map((p, i) => ({ i, frac: p - Math.floor(p) }))
    .sort((a, b) => b.frac - a.frac);

  // Nothing to apportion into: there is no honest way to represent a
  // non-zero total as zero parts, so return the empty list unchanged.
  if (byRemainder.length === 0) return out;

  // Hand spare units to whichever parts lost the most to flooring. Cycling
  // rather than one-pass matters only when the caller's total is not the sum
  // of the parts; when it is, |left| < parts.length and the first pass ends
  // it, giving each part a value within one unit of its exact one.
  for (let k = 0; left > 0; k++) {
    out[byRemainder[k % byRemainder.length].i] += 1;
    left -= 1;
  }

  // The mirror case: reclaim units from the parts that lost the least.
  //
  // This terminates because `target` is clamped to >= 0 and at most
  // `floored` units can ever be reclaimed: starting from left = target -
  // floored, reclaiming everything brings left back to target >= 0, so the
  // condition fails first. The exhaustion check below is therefore
  // unreachable — it is kept anyway, because an unbounded loop over money
  // is the one failure this codebase has already been bitten by, and a
  // proof in a comment is worth less than a stop condition in the code.
  const leastFirst = [...byRemainder].reverse();
  for (let k = 0; left < 0; k++) {
    /* v8 ignore next 1 */
    if (k >= leastFirst.length && out.every((v) => v <= 0)) break;
    const i = leastFirst[k % leastFirst.length].i;
    if (out[i] <= 0) continue;
    out[i] -= 1;
    left += 1;
  }

  return out;
}
