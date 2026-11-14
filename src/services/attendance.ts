import { doc, serverTimestamp, setDoc, writeBatch, collection } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { C } from '@/config/collections';
import { audit } from './audit';
import { notifyUsers } from './notifications';
import { clean } from './db';
import { timingFrom } from '@/lib/attendance';
import { toDate } from '@/lib/utils';
import type { AttStatus, AttTiming, Session, SessionAttendance, WithId } from '@/types/models';

export const attendanceId = (sessionId: string, studentUid: string) => `${sessionId}_${studentUid}`;
export interface Actor { uid: string; name: string; role: string }

/**
 * Learner checks themselves in. The server stamps checkInAt (security rules require it to equal request.time),
 * and the record starts as "pending verification". This is the manual fallback (in-person classes, or a learner who joined without the link).
 * For online classes, opening the meeting link records attendance automatically: see recordLinkJoin().
 * A second attempt fails (create-only rule), so duplicates are impossible.
 */
export async function selfCheckIn(session: WithId<Session>, student: { uid: string; name: string; studentId?: string }): Promise<void> {
  const data = {
    sessionId: session.id, seriesId: session.seriesId, studentUid: student.uid, studentId: student.studentId ?? '', studentName: student.name || 'Learner',
    parentUids: session.parentUids ?? [], teacherUid: session.teacherUid, courseId: session.courseId ?? '', classId: session.classId ?? '',
    monthKey: session.monthKey, scheduledStart: session.startAt, scheduledEnd: session.endAt,
    checkInAt: serverTimestamp(), status: 'pending_verification', method: 'self_checkin', verified: false, createdAt: serverTimestamp(),
  };
  await setDoc(doc(db(), C.sessionAttendance, attendanceId(session.id, student.uid)), clean(data));
}

/**
 * Automatic attendance: called the moment a learner opens the meeting link from the website.
 * The record is final (present, no teacher verification needed). The server clock stamps checkInAt; early / on time / late
 * is derived from it (never chosen by the learner).
 * Returns 'recorded', 'already' (a record exists) or 'skipped' (outside the class window or not invited).
 * It never throws: joining the class must never be blocked by an attendance problem.
 */
export async function recordLinkJoin(session: WithId<Session>, student: { uid: string; name: string; studentId?: string }, nowMs = Date.now()): Promise<'recorded' | 'already' | 'skipped'> {
  const start = toDate(session.startAt)?.getTime(); const end = toDate(session.endAt)?.getTime();
  if (start == null || end == null || session.status !== 'scheduled' || !session.studentUids.includes(student.uid)) return 'skipped';
  if (nowMs < start - 15 * 60_000 || nowMs > end) return 'skipped';
  const data = {
    sessionId: session.id, seriesId: session.seriesId, studentUid: student.uid, studentId: student.studentId ?? '', studentName: (student.name || 'Learner').slice(0, 120),
    parentUids: session.parentUids ?? [], teacherUid: session.teacherUid, courseId: session.courseId ?? '', classId: session.classId ?? '',
    monthKey: session.monthKey, scheduledStart: session.startAt, scheduledEnd: session.endAt,
    checkInAt: serverTimestamp(), status: 'present', method: 'link_click', verified: true,
    verifiedBy: 'system', verifiedByName: 'Meeting link (automatic)', createdAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db(), C.sessionAttendance, attendanceId(session.id, student.uid)), clean(data));
    return 'recorded';
  } catch (e) {
    // A record already exists (create-only rule) or the window closed: not an error for the learner.
    console.warn('automatic attendance not recorded', e);
    return 'already';
  }
}

export interface MarkInput {
  session: WithId<Session>;
  studentUid: string; studentName: string; studentId?: string;
  existing: WithId<SessionAttendance> | null;
  status: AttStatus; timing?: AttTiming | ''; reason: string; note?: string;
  method?: 'teacher_confirmed' | 'teacher_marked' | 'auto_finalised';
}

