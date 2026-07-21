// src/utils/dates.test.ts
import { formatDate, monthYearLabel, monthKey } from "./dates";

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

describe("monthYearLabel", () => {
  test("formats month and two-digit year", () => {
    expect(monthYearLabel("2026-08-15")).toBe("Aug '26");
    expect(monthYearLabel("2026-12-01")).toBe("Dec '26");
  });

  test("returns empty for falsy and passes through unparseable input", () => {
    expect(monthYearLabel("")).toBe("");
    expect(monthYearLabel(null)).toBe("");
    expect(monthYearLabel("nope")).toBe("nope");
  });

  test("falls back to the raw month when out of range", () => {
    expect(monthYearLabel("2026-13-01")).toBe("13 '26");
  });
});

describe("monthKey", () => {
  test("returns the YYYY-MM prefix", () => {
    expect(monthKey("2026-08-15")).toBe("2026-08");
    expect(monthKey("2027-01-02")).toBe("2027-01");
  });
});
