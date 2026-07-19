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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True if the string is a well-formed "YYYY-MM-DD" date that denotes a
 * real calendar day (rejects e.g. "2025-13-99" and "2025-02-30").
 */
export function isValidISODate(iso: unknown): iso is ISODate {
  if (typeof iso !== "string" || !ISO_DATE_RE.test(iso)) return false;
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  // Round-trip: Date.UTC silently rolls over out-of-range parts.
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/**
 * Parse an ISODate "YYYY-MM-DD" into a Date (UTC midnight).
 * Throws on malformed input instead of returning an Invalid Date;
 * callers holding possibly-invalid strings should check with
 * isValidISODate() first.
 */
export function parseISODate(iso: ISODate): Date {
  if (!isValidISODate(iso)) {
    throw new Error(`Invalid ISO date: "${iso}"`);
  }
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
