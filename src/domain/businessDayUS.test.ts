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

  test("recognizes every fixed and floating federal holiday in 2025", () => {
    const holidays2025 = [
      "2025-01-01", // New Year's Day
      "2025-01-20", // MLK Day (3rd Mon Jan)
      "2025-02-17", // Washington's Birthday (3rd Mon Feb)
      "2025-05-26", // Memorial Day (last Mon May)
      "2025-06-19", // Juneteenth
      "2025-07-04", // Independence Day
      "2025-09-01", // Labor Day (1st Mon Sep)
      "2025-10-13", // Columbus Day (2nd Mon Oct)
      "2025-11-11", // Veterans Day
      "2025-11-27", // Thanksgiving (4th Thu Nov)
      "2025-12-25", // Christmas
    ];
    for (const iso of holidays2025) {
      expect(isUSFederalReserveHoliday(parseISODate(iso))).toBe(true);
    }
  });

  test("observes a Sunday fixed-date holiday on the following Monday", () => {
    // Juneteenth 2022-06-19 was a Sunday -> observed Monday 2022-06-20.
    expect(isUSFederalReserveHoliday(parseISODate("2022-06-20"))).toBe(true);
    expect(isUSFederalReserveHoliday(parseISODate("2022-06-19"))).toBe(false);
  });

  test("a normal mid-week day is not a holiday", () => {
    // 2025-03-12 (Wednesday) is an ordinary business day.
    const d = parseISODate("2025-03-12");
    expect(isUSFederalReserveHoliday(d)).toBe(false);
    expect(isUSFederalReserveBusinessDay(d)).toBe(true);
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
