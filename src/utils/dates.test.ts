// src/utils/dates.test.ts
import { formatDate } from "./dates";

// formatDate joins its parts with non-breaking spaces (U+00A0) so a
// formatted date never wraps mid-value in the UI. Normalize to plain
// spaces here so the assertions read naturally.
const norm = (s: string) => s.replace(/ /g, " ");

describe("formatDate", () => {
  test("formats an ISO date as DD MMM 'YY", () => {
    expect(norm(formatDate("2025-01-26"))).toBe("26 Jan '25");
    expect(norm(formatDate("2030-12-05"))).toBe("5 Dec '30");
  });

  test("returns empty string for falsy input", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
  });

  test("returns the input unchanged when it is not YYYY-MM-DD shaped", () => {
    expect(formatDate("garbage")).toBe("garbage");
    expect(formatDate("2025-01")).toBe("2025-01");
  });

  test("falls back to the raw month when the month is out of range", () => {
    expect(norm(formatDate("2025-99-01"))).toBe("1 99 '25");
  });
});
