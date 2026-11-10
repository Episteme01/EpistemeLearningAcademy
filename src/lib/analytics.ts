import { summariseHomework, type HwAssignment, type HwSubmission, type HwSummary } from './homework';

export interface AssignmentRow { id: string; title: string; classId?: string; className?: string; dueMs: number; maxScore: number; studentUids: string[] }

export interface HwGroup { key: string; label: string; summary: HwSummary; learners: number }

/** Homework completion for each assignment, counting every learner it was set for. */
export function homeworkByAssignment(assignments: AssignmentRow[], subs: (HwSubmission & { uid: string })[], nowMs: number): HwGroup[] {
  return assignments.map((a) => {
    const h: HwAssignment = { id: a.id, dueMs: a.dueMs, maxScore: a.maxScore };
    const rows = a.studentUids.map((u) => ({ a: h, s: subs.find((s) => s.assignmentId === a.id && s.uid === u) }));
    return { key: a.id, label: a.title, learners: a.studentUids.length, summary: summariseHomework(rows, nowMs) };
  }).sort((x, y) => x.label.localeCompare(y.label));
}

/** Same, rolled up by class name. */
export function homeworkByClass(assignments: AssignmentRow[], subs: (HwSubmission & { uid: string })[], nowMs: number): HwGroup[] {
  const m = new Map<string, { label: string; rows: { a: HwAssignment; s?: HwSubmission }[]; learners: Set<string> }>();
  for (const a of assignments) {
    const k = a.classId || '-'; const e = m.get(k) ?? { label: a.className || 'No class', rows: [], learners: new Set<string>() };
    const h: HwAssignment = { id: a.id, dueMs: a.dueMs, maxScore: a.maxScore };
    for (const u of a.studentUids) { e.learners.add(u); e.rows.push({ a: h, s: subs.find((s) => s.assignmentId === a.id && s.uid === u) }); }
    m.set(k, e);
  }
  return [...m].map(([key, v]) => ({ key, label: v.label, learners: v.learners.size, summary: summariseHomework(v.rows, nowMs) })).sort((x, y) => x.label.localeCompare(y.label));
}

export interface LearnerSignal { uid: string; name: string; attendancePct: number | null; attendanceExpected: number; missingHomework: number }
export interface Attention extends LearnerSignal { reasons: string[] }
export const ATTENDANCE_FLOOR = 75;
export const MISSING_LIMIT = 3;

/** Learners who need a conversation: low attendance (with enough sessions to judge) or several missing pieces of homework. */
export function needingAttention(signals: LearnerSignal[], floor = ATTENDANCE_FLOOR, missingLimit = MISSING_LIMIT, minSessions = 3): Attention[] {
  const out: Attention[] = [];
  for (const s of signals) {
    const reasons: string[] = [];
    if (s.attendancePct !== null && s.attendanceExpected >= minSessions && s.attendancePct < floor) reasons.push(`Attendance ${s.attendancePct}%`);
    if (s.missingHomework >= missingLimit) reasons.push(`${s.missingHomework} homework missing`);
    if (reasons.length) out.push({ ...s, reasons });
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length || (a.attendancePct ?? 101) - (b.attendancePct ?? 101));
}

/** Missing-homework count per learner. */
export function missingByLearner(assignments: AssignmentRow[], subs: (HwSubmission & { uid: string })[], nowMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of assignments) {
    if (nowMs <= a.dueMs) continue;
    for (const u of a.studentUids) if (!subs.some((s) => s.assignmentId === a.id && s.uid === u)) out[u] = (out[u] ?? 0) + 1;
  }
  return out;
}
