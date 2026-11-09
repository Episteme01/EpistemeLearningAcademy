import type { AttStatus, AttTiming } from '@/types/models';

/** Minutes after the scheduled start that still count as "on time". Configurable in settings/attendance. */
export const DEFAULT_GRACE_MINUTES = 5;
/** Learners may check in this long before the start (matches the join-link window in firestore.rules). */
export const CHECKIN_OPENS_MIN = 15;

export interface RecordLike {
  status: AttStatus;
  timing?: AttTiming | '';
  checkInMs?: number | null;
  startMs: number;
}

/** early: before the start. on time: from the start until the grace period ends. late: after that. */
export function timingFrom(checkInMs: number, startMs: number, graceMin: number): AttTiming {
  if (checkInMs < startMs) return 'early';
  if (checkInMs <= startMs + graceMin * 60_000) return 'on_time';
  return 'late';
}

/** Minutes after the scheduled start (0 when early or within the grace period). */
export const minutesLate = (checkInMs: number, startMs: number, graceMin: number) =>
  timingFrom(checkInMs, startMs, graceMin) === 'late' ? Math.floor((checkInMs - startMs) / 60_000) : 0;
export const minutesEarly = (checkInMs: number, startMs: number) => Math.max(0, Math.ceil((startMs - checkInMs) / 60_000));

/** The timing that applies to a record, whether stored or still derived from the check-in time. */
export function effectiveTiming(r: RecordLike, graceMin: number): AttTiming | null {
  if (r.status === 'absent' || r.status === 'excused') return null;
  if (r.timing) return r.timing;
  if (r.checkInMs != null) return timingFrom(r.checkInMs, r.startMs, graceMin);
  return r.status === 'pending_verification' ? null : 'on_time';
}

export type Category = 'early' | 'on_time' | 'late' | 'left_early' | 'absent' | 'excused' | 'pending' | 'none';
export const CATEGORY_LABEL: Record<Category, string> = {
  early: 'Early', on_time: 'On time', late: 'Late', left_early: 'Left early', absent: 'Absent', excused: 'Excused', pending: 'Pending verification', none: 'No record',
};

export function categoryOf(r: RecordLike | null, graceMin: number): Category {
  if (!r) return 'none';
  if (r.status === 'pending_verification') return 'pending';
  if (r.status === 'absent') return 'absent';
  if (r.status === 'excused') return 'excused';
  if (r.status === 'left_early') return 'left_early';
  return effectiveTiming(r, graceMin) ?? 'on_time';
}

/** Human detail such as "Late by 12 min" or "5 min early". */
export function detailOf(r: RecordLike | null, graceMin: number): string {
  if (!r || r.checkInMs == null) return '';
  const t = timingFrom(r.checkInMs, r.startMs, graceMin);
  if (t === 'late') return `Late by ${minutesLate(r.checkInMs, r.startMs, graceMin)} min`;
  if (t === 'early') return `${minutesEarly(r.checkInMs, r.startMs)} min early`;
  return 'Checked in on time';
}

export interface Counts { expected: number; early: number; on_time: number; late: number; left_early: number; absent: number; excused: number; pending: number; none: number; attended: number; pct: number | null }
export const emptyCounts = (): Counts => ({ expected: 0, early: 0, on_time: 0, late: 0, left_early: 0, absent: 0, excused: 0, pending: 0, none: 0, attended: 0, pct: null });

/**
 * Attendance percentage = confirmed attendances / (sessions expected - excused).
 * Self check-ins still awaiting a teacher count as "pending", not as attended, so the figure never overstates.
 * Sessions with no record at all are shown separately ("no record") rather than silently treated as absent.
 */
export function tally(cats: Category[]): Counts {
  const c = emptyCounts();
  for (const k of cats) {
    c.expected += 1;
    if (k === 'early' || k === 'on_time' || k === 'late' || k === 'left_early') { c[k] += 1; c.attended += 1; }
    else c[k] += 1;
  }
  const denom = c.expected - c.excused;
  c.pct = denom > 0 ? Math.round((c.attended / denom) * 1000) / 10 : null;
  return c;
}
