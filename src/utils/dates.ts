/**
 * Utility functions for date formatting throughout the UI. All dates in
 * the application should be presented in the same human friendly format
 * (DD MMM 'YY) to ensure consistency. Example: `2025-01-26` becomes
 * `26 Jan '25`.
 */

/**
 * Format an ISO‐8601 date string (YYYY‑MM‑DD) into a short display
 * string like "26 Jan '25". If the input is falsy or cannot be parsed,
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
