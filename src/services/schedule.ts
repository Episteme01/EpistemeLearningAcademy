import { addDoc, collection, doc, getDoc, serverTimestamp, where } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { C } from '@/config/collections';
import { generateDates, type Recurrence } from '@/lib/schedule/recurrence';
import { monthKeyOf, utcToZoned, zonedToUtc } from '@/lib/schedule/tz';
import { batchSet, listDocs } from './db';
import { audit } from './audit';
import { notifyUsers } from './notifications';
import type { Session, SessionAccessLog, SessionLink, SessionStatus, TimetableSeries, WithId } from '@/types/models';
import { toDate } from '@/lib/utils';

export interface LinkInput { provider: string; meetingUrl: string; meetingId?: string; passcode?: string }

export interface SeriesInput {
  title: string; description?: string;
  courseId?: string; courseName?: string; subjectId?: string; subjectName?: string; classId?: string; className?: string;
  teacherUid: string; teacherName: string;
  location?: string; link?: LinkInput | null;
  startDate: string; startTime: string; endTime: string; timezone: string;
  recurrence: Recurrence;
  studentIds: string[]; excludedStudentIds: string[]; studentUids: string[]; parentUids: string[];
  notify: boolean;
}
export interface Actor { uid: string; name: string }

const uniq = (a: (string | undefined)[]) => [...new Set(a.filter((x): x is string => !!x))];
export const viewersOf = (teacherUid: string, studentUids: string[], parentUids: string[]) => uniq([teacherUid, ...studentUids, ...parentUids]);

