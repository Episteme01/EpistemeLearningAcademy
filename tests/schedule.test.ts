import { describe, expect, it } from 'vitest';
import { generateDates, MAX_OCCURRENCES } from '@/lib/schedule/recurrence';
import { monthGrid, shiftMonth, startOfWeek } from '@/lib/schedule/calendar';
import { minutesBetween, utcToZoned, zonedToUtc } from '@/lib/schedule/tz';

describe('timezone handling (Africa/Lagos = UTC+1, no DST)', () => {
  it('converts Lagos wall time to UTC and back', () => {
    const d = zonedToUtc('2026-11-09', '10:00', 'Africa/Lagos');
    expect(d.toISOString()).toBe('2026-11-09T09:00:00.000Z');
    expect(utcToZoned(d, 'Africa/Lagos')).toEqual({ date: '2026-11-09', time: '10:00', weekday: 1 });
  });
  it('shows the same instant correctly in other zones', () => {
    const d = zonedToUtc('2026-11-09', '23:30', 'Africa/Lagos');
    expect(utcToZoned(d, 'UTC').date).toBe('2026-11-09');
    expect(utcToZoned(d, 'Asia/Dubai')).toEqual({ date: '2026-11-10', time: '02:30', weekday: 2 });
  });
  it('handles a DST zone round trip', () => {
    const d = zonedToUtc('2026-07-01', '09:00', 'Europe/London');
    expect(d.toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });
  it('computes durations', () => { expect(minutesBetween('10:00', '11:30')).toBe(90); });
});

describe('recurrence', () => {
  it('single session', () => { expect(generateDates('2026-11-09', { freq: 'none', interval: 1, weekdays: [], end: { type: 'count', count: 1 } })).toEqual(['2026-11-09']); });
  it('daily with count', () => {
    expect(generateDates('2026-11-09', { freq: 'daily', interval: 2, weekdays: [], end: { type: 'count', count: 3 } })).toEqual(['2026-11-09', '2026-11-11', '2026-11-13']);
  });
  it('weekly on selected weekdays (Mon/Wed) starting on a Tuesday', () => {
    const r = generateDates('2026-11-10', { freq: 'weekly', interval: 1, weekdays: [1, 3], end: { type: 'count', count: 4 } });
    expect(r).toEqual(['2026-11-11', '2026-11-16', '2026-11-18', '2026-11-23']);
  });
  it('weekly defaults to the start weekday and respects end date', () => {
    const r = generateDates('2026-11-09', { freq: 'weekly', interval: 1, weekdays: [], end: { type: 'date', until: '2026-11-30' } });
    expect(r).toEqual(['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
  });
  it('every 2 weeks', () => {
    expect(generateDates('2026-11-09', { freq: 'weekly', interval: 2, weekdays: [], end: { type: 'count', count: 3 } })).toEqual(['2026-11-09', '2026-11-23', '2026-12-07']);
  });
  it('monthly clamps to month end', () => {
    expect(generateDates('2026-01-31', { freq: 'monthly', interval: 1, weekdays: [], end: { type: 'count', count: 3 } })).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
  it('caps runaway series', () => {
    expect(generateDates('2026-01-01', { freq: 'daily', interval: 1, weekdays: [], end: { type: 'count', count: 9999 } })).toHaveLength(MAX_OCCURRENCES);
  });
  it('end date before start gives nothing', () => {
    expect(generateDates('2026-11-09', { freq: 'daily', interval: 1, weekdays: [], end: { type: 'date', until: '2026-11-01' } })).toEqual([]);
  });
});

describe('calendar grid', () => {
  it('weeks start on Monday', () => { expect(startOfWeek('2026-11-08')).toBe('2026-11-02'); });
  it('month grid has 42 days, Monday first, covering the month', () => {
    const g = monthGrid('2026-11-15');
    expect(g).toHaveLength(42); expect(g[0]).toBe('2026-10-26'); expect(g.includes('2026-11-30')).toBe(true);
  });
  it('shifts months across year ends', () => { expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-01'); expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-01'); });
});
