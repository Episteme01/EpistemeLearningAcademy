/** Time-zone helpers. All instants are stored as UTC timestamps; wall-clock times are converted here. */
export const DEFAULT_TZ = 'Africa/Lagos';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(tz: string, ms: number) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset (minutes east of UTC) of `tz` at the instant `utcMs`. */
export function offsetMinutes(tz: string, utcMs: number): number {
  const p = parts(tz, utcMs);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Wall-clock date + time in `tz` -> UTC Date. */
export function zonedToUtc(date: string, time: string, tz: string = DEFAULT_TZ): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = offsetMinutes(tz, guess);
  let utc = guess - off1 * 60000;
  const off2 = offsetMinutes(tz, utc);
  if (off2 !== off1) utc = guess - off2 * 60000;
  return new Date(utc);
}

/** UTC instant -> wall-clock parts in `tz`. */
export function utcToZoned(d: Date, tz: string = DEFAULT_TZ): { date: string; time: string; weekday: number } {
  const p = parts(tz, d.getTime());
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return { date, time: `${pad(p.hour)}:${pad(p.minute)}`, weekday: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}

export const monthKeyOf = (date: string) => date.slice(0, 7);

/** Minutes between two HH:mm strings (end after start required). */
export function minutesBetween(start: string, end: string): number {
  const [a, b] = [start, end].map((t) => { const [h, m] = t.split(':').map(Number) as [number, number]; return h * 60 + m; }) as [number, number];
  return b - a;
}

/** "13:05" -> "1:05 PM" */
export function format12(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
export const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ; } catch { return DEFAULT_TZ; } };
