// src/domain/dateUtils.ts
import type { ISODate } from "./types";

/**
* Convert a Date (UTC) to ISODate "YYYY-MM-DD".
*/
export function toISODate(date: Date): ISODate {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse an ISODate "YYYY-MM-DD" into a Date (UTC midnight).
 */
export function parseISODate(iso: ISODate): Date {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Add 'days' days to date (works in UTC).
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * First day of the month in UTC.
 */
export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Last day of the month in UTC.
 */
export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

/**
 * True if two Dates represent the same calendar day in UTC.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