/** Teacher / leader marks, confirms or corrects one learner. Writes the record and its log entry in ONE batch. */
export async function staffMark(m: MarkInput, by: Actor): Promise<void> {
  const prev = m.existing;
  const reason = m.reason.trim();
  if (m.status === 'pending_verification') throw new Error('Choose a final status.');
  if ((!prev || prev.status !== 'pending_verification') && reason.length < 5) throw new Error('Please give a reason (at least 5 characters). It is saved in the history.');
  const b = writeBatch(db());
  const logRef = doc(collection(db(), C.attendanceLog));
  const id = attendanceId(m.session.id, m.studentUid);
  const timing: AttTiming | '' = m.status === 'absent' || m.status === 'excused' ? '' : (m.timing ?? '');
  b.set(logRef, clean({
    attendanceId: id, sessionId: m.session.id, studentUid: m.studentUid, teacherUid: m.session.teacherUid,
    by: by.uid, byName: by.name, byRole: by.role,
    fromStatus: prev?.status ?? 'none', toStatus: m.status, fromTiming: prev?.timing ?? '', toTiming: timing, reason, at: serverTimestamp(),
  }));
  const ref = doc(db(), C.sessionAttendance, id);
  const method = m.method ?? (prev?.status === 'pending_verification' ? 'teacher_confirmed' : 'teacher_marked');
  if (prev) {
    b.update(ref, clean({ status: m.status, timing, verified: true, verifiedBy: by.uid, verifiedByName: by.name, method, note: m.note ?? prev.note ?? '', lastLogId: logRef.id, updatedAt: serverTimestamp() }));
  } else {
    b.set(ref, clean({
      sessionId: m.session.id, seriesId: m.session.seriesId, studentUid: m.studentUid, studentId: m.studentId ?? '', studentName: m.studentName,
      parentUids: m.session.parentUids ?? [], teacherUid: m.session.teacherUid, courseId: m.session.courseId ?? '', classId: m.session.classId ?? '',
      monthKey: m.session.monthKey, scheduledStart: m.session.startAt, scheduledEnd: m.session.endAt,
      status: m.status, timing, method: method === 'teacher_confirmed' ? 'teacher_marked' : method, verified: true, verifiedBy: by.uid, verifiedByName: by.name, markedBy: by.uid,
      note: m.note ?? '', lastLogId: logRef.id, createdAt: serverTimestamp(),
    }));
  }
  await b.commit();
  void audit(prev && prev.status !== 'pending_verification' ? 'attendance.correct' : 'attendance.mark', id, `${prev?.status ?? 'none'} -> ${m.status}${timing ? ` (${timing})` : ''}: ${reason}`);
}

/** Confirms a learner's self check-in, locking in early / on-time / late from the server-stamped time. */
export function confirmPending(session: WithId<Session>, rec: WithId<SessionAttendance>, grace: number, by: Actor, status: AttStatus = 'present') {
  const ci = toDate(rec.checkInAt)?.getTime();
  const timing = ci != null ? timingFrom(ci, toDate(session.startAt)!.getTime(), grace) : 'on_time';
  return staffMark({ session, studentUid: rec.studentUid, studentName: rec.studentName, studentId: rec.studentId, existing: rec, status, timing, reason: '', method: 'teacher_confirmed' }, by);
}

/** Confirms every pending check-in. Sequential, so one failure is reported without hiding the others. */
export async function confirmAll(session: WithId<Session>, recs: WithId<SessionAttendance>[], grace: number, by: Actor): Promise<number> {
  let n = 0;
  for (const r of recs.filter((x) => x.status === 'pending_verification')) { await confirmPending(session, r, grace, by); n += 1; }
  return n;
}

/**
 * "Finalise attendance": every invited learner with no record becomes Absent (method auto_finalised); pending
 * check-ins are left for the teacher to confirm. Only allowed once the class has started (server rule).
 */
export async function finalise(session: WithId<Session>, names: Record<string, string>, existing: WithId<SessionAttendance>[], by: Actor): Promise<number> {
  const have = new Set(existing.map((r) => r.studentUid));
  const missing = session.studentUids.filter((u) => !have.has(u));
  for (const u of missing) {
    await staffMark({ session, studentUid: u, studentName: names[u] ?? 'Learner', existing: null, status: 'absent', reason: 'No check-in recorded when attendance was finalised', method: 'auto_finalised' }, by);
  }
  if (missing.length) void notifyUsers(session.parentUids, { title: 'Attendance recorded', body: `Attendance for "${session.title}" has been finalised.`, link: '/app/attendance' }).catch(() => undefined);
  return missing.length;
}