const validLink = (l?: LinkInput | null) => {
  if (!l || !l.meetingUrl.trim()) return null;
  if (!/^https:\/\//i.test(l.meetingUrl.trim())) throw new Error('The meeting link must start with https://');
  return { provider: l.provider || 'other', meetingUrl: l.meetingUrl.trim(), meetingId: l.meetingId?.trim() ?? '', passcode: l.passcode?.trim() ?? '' };
};

function sessionDoc(seriesId: string, i: number, date: string, s: SeriesInput, by: Actor, online: boolean) {
  const startAt = zonedToUtc(date, s.startTime, s.timezone); const endAt = zonedToUtc(date, s.endTime, s.timezone);
  return {
    seriesId, seriesIndex: i, title: s.title, description: s.description ?? '',
    courseId: s.courseId ?? '', courseName: s.courseName ?? '', subjectId: s.subjectId ?? '', subjectName: s.subjectName ?? '', classId: s.classId ?? '', className: s.className ?? '',
    teacherUid: s.teacherUid, teacherName: s.teacherName, location: s.location ?? '', online, provider: s.link?.provider ?? '',
    startAt, endAt, localDate: date, monthKey: monthKeyOf(date), timezone: s.timezone,
    status: 'scheduled' as SessionStatus, overridden: false,
    studentUids: s.studentUids, parentUids: s.parentUids, viewers: viewersOf(s.teacherUid, s.studentUids, s.parentUids),
    createdBy: by.uid, createdByName: by.name, createdAt: serverTimestamp(),
  };
}

/** Creates the series and one Session per occurrence (each with its own status/attendance later). */
export async function createSeries(input: SeriesInput, by: Actor): Promise<{ seriesId: string; count: number }> {
  if (!input.title.trim()) throw new Error('Title is required.');
  if (input.endTime <= input.startTime) throw new Error('End time must be after start time.');
  const dates = generateDates(input.startDate, input.recurrence);
  if (!dates.length) throw new Error('This recurrence produces no sessions. Check the end date.');
  const link = validLink(input.link);
  const seriesRef = doc(collection(db(), C.timetableSeries));
  const seriesId = seriesRef.id;
  const viewers = viewersOf(input.teacherUid, input.studentUids, input.parentUids);
  const series: Omit<TimetableSeries, 'createdAt' | 'updatedAt'> & { createdAt: unknown } = {
    title: input.title, description: input.description ?? '', courseId: input.courseId ?? '', courseName: input.courseName ?? '', subjectId: input.subjectId ?? '', subjectName: input.subjectName ?? '',
    classId: input.classId ?? '', className: input.className ?? '', teacherUid: input.teacherUid, teacherName: input.teacherName, location: input.location ?? '', online: !!link, provider: link?.provider ?? '',
    startDate: input.startDate, startTime: input.startTime, endTime: input.endTime, timezone: input.timezone, recurrence: input.recurrence,
    studentUids: input.studentUids, studentIds: input.studentIds, excludedStudentIds: input.excludedStudentIds, parentUids: input.parentUids, viewers,
    status: 'active', createdBy: by.uid, createdByName: by.name, createdAt: serverTimestamp(),
  };
  // Order matters: each session is followed by its link, and chunks of 400 never split a pair.
  const ops: { col: string; id: string; data: object; merge: boolean }[] = [{ col: C.timetableSeries, id: seriesId, data: series, merge: false }];
  dates.forEach((d, i) => {
    const id = `${seriesId}_${i}`;
    ops.push({ col: C.sessions, id, data: sessionDoc(seriesId, i, d, { ...input, link }, by, !!link), merge: false });
    if (link) ops.push({ col: C.sessionLinks, id, data: { ...link, updatedBy: by.uid }, merge: false });
  });
  await batchSet(ops.slice(0, 1)); // series first (its own chunk)
  await batchSet(ops.slice(1));
  void audit('timetable.create', `timetableSeries/${seriesId}`, `${input.title}: ${dates.length} session(s) from ${dates[0]}`);
  if (input.notify) {
    void notifyUsers(viewers.filter((u) => u !== by.uid), { title: `New class: ${input.title}`, body: `${dates.length > 1 ? `${dates.length} sessions starting` : 'Scheduled for'} ${dates[0]} at ${input.startTime}.`, link: '/app/schedule' });
  }
  return { seriesId, count: dates.length };
}

export type Scope = 'one' | 'future' | 'all';

/** Which occurrences a scope touches. Past and cancelled sessions are history and are never changed in bulk. */
async function select(base: WithId<Session>, scope: Scope, canSeeAll: boolean, myUid: string): Promise<WithId<Session>[]> {
  if (scope === 'one') return [base];
  const rows = await listDocs<Session>(C.sessions, [where('seriesId', '==', base.seriesId), ...(canSeeAll ? [] : [where('viewers', 'array-contains', myUid)])]);
  const now = Date.now();
  return rows
    .filter((r) => r.id === base.id || (r.status === 'scheduled' && !r.overridden && (toDate(r.startAt)?.getTime() ?? 0) > now))
    .filter((r) => scope === 'all' || r.seriesIndex >= base.seriesIndex)
    .sort((a, b) => a.seriesIndex - b.seriesIndex);
}

export interface EditChanges {
  title: string; description?: string; courseId?: string; courseName?: string; subjectId?: string; subjectName?: string;
  teacherUid: string; teacherName: string; location?: string; startTime: string; endTime: string;
  link?: LinkInput | null;
  /** only sent when the audience was edited */
  audience?: { studentUids: string[]; parentUids: string[]; studentIds: string[]; excludedStudentIds: string[] };
}

export async function editSessions(base: WithId<Session>, scope: Scope, ch: EditChanges, by: Actor, canSeeAll: boolean, notify: boolean): Promise<number> {
  if (ch.endTime <= ch.startTime) throw new Error('End time must be after start time.');
  const link = validLink(ch.link);
  const rows = await select(base, scope, canSeeAll, by.uid);
  const ops: { col: string; id: string; data: object; merge: boolean }[] = [];
  for (const r of rows) {
    const studentUids = ch.audience?.studentUids ?? r.studentUids; const parentUids = ch.audience?.parentUids ?? r.parentUids;
    ops.push({ col: C.sessions, id: r.id, merge: true, data: {
      title: ch.title, description: ch.description ?? '', courseId: ch.courseId ?? '', courseName: ch.courseName ?? '', subjectId: ch.subjectId ?? '', subjectName: ch.subjectName ?? '',
      teacherUid: ch.teacherUid, teacherName: ch.teacherName, location: ch.location ?? '', online: link ? true : r.online && ch.link === undefined, provider: link?.provider ?? r.provider ?? '',
      startAt: zonedToUtc(r.localDate, ch.startTime, r.timezone), endAt: zonedToUtc(r.localDate, ch.endTime, r.timezone),
      studentUids, parentUids, viewers: viewersOf(ch.teacherUid, studentUids, parentUids),
      overridden: scope === 'one' ? true : r.overridden, updatedBy: by.uid, updatedByName: by.name,
    } });
    if (link) ops.push({ col: C.sessionLinks, id: r.id, merge: true, data: { ...link, updatedBy: by.uid } });
  }
  await batchSet(ops);
  if (scope !== 'one') {
    await batchSet([{ col: C.timetableSeries, id: base.seriesId, merge: true, data: {
      title: ch.title, description: ch.description ?? '', courseId: ch.courseId ?? '', courseName: ch.courseName ?? '', subjectId: ch.subjectId ?? '', subjectName: ch.subjectName ?? '',
      teacherUid: ch.teacherUid, teacherName: ch.teacherName, location: ch.location ?? '', startTime: ch.startTime, endTime: ch.endTime,
      ...(ch.audience ? { ...ch.audience, viewers: viewersOf(ch.teacherUid, ch.audience.studentUids, ch.audience.parentUids) } : {}),
      ...(link ? { online: true, provider: link.provider } : {}),
    } }]);
  }
  void audit('timetable.edit', `timetableSeries/${base.seriesId}`, `${scope}: ${rows.length} session(s) — ${ch.title}`);
  if (notify) {
    const all = rows.flatMap((r) => r.viewers);
    void notifyUsers(uniq(all).filter((u) => u !== by.uid), { title: `Class updated: ${ch.title}`, body: scope === 'one' ? `Details for ${base.localDate} changed.` : `${rows.length} upcoming sessions were updated.`, link: '/app/schedule' });
  }
  return rows.length;
}

export async function cancelSessions(base: WithId<Session>, scope: Scope, reason: string, by: Actor, canSeeAll: boolean, notify: boolean): Promise<number> {
  if (!reason.trim()) throw new Error('Please give a reason for cancelling.');
  const rows = (await select(base, scope, canSeeAll, by.uid)).filter((r) => r.status === 'scheduled');
  await batchSet(rows.map((r) => ({ col: C.sessions, id: r.id, merge: true, data: { status: 'cancelled' as SessionStatus, cancelReason: reason.trim(), cancelledAt: serverTimestamp(), updatedBy: by.uid, updatedByName: by.name } })));
  if (scope === 'all') await batchSet([{ col: C.timetableSeries, id: base.seriesId, merge: true, data: { status: 'cancelled' } }]);
  void audit('session.cancel', `timetableSeries/${base.seriesId}`, `${scope}: ${rows.length} — ${reason.trim()}`);
  if (notify) {
    void notifyUsers(uniq(rows.flatMap((r) => r.viewers)).filter((u) => u !== by.uid), {
      title: `Class cancelled: ${base.title}`, body: `${scope === 'one' ? base.localDate : `${rows.length} sessions`} — ${reason.trim()}`, link: '/app/schedule',
    });
  }
  return rows.length;
}

/** Moves one occurrence. The original time is preserved in `rescheduledFrom` for the history. */
export async function rescheduleSession(s: WithId<Session>, date: string, start: string, end: string, reason: string, by: Actor, notify: boolean): Promise<void> {
  if (end <= start) throw new Error('End time must be after start time.');
  const startAt = zonedToUtc(date, start, s.timezone); const endAt = zonedToUtc(date, end, s.timezone);
  if (startAt.getTime() < Date.now() - 60_000) throw new Error('Choose a time in the future.');
  await batchSet([{ col: C.sessions, id: s.id, merge: true, data: {
    startAt, endAt, localDate: date, monthKey: monthKeyOf(date), status: 'scheduled' as SessionStatus, cancelReason: '', rescheduledFrom: s.rescheduledFrom ?? s.startAt, overridden: true, updatedBy: by.uid, updatedByName: by.name,
  } }]);
  void audit('session.reschedule', `sessions/${s.id}`, `${s.localDate} ${utcToZoned(toDate(s.startAt)!, s.timezone).time} → ${date} ${start}${reason ? ` — ${reason}` : ''}`);
  if (notify) void notifyUsers(s.viewers.filter((u) => u !== by.uid), { title: `Class rescheduled: ${s.title}`, body: `Now ${date} at ${start}.${reason ? ` ${reason}` : ''}`, link: '/app/schedule' });
}

export async function markCompleted(s: WithId<Session>, by: Actor): Promise<void> {
  await batchSet([{ col: C.sessions, id: s.id, merge: true, data: { status: 'completed' as SessionStatus, updatedBy: by.uid, updatedByName: by.name } }]);
  void audit('session.complete', `sessions/${s.id}`, s.title);
}

/* ------------------------------------------------------------ restricted join link */
export async function readLink(sessionId: string): Promise<SessionLink | null> {
  try {
    const snap = await getDoc(doc(db(), C.sessionLinks, sessionId));
    return snap.exists() ? (snap.data() as SessionLink) : null;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'permission-denied') throw new Error('The join link is only available to the invited audience, from 15 minutes before the class starts.');
    throw e;
  }
}

/** Records who looked at / clicked the link. This is NOT proof of attendance (see Phase 3). */
export async function logAccess(s: WithId<Session>, who: { uid: string; name: string; role: string }, action: SessionAccessLog['action']): Promise<void> {
  try {
    await addDoc(collection(db(), C.sessionAccess), { sessionId: s.id, teacherUid: s.teacherUid, uid: who.uid, name: who.name.slice(0, 120), role: who.role, action, at: serverTimestamp() });
  } catch (e) { console.warn('access log failed', e); }
}
