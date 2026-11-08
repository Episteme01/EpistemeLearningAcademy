/**
 * OPTIONAL. Requires the Firebase Blaze (pay-as-you-go) plan. The app works without it:
 * staff press "Grade submissions" in CBT → Results & grading (same logic, runs in their browser).
 * Deploy:  firebase deploy --only functions     Then set repository variable VITE_USE_CLOUD_FUNCTIONS=true.
 */
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { gradeAttempt } = require('./grade');

initializeApp();

exports.gradeOnSubmit = onDocumentUpdated('attempts/{attemptId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!after || after.status !== 'submitted' || before.status === 'submitted') return;
  const db = getFirestore();
  const examRef = db.doc(`exams/${after.examId}`);
  const [exam, paperSnap, keysSnap] = await Promise.all([examRef.get(), examRef.collection('paper').get(), examRef.collection('keys').get()]);
  if (!exam.exists) return;
  const e = exam.data();
  const paper = {}; paperSnap.forEach((d) => { paper[d.id] = d.data(); });
  const keys = {}; keysSnap.forEach((d) => { keys[d.id] = d.data(); });
  const questions = (after.questionIds || []).filter((id) => paper[id]).map((id) => ({ id, type: paper[id].type, marks: paper[id].marks }));
  const g = gradeAttempt({ questions, keys, answers: after.answers || {}, config: { negativeMarking: e.negativeMarking, passMark: e.passMark } });
  const stu = await db.collection('students').where('studentUid', '==', after.uid).limit(1).get();
  const parentUids = stu.empty ? [] : stu.docs[0].data().parentUids || [];
  await db.doc(`cbtResults/${event.params.attemptId}`).set({
    examId: after.examId, examTitle: e.title, attemptId: event.params.attemptId, uid: after.uid, studentId: after.studentId || '', studentName: after.studentName,
    studentUid: after.uid, parentUids, ...g, manualMarks: {}, released: e.releasePolicy === 'immediate', gradedBy: 'cloud-function', gradedAt: FieldValue.serverTimestamp(),
  });
  await event.data.after.ref.update({ status: 'graded' });
});
