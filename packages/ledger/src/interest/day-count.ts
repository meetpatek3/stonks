import type { DayCount } from "./types.js";

function parseUtcDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid date: ${date}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date: ${date}`);
  }
  return d;
}

function formatUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function dayCountDenominator(dayCount: DayCount, date: string): bigint {
  switch (dayCount) {
    case "ACT_365":
      return 365n;
    case "ACT_360":
      return 360n;
    case "ACT_ACT": {
      const year = parseUtcDate(date).getUTCFullYear();
      return isLeapYear(year) ? 366n : 365n;
    }
    default: {
      const _exhaustive: never = dayCount;
      throw new Error(`Unknown day count: ${_exhaustive}`);
    }
  }
}

export function calendarDaysBetween(startDate: string, endDate: string): number {
  const start = parseUtcDate(startDate).getTime();
  const end = parseUtcDate(endDate).getTime();
  if (end < start) {
    throw new Error(`endDate ${endDate} is before startDate ${startDate}`);
  }
  return Math.round((end - start) / 86_400_000);
}

export function addCalendarDays(date: string, days: number): string {
  const d = parseUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatUtcDate(d);
}

export function compareDates(a: string, b: string): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
