import { categoryOf, tally, type Category, type Counts } from './attendance';
import type { AttStatus, AttTiming } from '@/types/models';

export interface RSession { id: string; title: string; startMs: number; endMs: number; localDate: string; status: string; teacherUid: string; teacherName: string; classId?: string; className?: string; courseId?: string; courseName?: string; studentUids: string[] }
export interface RRecord { sessionId: string; studentUid: string; studentName: string; status: AttStatus; timing?: AttTiming | ''; checkInMs?: number | null; verifiedByName?: string; note?: string }
export interface Row { sessionId: string; session: RSession; studentUid: string; studentName: string; category: Category; record: RRecord | null }
export interface Filters { from?: string; to?: string; classId?: string; courseId?: string; teacherUid?: string; studentUid?: string }

/**
 * One row per (past, non-cancelled session) x (invited learner). Future sessions are not counted against anyone.
 * `onlyStudents` limits the rows to specific learners (a learner's own view, or a parent's children).
 */
export function buildRows(sessions: RSession[], records: RRecord[], grace: number, nowMs: number, f: Filters, names: Record<string, string> = {}, onlyStudents?: string[]): Row[] {
  const rec = new Map(records.map((r) => [`${r.sessionId}_${r.studentUid}`, r]));
  const rows: Row[] = [];
  for (const s of sessions) {
    if (s.status === 'cancelled' || s.startMs > nowMs) continue;
    if (f.from && s.localDate < f.from) continue;
    if (f.to && s.localDate > f.to) continue;
    if (f.classId && s.classId !== f.classId) continue;
    if (f.courseId && s.courseId !== f.courseId) continue;
    if (f.teacherUid && s.teacherUid !== f.teacherUid) continue;
    for (const u of s.studentUids) {
      if (f.studentUid && u !== f.studentUid) continue;
      if (onlyStudents && !onlyStudents.includes(u)) continue;
      const r = rec.get(`${s.id}_${u}`) ?? null;
      rows.push({ sessionId: s.id, session: s, studentUid: u, studentName: r?.studentName || names[u] || 'Learner', record: r, category: categoryOf(r ? { status: r.status, timing: r.timing, checkInMs: r.checkInMs ?? null, startMs: s.startMs } : null, grace) });
    }
  }
  return rows.sort((a, b) => b.session.startMs - a.session.startMs);
}

export type GroupBy = 'student' | 'class' | 'course' | 'teacher' | 'session';
const keyOf = (r: Row, g: GroupBy): [string, string] => {
  switch (g) {
    case 'student': return [r.studentUid, r.studentName];
    case 'class': return [r.session.classId || '-', r.session.className || 'No class'];
    case 'course': return [r.session.courseId || '-', r.session.courseName || 'No course'];
    case 'teacher': return [r.session.teacherUid, r.session.teacherName || 'Teacher'];
    default: return [r.sessionId, `${r.session.localDate} ${r.session.title}`];
  }
};
export interface Group { key: string; label: string; counts: Counts }
export function groupRows(rows: Row[], g: GroupBy): Group[] {
  const m = new Map<string, { label: string; cats: Category[] }>();
  for (const r of rows) { const [k, label] = keyOf(r, g); const e = m.get(k) ?? { label, cats: [] }; e.cats.push(r.category); m.set(k, e); }
  return [...m].map(([key, v]) => ({ key, label: v.label, counts: tally(v.cats) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** `YYYY-MM-01` strings for every month between two ISO dates (max `cap`), for month-bucket queries. */
export function monthsBetween(from: string, to: string, cap = 12): string[] {
  const out: string[] = []; let [y, m] = from.split('-').map(Number) as [number, number]; const [ty, tm] = to.split('-').map(Number) as [number, number];
  while ((y < ty || (y === ty && m <= tm)) && out.length < cap) { out.push(`${y}-${String(m).padStart(2, '0')}-01`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
}
