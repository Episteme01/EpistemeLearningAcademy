import { describe, it, expect } from 'vitest';
import { ADHKAR, ADHKAR_GROUPS, audioUrl, cleanReciters, dailyIndex, fmtCountdown, hijriOf, minutesInZone, nextPrayer, pad3, surahsAvailable, TAJWEED, toMinutes } from '../src/features/Islamic/lib';

describe('audio', () => {
  it('builds mp3quran urls', () => {
    expect(pad3(1)).toBe('001');
    expect(audioUrl({ server: 'https://server6.mp3quran.net/akdr' }, 114)).toBe('https://server6.mp3quran.net/akdr/114.mp3');
    expect(audioUrl({ server: 'https://server6.mp3quran.net/akdr/' }, 2)).toBe('https://server6.mp3quran.net/akdr/002.mp3');
  });
  it('parses the surah list and drops unusable reciters', () => {
    expect(surahsAvailable({ surah_list: '1,2,114,115,0,x' })).toEqual([1, 2, 114]);
    const r = cleanReciters({ reciters: [
      { id: 1, name: 'A', moshaf: [{ id: 1, name: 'm', server: 'https://s/a/', surah_total: 2, surah_list: '1,2' }] },
      { id: 2, name: 'B', moshaf: [{ id: 2, name: 'm', server: 'https://s/b/', surah_total: 0, surah_list: '' }] },
      { id: 3, name: 'C' },
    ] });
    expect(r.length).toBe(1);
    expect(cleanReciters(null)).toEqual([]);
  });
});
describe('prayer times', () => {
  const t = { Fajr: '05:12 (WAT)', Dhuhr: '12:30', Asr: '15:45', Maghrib: '18:20', Isha: '19:35' };
  it('finds the next prayer and wraps to Fajr', () => {
    expect(toMinutes('05:12 (WAT)')).toBe(312);
    expect(toMinutes('99:99')).toBe(null);
    expect(nextPrayer(t, 6 * 60)?.name).toBe('Dhuhr');
    const w = nextPrayer(t, 20 * 60);
    expect(w?.name).toBe('Fajr'); expect(w?.tomorrow).toBe(true); expect(w?.inMin).toBe(312 + 1440 - 1200);
    expect(nextPrayer({}, 10)).toBe(null);
    expect(fmtCountdown(125)).toBe('2h 5m'); expect(fmtCountdown(9)).toBe('9m');
  });
  it('reads the clock in Lagos time', () => {
    expect(minutesInZone(new Date('2026-11-12T11:30:00Z'), 'Africa/Lagos')).toBe(12 * 60 + 30);
  });
});
describe('hijri', () => {
  it('converts a known date (1 Ramadan 1445 ≈ 11 Mar 2024, Umm al-Qura)', () => {
    const h = hijriOf(new Date(Date.UTC(2024, 2, 11)));
    expect(h?.year).toBe(1445); expect(h?.month).toBe(9); expect(h?.day).toBe(1); expect(h?.monthName).toBe('Ramadan');
  });
});
describe('daily rotation', () => {
  it('cycles and stays in range', () => {
    const a = dailyIndex(new Date(Date.UTC(2026, 0, 1)), 42), b = dailyIndex(new Date(Date.UTC(2026, 0, 2)), 42);
    expect(a).toBe(0); expect(b).toBe(1);
    for (let d = 0; d < 400; d++) { const i = dailyIndex(new Date(Date.UTC(2026, 0, 1 + d)), 42); expect(i >= 0 && i < 42).toBe(true); }
    expect(dailyIndex(new Date(), 0)).toBe(0);
  });
});
describe('static content integrity', () => {
  it('every adhkar has text or a Qur’an reference, a count and a source', () => {
    for (const a of ADHKAR) { expect(!!(a.arabic || a.quran)).toBe(true); expect(a.times >= 1).toBe(true); expect(a.source.length > 3).toBe(true); }
    for (const g of ADHKAR_GROUPS) expect(ADHKAR.some((a) => a.group === g.id)).toBe(true);
    expect(new Set(ADHKAR.map((a) => a.id)).size).toBe(ADHKAR.length);
  });
  it('tajweed has levels with lessons', () => { expect(TAJWEED.length).toBe(3); for (const l of TAJWEED) expect(l.lessons.length > 0).toBe(true); });
});
