import { addDays, weekdayOf } from './recurrence';

/** Monday of the week containing `date`. */
export const startOfWeek = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7));
export const weekDates = (date: string) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i));

/** 6 weeks (42 days) covering the month of `date`, Monday-first. */
export function monthGrid(date: string): string[] {
  const first = `${date.slice(0, 7)}-01`;
  const s = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(s, i));
}

export function shiftMonth(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
}

export const monthKeysFor = (dates: string[]) => [...new Set(dates.map((d) => d.slice(0, 7)))];
