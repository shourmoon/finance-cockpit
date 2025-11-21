// src/domain/businessDayUS.ts
import { addDays } from "./dateUtils";

/**
 * Check if a date is Saturday or Sunday (UTC).
 */
function isWeekend(date: Date): boolean {
  const day = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

/**
 * Returns true if 'date' is an observed US Federal Reserve holiday.
 */
export function isUSFederalReserveHoliday(date: Date): boolean {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-based
  const day = date.getUTCDate();

  const sameDay = (d: Date) =>
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month &&
    d.getUTCDate() === day;

  function observedFixedDateHoliday(m: number, d: number): Date {
    const holiday = new Date(Date.UTC(year, m, d));
    const wd = holiday.getUTCDay();
    if (wd === 0) {
      // Sunday -> Monday
      return addDays(holiday, 1);
    }
    if (wd === 6) {
      // Saturday -> Friday
      return addDays(holiday, -1);
    }
    return holiday;
  }

  function nthWeekdayOfMonth(
    m: number,
    weekday: number, // 0..6
    n: number
  ): Date {
    const first = new Date(Date.UTC(year, m, 1));
    const firstDay = first.getUTCDay();
    const offset = (weekday - firstDay + 7) % 7;
    const dayOfMonth = 1 + offset + (n - 1) * 7;
    return new Date(Date.UTC(year, m, dayOfMonth));
  }

  function lastWeekdayOfMonth(m: number, weekday: number): Date {
    const last = new Date(Date.UTC(year, m + 1, 0));
    const lastDay = last.getUTCDate();
    const lastWDay = last.getUTCDay();
    const offset = (lastWDay - weekday + 7) % 7;
    const dayOfMonth = lastDay - offset;
    return new Date(Date.UTC(year, m, dayOfMonth));
  }

  // New Year's Day (Jan 1, observed)
  const newYearsObserved = observedFixedDateHoliday(0, 1);
  if (sameDay(newYearsObserved)) return true;

  // MLK Day (3rd Monday in January)
  const mlkDay = nthWeekdayOfMonth(0, 1, 3);
  if (sameDay(mlkDay)) return true;

  // Washington's Birthday (3rd Monday in February)
  const washBirthday = nthWeekdayOfMonth(1, 1, 3);
  if (sameDay(washBirthday)) return true;

  // Memorial Day (last Monday in May)
  const memorialDay = lastWeekdayOfMonth(4, 1);
  if (sameDay(memorialDay)) return true;

  // Juneteenth (June 19, observed)
  const juneteenthObserved = observedFixedDateHoliday(5, 19);
  if (sameDay(juneteenthObserved)) return true;

  // Independence Day (July 4, observed)
  const independenceObserved = observedFixedDateHoliday(6, 4);
  if (sameDay(independenceObserved)) return true;

  // Labor Day (1st Monday in September)
  const laborDay = nthWeekdayOfMonth(8, 1, 1);
  if (sameDay(laborDay)) return true;

  // Columbus Day (2nd Monday in October)
  const columbusDay = nthWeekdayOfMonth(9, 1, 2);
  if (sameDay(columbusDay)) return true;

  // Veterans Day (Nov 11, observed)
  const veteransObserved = observedFixedDateHoliday(10, 11);
  if (sameDay(veteransObserved)) return true;

  // Thanksgiving Day (4th Thursday in November)
  const thanksgiving = nthWeekdayOfMonth(10, 4, 4);
  if (sameDay(thanksgiving)) return true;

  // Christmas Day (Dec 25, observed)
  const christmasObserved = observedFixedDateHoliday(11, 25);
  if (sameDay(christmasObserved)) return true;

  return false;
}

/**
 * True if this is a US Federal Reserve business day.
 */
export function isUSFederalReserveBusinessDay(date: Date): boolean {
  if (isWeekend(date)) return false;
  if (isUSFederalReserveHoliday(date)) return false;
  return true;
}

/**
 * Move date backwards until it lands on a US Federal Reserve business day.
 */
export function adjustToPreviousUSBusinessDay(date: Date): Date {
  let d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  while (!isUSFederalReserveBusinessDay(d)) {
    d = addDays(d, -1);
  }
  return d;
}
