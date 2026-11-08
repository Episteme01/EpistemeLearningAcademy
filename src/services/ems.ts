import { arrayUnion, doc, runTransaction, serverTimestamp, where, addDoc, collection } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { C } from '@/config/collections';
import { batchSet, clean, getById, listDocs, patchDoc } from './db';
import { nextInvoiceNo, nextReceiptNo } from './counters';
import { notifyUsers } from './notifications';
import { audit } from './audit';
import { applyPayment, invoiceStatus, invoiceTotal } from '@/lib/finance';
import { computeSubjectResult, rankPositions, summarise, type GradingScale } from '@/lib/assessment';
import type { Invoice, Parent, Payment, ReportCard, ResultRecord, Student, WithId, FeeStructure } from '@/types/models';

export const fullName = (p: { firstName?: string; lastName?: string; otherNames?: string }) => [p.firstName, p.otherNames, p.lastName].filter(Boolean).join(' ');

/** Link a parent to a student on both sides and refresh the denormalised uid arrays. */
export async function linkParent(parent: WithId<Parent>, student: WithId<Student>) {
  await patchDoc(C.students, student.id, {
    parentIds: arrayUnion(parent.id),
    ...(parent.userUid ? { parentUids: arrayUnion(parent.userUid) } : {}),
  });
  await patchDoc(C.parents, parent.id, { studentIds: arrayUnion(student.id) });
  void audit('student.link_parent', `students/${student.id}`, parent.id);
}

/** After creating a parent login, copy its uid onto every linked student. */
export async function attachParentUid(parent: WithId<Parent>, uid: string) {
  await patchDoc(C.parents, parent.id, { userUid: uid });
  for (const sid of parent.studentIds ?? []) await patchDoc(C.students, sid, { parentUids: arrayUnion(uid) });
}

export async function addStudentHistory(studentId: string, text: string, by: string) {
  await addDoc(collection(db(), `${C.students}/${studentId}/history`), { text, by, at: serverTimestamp() });
}

/** Promote learners to another class (records history; keeps the login's classId in sync). */
export async function promoteStudents(students: WithId<Student>[], toClassId: string, toClassName: string, by: string) {
  await batchSet(students.map((s) => ({ col: C.students, id: s.id, data: { classId: toClassId, className: toClassName } })));
  await batchSet(students.filter((s) => s.studentUid).map((s) => ({ col: C.users, id: s.studentUid, data: { classId: toClassId } })));
  for (const s of students) await addStudentHistory(s.id, `Promoted from ${s.className ?? '—'} to ${toClassName}`, by);
  void audit('students.promote', `classes/${toClassId}`, `${students.length} learners`);
}

export async function generateInvoices(opts: { structure: WithId<FeeStructure>; students: WithId<Student>[]; termId: string; termName: string; dueDate: string }) {
  let created = 0;
  const existing = await listDocs<Invoice>(C.invoices, [where('termId', '==', opts.termId)]);
  const have = new Set(existing.filter((i) => i.items.map((x) => x.label).join() === opts.structure.items.map((x) => x.label).join()).map((i) => i.studentId));
  for (const s of opts.students) {
    if (have.has(s.id)) continue;
    const invoiceNo = await nextInvoiceNo();
    const total = invoiceTotal(opts.structure.items);
    const inv: Omit<Invoice, 'createdAt'> = {
      invoiceNo, studentId: s.id, studentName: fullName(s), studentUid: s.studentUid ?? '', parentUids: s.parentUids ?? [], classId: s.classId, termId: opts.termId, termName: opts.termName,
      items: opts.structure.items, total, paid: 0, balance: total, status: invoiceStatus(total, 0, opts.dueDate), dueDate: opts.dueDate, currency: opts.structure.currency,
    };
    await batchSet([{ col: C.invoices, id: invoiceNo.replace(/[^A-Za-z0-9-]/g, ''), data: { ...inv, createdAt: serverTimestamp() }, merge: false }]);
    created++;
    if (s.parentUids?.length) void notifyUsers(s.parentUids, { title: `New invoice ${invoiceNo}`, body: `${fullName(s)} — ${opts.termName}`, link: '/app/ems/children' });
  }
  void audit('invoices.generate', `feeStructures/${opts.structure.id}`, `${created} invoices`);
  return created;
}

/**
 * Records a payment against an invoice atomically (invoice totals + ledger entry).
 * Online gateway payments follow the same path via services/paymentGateway.ts.
 */
