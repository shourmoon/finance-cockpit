// src/domain/chartGeometry.ts
//
// Pure geometry for the dashboard balance chart. Framework-free so it
// can be unit-tested exhaustively; the SVG component in
// src/components/BalanceChart.tsx only maps these numbers to elements.

import type { ISODate, Money, TimelinePoint } from "./types";

export interface ChartPoint {
  x: number;
  y: number;
  balance: Money;
  date: ISODate;
}

export interface BalanceChartGeometry {
  points: ChartPoint[];
  /** SVG path string for the balance line ("M x y L x y …"). */
  linePath: string;
  /** SVG path for the smoothed (moving-average) trend overlay. */
  trendPath: string;
  /** y-coordinate of the safety-floor line. */
  floorY: number;
  /** y-coordinate of the zero line (always within the plot area). */
  zeroY: number;
  /** Index into `points` of the deepest balance. */
  minIndex: number;
  width: number;
  height: number;
  padding: number;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Centered moving average of a numeric series. Each output value is the
 * mean of up to `window` neighbours centered on that index (clamped at
 * the ends), so the result has the same length as the input and smooths
 * the daily paycheck/payment spikes into a trend. `window` is coerced to
 * an odd number >= 1.
 */
export function movingAverage(
  values: readonly number[],
  window: number
): number[] {
  const w = Math.max(1, Math.floor(window));
  const half = Math.floor(w / 2);
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < values.length) {
        sum += values[j];
        count++;
      }
    }
    out.push(sum / count);
  }
  return out;
}

/**
 * Index of the chart point whose x-coordinate is nearest the given
 * x (in viewBox units) — used to map a pointer/touch position on the
 * chart to a data point for the scrub crosshair. Returns 0 for an empty
 * point list.
 */
export function nearestPointIndex(
  points: readonly ChartPoint[],
  xInViewBox: number
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.abs(points[i].x - xInViewBox);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Scale a balance timeline into chart coordinates. The value axis always
 * includes both zero and the safety floor so those reference lines are
 * on-canvas. Returns null for an empty timeline.
 */
export function buildBalanceChartGeometry(
  timeline: readonly TimelinePoint[],
  minSafeBalance: Money,
  width = 320,
  height = 140,
  padding = 8
): BalanceChartGeometry | null {
  if (timeline.length === 0) return null;

  const balances = timeline.map((p) => p.balance);
  let lo = Math.min(minSafeBalance, 0, ...balances);
  let hi = Math.max(minSafeBalance, 0, ...balances);
  if (lo === hi) {
    // Perfectly flat series (and floor/zero coincide): give the axis a
    // unit span so nothing divides by zero.
    lo -= 1;
    hi += 1;
  }

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const n = timeline.length;

  const xOf = (i: number) =>
    padding + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yOf = (v: number) =>
    padding + innerH * (1 - (v - lo) / (hi - lo));

  const points: ChartPoint[] = timeline.map((p, i) => ({
    x: round(xOf(i)),
    y: round(yOf(p.balance)),
    balance: p.balance,
    date: p.date,
  }));

  let minIndex = 0;
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i].balance < timeline[minIndex].balance) minIndex = i;
  }

  const linePath = points
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x} ${pt.y}`)
    .join(" ");

  // Smoothed trend overlay: window scales with the horizon so daily and
  // biweekly-payday spikes flatten into a trajectory (clamped 5–31).
  const trendWindow = Math.min(31, Math.max(5, Math.round(n / 12)));
  const smoothed = movingAverage(
    timeline.map((p) => p.balance),
    trendWindow
  );
  const trendPath = smoothed
    .map((v, i) => `${i === 0 ? "M" : "L"} ${round(xOf(i))} ${round(yOf(v))}`)
    .join(" ");

  return {
    points,
    linePath,
    trendPath,
    floorY: round(yOf(minSafeBalance)),
    zeroY: round(yOf(0)),
    minIndex,
    width,
    height,
    padding,
  };
}
