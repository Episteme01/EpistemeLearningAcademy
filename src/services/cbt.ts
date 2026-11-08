import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, where, addDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { C } from '@/config/collections';
import { batchSet, listDocs, patchDoc } from './db';
import { notifyUsers } from './notifications';
import { audit } from './audit';
import { gradeAttempt, type AnswerKey } from '@/lib/cbt/grade';
import { seededPick } from '@/lib/cbt/shuffle';
import { toDate } from '@/lib/utils';
import type { Attempt, BankQuestion, CbtResult, Exam, PaperQuestion, QuestionKeyDoc, Student, WithId } from '@/types/models';

export const GRACE_MS = 20_000;
export const deadlineMs = (exam: Pick<Exam, 'durationMinutes'>, attempt: Pick<Attempt, 'startedAt'>) => (toDate(attempt.startedAt)?.getTime() ?? 0) + exam.durationMinutes * 60_000;

/** Copy selected bank questions into the exam's paper (no answers) and keys (staff-only) sub-collections, then publish. */
export async function publishExam(exam: WithId<Exam>) {
  if (!exam.questionIds.length) throw new Error('Add at least one question before publishing.');
  if (!exam.classIds.length && !exam.studentUids.length) throw new Error('Assign the exam to at least one class or student.');
  const bank = await Promise.all(exam.questionIds.map(async (id) => {
    const [q, k] = await Promise.all([getDoc(doc(db(), C.questions, id)), getDoc(doc(db(), C.questionKeys, id))]);
    if (!q.exists() || !k.exists()) throw new Error(`Question ${id} is missing or has no answer key.`);
    return { id, q: q.data() as BankQuestion, k: k.data() as QuestionKeyDoc };
  }));
  const ops = bank.flatMap(({ id, q, k }) => [
    { col: `${C.exams}/${exam.id}/paper`, id, data: { type: q.type, prompt: q.prompt, imageUrl: q.imageUrl ?? '', options: q.options, marks: q.marks, topic: q.topic ?? '' } satisfies PaperQuestion, merge: false },
    { col: `${C.exams}/${exam.id}/keys`, id, data: { correct: k.correct ?? '', accepted: k.accepted ?? [], manual: !!k.manual, explanation: k.explanation ?? '' }, merge: false },
  ]);
  await batchSet(ops);
  const totalMarks = bank.reduce((s, b) => s + b.q.marks, 0);
  await patchDoc(C.exams, exam.id, { status: 'published', totalMarks, questionCountResolved: bank.length });
  void audit('exam.publish', `exams/${exam.id}`);
}

export async function startOrResumeAttempt(exam: WithId<Exam>, who: { uid: string; name: string; studentId?: string }): Promise<WithId<Attempt>> {
  const mine = await listDocs<Attempt>(C.attempts, [where('uid', '==', who.uid), where('examId', '==', exam.id)]);
  const live = mine.find((a) => a.status === 'in_progress' && Date.now() <= deadlineMs(exam, a) + GRACE_MS);
  if (live) return live;
  const used = mine.reduce((m, a) => Math.max(m, a.attemptNo), 0);
  const no = used + 1;
  if (no > exam.maxAttempts) throw new Error('You have used all your attempts for this examination.');
  const id = `${exam.id}_${who.uid}_${no}`;
  const ids = seededPick(exam.questionIds, exam.questionCount, `${id}`);
  await setDoc(doc(db(), C.attempts, id), {
    examId: exam.id, uid: who.uid, studentId: who.studentId ?? '', studentName: who.name, attemptNo: no, attemptKey: String(no), status: 'in_progress',
    startedAt: serverTimestamp(), questionIds: ids, answers: {}, flagged: [], autoSubmitted: false,
  });
  const snap = await getDoc(doc(db(), C.attempts, id)); // server-resolved startedAt
  void logEvent(id, exam.id, who.uid, 'start');
  return { ...(snap.data() as Attempt), id };
}

export async function saveProgress(attemptId: string, answers: Record<string, string>, flagged: string[]) {
  await updateDoc(doc(db(), C.attempts, attemptId), { answers, flagged });
}

