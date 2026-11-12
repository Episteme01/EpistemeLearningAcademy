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

import { ayahOfDay, DEFAULT_ALARMS, dueAlarms, newPosts, sanitizeTajweed, shareLinks, youtubeId } from '../src/features/Islamic/lib';
describe('v2 helpers', () => {
  it('extracts YouTube ids', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ?t=3')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://example.com/x')).toBe(null);
  });
  it('verse of the day is always a valid ayah number', () => {
    for (let d = 0; d < 800; d++) { const n = ayahOfDay(new Date(Date.UTC(2026, 0, 1 + d))); expect(n >= 1 && n <= 6236).toBe(true); }
    expect(ayahOfDay(new Date(Date.UTC(2026, 5, 1)))).toBe(ayahOfDay(new Date(Date.UTC(2026, 5, 1))));
  });
  it('tajweed sanitizer keeps colour classes and strips everything else', () => {
    const out = sanitizeTajweed('بِسْمِ <tajweed class=ham_wasl title="x" data-tajweed="ham_wasl">ٱ</tajweed><script>alert(1)</script><img src=x onerror=alert(1)><span class=end>١</span>');
    expect(out.includes('<script')).toBe(false); expect(out.includes('<img')).toBe(false); expect(out.includes('&lt;img')).toBe(true);
    expect(out.includes('class="tj-ham_wasl"')).toBe(true); expect(out.includes('class="tj-end"')).toBe(true);
    expect(sanitizeTajweed('<tajweed class="x\" onmouseover=\"y">t</tajweed>').includes('onmouseover')).toBe(false);
  });
  it('builds share links with encoded text', () => {
    const l = shareLinks('https://a.b/c?d=1', 'Hi & bye');
    expect(l.find((x) => x.id === 'whatsapp')!.href).toBe('https://wa.me/?text=Hi%20%26%20bye%20https%3A%2F%2Fa.b%2Fc%3Fd%3D1');
    expect(l.length).toBe(5);
  });
  it('alarms: prayer lead time, windows, de-duplication and off-by-default', () => {
    const t = { Fajr: '05:00', Dhuhr: '12:30', Asr: '15:45', Maghrib: '18:20', Isha: '19:35' };
    expect(dueAlarms(DEFAULT_ALARMS, t, 300, '2026-11-12', []).length).toBe(0);
    const s = { ...DEFAULT_ALARMS, prayers: { ...DEFAULT_ALARMS.prayers, Fajr: { on: true, before: 10 } }, quran: { on: true, time: '05:30' } };
    expect(dueAlarms(s, t, 289, '2026-11-12', []).length).toBe(0);
    const d = dueAlarms(s, t, 290, '2026-11-12', []);
    expect(d.length).toBe(1); expect(d[0].title).toBe('Fajr in 10 minutes');
    expect(dueAlarms(s, t, 292, '2026-11-12', []).length).toBe(1);
    expect(dueAlarms(s, t, 293, '2026-11-12', []).length).toBe(0);
    expect(dueAlarms(s, t, 290, '2026-11-12', [d[0].id]).length).toBe(0);
    expect(dueAlarms(s, t, 290, '2026-11-13', [d[0].id]).length).toBe(1);
    expect(dueAlarms(s, t, 330, '2026-11-12', []).map((x) => x.id)).toEqual(['2026-11-12:quran']);
    expect(dueAlarms(s, null, 290, '2026-11-12', []).length).toBe(0);
  });
  it('detects new blog posts', () => {
    expect(newPosts([{ publishedMs: 5 }, { publishedMs: 10 }], 5).length).toBe(1);
    expect(newPosts([], 0).length).toBe(0);
  });
});
