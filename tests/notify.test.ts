import { describe, expect, it } from 'vitest';
import { assignmentReminderDue, channelsFor, chunk, cleanOffsets, dueReminderOffsets, emailHtml, escapeHtml, noticeRecipients, reminderText, validEmail } from '../supabase/functions/notify/logic';

const MIN = 60_000;
const START = Date.UTC(2026, 10, 12, 9, 0);   // 10:00 Lagos

describe('class reminders', () => {
  it('fires each offset once the moment arrives, within the grace window', () => {
    expect(dueReminderOffsets(START, START - 60 * MIN, [60, 10])).toEqual([60]);
    expect(dueReminderOffsets(START, START - 58 * MIN, [60, 10])).toEqual([60]);
    expect(dueReminderOffsets(START, START - 10 * MIN, [60, 10])).toEqual([10]);
  });
  it('does not fire early, too late, or after the class starts', () => {
    expect(dueReminderOffsets(START, START - 70 * MIN, [60, 10])).toEqual([]);
    expect(dueReminderOffsets(START, START - 40 * MIN, [60, 10])).toEqual([]);   // 60-min reminder missed by 20 min: skipped, not sent late
    expect(dueReminderOffsets(START, START, [60, 10])).toEqual([]);
    expect(dueReminderOffsets(START, START + 5 * MIN, [60, 10])).toEqual([]);
  });
  it('every 5-minute tick catches each offset exactly once in window (dedup covers repeats)', () => {
    const hits = [] as number[];
    for (let t = START - 90 * MIN; t < START; t += 5 * MIN) hits.push(...dueReminderOffsets(START, t, [60, 10], 4));
    expect(hits.filter((m) => m === 60).length).toBe(1); expect(hits.filter((m) => m === 10).length).toBe(1);
  });
  it('cleans settings', () => { expect(cleanOffsets([10, 60, 60, 2, 99999, 'x'])).toEqual([60, 10]); expect(cleanOffsets(undefined)).toEqual([60, 10]); expect(cleanOffsets([30])).toEqual([30]); });
  it('message text uses Lagos time', () => {
    expect(reminderText('Maths', START, 10).title).toBe('Class in 10 minutes: Maths');
    expect(reminderText('Maths', START, 10).body).toMatch(/10:00/);
    expect(reminderText('Maths', START, 60).title).toBe('Class in 1 hour: Maths');
  });
});
describe('assignment reminders', () => {
  const DUE = Date.UTC(2026, 10, 13, 12, 0);
  it('24 hours before only', () => {
    expect(assignmentReminderDue(DUE, DUE - 24 * 60 * MIN, 24)).toBe(true);
    expect(assignmentReminderDue(DUE, DUE - 30 * 60 * MIN, 24)).toBe(false);
    expect(assignmentReminderDue(DUE, DUE - 12 * 60 * MIN, 24)).toBe(false);
    expect(assignmentReminderDue(DUE, DUE + MIN, 24)).toBe(false);
  });
});
describe('notice recipients', () => {
  const kids = [{ studentUid: 's1', parentUids: ['p1', 'p2'] }, { studentUid: 's2', parentUids: ['p2'] }, { parentUids: ['p3'] }];
  it('parents are de-duplicated', () => { expect(noticeRecipients('class_parents', kids).sort()).toEqual(['p1', 'p2', 'p3']); });
  it('students only include those with a login', () => { expect(noticeRecipients('class_students', kids).sort()).toEqual(['s1', 's2']); });
  it('both, staff, unknown', () => {
    expect(noticeRecipients('class_both', kids).length).toBe(5);
    expect(noticeRecipients('all_staff', [], ['t1', 't1', 't2'])).toEqual(['t1', 't2']);
    expect(noticeRecipients('nope' as never, kids)).toEqual([]);
  });
});
describe('channels and email', () => {
  it('respects preferences and availability', () => {
    expect(channelsFor(null, true, true, true, true)).toEqual({ inApp: true, email: true, push: true });
    expect(channelsFor({ email: false }, true, true, true, true).email).toBe(false);
    expect(channelsFor({ push: false }, true, true, true, true).push).toBe(false);
    expect(channelsFor(null, false, false, true, true)).toEqual({ inApp: true, email: false, push: false });
    expect(channelsFor(null, true, true, false, false)).toEqual({ inApp: true, email: false, push: false });
  });
  it('escapes html in emails', () => {
    expect(escapeHtml('<b>"x"</b>')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    expect(emailHtml('ELA', '<script>', 'a\nb', 'https://x.org/app')).not.toMatch(/<script>/);
  });
  it('validates emails and chunks', () => { expect(validEmail('a@b.co')).toBe(true); expect(validEmail('nope')).toBe(false); expect(validEmail(5)).toBe(false); expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]); });
});
