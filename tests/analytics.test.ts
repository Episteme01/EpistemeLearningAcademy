import { describe, it, expect } from 'vitest';
import { homeworkStatus, summariseHomework } from '../src/lib/homework';
import { homeworkByAssignment, homeworkByClass, missingByLearner, needingAttention } from '../src/lib/analytics';
import { cleanOffsets as a } from '../src/lib/notifyPolicy';
import { cleanOffsets as b } from '../supabase/functions/notify/logic';

const H = 3_600_000; const due = 1_000 * H; const now = due + 2 * H;
const asg = { id: 'a1', dueMs: due, maxScore: 10 };

describe('homework status', () => {
  it('classifies each case', () => {
    expect(homeworkStatus(asg, undefined, due - H)).toBe('open');
    expect(homeworkStatus(asg, undefined, now)).toBe('missing');
    expect(homeworkStatus(asg, { assignmentId: 'a1', submittedMs: due - 1, status: 'submitted' }, now)).toBe('submitted');
    expect(homeworkStatus(asg, { assignmentId: 'a1', submittedMs: due + 1, status: 'submitted' }, now)).toBe('submitted_late');
    expect(homeworkStatus(asg, { assignmentId: 'a1', submittedMs: due - 1, status: 'graded', score: 8 }, now)).toBe('graded');
  });
  it('summarises', () => {
    const s = summariseHomework([
      { a: asg, s: { assignmentId: 'a1', submittedMs: due - 1, status: 'graded', score: 8 } },
      { a: asg, s: { assignmentId: 'a1', submittedMs: due + 5, status: 'submitted' } },
      { a: asg },
    ], now);
    expect(s).toEqual({ total: 3, due: 3, submitted: 2, onTime: 1, missing: 1, graded: 1, avgPct: 80 });
  });
  it('does not count open work as due', () => { expect(summariseHomework([{ a: asg }], due - H).due).toBe(0); });
});

describe('analytics', () => {
  const rows = [{ id: 'a1', title: 'HW1', classId: 'c1', className: 'JSS 1', dueMs: due, maxScore: 10, studentUids: ['u1', 'u2'] }];
  const subs = [{ assignmentId: 'a1', uid: 'u1', submittedMs: due - 1, status: 'submitted' }];
  it('groups by assignment and class', () => {
    expect(homeworkByAssignment(rows, subs, now)[0]!.summary.missing).toBe(1);
    const c = homeworkByClass(rows, subs, now)[0]!; expect([c.label, c.learners]).toEqual(['JSS 1', 2]);
  });
  it('counts missing per learner', () => { expect(missingByLearner(rows, subs, now)).toEqual({ u2: 1 }); });
  it('flags learners who need attention', () => {
    const r = needingAttention([
      { uid: 'x', name: 'X', attendancePct: 60, attendanceExpected: 10, missingHomework: 0 },
      { uid: 'y', name: 'Y', attendancePct: 90, attendanceExpected: 10, missingHomework: 4 },
      { uid: 'z', name: 'Z', attendancePct: 10, attendanceExpected: 1, missingHomework: 0 },
      { uid: 'w', name: 'W', attendancePct: 95, attendanceExpected: 10, missingHomework: 1 },
    ]);
    expect(r.map((x) => x.uid).sort()).toEqual(['x', 'y']);
  });
});

describe('reminder offsets stay identical in browser and server copies', () => {
  it('match', () => { for (const v of [undefined, [60, 10], [1, 5000], ['30', 15, 15, 120, 240, 480], 'x']) expect(a(v)).toEqual(b(v)); });
});
