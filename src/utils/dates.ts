/**
 * Utility functions for date formatting throughout the UI. All dates in
 * the application should be presented in the same human friendly format
 * (DD MMM 'YY) to ensure consistency. Example: `2025-01-26` becomes
 * `26 Jan '25`.
 */

/**
 * Format an ISO‐8601 date string (YYYY‑MM‑DD) into a short display
 * string like "26 Jan '25". If the input is falsy or cannot be parsed,
 * the original value is returned unchanged.
 *
 * @param isoDate An ISO date string (YYYY‑MM‑DD) or undefined.
 * @returns The formatted date string.
 */
export function formatDate(isoDate: string | undefined | null): string {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  // Convert numeric month into short month name
  const monthIndex = parseInt(month, 10) - 1;
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const monthName = monthNames[monthIndex] ?? month;
  const shortYear = year.slice(2);
  return `${parseInt(day, 10)} ${monthName} '${shortYear}`;
}

/**
 * Month-and-year label for grouping, like "Aug '25". Returns the input
 * unchanged if it is not a parseable YYYY-MM-DD string.
 *
 * @param isoDate An ISO date string (YYYY-MM-DD) or undefined.
 */
export function monthYearLabel(isoDate: string | undefined | null): string {
  if (!isoDate) return "";
  const [year, month] = isoDate.split("-");
  if (!year || !month) return isoDate;
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const monthName = monthNames[parseInt(month, 10) - 1] ?? month;
  return `${monthName} '${year.slice(2)}`;
}

/** The "YYYY-MM" key used to detect month boundaries in a sorted list. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}
