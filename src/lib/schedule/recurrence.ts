export type Freq = 'none' | 'daily' | 'weekly' | 'monthly';
export type RecurrenceEnd = { type: 'count'; count: number } | { type: 'date'; until: string };
export interface Recurrence {
  freq: Freq;
  /** every N days / weeks / months (custom recurrence) */
  interval: number;
  /** weekly only: 0 = Sunday … 6 = Saturday. Empty = weekday of the start date. */
  weekdays: number[];
  end: RecurrenceEnd;
}

/** One series can create at most this many sessions (keeps writes in one batch). */
export const MAX_OCCURRENCES = 150;

const toUtc = (s: string) => { const [y, m, d] = s.split('-').map(Number) as [number, number, number]; return Date.UTC(y, m - 1, d); };
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => fmt(toUtc(s) + n * 86_400_000);
export const weekdayOf = (s: string) => new Date(toUtc(s)).getUTCDay();
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const defaultRecurrence = (): Recurrence => ({ freq: 'none', interval: 1, weekdays: [], end: { type: 'count', count: 10 } });

/** Local calendar dates (YYYY-MM-DD) of every occurrence, in order. Pure and timezone-free. */
export function generateDates(startDate: string, r: Recurrence): string[] {
  if (r.freq === 'none') return [startDate];
  const interval = Math.max(1, Math.floor(r.interval || 1));
  const limit = r.end.type === 'count' ? Math.min(Math.max(1, Math.floor(r.end.count)), MAX_OCCURRENCES) : MAX_OCCURRENCES;
  const until = r.end.type === 'date' ? r.end.until : null;
  const out: string[] = [];
  const push = (d: string) => { if (d < startDate) return false; if (until && d > until) return null; out.push(d); return true; };
  let guard = 0;

  if (r.freq === 'daily') {
    for (let d = startDate; out.length < limit && guard++ < 5000; d = addDays(d, interval)) if (push(d) === null) break;
  } else if (r.freq === 'weekly') {
    const days = (r.weekdays.length ? [...new Set(r.weekdays)] : [weekdayOf(startDate)]).sort((a, b) => a - b);
    // Weeks start on Monday (Nigerian school week). Offsets 0..6 = Mon..Sun.
    const monOffset = (wd: number) => (wd + 6) % 7;
    const startMonday = addDays(startDate, -monOffset(weekdayOf(startDate)));
    const ordered = [...days].sort((a, b) => monOffset(a) - monOffset(b));
    outer: for (let w = 0; guard++ < 2000; w += interval) {
      for (const wd of ordered) {
        const d = addDays(startMonday, w * 7 + monOffset(wd));
        const res = push(d);
        if (res === null) break outer;
        if (res && out.length >= limit) break outer;
      }
    }
  } else {
    const [y0, m0, day0] = startDate.split('-').map(Number) as [number, number, number];
    for (let k = 0; out.length < limit && guard++ < 1200; k += interval) {
      const total = m0 - 1 + k; const y = y0 + Math.floor(total / 12); const m = (total % 12) + 1;
      const d = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day0, daysInMonth(y, m))).padStart(2, '0')}`;
      if (push(d) === null) break;
    }
  }
  return out.slice(0, limit);
}
