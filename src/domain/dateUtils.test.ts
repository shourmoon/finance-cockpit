// src/domain/dateUtils.test.ts
import { addDays, toISODate, parseISODate, isValidISODate, startOfMonth, endOfMonth, isSameDay } from "./dateUtils";
import type { ISODate } from "./types";

describe("dateUtils", () => {
  test("toISODate formats UTC date correctly", () => {
    const d = new Date(Date.UTC(2025, 0, 5)); // Jan 5, 2025
    const iso = toISODate(d);
    expect(iso).toBe("2025-01-05");
  });

  test("parseISODate parses YYYY-MM-DD as UTC midnight", () => {
    const iso: ISODate = "2030-12-25";
    const d = parseISODate(iso);
    expect(d.getUTCFullYear()).toBe(2030);
    expect(d.getUTCMonth()).toBe(11); // zero-based
    expect(d.getUTCDate()).toBe(25);
    expect(d.getUTCHours()).toBe(0);
  });

  test("addDays moves date forward correctly", () => {
    const d = new Date(Date.UTC(2025, 0, 31)); // Jan 31
    const next = addDays(d, 1);
    expect(toISODate(next)).toBe("2025-02-01");
  });

  test("startOfMonth and endOfMonth are correct for typical month", () => {
    const d = new Date(Date.UTC(2025, 6, 15)); // July 15
    const start = startOfMonth(d);
    const end = endOfMonth(d);
    expect(toISODate(start)).toBe("2025-07-01");
    expect(toISODate(end)).toBe("2025-07-31");
  });

  test("endOfMonth handles February and leap years", () => {
    const d1 = new Date(Date.UTC(2024, 1, 10)); // Feb 2024 (leap)
    const d2 = new Date(Date.UTC(2025, 1, 10)); // Feb 2025 (non-leap)
    expect(toISODate(endOfMonth(d1))).toBe("2024-02-29");
    expect(toISODate(endOfMonth(d2))).toBe("2025-02-28");
  });

  test("isSameDay compares only calendar day in UTC", () => {
    const a = new Date(Date.UTC(2025, 3, 10, 0, 0, 0));
    const b = new Date(Date.UTC(2025, 3, 10, 23, 59, 59));
    const c = new Date(Date.UTC(2025, 3, 11, 0, 0, 0));

    expect(isSameDay(a, b)).toBe(true);
    expect(isSameDay(a, c)).toBe(false);
  });

  test("isValidISODate accepts real dates and rejects malformed ones", () => {
    expect(isValidISODate("2025-01-31")).toBe(true);
    expect(isValidISODate("2024-02-29")).toBe(true); // leap day

    expect(isValidISODate("")).toBe(false);
    expect(isValidISODate("garbage")).toBe(false);
    expect(isValidISODate("2025-13-99")).toBe(false);
    expect(isValidISODate("2025-02-30")).toBe(false); // no Feb 30
    expect(isValidISODate("2025-1-5")).toBe(false); // must be zero-padded
    expect(isValidISODate("2025-01-05T00:00:00Z")).toBe(false);
    expect(isValidISODate(null)).toBe(false);
    expect(isValidISODate(20250105)).toBe(false);
  });

  test("parseISODate throws a clear error on malformed input", () => {
    expect(() => parseISODate("")).toThrow("Invalid ISO date");
    expect(() => parseISODate("garbage")).toThrow("Invalid ISO date");
    expect(() => parseISODate("2025-13-99")).toThrow("Invalid ISO date");
  });

  test("parseISODate(toISODate(d)) round-trips day component (randomized)", () => {
    for (let i = 0; i < 50; i++) {
      const year = 2000 + Math.floor(Math.random() * 40); // 2000-2039
      const month = Math.floor(Math.random() * 12); // 0-11
      const day = 1 + Math.floor(Math.random() * 28); // keep safe within month
      const d = new Date(Date.UTC(year, month, day));
      const iso = toISODate(d);
      const back = parseISODate(iso);
      expect(isSameDay(d, back)).toBe(true);
    }
  });
});
