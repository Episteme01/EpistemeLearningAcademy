import { generateDates, type Recurrence } from './recurrence';
import { zonedToUtc, DEFAULT_TZ } from './tz';

export interface ExistingSlot { id: string; teacherUid: string; classId?: string; startMs: number; endMs: number; status: string; title?: string; localDate?: string }
export interface Candidate { title: string; teacherUid: string; classId?: string; subjectId?: string; courseId?: string; startDate: string; startTime: string; endTime: string; recurrence: Recurrence; tz?: string }
export interface ScheduleContext {
  existing: ExistingSlot[]; excludeIds?: string[];
  classSubjectIds?: string[] | null;                       // subjects the class offers (empty/undefined = not restricted)
  courseInstructorUid?: string | null;
  assignments?: Array<{ staffUid: string; classId: string; subjectId: string }>;
  /** override occurrence dates (editing a single session) */
  dates?: string[];
}
export interface Issue { level: 'error' | 'warning'; code: string; message: string }
const some = (a: string[]) => (a.length > 3 ? `${a.slice(0, 3).join(', ')} and ${a.length - 3} more` : a.join(', '));

export function validateSchedule(c: Candidate, ctx: ScheduleContext): Issue[] {
  const out: Issue[] = [];
  const tz = c.tz ?? DEFAULT_TZ;
  if (!c.teacherUid) out.push({ level: 'error', code: 'no_teacher', message: 'Choose the teacher.' });
  if (!/^\d{2}:\d{2}$/.test(c.startTime) || !/^\d{2}:\d{2}$/.test(c.endTime)) out.push({ level: 'error', code: 'bad_time', message: 'Enter valid start and end times.' });
  else if (c.endTime <= c.startTime) out.push({ level: 'error', code: 'bad_time', message: 'End time must be after the start time.' });
  if (out.some((i) => i.code === 'bad_time')) return out;
  const [sh, sm] = c.startTime.split(':').map(Number), [eh, em] = c.endTime.split(':').map(Number);
  if ((eh * 60 + em) - (sh * 60 + sm) > 360) out.push({ level: 'warning', code: 'long', message: 'This class is longer than 6 hours.' });
  const dates = ctx.dates ?? generateDates(c.startDate, c.recurrence);
  if (!dates.length) { out.push({ level: 'error', code: 'no_dates', message: 'This repeat pattern produces no classes. Check the end date.' }); return out; }
  if (new Set(dates).size !== dates.length) out.push({ level: 'error', code: 'dup_dates', message: 'The repeat pattern lists the same day twice.' });

  const skip = new Set(ctx.excludeIds ?? []);
  const live = ctx.existing.filter((e) => !skip.has(e.id) && e.status !== 'cancelled');
  const tClash: string[] = [], cClash: string[] = [], dup: string[] = [];
  for (const d of dates) {
    const s = zonedToUtc(d, c.startTime, tz).getTime(), e = zonedToUtc(d, c.endTime, tz).getTime();
    for (const x of live) {
      if (!(s < x.endMs && x.startMs < e)) continue;
      const same = x.startMs === s && x.endMs === e;
      if (c.teacherUid && x.teacherUid === c.teacherUid) { (same && c.classId && x.classId === c.classId ? dup : tClash).push(`${d}${x.title ? ` (${x.title})` : ''}`); }
      else if (c.classId && x.classId === c.classId) cClash.push(`${d}${x.title ? ` (${x.title})` : ''}`);
    }
  }
  if (dup.length) out.push({ level: 'error', code: 'duplicate', message: `Already scheduled with the same teacher, class and time: ${some(dup)}.` });
  if (tClash.length) out.push({ level: 'error', code: 'teacher_conflict', message: `The teacher already has a class at that time: ${some(tClash)}.` });
  if (cClash.length) out.push({ level: 'error', code: 'class_conflict', message: `The class already has another lesson at that time: ${some(cClash)}.` });

  if (c.classId && c.subjectId && ctx.classSubjectIds && ctx.classSubjectIds.length && !ctx.classSubjectIds.includes(c.subjectId))
    out.push({ level: 'error', code: 'class_subject', message: 'This class does not offer the chosen subject. Add it under the class settings or choose another subject.' });
  if (c.courseId && ctx.courseInstructorUid && c.teacherUid && ctx.courseInstructorUid !== c.teacherUid)
    out.push({ level: 'warning', code: 'course_instructor', message: 'The chosen teacher is not the instructor recorded on this course.' });
  const mine = (ctx.assignments ?? []).filter((a) => a.staffUid === c.teacherUid);
  if (c.classId && c.subjectId && mine.length && !mine.some((a) => a.classId === c.classId && a.subjectId === c.subjectId))
    out.push({ level: 'warning', code: 'not_assigned', message: 'This teacher is not assigned to teach this subject in this class (Teacher assignments).' });
  return out;
}
export const hasErrors = (i: Issue[]) => i.some((x) => x.level === 'error');

/** The live preview stays quiet about fields the person has not filled in yet; the save button still runs the full check. */
export const previewIssues = (i: Issue[]): Issue[] => i.filter((x) => x.code !== 'no_teacher');

export interface TargetRow { id: string; status: string; overridden?: boolean; startMs: number; localDate: string; seriesIndex: number }
/**
 * Which sessions an edit touches: the session itself, plus (for "this and later" / "whole series") upcoming scheduled
 * siblings that were not individually edited. Shared by the live preview and the save check so they always agree.
 */
export function scopeTargets(siblings: TargetRow[], current: { id: string; seriesIndex: number }, scope: 'one' | 'future' | 'all', nowMs: number): { dates: string[]; exclude: string[] } {
  const hit = siblings.filter((r) => r.id === current.id || (scope !== 'one' && r.status === 'scheduled' && !r.overridden && r.startMs > nowMs && (scope === 'all' || r.seriesIndex >= current.seriesIndex)));
  return { dates: hit.map((r) => r.localDate), exclude: hit.map((r) => r.id) };
}
