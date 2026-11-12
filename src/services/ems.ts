import { arrayRemove, arrayUnion, doc, runTransaction, serverTimestamp, where, addDoc, collection } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { C } from '@/config/collections';
import { batchSet, clean, getById, listDocs, patchDoc } from './db';
import { nextInvoiceNo, nextReceiptNo } from './counters';
import { notifyUsers } from './notifications';
import { audit } from './audit';
import { alreadyInvoiced, applyPayment, invoiceStatus, invoiceTotal, planCreditApplication, round2, validMoney, type CreditLike } from '@/lib/finance';
import { computeSubjectResult, rankPositions, summarise, type GradingScale } from '@/lib/assessment';
import type { Invoice, Parent, Payment, ReportCard, ResultRecord, Student, StudentCredit, WithId, FeeStructure } from '@/types/models';

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

/** Remove a parent link on both sides. */
export async function unlinkParent(parent: WithId<Parent>, student: WithId<Student>) {
  await patchDoc(C.students, student.id, { parentIds: arrayRemove(parent.id), ...(parent.userUid ? { parentUids: arrayRemove(parent.userUid) } : {}) });
  await patchDoc(C.parents, parent.id, { studentIds: arrayRemove(student.id) });
  void audit('student.unlink_parent', `students/${student.id}`, parent.id);
}

