import { getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { C } from '@/config/collections';
import { batchSet, createDoc, deleteLessonProgress, listDocs, patchDoc } from './db';
import { notifyUsers } from './notifications';
import { audit } from './audit';
import type { Course, CourseEnrollment, Lesson, Student, WithId } from '@/types/models';

export async function enrolStudent(course: WithId<Course>, who: { uid: string; name: string; studentId?: string; parentUids?: string[] }) {
  const lessons = await listDocs<Lesson>(C.lessons, [where('courseId', '==', course.id)]).catch(() => [] as WithId<Lesson>[]);
  const e: CourseEnrollment = {
    courseId: course.id, courseTitle: course.title, uid: who.uid, studentId: who.studentId ?? '', studentName: who.name, parentUids: who.parentUids ?? [],
    status: 'active', progressPct: 0, completedLessons: 0, totalLessons: lessons.length,
  };
  await batchSet([{ col: C.courseEnrollments, id: `${course.id}_${who.uid}`, data: { ...e, enrolledAt: serverTimestamp() }, merge: false }]);
}

/** Staff: enrol every active student of a class (restricted / assigned courses). */
export async function enrolClass(course: WithId<Course>, classId: string) {
  const students = (await listDocs<Student>(C.students, [where('classId', '==', classId)])).filter((s) => s.status === 'active' && s.studentUid);
  for (const s of students) await enrolStudent(course, { uid: s.studentUid, name: `${s.firstName} ${s.lastName}`, studentId: s.id, parentUids: s.parentUids });
  void notifyUsers(students.map((s) => s.studentUid), { title: `You were enrolled in ${course.title}`, link: '/app/lms/my-courses' });
  void audit('course.enrol_class', `courses/${course.id}`, `${students.length} learners`);
  return students.length;
}

/** Marks a lesson complete / incomplete and recomputes the enrolment's progress. */
export async function setLessonComplete(args: { uid: string; courseId: string; lessonId: string; complete: boolean; totalLessons: number }) {
  const id = `${args.uid}_${args.lessonId}`;
  if (args.complete) await createDoc(C.lessonProgress, { uid: args.uid, courseId: args.courseId, lessonId: args.lessonId, completedAt: new Date() }, id).catch(() => undefined);
  else await deleteLessonProgress(id);
  const snap = await getDocs(query(collection(db(), C.lessonProgress), where('uid', '==', args.uid), where('courseId', '==', args.courseId)));
  const done = snap.size;
  const pct = args.totalLessons ? Math.min(100, Math.round((done / args.totalLessons) * 100)) : 0;
  await patchDoc(C.courseEnrollments, `${args.courseId}_${args.uid}`, {
    completedLessons: done, totalLessons: args.totalLessons, progressPct: pct, status: pct >= 100 ? 'completed' : 'active', lastActivityAt: new Date(), ...(pct >= 100 ? { completedAt: new Date() } : {}),
  });
  return pct;
}

export function certificateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(10); crypto.getRandomValues(buf);
  const s = Array.from(buf, (n) => chars[n % chars.length]).join('');
  return `ELA-${s.slice(0, 5)}-${s.slice(5)}`;
}

export async function issueCertificate(e: WithId<CourseEnrollment>, issuedBy: string) {
  const code = certificateCode();
  await createDoc(C.certificates, { code, courseId: e.courseId, courseTitle: e.courseTitle, uid: e.uid, studentName: e.studentName, parentUids: e.parentUids ?? [], issuedBy, issuedAt: new Date() }, code);
  await patchDoc(C.courseEnrollments, e.id, { certificateCode: code }).catch(() => undefined);
  void notifyUsers([e.uid], { title: `Certificate issued: ${e.courseTitle}`, link: '/app/lms/certificates' });
  void audit('certificate.issue', `certificates/${code}`, e.uid);
  return code;
}

