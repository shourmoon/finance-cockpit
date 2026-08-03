// src/utils/apportion.test.ts
//
// Breakdowns that do not add up destroy trust in every number beside them,
// and on a page about a mortgage decision that is not a cosmetic problem.
// Rounding each part on its own is the usual cause: it can undershoot the
// whole (0.6 + 0.6 rounds to 1 + 1 = 2 against a total of 1) or overshoot it
// (0.4 + 0.4 + 0.4 rounds to 0 + 0 + 0 against a total of 1).
//
// The property is simple and absolute — the parts sum to the rounded whole —
// so it is worth testing exhaustively rather than through one example.

import { describe, it, expect } from "vitest";
import { apportion } from "./apportion";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("apportion", () => {
  it("returns parts that sum to the rounded total", () => {
    const parts = [55.425, 98.431, 33.577, 54.275];
    const out = apportion(parts, sum(parts));
    expect(sum(out)).toBe(Math.round(sum(parts)));
    // 241.708 rounds to 242, so the two largest remainders (.577 and .431)
    // each take a unit.
    expect(out).toEqual([55, 99, 34, 54]);
  });

  it("handles parts that would each round up", () => {
    // Rounding independently gives 1+1+1 = 3 against a total of 2.
    const parts = [0.6, 0.6, 0.6];
    const out = apportion(parts, sum(parts));
    expect(sum(out)).toBe(2);
  });

  it("handles parts that would each round down", () => {
    // Rounding independently gives 0+0+0 = 0 against a total of 1.
    const parts = [0.4, 0.4, 0.4];
    const out = apportion(parts, sum(parts));
    expect(sum(out)).toBe(1);
  });

  it("gives the leftover units to the parts that lost the most", () => {
    // 1.9 lost .9 and 1.1 lost .1, so the spare unit belongs to the former.
    expect(apportion([1.9, 1.1], 3)).toEqual([2, 1]);
    expect(apportion([1.1, 1.9], 3)).toEqual([1, 2]);
  });

  it("never returns a negative part", () => {
    expect(apportion([-5, 10], 5)).toEqual([0, 5]);
  });

  it("treats unusable parts as zero", () => {
    expect(apportion([Number.NaN, 4], 4)).toEqual([0, 4]);
    expect(apportion([Number.POSITIVE_INFINITY, 4], 4)).toEqual([0, 4]);
  });

  it("survives an unusable total", () => {
    expect(sum(apportion([1.5, 1.5], Number.NaN))).toBe(0);
    expect(sum(apportion([1.5, 1.5], -10))).toBe(0);
  });

  it("copes with an empty list", () => {
    expect(apportion([], 0)).toEqual([]);
    expect(apportion([], 5)).toEqual([]);
  });

  it("is exact for whole numbers already", () => {
    expect(apportion([3, 4, 5], 12)).toEqual([3, 4, 5]);
  });

  it("holds the property across a spread of random inputs", () => {
    // Deterministic pseudo-random so a failure is reproducible.
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 500; trial++) {
      const n = 1 + Math.floor(rnd() * 6);
      const parts = Array.from({ length: n }, () => rnd() * 200);
      const total = sum(parts);
      const out = apportion(parts, total);
      expect(sum(out)).toBe(Math.round(total));
      // Every part stays within a unit of its exact value, so no leg is
      // silently inflated to make the books balance.
      out.forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(Math.floor(parts[i]));
        expect(v).toBeLessThanOrEqual(Math.ceil(parts[i]));
      });
    }
  });

  it("still balances when the total is not the sum of the parts", () => {
    // The caller passes an independently-computed total; the contract is to
    // match THAT, since it is the figure shown as the whole.
    expect(sum(apportion([1.2, 1.2], 10))).toBe(10);
  });
});