/** Link a teacher (a staff member with a login) to a student. */
export async function linkTeacher(staff: { id: string; userUid?: string }, student: WithId<Student>) {
  if (!staff.userUid) throw new Error('This staff member has no login yet. Create their login first.');
  await patchDoc(C.students, student.id, { teacherIds: arrayUnion(staff.id), teacherUids: arrayUnion(staff.userUid) });
  void audit('student.link_teacher', `students/${student.id}`, staff.id);
}
export async function unlinkTeacher(staff: { id: string; userUid?: string }, student: WithId<Student>) {
  await patchDoc(C.students, student.id, { teacherIds: arrayRemove(staff.id), ...(staff.userUid ? { teacherUids: arrayRemove(staff.userUid) } : {}) });
  void audit('student.unlink_teacher', `students/${student.id}`, staff.id);
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

/**
 * Creates (or, with `invoiceData` = null, updates) an invoice and pays it from the learner's waiting credits in ONE transaction.
 * Credits are re-read inside the transaction, so the same money can never be applied twice.
 */
async function settleWithCredits(invoiceId: string, invoiceData: (Omit<Invoice, 'createdAt'> & Record<string, unknown>) | null, creditIds: string[]) {
  const invRef = doc(db(), C.invoices, invoiceId);
  let applied = 0;
  await runTransaction(db(), async (tx) => {
    let inv: Invoice;
    if (invoiceData) inv = invoiceData as Invoice;
    else { const snap = await tx.get(invRef); if (!snap.exists()) throw new Error('Invoice no longer exists.'); inv = snap.data() as Invoice; if (inv.status === 'cancelled') return; }
    const fresh: (CreditLike & { data: StudentCredit })[] = [];
    for (const id of creditIds) {
      const snap = await tx.get(doc(db(), C.studentCredits, id));
      if (snap.exists()) { const d = snap.data() as StudentCredit; fresh.push({ id, remaining: d.remaining, termId: d.termId, structureId: d.structureId, paidAt: d.paidAt, data: d }); }
    }
    const plan = planCreditApplication(inv, fresh);
    if (invoiceData) tx.set(invRef, { ...clean(invoiceData), paid: plan.paid, balance: plan.balance, status: plan.status, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    else if (plan.applications.length) tx.update(invRef, { paid: plan.paid, balance: plan.balance, status: plan.status, updatedAt: serverTimestamp() });
    for (const a of plan.applications) {
      const c = fresh.find((x) => x.id === a.creditId)!;
      const left = round2(c.remaining - a.amount);
      tx.update(doc(db(), C.studentCredits, a.creditId), { remaining: left, updatedAt: serverTimestamp() });
      tx.set(doc(db(), C.payments, `${a.creditId}_${invoiceId}`), clean({
        receiptNo: c.data.receiptNo, invoiceId, invoiceNo: inv.invoiceNo, studentId: inv.studentId, studentName: inv.studentName, studentUid: inv.studentUid, parentUids: inv.parentUids,
        amount: a.amount, method: c.data.method, reference: c.data.reference ?? '', paidAt: c.data.paidAt, recordedBy: `${c.data.recordedBy} (advance payment)`, currency: inv.currency, creditId: a.creditId,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }));
    }
    applied = plan.applied;
  });
  return applied;
}

const creditsOf = async (studentId: string) => (await listDocs<StudentCredit>(C.studentCredits, [where('studentId', '==', studentId)])).filter((c) => c.remaining > 0);

/** Creates invoices for the given learners (a whole class, a hand-picked list, or one learner). Skips anyone already billed for this fee category and term. */
export async function generateInvoices(opts: { structure: WithId<FeeStructure>; students: WithId<Student>[]; termId: string; termName: string; dueDate: string }) {
  let created = 0; let credited = 0;
  const existing = await listDocs<Invoice>(C.invoices, [where('termId', '==', opts.termId)]);
  const have = alreadyInvoiced(existing, opts.structure, opts.termId);
  for (const s of opts.students) {
    if (have.has(s.id)) continue;
    const invoiceNo = await nextInvoiceNo();
    const total = invoiceTotal(opts.structure.items);
    const inv = {
      invoiceNo, studentId: s.id, studentName: fullName(s), studentUid: s.studentUid ?? '', parentUids: s.parentUids ?? [], classId: s.classId, termId: opts.termId, termName: opts.termName,
      items: opts.structure.items, total, paid: 0, balance: total, status: invoiceStatus(total, 0, opts.dueDate), dueDate: opts.dueDate, currency: opts.structure.currency,
      structureId: opts.structure.id, structureName: opts.structure.name,
    } as Omit<Invoice, 'createdAt'> & Record<string, unknown>;
    const credits = await creditsOf(s.id);
    credited += await settleWithCredits(invoiceNo.replace(/[^A-Za-z0-9-]/g, ''), inv, credits.map((c) => c.id));
    created++;
    if (s.parentUids?.length) void notifyUsers(s.parentUids, { title: `New invoice ${invoiceNo}`, body: `${fullName(s)} — ${opts.termName}`, link: '/app/ems/children' });
  }
  void audit('invoices.generate', `feeStructures/${opts.structure.id}`, `${created} invoices, ${credited} from advance payments`);
  return { created, skipped: opts.students.length - created, credited };
}

/**
 * Records money a learner paid BEFORE an invoice existed (or an advance). It gets a receipt number and waits on the account;
 * any matching unpaid invoice the learner already has is paid from it straight away, and invoices created later pick it up automatically.
 */
export async function recordAdvancePayment(student: WithId<Student>, input: { amount: number; method: StudentCredit['method']; reference?: string; paidAt: string; by: string; currency: string; termId?: string; termName?: string; structureId?: string; structureName?: string; note?: string }) {
  if (!validMoney(input.amount)) throw new Error('Enter a valid amount greater than zero (at most 2 decimal places).');
  if (!input.paidAt) throw new Error('Choose the date the money was paid.');
  const receiptNo = await nextReceiptNo();
  const id = receiptNo.replace(/[^A-Za-z0-9-]/g, '');
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), C.studentCredits, id);
    if ((await tx.get(ref)).exists()) throw new Error('This receipt number already exists. Try again.');
    tx.set(ref, clean({
      studentId: student.id, studentName: fullName(student), studentUid: student.studentUid ?? '', parentUids: student.parentUids ?? [], amount: input.amount, remaining: input.amount, receiptNo,
      method: input.method, reference: input.reference ?? '', paidAt: input.paidAt, termId: input.termId ?? '', termName: input.termName ?? '', structureId: input.structureId ?? '', structureName: input.structureName ?? '',
      note: input.note ?? '', recordedBy: input.by, currency: input.currency, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
  void audit('payment.advance', `studentCredits/${id}`, `${receiptNo}: ${input.amount} for ${fullName(student)}`);
  // pay any invoice the learner already has (oldest first)
  let applied = 0;
  const invs = (await listDocs<Invoice>(C.invoices, [where('studentId', '==', student.id)])).filter((i) => i.status !== 'cancelled' && i.balance > 0).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  for (const inv of invs) applied += await settleWithCredits(inv.id, null, [id]);
  if (student.parentUids?.length) void notifyUsers(student.parentUids, { title: `Payment recorded (${receiptNo})`, body: `${fullName(student)}`, link: '/app/ems/children' });
  return { receiptNo, applied, waiting: round2(input.amount - applied) };
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
