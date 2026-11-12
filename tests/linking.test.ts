import { describe, it, expect } from 'vitest';
import { candidatesFor, linkProblem, linkUserPatch, unlinkPlan } from '../src/lib/linking';
import { hasErrors, validateSchedule } from '../src/lib/schedule/validate';
import { defaultRecurrence } from '../src/lib/schedule/recurrence';
import { zonedToUtc } from '../src/lib/schedule/tz';

const U = (id: string, o: Record<string, unknown> = {}) => ({ id, email: `${id}@x.com`, displayName: id.toUpperCase(), role: 'teacher', roles: ['teacher'], status: 'active', ...o });
describe('account linking', () => {
  it('lists only unlinked logins and searches by name or email', () => {
    const users = [U('ada'), U('bola', { staffId: 's1' }), U('chi')];
    expect(candidatesFor(users, 'staff', [{ id: 's1', userUid: 'bola' }], '').map((u) => u.id)).toEqual(['ada', 'chi']);
    expect(candidatesFor(users, 'staff', [], 'CH').map((u) => u.id)).toEqual(['chi']);
    expect(candidatesFor(users, 'staff', [], '', true).length).toBe(3);
    // a login already used by another record is hidden even if the user doc was not updated
    expect(candidatesFor([U('dee')], 'student', [{ id: 'k1', userUid: undefined, ...{ studentUid: 'dee' } } as never], '').length).toBe(0);
  });
  it('prevents duplicate and unsafe links', () => {
    const recs = [{ id: 'r1' }, { id: 'r2', userUid: 'ada' }];
    expect(linkProblem(U('ada'), { id: 'r1' }, 'staff', recs) !== null).toBe(true);
    expect(linkProblem(U('eve', { staffId: 'r9' }), { id: 'r1' }, 'staff', recs) !== null).toBe(true);
    expect(linkProblem(U('eve'), { id: 'r2', userUid: 'ada' }, 'staff', recs) !== null).toBe(true);
    expect(linkProblem(U('eve', { status: 'suspended' }), { id: 'r1' }, 'staff', recs) !== null).toBe(true);
    expect(linkProblem(U('boss', { roles: ['super_admin'], role: 'super_admin' }), { id: 'k' }, 'student', []) !== null).toBe(true);
    expect(linkProblem(U('eve'), { id: 'r1' }, 'staff', recs)).toBe(null);
  });
  it('link patch keeps roles and only adds what is needed', () => {
    expect(linkUserPatch(U('a', { roles: ['finance'], role: 'finance' }), 'staff', 'r1')).toEqual({ roles: ['finance'], staffId: 'r1' });
    expect(linkUserPatch(U('a', { roles: ['parent'], role: 'parent' }), 'staff', 'r1').roles).toEqual(['parent', 'teacher']);
    expect(linkUserPatch(U('a', { roles: ['teacher'] }), 'parent', 'p1')).toEqual({ roles: ['teacher', 'parent'], parentId: 'p1' });
  });
  it('unlinking: blocks self and super admin, warns, suspends a login left with no role', () => {
    expect(unlinkPlan(U('a'), 'staff', { isSelf: true, upcomingSessions: 0 }).block !== undefined).toBe(true);
    expect(unlinkPlan(U('a', { roles: ['super_admin'] }), 'staff', { isSelf: false, upcomingSessions: 0 }).block !== undefined).toBe(true);
    const w = unlinkPlan(U('a'), 'staff', { isSelf: false, upcomingSessions: 3 });
    expect(w.block).toBe(undefined); expect(w.warnings.length).toBe(1); expect(w.userPatch.staffId).toBe('');
    const s = unlinkPlan(U('k', { roles: ['student'], role: 'student' }), 'student', { isSelf: false, upcomingSessions: 0 });
    expect(s.userPatch.status).toBe('suspended'); expect(s.userPatch.studentId).toBe('');
    const both = unlinkPlan(U('k', { roles: ['teacher', 'parent'], role: 'parent' }), 'parent', { isSelf: false, upcomingSessions: 0 });
    expect(both.userPatch.roles).toEqual(['teacher']); expect(both.userPatch.role).toBe('teacher'); expect(both.userPatch.status).toBe(undefined);
  });
});

