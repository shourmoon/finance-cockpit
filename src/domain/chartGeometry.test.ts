// src/domain/chartGeometry.test.ts
import { describe, it, expect } from "vitest";
import { buildBalanceChartGeometry } from "./chartGeometry";
import type { TimelinePoint } from "./types";

function tp(date: string, balance: number): TimelinePoint {
  return { date, balance, inflow: 0, outflow: 0 };
}

describe("buildBalanceChartGeometry", () => {
  it("returns null for an empty timeline", () => {
    expect(buildBalanceChartGeometry([], 0)).toBeNull();
  });

  it("places a single point at the horizontal center", () => {
    const geo = buildBalanceChartGeometry([tp("2025-01-01", 100)], 0, 320, 140, 8)!;
    expect(geo.points).toHaveLength(1);
    expect(geo.points[0].x).toBe(160); // padding + innerW/2
    expect(geo.linePath.startsWith("M ")).toBe(true);
  });

  it("keeps zero and floor lines on-canvas for an all-positive series", () => {
    const geo = buildBalanceChartGeometry(
      [tp("2025-01-01", 500), tp("2025-01-02", 800)],
      100,
      320,
      140,
      8
    )!;
    for (const v of [geo.zeroY, geo.floorY, ...geo.points.map((p) => p.y)]) {
      expect(v).toBeGreaterThanOrEqual(8);
      expect(v).toBeLessThanOrEqual(132);
    }
    // Zero is the axis minimum here, so it sits at the bottom edge.
    expect(geo.zeroY).toBe(132);
  });

  it("puts higher balances higher on the canvas (smaller y)", () => {
    const geo = buildBalanceChartGeometry(
      [tp("2025-01-01", 0), tp("2025-01-02", 1000)],
      0
    )!;
    expect(geo.points[1].y).toBeLessThan(geo.points[0].y);
  });

  it("identifies the deepest point via minIndex", () => {
    const geo = buildBalanceChartGeometry(
      [tp("2025-01-01", 300), tp("2025-01-02", -50), tp("2025-01-03", 200)],
      0
    )!;
    expect(geo.minIndex).toBe(1);
    expect(geo.points[geo.minIndex].balance).toBe(-50);
  });

  it("handles a flat series without dividing by zero", () => {
    const geo = buildBalanceChartGeometry(
      [tp("2025-01-01", 0), tp("2025-01-02", 0)],
      0
    )!;
    for (const p of geo.points) expect(Number.isFinite(p.y)).toBe(true);
    expect(Number.isFinite(geo.zeroY)).toBe(true);
    expect(Number.isFinite(geo.floorY)).toBe(true);
  });

  it("places the zero line above the bottom when balances go negative", () => {
    const geo = buildBalanceChartGeometry(
      [tp("2025-01-01", 100), tp("2025-01-02", -100)],
      0,
      320,
      140,
      8
    )!;
    // Symmetric range [-100, 100] => zero at vertical center.
    expect(geo.zeroY).toBeGreaterThan(8);
    expect(geo.zeroY).toBeLessThan(132);
  });
});
