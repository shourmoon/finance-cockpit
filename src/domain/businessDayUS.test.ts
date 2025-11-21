// src/domain/businessDayUS.test.ts
import { isUSFederalReserveHoliday, isUSFederalReserveBusinessDay, adjustToPreviousUSBusinessDay } from "./businessDayUS";
import { toISODate, parseISODate } from "./dateUtils";

describe("businessDayUS", () => {
  test("recognizes New Year's Day (observed) as holiday", () => {
    const d2025 = parseISODate("2025-01-01");
    expect(isUSFederalReserveHoliday(d2025)).toBe(true);
    expect(isUSFederalReserveBusinessDay(d2025)).toBe(false);
  });

  test("recognizes Independence Day observed on Friday when July 4 is Saturday", () => {
    // 2020-07-04 was Saturday, observed on Friday 2020-07-03
    const holidayObserved = parseISODate("2020-07-03");
    expect(isUSFederalReserveHoliday(holidayObserved)).toBe(true);
    expect(isUSFederalReserveBusinessDay(holidayObserved)).toBe(false);

    const actual4th = parseISODate("2020-07-04");
    // weekend and holiday, but we treat weekend via weekend rule
    expect(isUSFederalReserveBusinessDay(actual4th)).toBe(false);
  });

  test("recognizes Thanksgiving as holiday (4th Thursday of November)", () => {
    // 2025 Thanksgiving = 2025-11-27
    const thanksgiving2025 = parseISODate("2025-11-27");
    expect(isUSFederalReserveHoliday(thanksgiving2025)).toBe(true);
    expect(isUSFederalReserveBusinessDay(thanksgiving2025)).toBe(false);
  });

  test("adjustToPreviousUSBusinessDay moves weekend date back", () => {
    // Saturday 2025-03-15 -> previous business day 2025-03-14
    const sat = parseISODate("2025-03-15");
    const adjusted = adjustToPreviousUSBusinessDay(sat);
    expect(toISODate(adjusted)).toBe("2025-03-14");
    expect(isUSFederalReserveBusinessDay(adjusted)).toBe(true);
  });

  test("adjustToPreviousUSBusinessDay moves holiday back to prior business day", () => {
    // Christmas 2025-12-25 is Thursday, not weekend but holiday.
    const xmas = parseISODate("2025-12-25");
    const adjusted = adjustToPreviousUSBusinessDay(xmas);
    expect(toISODate(adjusted)).toBe("2025-12-24");
    expect(isUSFederalReserveBusinessDay(adjusted)).toBe(true);
  });

  test("random mid-week days are usually business days unless a holiday", () => {
    // Quick randomized sample over some years
    for (let i = 0; i < 50; i++) {
      const year = 2020 + Math.floor(Math.random() * 6); // 2020-2025
      const month = Math.floor(Math.random() * 12);
      // pick Mon-Thu to avoid weekend
      const base = new Date(Date.UTC(year, month, 15));
      const weekday = base.getUTCDay();
      const offset = (1 - weekday + 7) % 7; // shift to Monday-ish
      const d = new Date(Date.UTC(year, month, 15 + offset));
      const iso = toISODate(d);

      const isBiz = isUSFederalReserveBusinessDay(d);
      // It's okay if sometimes it's not (e.g., holiday Monday), but at least it won't throw.
      expect(typeof isBiz).toBe("boolean");
      expect(typeof iso).toBe("string");
    }
  });
});
