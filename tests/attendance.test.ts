import { describe, expect, it } from 'vitest';
import { categoryOf, detailOf, effectiveTiming, minutesLate, tally, timingFrom } from '@/lib/attendance';

const T = (hh: number, mm: number, ss = 0) => Date.UTC(2026, 10, 9, hh, mm, ss);   // class day, UTC clock
const START = T(10, 0);

describe('early / on time / late', () => {
  it('9:55 is early', () => { expect(timingFrom(T(9, 55), START, 5)).toBe('early'); });
  it('exactly 10:00 is on time', () => { expect(timingFrom(T(10, 0), START, 5)).toBe('on_time'); });
  it('10:05:00 is still on time; 10:05:01 is late (5 min grace)', () => {
    expect(timingFrom(T(10, 5), START, 5)).toBe('on_time'); expect(timingFrom(T(10, 5, 1), START, 5)).toBe('late');
  });
  it('10:12 is late by 12 minutes', () => {
    expect(timingFrom(T(10, 12), START, 5)).toBe('late'); expect(minutesLate(T(10, 12), START, 5)).toBe(12);
    expect(detailOf({ status: 'present', checkInMs: T(10, 12), startMs: START }, 5)).toBe('Late by 12 min');
  });
  it('grace is configurable', () => { expect(timingFrom(T(10, 8), START, 10)).toBe('on_time'); expect(timingFrom(T(10, 8), START, 0)).toBe('late'); });
  it('early detail', () => { expect(detailOf({ status: 'present', checkInMs: T(9, 55), startMs: START }, 5)).toBe('5 min early'); });
});

describe('categories', () => {
  const base = { startMs: START };
  it('self check-in is pending until a teacher verifies', () => {
    expect(categoryOf({ ...base, status: 'pending_verification', checkInMs: T(10, 1) }, 5)).toBe('pending');
  });
  it('verified record uses stored timing, else derives it', () => {
    expect(categoryOf({ ...base, status: 'present', timing: 'late', checkInMs: T(10, 1) }, 5)).toBe('late');
    expect(categoryOf({ ...base, status: 'present', checkInMs: T(10, 20) }, 5)).toBe('late');
    expect(effectiveTiming({ ...base, status: 'present' }, 5)).toBe('on_time');
  });
  it('absent / excused / none', () => {
    expect(categoryOf({ ...base, status: 'absent' }, 5)).toBe('absent'); expect(categoryOf({ ...base, status: 'excused' }, 5)).toBe('excused'); expect(categoryOf(null, 5)).toBe('none');
  });
});

describe('percentage', () => {
  it('excused sessions are removed from the denominator; pending is not counted as attended', () => {
    const c = tally(['on_time', 'late', 'absent', 'excused', 'pending', 'none', 'early', 'left_early']);
    expect(c.expected).toBe(8); expect(c.attended).toBe(4); expect(c.pct).toBe(Math.round((4 / 7) * 1000) / 10);
    expect(c.pending).toBe(1); expect(c.none).toBe(1);
  });
  it('is null when nothing is expected', () => { expect(tally([]).pct).toBeNull(); expect(tally(['excused']).pct).toBeNull(); });
});

import { buildRows, groupRows, monthsBetween } from '@/lib/attendanceReport';
describe('report building', () => {
  const mk = (id: string, day: number, over: object = {}) => ({ id, title: 'Maths', startMs: Date.UTC(2026, 10, day, 10), endMs: Date.UTC(2026, 10, day, 11), localDate: `2026-11-${String(day).padStart(2, '0')}`, status: 'completed', teacherUid: 't1', teacherName: 'Mr A', classId: 'c1', className: 'JSS1', courseId: 'm1', courseName: 'Maths', studentUids: ['s1', 's2'], ...over });
  const sessions = [mk('a', 2), mk('b', 3), mk('c', 4, { status: 'cancelled' }), mk('d', 20)];
  const records = [
    { sessionId: 'a', studentUid: 's1', studentName: 'Ada', status: 'present' as const, timing: 'on_time' as const, checkInMs: Date.UTC(2026, 10, 2, 10, 1) },
    { sessionId: 'b', studentUid: 's1', studentName: 'Ada', status: 'pending_verification' as const, checkInMs: Date.UTC(2026, 10, 3, 10, 30) },
    { sessionId: 'a', studentUid: 's2', studentName: 'Bayo', status: 'excused' as const },
  ];
  const now = Date.UTC(2026, 10, 8);
  it('skips cancelled and future sessions', () => { const r = buildRows(sessions, records, 5, now, {}); expect(r.length).toBe(4); expect(new Set(r.map((x) => x.sessionId))).toEqual(new Set(['a', 'b'])); });
  it('missing records show as none, not absent', () => { const r = buildRows(sessions, records, 5, now, {}); expect(r.find((x) => x.sessionId === 'b' && x.studentUid === 's2')!.category).toBe('none'); });
  it('groups by student with percentages', () => {
    const g = groupRows(buildRows(sessions, records, 5, now, {}), 'student'); const ada = g.find((x) => x.label === 'Ada')!;
    expect(ada.counts.on_time).toBe(1); expect(ada.counts.pending).toBe(1); expect(ada.counts.pct).toBe(50);
    const bayo = g.find((x) => x.key === 's2')!; expect(bayo.counts.excused).toBe(1); expect(bayo.counts.none).toBe(1); expect(bayo.counts.pct).toBe(0);
  });
  it('filters by student and date range; onlyStudents restricts a parent to their children', () => {
    expect(buildRows(sessions, records, 5, now, { studentUid: 's1' }).length).toBe(2);
    expect(buildRows(sessions, records, 5, now, { from: '2026-11-03' }).length).toBe(2);
    expect(buildRows(sessions, records, 5, now, {}, {}, ['s2']).every((x) => x.studentUid === 's2')).toBe(true);
  });
  it('months between', () => { expect(monthsBetween('2026-10-15', '2027-01-02')).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']); });
});

describe('automatic link-click attendance record', () => {
  const base = { startMs: START };
  it('is final (not pending) and derives timing from the server check-in time', () => {
    expect(categoryOf({ ...base, status: 'present', timing: '', checkInMs: T(9, 58) }, 5)).toBe('early');
    expect(categoryOf({ ...base, status: 'present', timing: '', checkInMs: T(10, 3) }, 5)).toBe('on_time');
    expect(categoryOf({ ...base, status: 'present', timing: '', checkInMs: T(10, 9) }, 5)).toBe('late');
  });
  it('counts toward the attendance percentage immediately', () => {
    const c = tally(['on_time', 'late', 'absent']);
    expect(c.attended).toBe(2); expect(c.pending).toBe(0);
  });
});
