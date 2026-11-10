/** Pure homework helpers shared by the parent view and analytics (unit-tested). */
export type HwStatus = 'open' | 'submitted' | 'submitted_late' | 'graded' | 'missing';

export interface HwAssignment { id: string; dueMs: number; maxScore: number }
export interface HwSubmission { assignmentId: string; submittedMs: number | null; status: string; score?: number | null }

export function homeworkStatus(a: HwAssignment, s: HwSubmission | undefined, nowMs: number): HwStatus {
  if (s?.status === 'graded') return 'graded';
  if (s) return s.submittedMs !== null && s.submittedMs > a.dueMs ? 'submitted_late' : 'submitted';
  return nowMs > a.dueMs ? 'missing' : 'open';
}

export interface HwSummary { total: number; due: number; submitted: number; onTime: number; missing: number; graded: number; avgPct: number | null }

/** Summarise a learner's (or a group's) work. `due` counts assignments whose deadline has passed or that were handed in. */
export function summariseHomework(rows: { a: HwAssignment; s?: HwSubmission }[], nowMs: number): HwSummary {
  let due = 0, submitted = 0, onTime = 0, missing = 0, graded = 0; const pcts: number[] = [];
  for (const { a, s } of rows) {
    const st = homeworkStatus(a, s, nowMs);
    if (st !== 'open') due += 1;
    if (st === 'missing') missing += 1;
    if (st === 'submitted' || st === 'graded' || st === 'submitted_late') {
      submitted += 1;
      if (s && s.submittedMs !== null && s.submittedMs <= a.dueMs) onTime += 1;
    }
    if (st === 'graded' && typeof s?.score === 'number' && a.maxScore > 0) { graded += 1; pcts.push((s.score / a.maxScore) * 100); }
  }
  return { total: rows.length, due, submitted, onTime, missing, graded, avgPct: pcts.length ? Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length) : null };
}