export async function recordPayment(invoice: WithId<Invoice>, input: { amount: number; method: Payment['method']; reference?: string; paidAt: string; by: string; gateway?: Payment['gateway'] }) {
  const receiptNo = await nextReceiptNo();
  const payRef = doc(db(), C.payments, receiptNo.replace(/[^A-Za-z0-9-]/g, ''));
  const invRef = doc(db(), C.invoices, invoice.id);
  await runTransaction(db(), async (tx) => {
    const snap = await tx.get(invRef);
    if (!snap.exists()) throw new Error('Invoice no longer exists.');
    const cur = snap.data() as Invoice;
    if (cur.status === 'cancelled') throw new Error('Cannot pay a cancelled invoice.');
    const next = applyPayment(cur, input.amount);
    tx.update(invRef, { paid: next.paid, balance: next.balance, status: next.status, updatedAt: serverTimestamp() });
    tx.set(payRef, clean({
      receiptNo, invoiceId: invoice.id, invoiceNo: cur.invoiceNo, studentId: cur.studentId, studentName: cur.studentName, studentUid: cur.studentUid, parentUids: cur.parentUids,
      amount: input.amount, method: input.method, reference: input.reference ?? '', paidAt: input.paidAt, recordedBy: input.by, currency: cur.currency, gateway: input.gateway,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
  void audit('payment.record', `invoices/${invoice.id}`, `${receiptNo}: ${input.amount}`);
  if (invoice.parentUids?.length) void notifyUsers(invoice.parentUids, { title: `Payment received (${receiptNo})`, body: `${invoice.studentName}`, link: '/app/ems/children' });
  return receiptNo;
}

export async function saveResultRows(rows: { student: WithId<Student>; ca: number; exam: number; comment?: string }[], ctx: { termId: string; classId: string; subjectId: string; subjectName: string; scale: GradingScale; status: 'draft' | 'submitted'; by: string }) {
  await batchSet(rows.map((r) => {
    const calc = computeSubjectResult(r.ca, r.exam, ctx.scale);
    const data: ResultRecord = {
      termId: ctx.termId, classId: ctx.classId, studentId: r.student.id, studentName: fullName(r.student), studentUid: r.student.studentUid ?? '', parentUids: r.student.parentUids ?? [],
      subjectId: ctx.subjectId, subjectName: ctx.subjectName, ca: r.ca, exam: r.exam, total: calc.total, grade: calc.grade, remark: calc.remark, teacherComment: r.comment ?? '', status: ctx.status, enteredBy: ctx.by,
    };
    return { col: C.results, id: `${ctx.termId}_${r.student.id}_${ctx.subjectId}`, data, merge: false };
  }));
}

export async function approveResults(ids: string[], termId: string) {
  await batchSet(ids.map((id) => ({ col: C.results, id, data: { status: 'approved' } })));
  const rows = await Promise.all(ids.map((id) => getById<ResultRecord>(C.results, id)));
  const parents = new Set<string>();
  rows.forEach((r) => (r?.parentUids ?? []).forEach((u) => parents.add(u)));
  void notifyUsers([...parents], { title: 'New results published', body: 'Open “My children” to view the latest results.', link: '/app/ems/children' });
  void audit('results.approve', `terms/${termId}`, `${ids.length} results`);
}

/** Build/refresh report cards for a class+term from existing results (keeps comments). */
export async function generateReportCards(classId: string, termId: string, students: WithId<Student>[]) {
  const results = await listDocs<ResultRecord>(C.results, [where('termId', '==', termId), where('classId', '==', classId)]);
  const existing = await listDocs<ReportCard>(C.reportCards, [where('termId', '==', termId), where('classId', '==', classId)]);
  const sums = students.map((s) => ({ s, sum: summarise(results.filter((r) => r.studentId === s.id).map((r) => r.total)) })).filter((x) => x.sum.subjects > 0);
  const pos = rankPositions(sums.map((x) => ({ id: x.s.id, total: x.sum.total })));
  await batchSet(sums.map(({ s, sum }) => {
    const prev = existing.find((e) => e.studentId === s.id);
    const card: ReportCard = {
      termId, classId, studentId: s.id, studentName: fullName(s), studentUid: s.studentUid ?? '', parentUids: s.parentUids ?? [], total: sum.total, average: sum.average,
      position: pos[s.id], classSize: sums.length, teacherComment: prev?.teacherComment ?? '', principalComment: prev?.principalComment ?? '', status: prev?.status ?? 'draft',
    };
    return { col: C.reportCards, id: `${termId}_${s.id}`, data: card, merge: false };
  }));
  return sums.length;
}