export async function submitAttempt(attemptId: string, examId: string, uid: string, answers: Record<string, string>, flagged: string[], auto: boolean) {
  await updateDoc(doc(db(), C.attempts, attemptId), { answers, flagged, status: 'submitted', submittedAt: serverTimestamp(), autoSubmitted: auto });
  void logEvent(attemptId, examId, uid, auto ? 'auto_submit' : 'submit');
}

export async function logEvent(attemptId: string, examId: string, uid: string, type: 'start' | 'resume' | 'submit' | 'auto_submit' | 'blur' | 'focus', detail = '') {
  try { await addDoc(collection(db(), C.examEvents), { attemptId, examId, uid, type, at: serverTimestamp(), detail }); } catch { /* auditing must never block the exam */ }
}

/**
 * Staff-side grading (works on the free plan). Reads the answer keys (staff-only), scores every
 * submitted — or expired in-progress — attempt, and writes server-readable results.
 * When Cloud Functions are deployed (functions/index.js) the same logic runs automatically on submit.
 */
export async function gradeExamAttempts(exam: WithId<Exam>, by: string, regrade = false): Promise<number> {
  const [paperSnap, keysSnap, attempts, existing] = await Promise.all([
    getDocs(collection(db(), `${C.exams}/${exam.id}/paper`)), getDocs(collection(db(), `${C.exams}/${exam.id}/keys`)),
    listDocs<Attempt>(C.attempts, [where('examId', '==', exam.id)]), listDocs<CbtResult>(C.cbtResults, [where('examId', '==', exam.id)]),
  ]);
  const paper: Record<string, PaperQuestion> = {}; paperSnap.forEach((d) => { paper[d.id] = d.data() as PaperQuestion; });
  const keys: Record<string, AnswerKey> = {}; keysSnap.forEach((d) => { keys[d.id] = d.data() as AnswerKey; });
  const now = Date.now(); let n = 0;
  const parentCache = new Map<string, string[]>();
  for (const a of attempts) {
    const expired = a.status === 'in_progress' && now > deadlineMs(exam, a) + GRACE_MS;
    const prev = existing.find((r) => r.attemptId === a.id);
    if (!(a.status === 'submitted' || expired || (regrade && a.status === 'graded'))) continue;
    if (prev && !regrade) continue;
    const questions = a.questionIds.filter((id) => paper[id]).map((id) => ({ id, type: paper[id]!.type, marks: paper[id]!.marks }));
    const g = gradeAttempt({ questions, keys, answers: a.answers ?? {}, manualMarks: prev?.manualMarks, config: { negativeMarking: exam.negativeMarking, passMark: exam.passMark } });
    if (!parentCache.has(a.uid)) parentCache.set(a.uid, (await listDocs<Student>(C.students, [where('studentUid', '==', a.uid)]))[0]?.parentUids ?? []);
    const result: Omit<CbtResult, 'gradedAt'> = {
      examId: exam.id, examTitle: exam.title, attemptId: a.id, uid: a.uid, studentId: a.studentId, studentName: a.studentName, studentUid: a.uid, parentUids: parentCache.get(a.uid) ?? [],
      score: g.score, total: g.total, percentage: g.percentage, passed: g.passed, pendingManual: g.pendingManual, outcomes: g.outcomes, manualMarks: prev?.manualMarks ?? {},
      released: prev?.released ?? exam.releasePolicy === 'immediate', gradedBy: by,
    };
    await batchSet([{ col: C.cbtResults, id: a.id, data: { ...result, gradedAt: serverTimestamp() }, merge: false }, { col: C.attempts, id: a.id, data: { status: 'graded', ...(expired ? { autoSubmitted: true } : {}) } }]);
    n++;
  }
  if (n) void audit('exam.grade', `exams/${exam.id}`, `${n} attempts`);
  return n;
}

export async function setReleased(results: WithId<CbtResult>[], released: boolean) {
  await batchSet(results.map((r) => ({ col: C.cbtResults, id: r.id, data: { released } })));
  if (released) void notifyUsers(results.map((r) => r.uid), { title: 'Examination result available', link: '/app/cbt/my-exams' });
}

export async function applyManualMark(exam: WithId<Exam>, result: WithId<CbtResult>, qid: string, mark: number, by: string) {
  const manualMarks = { ...(result.manualMarks ?? {}), [qid]: mark };
  await patchDoc(C.cbtResults, result.id, { manualMarks });
  await gradeExamAttempts(exam, by, true);
}