const slot = (id: string, date: string, s: string, e: string, teacherUid: string, classId: string, status = 'scheduled') => ({ id, teacherUid, classId, status, title: id, startMs: zonedToUtc(date, s).getTime(), endMs: zonedToUtc(date, e).getTime() });
const base = { title: 'Maths', teacherUid: 't1', classId: 'c1', subjectId: 'sub1', startDate: '2026-11-16', startTime: '10:00', endTime: '11:00', recurrence: defaultRecurrence() };
const codes = (i: { code: string }[]) => i.map((x) => x.code);
describe('timetable validation', () => {
  it('accepts a clean schedule', () => { expect(validateSchedule(base, { existing: [] })).toEqual([]); });
  it('rejects bad times and missing teacher', () => {
    expect(codes(validateSchedule({ ...base, endTime: '09:00' }, { existing: [] }))).toEqual(['bad_time']);
    expect(codes(validateSchedule({ ...base, endTime: '10:00' }, { existing: [] }))).toEqual(['bad_time']);
    expect(codes(validateSchedule({ ...base, teacherUid: '' }, { existing: [] }))).toContain('no_teacher');
  });
  it('detects teacher, class and duplicate clashes (overlap, not just equality)', () => {
    expect(codes(validateSchedule(base, { existing: [slot('x', '2026-11-16', '10:30', '11:30', 't1', 'c2')] }))).toEqual(['teacher_conflict']);
    expect(codes(validateSchedule(base, { existing: [slot('x', '2026-11-16', '10:30', '11:30', 't2', 'c1')] }))).toEqual(['class_conflict']);
    expect(codes(validateSchedule(base, { existing: [slot('x', '2026-11-16', '10:00', '11:00', 't1', 'c1')] }))).toEqual(['duplicate']);
    expect(validateSchedule(base, { existing: [slot('x', '2026-11-16', '11:00', '12:00', 't1', 'c1')] })).toEqual([]); // back-to-back is fine
    expect(validateSchedule(base, { existing: [slot('x', '2026-11-16', '10:00', '11:00', 't1', 'c1', 'cancelled')] })).toEqual([]);
    expect(validateSchedule(base, { existing: [slot('x', '2026-11-16', '10:00', '11:00', 't1', 'c1')], excludeIds: ['x'] })).toEqual([]);
  });
  it('checks every occurrence of a repeating class', () => {
    const rec = { freq: 'weekly' as const, interval: 1, weekdays: [1], end: { type: 'count' as const, count: 3 } };
    const i = validateSchedule({ ...base, recurrence: rec }, { existing: [slot('x', '2026-11-30', '10:00', '11:00', 't1', 'c9')] });
    expect(codes(i)).toEqual(['teacher_conflict']); expect(i[0].message.includes('2026-11-30')).toBe(true);
  });
  it('class-subject and course-instructor rules', () => {
    expect(codes(validateSchedule(base, { existing: [], classSubjectIds: ['other'] }))).toEqual(['class_subject']);
    expect(hasErrors(validateSchedule(base, { existing: [], classSubjectIds: ['other'] }))).toBe(true);
    expect(validateSchedule(base, { existing: [], classSubjectIds: [] })).toEqual([]);
    const w = validateSchedule({ ...base, courseId: 'co' }, { existing: [], courseInstructorUid: 't9' });
    expect(codes(w)).toEqual(['course_instructor']); expect(hasErrors(w)).toBe(false);
    expect(codes(validateSchedule(base, { existing: [], assignments: [{ staffUid: 't1', classId: 'c2', subjectId: 'sub1' }] }))).toEqual(['not_assigned']);
  });
});
