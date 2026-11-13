import { serverTimestamp } from 'firebase/firestore';
import { C } from '@/config/collections';
import { getById, replaceDoc, createDoc } from './db';
import { notifyUsers } from './notifications';
import { audit } from './audit';
import { packRanges, type Range } from '@/lib/learning';
import type { LearningFeedback } from '@/types/models';

/** Saves what the learner actually did on a lesson. Never marks the lesson complete. */
export async function saveActivity(a: { uid: string; courseId: string; lessonId: string; parentUids: string[]; ranges: Range[]; watchedPct: number; positionSec?: number; durationSec?: number }): Promise<void> {
  await replaceDoc(C.lessonActivity, `${a.uid}_${a.lessonId}`, {
    uid: a.uid, courseId: a.courseId, lessonId: a.lessonId, parentUids: a.parentUids, ranges: packRanges(a.ranges), watchedPct: a.watchedPct,
    positionSec: Math.floor(a.positionSec ?? 0), durationSec: Math.floor(a.durationSec ?? 0), viewedAt: serverTimestamp(),
  });
}
export async function parentsOfEnrolment(courseId: string, uid: string): Promise<string[]> {
  const e = await getById<{ parentUids?: string[] }>(C.courseEnrollments, `${courseId}_${uid}`).catch(() => null);
  return e?.parentUids ?? [];
}

export async function sendFeedback(f: Omit<LearningFeedback, 'createdAt'>): Promise<void> {
  const message = f.message.trim();
  if (!message) throw new Error('Write a message first.');
  if (message.length > 1000) throw new Error('Keep the message under 1,000 characters.');
  if (!f.parentUids.length) throw new Error('This learner has no parent or guardian linked yet.');
  await createDoc(C.learningFeedback, { ...f, message });
  void notifyUsers(f.parentUids, { title: `Message from ${f.teacherName} about ${f.studentName}`, body: message.slice(0, 120), link: '/app/lms/monitor' });
  void audit('feedback.send', `students/${f.studentId}`, f.courseTitle ?? '');
}
